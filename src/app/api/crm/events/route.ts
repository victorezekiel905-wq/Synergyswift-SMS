import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { refreshScore, upsertLead, setLeadStage } from "@/lib/admissions-crm";
import { appUrl } from "@/lib/school";

/** Tours, open days, assessment and interview sessions with their bookings. */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.admissions, "admissions");
  if (ctx instanceof NextResponse) return ctx;
  const past = new URL(req.url).searchParams.get("past") === "1";
  let q = ctx.sb.from("admission_events").select("*,admission_bookings(id,lead_id,name,email,phone,party_size,status,created_at)").eq("tenant_id", ctx.tenant.id);
  q = past ? q.lt("starts_at", new Date().toISOString()).order("starts_at", { ascending: false }).limit(50) : q.gte("starts_at", new Date(Date.now() - 86_400_000).toISOString()).order("starts_at").limit(200);
  const { data, error } = await q;
  if (error) return jsonError(error.message);
  const { data: t } = await ctx.sb.from("tenants").select("public_slug").eq("id", ctx.tenant.id).maybeSingle();
  return NextResponse.json({ events: data ?? [], booking_url: t?.public_slug ? `${appUrl(req)}/visit/${t.public_slug}` : null });
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), id: z.string().uuid().optional(), kind: z.enum(["tour", "open_day", "assessment", "interview"]), title: z.string().trim().min(2).max(120),
    starts_at: z.string().datetime({ offset: true }), ends_at: z.string().datetime({ offset: true }).nullish(), capacity: z.number().int().min(1).max(5000),
    location: z.string().trim().max(200).nullish(), details: z.string().trim().max(2000).nullish(), published: z.boolean().default(true) }),
  // Repeat a slot weekly (e.g. tours every Tuesday at 10:00 for 6 weeks).
  z.object({ action: z.literal("repeat"), id: z.string().uuid(), weeks: z.number().int().min(1).max(26) }),
  z.object({ action: z.literal("delete"), id: z.string().uuid() }),
  z.object({ action: z.literal("booking_status"), booking_id: z.string().uuid(), status: z.enum(["booked", "attended", "no_show", "cancelled"]) }),
  z.object({ action: z.literal("add_booking"), event_id: z.string().uuid(), name: z.string().trim().min(2).max(120), phone: z.string().trim().max(30).nullish(),
    email: z.string().trim().email().nullish().or(z.literal("")), party_size: z.number().int().min(1).max(20).default(1), lead_id: z.string().uuid().nullish() })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.admissions, "admissions");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  const svc = createServiceClient();
  if (b.action === "save") {
    const { action: _a, id, ...row } = b;
    if (row.ends_at && row.ends_at <= row.starts_at) return jsonError("the end is before the start");
    const { error } = id ? await ctx.sb.from("admission_events").update(row).eq("tenant_id", tid).eq("id", id)
      : await ctx.sb.from("admission_events").insert({ ...row, tenant_id: tid, created_by: ctx.userId });
    return error ? jsonError(error.message) : NextResponse.json({ ok: true });
  }
  if (b.action === "repeat") {
    const { data: e } = await ctx.sb.from("admission_events").select("*").eq("tenant_id", tid).eq("id", b.id).maybeSingle();
    if (!e) return jsonError("event not found", 404);
    const week = 7 * 86_400_000;
    const rows = Array.from({ length: b.weeks }, (_, i) => ({ tenant_id: tid, kind: e.kind, title: e.title, capacity: e.capacity, location: e.location, details: e.details, published: e.published, created_by: ctx.userId,
      starts_at: new Date(new Date(e.starts_at).getTime() + (i + 1) * week).toISOString(), ends_at: e.ends_at ? new Date(new Date(e.ends_at).getTime() + (i + 1) * week).toISOString() : null }));
    const { error } = await ctx.sb.from("admission_events").insert(rows);
    return error ? jsonError(error.message) : NextResponse.json({ created: rows.length });
  }
  if (b.action === "delete") {
    const { error } = await ctx.sb.from("admission_events").delete().eq("tenant_id", tid).eq("id", b.id);
    return error ? jsonError(error.message) : NextResponse.json({ ok: true });
  }
  if (b.action === "booking_status") {
    const { data: bk, error } = await ctx.sb.from("admission_bookings").update({ status: b.status }).eq("tenant_id", tid).eq("id", b.booking_id).select("lead_id").single();
    if (error) return jsonError(error.message);
    if (bk.lead_id) {
      await ctx.sb.from("lead_activities").insert({ tenant_id: tid, lead_id: bk.lead_id, kind: "meeting", body: `Visit marked ${b.status.replace("_", " ")}.`, actor_id: ctx.userId });
      await refreshScore(svc, tid, bk.lead_id);
    }
    return NextResponse.json({ ok: true });
  }
  // add_booking: staff book a family in (by phone, at the gate…)
  const { data: e } = await ctx.sb.from("admission_events").select("id,kind,capacity,admission_bookings(party_size,status)").eq("tenant_id", tid).eq("id", b.event_id).maybeSingle();
  if (!e) return jsonError("event not found", 404);
  const taken = (e.admission_bookings ?? []).filter((x: any) => x.status !== "cancelled").reduce((a: number, x: any) => a + x.party_size, 0);
  if (taken + b.party_size > e.capacity) return jsonError("this session is full");
  let leadId = b.lead_id ?? null;
  if (!leadId) leadId = (await upsertLead(svc, tid, { parent_name: b.name, phone: b.phone ?? null, email: b.email || null, source: e.kind === "open_day" ? "open_day" : "phone", consent: true }, ctx.userId, appUrl(req))).id;
  const { error } = await ctx.sb.from("admission_bookings").insert({ tenant_id: tid, event_id: e.id, lead_id: leadId, name: b.name, phone: b.phone ?? null, email: b.email || null, party_size: b.party_size });
  if (error) return jsonError(error.message);
  const { data: lead } = await svc.from("admission_leads").select("stage").eq("id", leadId).maybeSingle();
  if (lead?.stage === "enquiry" && ["tour", "open_day"].includes(e.kind)) await setLeadStage(svc, tid, leadId!, "tour_booked", ctx.userId);
  return NextResponse.json({ ok: true, lead_id: leadId }, { status: 201 });
}
