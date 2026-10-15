import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { studentName } from "@/lib/school";
import { CERT_KINDS, certificateText } from "@/lib/sis";
import { certificateFacts, issueCertificate } from "@/lib/sis-server";

export const dynamic = "force-dynamic";

/** Issued certificates, newest first, with the classes and students for issuing more. */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "sims");
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  const u = new URL(req.url).searchParams;
  let q = ctx.sb.from("certificates").select("id,kind,serial_no,title,issued_on,status,verify_token,revoked_reason,students(id,first_name,last_name,other_names,admission_no)")
    .eq("tenant_id", tid).order("created_at", { ascending: false }).limit(500);
  const kind = u.get("kind");
  if (kind && (CERT_KINDS as readonly string[]).includes(kind)) q = q.eq("kind", kind);
  const [{ data, error }, { data: classes }, { data: students }, { data: s }] = await Promise.all([
    q,
    ctx.sb.from("class_groups").select("id,name").eq("tenant_id", tid).order("name"),
    ctx.sb.from("students").select("id,first_name,last_name,other_names,admission_no,class_group_id,status").eq("tenant_id", tid).in("status", ["active", "graduated", "withdrawn"]).order("first_name").limit(10000),
    createServiceClient().from("tenant_settings").select("principal_name").eq("tenant_id", tid).maybeSingle()
  ]);
  if (error) return jsonError(error.message);
  return NextResponse.json({
    items: (data ?? []).map((c: any) => ({ ...c, student: c.students ? `${studentName(c.students)} (${c.students.admission_no})` : "—" })),
    classes: classes ?? [], students: (students ?? []).map((x: any) => ({ id: x.id, name: studentName(x), admission_no: x.admission_no, class_group_id: x.class_group_id, status: x.status })),
    principal: s?.principal_name ?? null
  });
}

const Common = {
  kind: z.enum(CERT_KINDS), title: z.string().trim().max(160).nullish(), remarks: z.string().trim().max(2000).nullish(), conduct: z.string().trim().max(200).nullish(),
  period: z.string().trim().max(120).nullish(), achievement_id: z.string().uuid().nullish()
};
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview"), student_id: z.string().uuid(), ...Common }),
  z.object({ action: z.literal("issue"), student_ids: z.array(z.string().uuid()).min(1).max(500), body: z.string().trim().max(6000).nullish(), ...Common,
    issued_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(), signer_name: z.string().trim().max(120).nullish(), signer_title: z.string().trim().max(80).nullish(), shared: z.boolean().default(true) }),
  z.object({ action: z.literal("revoke"), id: z.string().uuid(), reason: z.string().trim().min(3).max(300) })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.admin, "sims");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  const svc = createServiceClient();
  try {
    if (b.action === "preview") {
      const { data: st } = await ctx.sb.from("students").select("id").eq("tenant_id", tid).eq("id", b.student_id).maybeSingle();
      if (!st) return jsonError("student not found", 404);
      const facts = await certificateFacts(svc, tid, b.student_id, b.kind, b.achievement_id);
      if (b.remarks) facts.remarks = b.remarks;
      if (b.conduct) facts.conduct = b.conduct;
      if (b.period) facts.period = b.period;
      const { data: t } = await svc.from("tenant_settings").select("school_name").eq("tenant_id", tid).maybeSingle();
      // Transfer certificates and testimonials need a leaving date; warn rather than refuse.
      const warnings = [
        ...(["transfer", "testimonial"].includes(b.kind) && !facts.left_on ? ["This student has not been marked as left yet, so the leaving date is blank."] : []),
        ...(b.kind === "transfer" && facts.fees_cleared === false ? ["Fees are not fully paid: the certificate will say so."] : [])
      ];
      return NextResponse.json({ ...certificateText(b.kind, facts, t?.school_name ?? "the school", b.title), facts, warnings });
    }
    if (b.action === "issue") {
      const { data: owned } = await ctx.sb.from("students").select("id").eq("tenant_id", tid).in("id", b.student_ids);
      const ids = (owned ?? []).map((s: any) => s.id);
      if (!ids.length) return jsonError("no students found", 404);
      const out: { id: string; serial_no: string; verify_token: string }[] = [];
      for (const sid of ids) {
        out.push(await issueCertificate(svc, { tenantId: tid, studentId: sid, kind: b.kind, title: b.title, body: ids.length === 1 ? b.body : null, remarks: b.remarks, conduct: b.conduct,
          period: b.period, achievementId: ids.length === 1 ? b.achievement_id : null, issuedOn: b.issued_on, signerName: b.signer_name, signerTitle: b.signer_title, issuedBy: ctx.userId, shared: b.shared }));
      }
      await ctx.sb.from("audit_logs").insert({ tenant_id: tid, actor_id: ctx.userId, action: "certificates.issued", meta: { kind: b.kind, count: out.length } });
      return NextResponse.json({ ok: true, issued: out }, { status: 201 });
    }
    // A revoked certificate stays on record; its verification page says it is no longer valid.
    const { data, error } = await svc.from("certificates").update({ status: "revoked", revoked_reason: b.reason, revoked_at: new Date().toISOString() }).eq("tenant_id", tid).eq("id", b.id).eq("status", "issued").select("id").maybeSingle();
    if (error || !data) return jsonError(error?.message ?? "certificate not found or already revoked", 404);
    await ctx.sb.from("audit_logs").insert({ tenant_id: tid, actor_id: ctx.userId, action: "certificate.revoked", target: b.id, meta: { reason: b.reason } });
    return NextResponse.json({ ok: true });
  } catch (e) { return jsonError((e as Error).message); }
}
