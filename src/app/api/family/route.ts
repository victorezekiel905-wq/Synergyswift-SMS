import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { guardianByToken } from "@/lib/guardian";
import { respondToEvent, bookMeeting, cancelMeeting, requestExeat } from "@/lib/family";
import { LANGUAGES } from "@/lib/languages";
import { appUrl } from "@/lib/school";
import { createTicket, respondReenrolment } from "@/lib/community-server";
import { TICKET_CATEGORIES, REENROL_REASONS } from "@/lib/community";
import { recordConsent } from "@/lib/consent-server";
import { familyFileLink } from "@/lib/sis-server";
import { clientIp } from "@/lib/net";
import { requestAbsence, cancelAbsence, ABSENCE_KINDS } from "@/lib/attendance-server";

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
  z.object({ action: z.literal("ticket"), token: z.string().optional(), student_id: z.string().uuid().nullish(), kind: z.enum(["complaint", "request", "enquiry", "feedback"]).default("complaint"),
    category: z.enum(TICKET_CATEGORIES).default("other"), subject: z.string().trim().min(3).max(160), body: z.string().trim().min(5).max(3000) }),
  z.object({ action: z.literal("reenrol"), token: z.string().optional(), round_id: z.string().uuid(), student_id: z.string().uuid(), intent: z.enum(["returning", "not_returning", "undecided"]),
    reason: z.enum(REENROL_REASONS).nullish(), note: z.string().trim().max(500).nullish() }),
  z.object({ action: z.literal("consent"), token: z.string().optional(), purpose_id: z.string().uuid(), student_id: z.string().uuid().nullish(), granted: z.boolean() }),
  z.object({ action: z.literal("iep_agree"), token: z.string().optional(), iep_id: z.string().uuid(), views: z.string().trim().max(2000).nullish() }),
  z.object({ action: z.literal("open_file"), token: z.string().optional(), kind: z.enum(["document", "portfolio"]), id: z.string().uuid() }),
  z.object({ action: z.literal("absence"), token: z.string().optional(), student_id: z.string().uuid(), kind: z.enum(ABSENCE_KINDS),
    starts_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), ends_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reason: z.string().trim().min(3).max(1000) }),
  z.object({ action: z.literal("cancel_absence"), token: z.string().optional(), id: z.string().uuid() }),
  z.object({ action: z.literal("notice_read"), token: z.string().optional(), receipt_id: z.string().uuid(), ack: z.boolean().default(false) }),
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
      case "ticket": {
        const { count } = await svc.from("tickets").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("guardian_id", guardianId).gte("created_at", new Date(Date.now() - 86400_000).toISOString());
        if ((count ?? 0) >= 5) return jsonError("you have raised several requests today; please wait for a reply or call the school", 429);
        const t = await createTicket(svc, { tenantId, guardianId, studentId: b.student_id ?? null, kind: b.kind, category: b.category,
          priority: ["safety", "bullying", "health"].includes(b.category) ? "high" : "normal", channel: "portal", subject: b.subject, body: b.body, baseUrl: appUrl(req) });
        return NextResponse.json({ ok: true, ticket_no: t.ticket_no, token: t.token }, { status: 201 });
      }
      case "reenrol":
        return NextResponse.json(await respondReenrolment(svc, { tenantId, guardianId, roundId: b.round_id, studentId: b.student_id, intent: b.intent, reason: b.reason, note: b.note }));
      case "consent":
        return NextResponse.json(await recordConsent(svc, { tenantId, guardianId, purposeId: b.purpose_id, studentId: b.student_id ?? null, granted: b.granted,
          method: b.token ? "link" : "portal", ip: clientIp(req.headers), userAgent: req.headers.get("user-agent") }));
      case "iep_agree": {
        // The family reads the support plan and agrees, adding their own views.
        const { data: links } = await svc.from("student_guardians").select("student_id").eq("tenant_id", tenantId).eq("guardian_id", guardianId);
        const ids = (links ?? []).map((l: { student_id: string }) => l.student_id);
        const { data: plan } = await svc.from("ieps").select("id,parent_views").eq("tenant_id", tenantId).eq("id", b.iep_id).eq("status", "active").in("student_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]).maybeSingle();
        if (!plan) return jsonError("plan not found", 404);
        const views = b.views ? [plan.parent_views, `${new Date().toISOString().slice(0, 10)}: ${b.views}`].filter(Boolean).join("\n") : plan.parent_views;
        const { error } = await svc.from("ieps").update({ parent_agreed_at: new Date().toISOString(), parent_views: views, updated_at: new Date().toISOString() }).eq("id", plan.id);
        return error ? jsonError(error.message) : NextResponse.json({ ok: true });
      }
      case "open_file": {
        const { data: links } = await svc.from("student_guardians").select("student_id").eq("tenant_id", tenantId).eq("guardian_id", guardianId);
        return NextResponse.json({ url: await familyFileLink(svc, tenantId, (links ?? []).map((l: { student_id: string }) => l.student_id), b.kind, b.id) });
      }
      case "absence":
        return NextResponse.json(await requestAbsence(svc, { tenantId, guardianId, studentId: b.student_id, kind: b.kind, startsOn: b.starts_on, endsOn: b.ends_on,
          reason: b.reason, timezone, baseUrl: appUrl(req) }), { status: 201 });
      case "cancel_absence": return NextResponse.json(await cancelAbsence(svc, { tenantId, guardianId, id: b.id }));
      case "notice_read": {
        const now = new Date().toISOString();
        const { data: r } = await svc.from("notice_recipients").select("id,read_at,acknowledged_at").eq("tenant_id", tenantId).eq("guardian_id", guardianId).eq("id", b.receipt_id).maybeSingle();
        if (!r) return jsonError("not found", 404);
        await svc.from("notice_recipients").update({ read_at: r.read_at ?? now, ...(b.ack && !r.acknowledged_at ? { acknowledged_at: now } : {}) }).eq("id", r.id);
        return NextResponse.json({ ok: true });
      }
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
