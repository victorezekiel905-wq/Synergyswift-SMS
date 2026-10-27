/**
 * Admission decisions shared by the Applications screen and the entrance
 * automation (phase 14e): the offer letter, waiting-list and regret letters,
 * and booking an interview. Server only (service client).
 */
import { notifyContact, money } from "@/lib/notify";
import { admissionNote } from "@/lib/messaging/notices";
import { renderTemplate, DEFAULT_TEMPLATES } from "@/lib/crm";
import { brandAndPrincipal, syncLeadFromApplication } from "@/lib/admissions-crm";

const now = () => new Date().toISOString();
const longDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { dateStyle: "long" });

/** Issues (or re-issues) an offer: letter from the school's template, expiry, acceptance fee; the family signs online. */
export async function issueOffer(svc: any, app: any, base: string, opts: { acceptanceFee?: number | null; expiresOn?: string | null; validDays?: number | null; note?: string | null; defer?: boolean } = {}) {
  const tid = app.tenant_id;
  const [{ data: s }, { data: t }, { brand, principal }] = await Promise.all([
    svc.from("tenant_settings").select("acceptance_fee,offer_valid_days,currency").eq("tenant_id", tid).maybeSingle(),
    svc.from("admission_templates").select("subject,body").eq("tenant_id", tid).eq("kind", "offer").maybeSingle(),
    brandAndPrincipal(svc, tid)
  ]);
  const fee = opts.acceptanceFee ?? Number(s?.acceptance_fee ?? 0);
  const days = opts.validDays ?? s?.offer_valid_days ?? 14;
  const expires = opts.expiresOn ?? new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
  const tpl = t ?? DEFAULT_TEMPLATES.offer;
  const vars = { parent: app.guardian_name, child: `${app.first_name} ${app.last_name}`, school: brand.schoolName, level: app.applying_for, application_no: app.application_no,
    principal, fee: fee ? money(fee, s?.currency ?? "NGN") : "", expires: longDate(expires),
    fee_line: fee ? ` and pay the acceptance fee of ${money(fee, s?.currency ?? "NGN")}` : "" };
  const letter = { subject: renderTemplate(tpl.subject, vars), body: renderTemplate(tpl.body, vars), issued_at: now(), acceptance_fee: fee, expires_on: expires, note: opts.note ?? null };
  const { data: updated, error } = await svc.from("applications").update({ status: "offered", offer_letter: letter, offer_issued_at: letter.issued_at, offer_expires_on: expires,
    // (decided_at is set by the entrance automation, so this also works before migration 6200 is applied)
    acceptance_fee: fee, offer_accepted_at: null, offer_signature: null, offer_signer_name: null, offer_sign_meta: null, waitlist_position: null, updated_at: now() })
    .eq("tenant_id", tid).eq("id", app.id).select("*").single();
  if (error) throw new Error(error.message);
  await syncLeadFromApplication(svc, updated);
  const link = `${base}/apply/track/${app.tracking_token}/offer`;
  const sent = await notifyContact(svc, { tenantId: tid, name: app.guardian_name, email: app.guardian_email, phone: app.guardian_phone, kind: "admission", refId: app.id, defer: opts.defer,
    build: br => admissionNote(br, { name: app.guardian_name, subject: letter.subject, lines: [`${app.first_name} has been offered a place in ${app.applying_for} at ${br.schoolName}.`,
      `Please read and sign the offer letter by ${vars.expires}.`, ...(opts.note ? [opts.note] : [])], link, linkLabel: "Read and accept the offer" }) });
  return { link, sent, app: updated };
}

/** Sends a waiting-list or regret letter from the school's template. */
export async function sendDecisionLetter(svc: any, app: any, kind: "waitlist" | "regret", base: string, defer = false) {
  const { data: t } = await svc.from("admission_templates").select("subject,body").eq("tenant_id", app.tenant_id).eq("kind", kind).maybeSingle();
  const tpl = t ?? DEFAULT_TEMPLATES[kind];
  const { brand } = await brandAndPrincipal(svc, app.tenant_id);
  const vars = { parent: app.guardian_name, child: app.first_name, school: brand.schoolName, level: app.applying_for, application_no: app.application_no };
  return notifyContact(svc, { tenantId: app.tenant_id, name: app.guardian_name, email: app.guardian_email, phone: app.guardian_phone, kind: "admission", refId: app.id, defer,
    build: b => admissionNote(b, { name: app.guardian_name, subject: renderTemplate(tpl.subject, vars), lines: renderTemplate(tpl.body, vars).split(/\n+/).filter(Boolean).slice(1),
      link: `${base}/apply/track/${app.tracking_token}`, linkLabel: "View application" }) });
}

/** Puts an application on the waiting list at a position (and tells the family the first time). */
export async function waitlist(svc: any, app: any, position: number | null, base: string, defer = false) {
  const first = app.status !== "waitlisted";
  const { data: updated, error } = await svc.from("applications").update({ status: "waitlisted", waitlist_position: position, decided_at: first ? now() : app.decided_at, updated_at: now() })
    .eq("id", app.id).select("*").single();
  if (error) throw new Error(error.message);
  await syncLeadFromApplication(svc, updated);
  return first ? sendDecisionLetter(svc, updated, "waitlist", base, defer) : 0;
}

/** Declines an application with the regret letter. */
export async function regret(svc: any, app: any, base: string, defer = false) {
  const { data: updated, error } = await svc.from("applications").update({ status: "rejected", waitlist_position: null, decided_at: now(), updated_at: now() })
    .eq("id", app.id).select("*").single();
  if (error) throw new Error(error.message);
  await syncLeadFromApplication(svc, updated);
  return sendDecisionLetter(svc, updated, "regret", base, defer);
}

/**
 * Books the next interview slot with room (an "interview" session under Tours & open days, at
 * least 12 hours away) and tells the family, with a link to see or cancel the booking. With no
 * slot free, the family is told the school will be in touch and the family's record says so.
 */
export async function bookInterview(svc: any, app: any, base: string, defer = false) {
  const { data: events } = await svc.from("admission_events").select("id,title,starts_at,location,capacity,admission_bookings(party_size,status)")
    .eq("tenant_id", app.tenant_id).eq("kind", "interview").gte("starts_at", new Date(Date.now() + 12 * 3_600_000).toISOString()).order("starts_at").limit(50);
  const ev = (events ?? []).find((e: any) => (e.admission_bookings ?? []).filter((b: any) => b.status !== "cancelled").reduce((a: number, b: any) => a + Number(b.party_size), 0) < e.capacity);
  let booking: { token: string } | null = null;
  if (ev) {
    const { data } = await svc.from("admission_bookings").insert({ tenant_id: app.tenant_id, event_id: ev.id, lead_id: app.lead_id ?? null,
      name: `${app.first_name} ${app.last_name} (${app.guardian_name})`, email: app.guardian_email, phone: app.guardian_phone, party_size: 1 }).select("token").single();
    booking = data;
  }
  const { data: updated } = await svc.from("applications").update({ status: "interview", interview_at: ev?.starts_at ?? null, updated_at: now() }).eq("id", app.id).select("*").single();
  if (updated) await syncLeadFromApplication(svc, updated);
  if (app.lead_id) await svc.from("lead_activities").insert({ tenant_id: app.tenant_id, lead_id: app.lead_id, kind: "system",
    body: ev ? `Interview booked automatically: ${ev.title}, ${new Date(ev.starts_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}.` : "Needs an interview, but no interview slot has room. Add one under Tours & open days." });
  const when = ev ? new Date(ev.starts_at).toLocaleString("en-GB", { dateStyle: "full", timeStyle: "short" }) : null;
  return notifyContact(svc, { tenantId: app.tenant_id, name: app.guardian_name, email: app.guardian_email, phone: app.guardian_phone, kind: "admission", refId: app.id, defer,
    build: b => admissionNote(b, { name: app.guardian_name, subject: `Interview for ${app.first_name}`,
      lines: ev ? [`Thank you for ${app.first_name}'s entrance test. We would like to meet ${app.first_name} for a short interview.`, `${when}${ev.location ? `, ${ev.location}` : ""}.`, "If this time does not suit you, use the link to cancel and the school will offer another."]
        : [`Thank you for ${app.first_name}'s entrance test. We would like to meet ${app.first_name} for a short interview; the school will contact you with a time.`],
      link: booking ? `${base}/visit/booking/${booking.token}` : `${base}/apply/track/${app.tracking_token}`, linkLabel: booking ? "See the interview booking" : "View application" }) });
}
