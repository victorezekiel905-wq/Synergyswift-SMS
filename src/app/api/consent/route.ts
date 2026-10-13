import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { studentName } from "@/lib/school";
import { coverage, nextVersion, stateFor } from "@/lib/consent";
import { consentRegister, ensurePurposes, recordConsent } from "@/lib/consent-server";

export const dynamic = "force-dynamic";

/** Purposes, coverage and (with ?student=) one child's consents. Admins manage; staff may look a child up. */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff);
  if (ctx instanceof NextResponse) return ctx;
  const svc = createServiceClient();
  const tid = ctx.tenant.id;
  const reg = await consentRegister(svc, tid);
  const studentId = new URL(req.url).searchParams.get("student");
  const purpose = new URL(req.url).searchParams.get("purpose");
  const active = reg.purposes.filter(p => p.active);
  // Which children may (or may not) be photographed, for example.
  const list = purpose ? (() => {
    const p = active.find(x => x.id === purpose && x.per_child);
    if (!p) return null;
    return reg.students.map(s => ({ id: s.id, name: studentName(s), admission_no: s.admission_no, class_name: s.class_groups?.name ?? null, state: stateFor(p, reg.records, { studentId: s.id }).state }))
      .sort((a, b) => (a.class_name ?? "").localeCompare(b.class_name ?? "") || a.name.localeCompare(b.name));
  })() : null;
  const child = studentId ? reg.students.find(s => s.id === studentId) : null;
  const { data: s } = await svc.from("tenant_settings").select("privacy_notice,privacy_notice_version").eq("tenant_id", tid).maybeSingle();
  return NextResponse.json({
    purposes: reg.purposes, privacy_notice: s?.privacy_notice ?? "", privacy_notice_version: s?.privacy_notice_version ?? 1,
    coverage: coverage(active, reg.records, reg.students.map(x => x.id), reg.guardianIds),
    list,
    child: child ? { id: child.id, name: studentName(child), items: active.filter(p => p.per_child).map(p => ({ purpose_id: p.id, title: p.title, ...stateFor(p, reg.records, { studentId: child.id }) })) } : null,
    students: reg.students.map(x => ({ id: x.id, name: studentName(x), admission_no: x.admission_no })).sort((a, b) => a.name.localeCompare(b.name))
  });
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("purpose"), id: z.string().uuid().nullish(), key: z.string().regex(/^[a-z0-9_]{2,40}$/).optional(), title: z.string().trim().min(2).max(120),
    description: z.string().trim().max(2000), per_child: z.boolean(), required: z.boolean(), active: z.boolean(), position: z.number().int().min(0).max(100) }),
  z.object({ action: z.literal("record"), purpose_id: z.string().uuid(), student_id: z.string().uuid().nullish(), guardian_id: z.string().uuid().nullish(), granted: z.boolean(),
    method: z.enum(["paper", "staff", "email"]), note: z.string().trim().max(300).nullish() }),
  z.object({ action: z.literal("notice"), text: z.string().trim().max(20000) })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.admin);
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  const svc = createServiceClient();
  try {
    if (b.action === "purpose") {
      await ensurePurposes(svc, tid);
      if (b.id) {
        const { data: old } = await ctx.sb.from("consent_purposes").select("title,description,version").eq("tenant_id", tid).eq("id", b.id).maybeSingle();
        if (!old) return jsonError("not found", 404);
        const version = nextVersion(old, b);
        const { error } = await ctx.sb.from("consent_purposes").update({ title: b.title, description: b.description, per_child: b.per_child, required: b.required, active: b.active,
          position: b.position, version, updated_at: new Date().toISOString() }).eq("tenant_id", tid).eq("id", b.id);
        if (error) return jsonError(error.message);
        return NextResponse.json({ ok: true, reasked: version !== old.version });
      }
      const key = b.key ?? b.title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40);
      const { error } = await ctx.sb.from("consent_purposes").insert({ tenant_id: tid, key, title: b.title, description: b.description, per_child: b.per_child, required: b.required, active: b.active, position: b.position });
      return error ? jsonError(error.message.includes("duplicate") ? "a permission with that name exists" : error.message) : NextResponse.json({ ok: true });
    }
    if (b.action === "record") {
      // A paper form or a phone call: recorded under the admin's name.
      return NextResponse.json(await recordConsent(svc, { tenantId: tid, guardianId: b.guardian_id ?? null, purposeId: b.purpose_id, studentId: b.student_id ?? null,
        granted: b.granted, method: b.method, recordedBy: ctx.userId, note: b.note ?? null }));
    }
    const { data: cur } = await svc.from("tenant_settings").select("privacy_notice,privacy_notice_version").eq("tenant_id", tid).maybeSingle();
    const changed = (cur?.privacy_notice ?? "").trim() !== b.text;
    const { error } = await ctx.sb.from("tenant_settings").upsert({ tenant_id: tid, privacy_notice: b.text || null, privacy_notice_version: (cur?.privacy_notice_version ?? 1) + (changed && cur?.privacy_notice ? 1 : 0) }, { onConflict: "tenant_id" });
    return error ? jsonError(error.message) : NextResponse.json({ ok: true });
  } catch (e) { return jsonError((e as Error).message); }
}
