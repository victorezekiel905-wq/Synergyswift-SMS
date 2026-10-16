import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError, hasAny } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { appUrl, studentName } from "@/lib/school";
import { progress, contractText, auditTrail } from "@/lib/esign";
import { createRequest, sendLinks } from "@/lib/esign-server";

export const dynamic = "force-dynamic";

/**
 * E-signatures. GET: requests this person sent or manages, with progress, and
 * what is waiting for their own signature (?mine=1 for just that). GET ?id=
 * one request with every signer and the audit trail.
 */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx([...ROLES.staff, "parent"]);
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  const u = new URL(req.url).searchParams;
  const base = appUrl(req);
  const { data: myGuardian } = await ctx.sb.from("guardians").select("id").eq("tenant_id", tid).eq("user_id", ctx.userId);
  const gids = (myGuardian ?? []).map((g: any) => g.id);
  let mineQ = ctx.sb.from("signature_signers").select("id,token,status,student_id,signature_requests(id,title,kind,due_on,status,created_at),students(first_name,last_name,other_names)").eq("tenant_id", tid).in("status", ["pending", "viewed"]);
  mineQ = gids.length ? mineQ.or(`user_id.eq.${ctx.userId},guardian_id.in.(${gids.join(",")})`) : mineQ.eq("user_id", ctx.userId);
  const { data: mine } = await mineQ;
  const toSign = (mine ?? []).filter((s: any) => s.signature_requests?.status === "open").map((s: any) => ({
    id: s.id, link: `${base}/sign/${s.token}`, title: s.signature_requests.title, kind: s.signature_requests.kind, due_on: s.signature_requests.due_on, child: s.students ? studentName(s.students) : null
  }));
  if (u.get("mine") || !hasAny(ctx, ROLES.staff)) return NextResponse.json({ to_sign: toSign });

  const id = u.get("id");
  if (id) {
    const { data: r } = await ctx.sb.from("signature_requests").select("*,users:created_by(full_name),school_documents(title)").eq("tenant_id", tid).eq("id", id).maybeSingle();
    if (!r) return jsonError("not found", 404);
    const { data: signers } = await ctx.sb.from("signature_signers").select("id,signer_type,name,email,status,student_id,viewed_at,signed_at,typed_name,signature_png,decline_reason,signed_hash,ip,user_agent,students(first_name,last_name,other_names)")
      .eq("request_id", r.id).order("created_at");
    const list = (signers ?? []).map((s: any) => ({ ...s, child: s.students ? studentName(s.students) : null, students: undefined }));
    return NextResponse.json({ request: r, signers: list, progress: progress(list, r.rule), audit: auditTrail(r, list) });
  }
  const { data: reqs } = await ctx.sb.from("signature_requests").select("id,title,kind,rule,status,due_on,created_at,completed_at,created_by,users:created_by(full_name),signature_signers(id,status,student_id,name)")
    .eq("tenant_id", tid).order("created_at", { ascending: false }).limit(200);
  const admin = hasAny(ctx, [...ROLES.admin, ...ROLES.hr]);
  const { data: classes } = await ctx.sb.from("class_groups").select("id,name").eq("tenant_id", tid).order("name");
  const { data: docs } = await ctx.sb.from("school_documents").select("id,title").eq("tenant_id", tid).eq("status", "approved").order("title");
  return NextResponse.json({
    to_sign: toSign, admin, classes: classes ?? [], documents: docs ?? [],
    requests: (reqs ?? []).filter((r: any) => admin || r.created_by === ctx.userId).map((r: any) => ({ ...r, signature_signers: undefined, progress: progress(r.signature_signers ?? [], r.rule) }))
  });
}

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), title: z.string().trim().min(2).max(200), kind: z.enum(["form", "contract", "policy", "consent", "other"]).default("form"),
    body: z.string().max(100000).default(""), document_id: z.string().uuid().nullish(), due_on: DATE.nullish().or(z.literal("")),
    staff_ids: z.array(z.string().uuid()).max(500).default([]), class_group_ids: z.array(z.string().uuid()).max(50).default([]), student_ids: z.array(z.string().uuid()).max(3000).default([]),
    external: z.array(z.object({ name: z.string().trim().min(1).max(160), email: z.string().trim().email() })).max(20).default([]) }),
  z.object({ action: z.literal("from_contract"), contract_id: z.string().uuid() }),
  z.object({ action: z.literal("cancel"), id: z.string().uuid() }),
  z.object({ action: z.literal("remind"), id: z.string().uuid() })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff);
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  const svc = createServiceClient();
  const base = appUrl(req);
  try {
    if (b.action === "create") {
      if (!b.body.trim() && !b.document_id) return jsonError("Write the text to sign or attach a document.");
      if (b.external.length && !hasAny(ctx, [...ROLES.admin, ...ROLES.hr])) return jsonError("Only admins and HR send to people outside the school.", 403);
      let students = [...b.student_ids];
      if (b.class_group_ids.length) {
        const { data } = await svc.from("students").select("id").eq("tenant_id", tid).eq("status", "active").in("class_group_id", b.class_group_ids);
        students.push(...(data ?? []).map((s: any) => s.id));
      }
      students = [...new Set(students)];
      if (students.length && !hasAny(ctx, ROLES.admin)) {
        // Teachers send parents' forms only for classes they teach or tutor.
        const [{ data: o }, { data: f }, { data: st }] = await Promise.all([
          svc.from("subject_offerings").select("class_group_id").eq("tenant_id", tid).eq("teacher_id", ctx.userId),
          svc.from("class_groups").select("id").eq("tenant_id", tid).eq("form_teacher_id", ctx.userId),
          svc.from("students").select("id,class_group_id").in("id", students)
        ]);
        const mine = new Set([...(o ?? []).map((x: any) => x.class_group_id), ...(f ?? []).map((x: any) => x.id)]);
        if ((st ?? []).some((s: any) => !mine.has(s.class_group_id))) return jsonError("You can send parents' forms only for classes you teach.", 403);
      }
      if (!students.length && !b.staff_ids.length && !b.external.length) return jsonError("Choose who must sign.");
      const out = await createRequest(svc, tid, ctx.userId, base, { title: b.title, kind: b.kind, body: b.body, document_id: b.document_id ?? null, due_on: b.due_on || null,
        staff_ids: b.staff_ids, student_ids: students, external: b.external });
      return NextResponse.json({ ok: true, ...out });
    }
    if (b.action === "from_contract") {
      if (!hasAny(ctx, ROLES.hr)) return jsonError("forbidden", 403);
      const { data: c } = await svc.from("staff_contracts").select("*,staff(full_name,user_id)").eq("tenant_id", tid).eq("id", b.contract_id).maybeSingle();
      if (!c) return jsonError("not found", 404);
      if (!c.staff?.user_id) return jsonError("This person has no account to sign with; add one under Staff first.");
      if (c.accepted_at) return jsonError("This contract has already been accepted.");
      const { data: open } = await svc.from("signature_requests").select("id").eq("staff_contract_id", c.id).eq("status", "open").limit(1);
      if (open?.length) return jsonError("This contract is already waiting for a signature.", 409);
      const { data: s } = await svc.from("tenant_settings").select("school_name").eq("tenant_id", tid).maybeSingle();
      const out = await createRequest(svc, tid, ctx.userId, base, { title: `Employment contract: ${c.staff.full_name}`, kind: "contract",
        body: contractText(c, c.staff.full_name, s?.school_name ?? ctx.tenant.name), document_id: null, due_on: null, staff_contract_id: c.id,
        staff_ids: [c.staff.user_id], student_ids: [], external: [] });
      return NextResponse.json({ ok: true, ...out });
    }
    const { data: r } = await ctx.sb.from("signature_requests").select("id,title,due_on,status").eq("tenant_id", tid).eq("id", b.id).maybeSingle();
    if (!r) return jsonError("not found", 404);
    if (r.status !== "open") return jsonError("This request is closed.");
    if (b.action === "cancel") {
      const { error } = await ctx.sb.from("signature_requests").update({ status: "cancelled" }).eq("id", r.id);
      return error ? jsonError(error.message) : NextResponse.json({ ok: true });
    }
    const { data: waiting } = await svc.from("signature_signers").select("id,signer_type,user_id,guardian_id,student_id,name,email,token").eq("request_id", r.id).in("status", ["pending", "viewed"]);
    await sendLinks(svc, tid, base, r.id, r.title, r.due_on, waiting ?? []);
    return NextResponse.json({ ok: true, reminded: (waiting ?? []).length });
  } catch (e) {
    return jsonError((e as Error).message);
  }
}
