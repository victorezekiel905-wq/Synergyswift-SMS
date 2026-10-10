import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { jsonError, readJson } from "@/lib/auth";
import { tenantForEnquiry } from "@/lib/admissions";
import { upsertLead, setLeadStage } from "@/lib/admissions-crm";
import { detectSource } from "@/lib/crm";
import { notifyContact } from "@/lib/notify";
import { admissionNote } from "@/lib/messaging/notices";
import { formatInZone, loadBrand } from "@/lib/messaging/outbox";
import { appUrl } from "@/lib/school";

export const dynamic = "force-dynamic";

/** Public list of bookable tours and open days with seats left. */
export async function GET(_req: NextRequest, props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  const svc = createServiceClient();
  const t = await tenantForEnquiry(svc, slug);
  if (!t) return jsonError("This school's booking page is not available.", 404);
  const { data: events } = await svc.from("admission_events").select("id,kind,title,starts_at,ends_at,capacity,location,details,admission_bookings(party_size,status)")
    .eq("tenant_id", t.tenant.id).eq("published", true).in("kind", ["tour", "open_day"]).gte("starts_at", new Date().toISOString()).order("starts_at").limit(60);
  const s: any = t.settings;
  return NextResponse.json({
    school: { name: s.school_name ?? t.tenant.name, logo_url: s.logo_url ?? null, brand_color: s.brand_color ?? null, address: s.address ?? null, phone: s.phone ?? null },
    events: (events ?? []).map((e: any) => ({ id: e.id, kind: e.kind, title: e.title, starts_at: e.starts_at, ends_at: e.ends_at, location: e.location, details: e.details,
      seats_left: Math.max(0, e.capacity - (e.admission_bookings ?? []).filter((b: any) => b.status !== "cancelled").reduce((a: number, b: any) => a + b.party_size, 0)) }))
  });
}

const Body = z.object({
  event_id: z.string().uuid(), name: z.string().trim().min(2).max(120), phone: z.string().trim().min(7).max(30), email: z.string().trim().email().nullish().or(z.literal("")),
  party_size: z.number().int().min(1).max(10).default(1), child_name: z.string().trim().max(120).nullish(), applying_for: z.string().trim().max(60).nullish(),
  utm: z.record(z.string().max(120)).default({}), ref: z.string().trim().max(20).nullish(),
  consent: z.literal(true, { errorMap: () => ({ message: "please agree to be contacted about your visit" }) }), website: z.string().max(0).optional()
});

/** Books a place; creates or updates the family's lead and sends a confirmation with a calendar file. */
export async function POST(req: NextRequest, props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  const svc = createServiceClient();
  const t = await tenantForEnquiry(svc, slug);
  if (!t) return jsonError("This school's booking page is not available.", 404);
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => i.message).join("; "));
  const b = parsed.data;
  const { data: e } = await svc.from("admission_events").select("id,kind,title,starts_at,capacity,location,published,admission_bookings(party_size,status,phone)")
    .eq("tenant_id", t.tenant.id).eq("id", b.event_id).maybeSingle();
  if (!e || !e.published || new Date(e.starts_at) < new Date()) return jsonError("that session is not available");
  const active = (e.admission_bookings ?? []).filter((x: any) => x.status !== "cancelled");
  if (active.some((x: any) => x.phone === b.phone)) return jsonError("you are already booked for this session");
  if (active.reduce((a: number, x: any) => a + x.party_size, 0) + b.party_size > e.capacity) return jsonError("sorry, this session is now full; please choose another");
  const base = appUrl(req);
  const utm = Object.fromEntries(Object.entries(b.utm).filter(([k]) => /^utm_/.test(k)));
  const lead = await upsertLead(svc, t.tenant.id, { parent_name: b.name, phone: b.phone, email: b.email || null, child_name: b.child_name ?? null, applying_for: b.applying_for ?? null,
    source: e.kind === "open_day" ? "open_day" : detectSource(utm, null, b.ref), utm, referral_code: b.ref ?? null, consent: true }, null, base);
  const { data: booking, error } = await svc.from("admission_bookings").insert({ tenant_id: t.tenant.id, event_id: e.id, lead_id: lead.id, name: b.name, phone: b.phone, email: b.email || null, party_size: b.party_size }).select("token").single();
  if (error) return jsonError(error.message);
  const { data: l } = await svc.from("admission_leads").select("stage").eq("id", lead.id).maybeSingle();
  if (l?.stage === "enquiry") await setLeadStage(svc, t.tenant.id, lead.id, "tour_booked", null);
  const brand = await loadBrand(svc, t.tenant.id);
  const when = formatInZone(new Date(e.starts_at), brand.timezone);
  await notifyContact(svc, { tenantId: t.tenant.id, name: b.name, email: b.email || null, phone: b.phone, kind: "admissions_booking", refId: lead.id,
    build: br => admissionNote(br, { name: b.name, subject: `Booked: ${e.title}`, lines: [`You are booked for ${e.title} at ${br.schoolName} on ${when.date} at ${when.time}${b.party_size > 1 ? ` for ${b.party_size} people` : ""}.`,
      ...(e.location ? [`Where: ${e.location}`] : []), "Add it to your calendar or cancel from the link below."], link: `${base}/visit/booking/${booking.token}`, linkLabel: "View booking" }) });
  return NextResponse.json({ ok: true, token: booking.token }, { status: 201 });
}
