import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";
import { GuardianInput } from "@/lib/validators";
import { createServiceClient } from "@/lib/supabase/service";
import { enqueue, dispatchDue, loadBrand, rowsForGuardian } from "@/lib/messaging/outbox";
import { portalLink } from "@/lib/messaging/templates";
import { provisionUser } from "@/lib/provision";
import { appUrl, studentName } from "@/lib/school";
import { randomToken } from "@/lib/crypto";

const Body = z.discriminatedUnion("action", [
  // add a new guardian to a student, or link an existing one
  z.object({ action: z.literal("add"), student_id: z.string().uuid(), guardian_id: z.string().uuid().optional(), guardian: GuardianInput.optional() }),
  z.object({ action: z.literal("update"), guardian_id: z.string().uuid(), guardian: GuardianInput.partial() }),
  z.object({ action: z.literal("link_flags"), student_id: z.string().uuid(), guardian_id: z.string().uuid(),
    relation: z.string().trim().max(30).optional(), is_primary: z.boolean().optional(), can_pickup: z.boolean().optional() }),
  z.object({ action: z.literal("unlink"), student_id: z.string().uuid(), guardian_id: z.string().uuid() }),
  // WhatsApp / email the private portal link (rotate: issue a new link, old one stops working)
  z.object({ action: z.literal("send_portal_link"), guardian_id: z.string().uuid(), rotate: z.boolean().default(false) }),
  z.object({ action: z.literal("create_login"), guardian_id: z.string().uuid() })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.sims, "sims");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  const sb = ctx.sb;

  if (b.action === "add") {
    let gid = b.guardian_id ?? null;
    let relation = "parent", is_primary = false, can_pickup = true;
    if (!gid) {
      if (!b.guardian) return jsonError("guardian details required");
      ({ relation, is_primary, can_pickup } = b.guardian);
      const { relation: _r, is_primary: _p, can_pickup: _c, ...row } = b.guardian;
      const { data, error } = await sb.from("guardians").insert({ ...row, email: row.email || null, tenant_id: tid }).select("id").single();
      if (error) return jsonError(error.message);
      gid = data.id;
    }
    const { error } = await sb.from("student_guardians").upsert({ tenant_id: tid, student_id: b.student_id, guardian_id: gid, relation, is_primary, can_pickup },
      { onConflict: "student_id,guardian_id" });
    return error ? jsonError(error.message) : NextResponse.json({ guardian_id: gid });
  }
  if (b.action === "update") {
    const { relation: _r, is_primary: _p, can_pickup: _c, ...row } = b.guardian;
    if (row.email === "") row.email = null;
    const { error } = await sb.from("guardians").update(row).eq("tenant_id", tid).eq("id", b.guardian_id);
    return error ? jsonError(error.message) : NextResponse.json({ ok: true });
  }
  if (b.action === "link_flags") {
    const { action: _a, student_id, guardian_id, ...flags } = b;
    const { error } = await sb.from("student_guardians").update(flags).eq("tenant_id", tid).eq("student_id", student_id).eq("guardian_id", guardian_id);
    return error ? jsonError(error.message) : NextResponse.json({ ok: true });
  }
  if (b.action === "unlink") {
    const { error } = await sb.from("student_guardians").delete().eq("tenant_id", tid).eq("student_id", b.student_id).eq("guardian_id", b.guardian_id);
    return error ? jsonError(error.message) : NextResponse.json({ ok: true });
  }

  const { data: g } = await sb.from("guardians")
    .select("id,full_name,email,phone,whatsapp_phone,notify_email,notify_whatsapp,portal_token,user_id,student_guardians(students(first_name,last_name,other_names))")
    .eq("tenant_id", tid).eq("id", b.guardian_id).maybeSingle();
  if (!g) return jsonError("guardian not found", 404);
  const svc = createServiceClient();

  if (b.action === "create_login") {
    if (g.user_id) return jsonError("this guardian already has a login");
    try {
      const { userId } = await provisionUser(svc, { tenantId: tid, email: String(g.email ?? ""), fullName: g.full_name, role: "parent",
        redirectTo: `${appUrl(req)}/auth/welcome?next=/parent`, createdBy: ctx.userId });
      await svc.from("guardians").update({ user_id: userId }).eq("tenant_id", tid).eq("id", g.id);
      return NextResponse.json({ ok: true });
    } catch (e) { return jsonError((e as Error).message); }
  }

  // send_portal_link
  let token = g.portal_token as string;
  if (b.rotate) {
    token = randomToken(24);
    await svc.from("guardians").update({ portal_token: token }).eq("tenant_id", tid).eq("id", g.id);
  }
  const brand = await loadBrand(svc, tid);
  const names = (g.student_guardians ?? []).map((x: any) => studentName(x.students)).join(", ") || "your child";
  const link = `${appUrl(req)}/g/${token}`;
  const rows = rowsForGuardian(tid, { ...g, notify_email: true, notify_whatsapp: true }, "portal_link",
    portalLink(brand, { guardianName: g.full_name, studentNames: names, link }), g.id, ctx.userId);
  if (!rows.length) return jsonError("guardian has no valid email or WhatsApp number");
  await enqueue(svc, rows);
  const stats = await dispatchDue(svc, { budgetMs: 8000 });
  return NextResponse.json({ ok: true, queued: rows.length, delivery: stats, link });
}
