/**
 * Gate (sign-in / sign-out) and pickup-code logic shared by the kiosk, staff
 * self check-in, the parent portal and the guardian token portal.
 * All functions take the service client plus an explicit tenantId, and every
 * query filters on that tenant.
 */
import { enqueue, dispatchDue, guardiansByStudent, loadBrand, rowsForGuardian, formatInZone, type OutboxRow } from "./messaging/outbox";
import { gateEvent, pickupCode as pickupCodeMsg, pickupDone } from "./messaging/templates";
import { sendWhatsApp } from "./messaging/providers";
import { isLate, startOfTodayIso, studentName } from "./school";
import { pickupCodeHash, randomDigits } from "./crypto";

export type GatePerson =
  | { type: "student"; id: string; name: string; photo_url: string | null; class_name: string | null }
  | { type: "staff"; id: string; name: string; photo_url: null; class_name: string | null };

/** QR codes on ID cards encode "EDU:<card_code>"; staff can also type admission / staff numbers. */
export function normalizeScan(raw: string): string {
  return raw.trim().replace(/^EDU:/i, "").trim();
}

export async function resolvePerson(svc: any, tenantId: string, raw: string): Promise<GatePerson | null> {
  const code = normalizeScan(raw);
  if (!code || code.length > 80) return null;
  const { data: st } = await svc.from("students").select("id,first_name,last_name,other_names,photo_url,status,class_groups(name)")
    .eq("tenant_id", tenantId).or(`card_code.eq.${code.replace(/[,()]/g, "")},admission_no.eq.${code.replace(/[,()]/g, "")}`).limit(1);
  if (st?.[0] && st[0].status === "active") {
    const s = st[0];
    return { type: "student", id: s.id, name: studentName(s), photo_url: s.photo_url, class_name: s.class_groups?.name ?? null };
  }
  const { data: sf } = await svc.from("staff").select("id,full_name,status,position")
    .eq("tenant_id", tenantId).or(`card_code.eq.${code.replace(/[,()]/g, "")},staff_no.eq.${code.replace(/[,()]/g, "")}`).limit(1);
  if (sf?.[0] && sf[0].status !== "exited") return { type: "staff", id: sf[0].id, name: sf[0].full_name, photo_url: null, class_name: sf[0].position };
  return null;
}

export async function recordGateEvent(svc: any, p: {
  tenantId: string; timezone: string; person: GatePerson; direction: "in" | "out" | "auto";
  method: "kiosk" | "self" | "manual" | "pickup"; recordedBy: string | null; note?: string | null;
  lat?: number | null; lng?: number | null; notify?: boolean; viaLabel?: string | null;
}) {
  const col = p.person.type === "student" ? "student_id" : "staff_id";
  const since = startOfTodayIso(p.timezone);
  const { data: last } = await svc.from("gate_events").select("direction,at").eq("tenant_id", p.tenantId)
    .eq(col, p.person.id).gte("at", since).order("at", { ascending: false }).limit(1);
  const prev = last?.[0] as { direction: "in" | "out"; at: string } | undefined;
  const direction: "in" | "out" = p.direction === "auto" ? (prev?.direction === "in" ? "out" : "in") : p.direction;

  // Double scans within 60s are ignored (no duplicate parent alerts).
  if (prev && prev.direction === direction && Date.now() - new Date(prev.at).getTime() < 60_000) {
    return { duplicate: true, direction, late: false, at: prev.at, notified: 0 };
  }

  const { data: settings } = await svc.from("tenant_settings").select("staff_start_time,student_start_time,notify_gate_events")
    .eq("tenant_id", p.tenantId).maybeSingle();
  const now = new Date();
  const firstInToday = direction === "in" && !(last ?? []).length;
  const late = firstInToday && isLate(now, p.person.type === "student" ? settings?.student_start_time ?? "07:45" : settings?.staff_start_time ?? "08:00", p.timezone);

  const { data: ev, error } = await svc.from("gate_events").insert({
    tenant_id: p.tenantId, person_type: p.person.type, [col]: p.person.id, direction, method: p.method, late,
    recorded_by: p.recordedBy, note: p.note ?? null, lat: p.lat ?? null, lng: p.lng ?? null, at: now.toISOString()
  }).select("id,at").single();
  if (error) throw new Error(error.message);

  let notified = 0;
  if (p.person.type === "student" && p.notify !== false && settings?.notify_gate_events !== false) {
    const brand = await loadBrand(svc, p.tenantId);
    const { time, date } = formatInZone(now, p.timezone);
    const gs = (await guardiansByStudent(svc, p.tenantId, [p.person.id])).get(p.person.id) ?? [];
    const rows: OutboxRow[] = gs.flatMap(g => rowsForGuardian(p.tenantId, g, direction === "in" ? "gate_in" : "gate_out",
      gateEvent(brand, { guardianName: g.full_name, studentName: p.person.name, direction, time, date, via: p.viaLabel ?? null }), ev.id, p.recordedBy));
    if (rows.length) {
      await enqueue(svc, rows);
      await dispatchDue(svc, { budgetMs: 6000 });
      notified = rows.length;
    }
  }
  return { duplicate: false, direction, late, at: ev.at, notified, event_id: ev.id };
}

/** Creates a single-use pickup code for a guardian. Earlier active codes for the same child and guardian are revoked. */
export async function createPickupCode(svc: any, p: {
  tenantId: string; timezone: string; guardianId: string; studentId: string;
  delegateName?: string | null; delegatePhone?: string | null;
}) {
  const { data: link } = await svc.from("student_guardians")
    .select("can_pickup, guardians(id,full_name,email,phone,whatsapp_phone,notify_email,notify_whatsapp), students(id,first_name,last_name,other_names,status)")
    .eq("tenant_id", p.tenantId).eq("guardian_id", p.guardianId).eq("student_id", p.studentId).maybeSingle();
  if (!link || !link.guardians || !link.students) throw new Error("you are not linked to this student");
  if (!link.can_pickup) throw new Error("the school has not authorised you to collect this student; please contact the school");
  const { data: settings } = await svc.from("tenant_settings").select("pickup_code_ttl_min").eq("tenant_id", p.tenantId).maybeSingle();
  const ttl = settings?.pickup_code_ttl_min ?? 240;

  await svc.from("pickup_codes").update({ status: "revoked" }).eq("tenant_id", p.tenantId)
    .eq("student_id", p.studentId).eq("guardian_id", p.guardianId).eq("status", "active");

  // Retry on the (unlikely) event that the same code is already active in this school.
  let code = "";
  for (let i = 0; i < 5; i++) {
    code = randomDigits(6);
    const { data: clash } = await svc.from("pickup_codes").select("id").eq("tenant_id", p.tenantId)
      .eq("code_hash", pickupCodeHash(p.tenantId, code)).eq("status", "active").limit(1);
    if (!clash?.length) break;
  }
  const expires = new Date(Date.now() + ttl * 60_000);
  const { data: row, error } = await svc.from("pickup_codes").insert({
    tenant_id: p.tenantId, student_id: p.studentId, guardian_id: p.guardianId, code_hash: pickupCodeHash(p.tenantId, code),
    delegate_name: p.delegateName || null, delegate_phone: p.delegatePhone || null, expires_at: expires.toISOString()
  }).select("id,expires_at").single();
  if (error) throw new Error(error.message);

  const brand = await loadBrand(svc, p.tenantId);
  const sName = studentName(link.students);
  const g = link.guardians;
  const { time, date } = formatInZone(expires, p.timezone);
  const collector = p.delegateName || g.full_name;
  const msg = pickupCodeMsg(brand, { guardianName: g.full_name, studentName: sName, code, expires: `${time}, ${date}`, collector });
  const rows = rowsForGuardian(p.tenantId, g, "pickup_code", msg, row.id, null);
  if (rows.length) { await enqueue(svc, rows); await dispatchDue(svc, { budgetMs: 6000 }); }
  // The collector (driver, relative) gets the code directly on WhatsApp.
  if (p.delegatePhone) {
    await sendWhatsApp({ to: p.delegatePhone, text: `*${brand.schoolName}*\nYou have been authorised by ${g.full_name} to collect ${sName}. Pickup code: ${code}. Valid until ${time}, ${date}.` }).catch(() => null);
  }
  return { id: row.id, code, expires_at: row.expires_at, student_name: sName, collector };
}

export async function verifyPickupCode(svc: any, tenantId: string, code: string) {
  const clean = code.replace(/\D/g, "");
  if (clean.length !== 6) return null;
  const { data } = await svc.from("pickup_codes")
    .select("id,status,expires_at,delegate_name,delegate_phone,created_at,guardians(full_name,phone),students(id,first_name,last_name,other_names,photo_url,class_groups(name))")
    .eq("tenant_id", tenantId).eq("code_hash", pickupCodeHash(tenantId, clean)).eq("status", "active")
    .gt("expires_at", new Date().toISOString()).limit(1);
  return data?.[0] ?? null;
}

export async function releaseStudent(svc: any, p: { tenantId: string; timezone: string; pickupId: string; staffUserId: string }) {
  const { data: used } = await svc.from("pickup_codes")
    .update({ status: "used", used_at: new Date().toISOString(), verified_by: p.staffUserId })
    .eq("tenant_id", p.tenantId).eq("id", p.pickupId).eq("status", "active").gt("expires_at", new Date().toISOString())
    .select("id,student_id,delegate_name,guardians(full_name),students(id,first_name,last_name,other_names,photo_url,class_groups(name))")
    .maybeSingle();
  if (!used) throw new Error("code is no longer valid (already used, revoked or expired)");
  const collector = used.delegate_name || used.guardians?.full_name || "guardian";
  const person: GatePerson = { type: "student", id: used.student_id, name: studentName(used.students), photo_url: used.students?.photo_url ?? null, class_name: used.students?.class_groups?.name ?? null };
  const ev = await recordGateEvent(svc, { tenantId: p.tenantId, timezone: p.timezone, person, direction: "out", method: "pickup",
    recordedBy: p.staffUserId, note: `Collected by ${collector}`, notify: false });

  const brand = await loadBrand(svc, p.tenantId);
  const { time } = formatInZone(new Date(), p.timezone);
  const gs = (await guardiansByStudent(svc, p.tenantId, [used.student_id])).get(used.student_id) ?? [];
  const rows = gs.flatMap(g => rowsForGuardian(p.tenantId, g, "pickup_done", pickupDone(brand, { guardianName: g.full_name, studentName: person.name, collector, time }), used.id, p.staffUserId));
  if (rows.length) { await enqueue(svc, rows); await dispatchDue(svc, { budgetMs: 6000 }); }
  return { student: person, collector, at: ev.at, notified: rows.length };
}
