import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { guardianByToken } from "@/lib/guardian";
import { respondToEvent, bookMeeting, cancelMeeting, requestExeat } from "@/lib/family";
import { LANGUAGES } from "@/lib/languages";

/**
 * Parent actions for both portals. Identify the guardian by session (logged-in
 * parent) or by the private link token in the body.
 */
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("event"), token: z.string().optional(), student_id: z.string().uuid(), event_id: z.string().uuid(), consent: z.boolean(), note: z.string().trim().max(300).nullish() }),
  z.object({ action: z.literal("book"), token: z.string().optional(), student_id: z.string().uuid(), slot_id: z.string().uuid(), note: z.string().trim().max(300).nullish() }),
  z.object({ action: z.literal("cancel_booking"), token: z.string().optional(), slot_id: z.string().uuid() }),
  z.object({ action: z.literal("exeat"), token: z.string().optional(), student_id: z.string().uuid(), reason: z.string().trim().min(3).max(300),
    leave_at: z.string().datetime({ offset: true }), return_by: z.string().datetime({ offset: true }), collector: z.string().trim().max(120).nullish() }),
  z.object({ action: z.literal("medical"), token: z.string().optional(), student_id: z.string().uuid(), allergies: z.string().trim().max(500).nullish(),
    conditions: z.string().trim().max(500).nullish(), medications: z.string().trim().max(500).nullish(), emergency_contact: z.string().trim().max(200).nullish() }),
  z.object({ action: z.literal("language"), token: z.string().optional(), language: z.string().refine(l => l in LANGUAGES, "unsupported language").nullable() })
]);

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const svc = createServiceClient();
  let tenantId: string, guardianId: string, timezone: string;
  if (b.token) {
    const g = await guardianByToken(svc, b.token);
    if (!g) return jsonError("This link is invalid or has been replaced.", 404);
    tenantId = g.tenant_id; guardianId = g.id; timezone = g.tenants.timezone;
  } else {
    const ctx = await requireCtx();
    if (ctx instanceof NextResponse) return ctx;
    const { data: g } = await svc.from("guardians").select("id").eq("tenant_id", ctx.tenant.id).eq("user_id", ctx.userId).maybeSingle();
    if (!g) return jsonError("no guardian record is linked to this account", 403);
    tenantId = ctx.tenant.id; guardianId = g.id; timezone = ctx.tenant.timezone;
  }
  try {
    switch (b.action) {
      case "event": return NextResponse.json(await respondToEvent(svc, { tenantId, guardianId, studentId: b.student_id, eventId: b.event_id, consent: b.consent, note: b.note }));
      case "book": return NextResponse.json(await bookMeeting(svc, { tenantId, guardianId, studentId: b.student_id, slotId: b.slot_id, note: b.note, timezone }));
      case "cancel_booking": return NextResponse.json(await cancelMeeting(svc, { tenantId, guardianId, slotId: b.slot_id }));
      case "exeat": return NextResponse.json(await requestExeat(svc, { tenantId, guardianId, studentId: b.student_id, reason: b.reason, leaveAt: b.leave_at, returnBy: b.return_by, collector: b.collector }), { status: 201 });
      case "language": {
        const { error } = await svc.from("guardians").update({ language: b.language }).eq("tenant_id", tenantId).eq("id", guardianId);
        return error ? jsonError(error.message) : NextResponse.json({ ok: true });
      }
      case "medical": {
        const { data: link } = await svc.from("student_guardians").select("student_id").eq("tenant_id", tenantId).eq("guardian_id", guardianId).eq("student_id", b.student_id).maybeSingle();
        if (!link) return jsonError("you are not linked to this student", 403);
        const { action: _a, token: _t, ...row } = b;
        const { error } = await svc.from("medical_profiles").upsert({ ...row, tenant_id: tenantId, updated_at: new Date().toISOString() }, { onConflict: "student_id" });
        return error ? jsonError(error.message) : NextResponse.json({ ok: true });
      }
    }
  } catch (e) { return jsonError((e as Error).message); }
}
