/**
 * Student information system: database work for leaving, the enrolment
 * history and certificates. Callers must have authorised the action.
 */
import { createHmac, createHash, timingSafeEqual } from "crypto";
import { fetchAll } from "./results";
import { studentName } from "./school";
import { money } from "./notify";
import {
  attendanceRate, canonicalCertificate, certificateText, clearance, leavingEffect, yearsAttended,
  type CertFacts, type CertKind, type LeavingKind
} from "./sis";

// ---------------- history ----------------

export async function recordMovement(sb: any, m: { tenantId: string; studentId: string; kind: string; effectiveOn?: string | null; fromClass?: string | null; toClass?: string | null;
  sessionName?: string | null; school?: string | null; reason?: string | null; notes?: string | null; recordedBy?: string | null }) {
  return sb.from("student_movements").insert({ tenant_id: m.tenantId, student_id: m.studentId, kind: m.kind, effective_on: m.effectiveOn ?? new Date().toISOString().slice(0, 10),
    from_class: m.fromClass ?? null, to_class: m.toClass ?? null, session_name: m.sessionName ?? null, school: m.school ?? null, reason: m.reason ?? null, notes: m.notes ?? null,
    recorded_by: m.recordedBy ?? null });
}

/** What the office should settle before a child leaves. */
export async function clearanceFor(svc: any, tenantId: string, studentId: string) {
  const [{ data: inv }, { count: books }, { data: bed }, { data: wallet }, { data: s }] = await Promise.all([
    svc.from("fee_invoices").select("total,amount_paid").eq("tenant_id", tenantId).eq("student_id", studentId).in("status", ["issued", "part_paid"]),
    svc.from("library_loans").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("student_id", studentId).is("returned_at", null),
    svc.from("hostel_allocations").select("id").eq("tenant_id", tenantId).eq("student_id", studentId).is("ended_at", null).maybeSingle(),
    svc.from("wallets").select("balance").eq("tenant_id", tenantId).eq("student_id", studentId).maybeSingle(),
    svc.from("tenant_settings").select("currency").eq("tenant_id", tenantId).maybeSingle()
  ]);
  const balance = (inv ?? []).reduce((a: number, i: any) => a + Math.max(0, Number(i.total) - Number(i.amount_paid)), 0);
  const currency = s?.currency ?? "NGN";
  return clearance({ balance, unreturnedBooks: books ?? 0, hostelBed: Boolean(bed), walletBalance: Number(wallet?.balance ?? 0), currency }, n => money(n, currency));
}

/**
 * A child leaves: their status changes, their class place, bed and bus seat
 * are released, their own sign-in stops, and the leaving is written to their
 * history. Records are kept, never deleted.
 */
export async function leaveSchool(sb: any, svc: any, p: { tenantId: string; studentId: string; kind: LeavingKind; leftOn: string; reason?: string | null;
  destination?: string | null; notes?: string | null; actorId: string; addToAlumni?: boolean }) {
  const { data: st } = await sb.from("students").select("id,first_name,last_name,other_names,status,user_id,class_group_id,class_groups(name)").eq("tenant_id", p.tenantId).eq("id", p.studentId).maybeSingle();
  if (!st) throw new Error("student not found");
  if (st.status !== "active" && st.status !== "suspended") throw new Error("this student has already left");
  const fx = leavingEffect(p.kind);
  const { error } = await sb.from("students").update({ status: fx.status, class_group_id: null, left_on: p.leftOn, leaving_kind: p.kind, leaving_reason: p.reason ?? null,
    destination_school: p.destination ?? null }).eq("tenant_id", p.tenantId).eq("id", st.id);
  if (error) throw new Error(error.message);
  await recordMovement(sb, { tenantId: p.tenantId, studentId: st.id, kind: fx.movement, effectiveOn: p.leftOn, fromClass: st.class_groups?.name ?? null,
    school: p.destination ?? null, reason: p.reason ?? null, notes: p.notes ?? null, recordedBy: p.actorId });
  await svc.from("hostel_allocations").update({ ended_at: new Date().toISOString() }).eq("tenant_id", p.tenantId).eq("student_id", st.id).is("ended_at", null);
  await svc.from("transport_assignments").delete().eq("tenant_id", p.tenantId).eq("student_id", st.id);
  await svc.from("pickup_codes").update({ status: "expired" }).eq("tenant_id", p.tenantId).eq("student_id", st.id).eq("status", "active");
  if (st.user_id) await svc.from("users").update({ active: false }).eq("tenant_id", p.tenantId).eq("id", st.user_id);
  let alumnus = false;
  if (p.addToAlumni) {
    const { data: have } = await svc.from("alumni").select("id").eq("tenant_id", p.tenantId).eq("student_id", st.id).maybeSingle();
    if (!have) {
      await svc.from("alumni").insert({ tenant_id: p.tenantId, student_id: st.id, full_name: studentName(st), graduation_year: Number(p.leftOn.slice(0, 4)),
        last_class: st.class_groups?.name ?? null, source: "graduated", status: "active" });
      alumnus = true;
    }
  }
  return { ok: true, alumnus };
}

/** Back to school after leaving or suspension. */
export async function reinstate(sb: any, svc: any, p: { tenantId: string; studentId: string; classGroupId: string | null; reason?: string | null; actorId: string }) {
  const { data: st } = await sb.from("students").select("id,status,user_id").eq("tenant_id", p.tenantId).eq("id", p.studentId).maybeSingle();
  if (!st) throw new Error("student not found");
  if (st.status === "active") throw new Error("this student is already active");
  let toClass: string | null = null;
  if (p.classGroupId) toClass = (await sb.from("class_groups").select("name").eq("tenant_id", p.tenantId).eq("id", p.classGroupId).maybeSingle()).data?.name ?? null;
  const { error } = await sb.from("students").update({ status: "active", class_group_id: p.classGroupId, left_on: null, leaving_kind: null, leaving_reason: null, destination_school: null })
    .eq("tenant_id", p.tenantId).eq("id", st.id);
  if (error) throw new Error(error.message);
  if (st.user_id) await svc.from("users").update({ active: true }).eq("tenant_id", p.tenantId).eq("id", st.user_id);
  await recordMovement(sb, { tenantId: p.tenantId, studentId: st.id, kind: "reinstated", toClass, reason: p.reason ?? null, recordedBy: p.actorId });
  return { ok: true };
}

// ---------------- certificates ----------------

function key(): Buffer | null {
  if (process.env.REPORT_SIGNING_KEY) return createHash("sha256").update(`certificate:${process.env.REPORT_SIGNING_KEY}`).digest();
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return svc ? createHash("sha256").update(`certificate-sign:${svc}`).digest() : null;
}
export function signCertificate(c: Parameters<typeof canonicalCertificate>[0]): string | null {
  const k = key();
  return k ? createHmac("sha256", k).update(canonicalCertificate(c)).digest("base64url") : null;
}
export function certificateGenuine(c: Parameters<typeof canonicalCertificate>[0] & { signature: string | null }): boolean {
  const exp = signCertificate(c);
  if (!exp || !c.signature) return false;
  const a = Buffer.from(exp), b = Buffer.from(c.signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The facts a certificate prints, taken from the record at the moment it is issued. */
export async function certificateFacts(svc: any, tenantId: string, studentId: string, kind: CertKind, achievementId?: string | null): Promise<CertFacts> {
  const { data: s } = await svc.from("students").select("id,first_name,last_name,other_names,admission_no,date_of_birth,gender,admitted_on,left_on,leaving_reason,destination_school,class_groups(name)")
    .eq("tenant_id", tenantId).eq("id", studentId).maybeSingle();
  if (!s) throw new Error("student not found");
  const { data: lastMove } = await svc.from("student_movements").select("from_class").eq("student_id", studentId).not("from_class", "is", null).order("effective_on", { ascending: false }).limit(1).maybeSingle();
  const lastClass = s.class_groups?.name ?? lastMove?.from_class ?? null;
  const facts: CertFacts = { student: studentName(s), admission_no: s.admission_no, date_of_birth: s.date_of_birth, gender: s.gender, admitted_on: s.admitted_on, left_on: s.left_on,
    last_class: lastClass, leaving_reason: s.leaving_reason, destination_school: s.destination_school, years: yearsAttended(s.admitted_on, s.left_on) };
  if (kind === "transfer") {
    const { data: inv } = await svc.from("fee_invoices").select("total,amount_paid").eq("tenant_id", tenantId).eq("student_id", studentId).in("status", ["issued", "part_paid"]);
    facts.fees_cleared = !(inv ?? []).some((i: any) => Number(i.total) - Number(i.amount_paid) > 0);
  }
  if (kind === "testimonial" || kind === "attendance") {
    const marks = await fetchAll<any>(() => svc.from("class_attendance").select("status").eq("tenant_id", tenantId).eq("student_id", studentId).order("id"));
    facts.attendance_rate = attendanceRate(marks);
  }
  if (kind === "testimonial") {
    const { data: ach } = await svc.from("student_achievements").select("kind,title,award,level,achieved_on").eq("tenant_id", tenantId).eq("student_id", studentId).order("achieved_on", { ascending: false }).limit(30);
    facts.positions = (ach ?? []).filter((a: any) => a.kind === "leadership").map((a: any) => a.award || a.title);
    facts.achievements = (ach ?? []).filter((a: any) => a.kind !== "leadership").slice(0, 8).map((a: any) => [a.title, a.award].filter(Boolean).join(", "));
  }
  if (achievementId) {
    const { data: a } = await svc.from("student_achievements").select("title,award,level,achieved_on,description").eq("tenant_id", tenantId).eq("student_id", studentId).eq("id", achievementId).maybeSingle();
    if (a) { facts.award = a.award ? `${a.title}: ${a.award}` : a.title; facts.level = a.level; facts.achieved_on = a.achieved_on; facts.remarks = a.description ?? null; }
  }
  return facts;
}

export type IssueInput = {
  tenantId: string; studentId: string; kind: CertKind; title?: string | null; body?: string | null; remarks?: string | null; conduct?: string | null; period?: string | null;
  achievementId?: string | null; issuedOn?: string | null; signerName?: string | null; signerTitle?: string | null; issuedBy: string; shared?: boolean;
};

/** Numbers, words, signs and stores a certificate. Returns its id and verification token. */
export async function issueCertificate(svc: any, p: IssueInput) {
  const facts = await certificateFacts(svc, p.tenantId, p.studentId, p.kind, p.achievementId);
  if (p.remarks) facts.remarks = p.remarks;
  if (p.conduct) facts.conduct = p.conduct;
  if (p.period) facts.period = p.period;
  const { data: t } = await svc.from("tenant_settings").select("school_name,principal_name").eq("tenant_id", p.tenantId).maybeSingle();
  const school = t?.school_name ?? "the school";
  const text = certificateText(p.kind, facts, school, p.title);
  const { data: serial, error: sErr } = await svc.rpc("next_doc_no", { p_tenant: p.tenantId, p_kind: "cert" });
  if (sErr) throw new Error(sErr.message);
  const { data: row, error } = await svc.from("certificates").insert({
    tenant_id: p.tenantId, student_id: p.studentId, kind: p.kind, serial_no: serial, title: text.title, body: (p.body ?? text.body).trim(), data: facts,
    achievement_id: p.achievementId ?? null, issued_on: p.issuedOn ?? new Date().toISOString().slice(0, 10),
    signer_name: p.signerName ?? t?.principal_name ?? null, signer_title: p.signerTitle ?? "Principal", issued_by: p.issuedBy, shared_with_family: p.shared !== false
  }).select("id,tenant_id,student_id,kind,serial_no,issued_on,title,body,data,verify_token").single();
  if (error) throw new Error(error.message);
  const signature = signCertificate(row);
  if (signature) await svc.from("certificates").update({ signature }).eq("id", row.id);
  return { id: row.id as string, serial_no: row.serial_no as string, verify_token: row.verify_token as string };
}

/** A certificate by its public token, with whether it is genuine. */
export async function certificateByToken(svc: any, token: string) {
  if (!/^[0-9a-f]{32}$/i.test(token)) return null;
  const { data: c } = await svc.from("certificates").select("id,tenant_id,student_id,kind,serial_no,issued_on,title,body,data,status,revoked_reason,revoked_at,signature,signer_name,signer_title,tenants(status,name)")
    .eq("verify_token", token).maybeSingle();
  if (!c) return null;
  const { data: s } = await svc.from("tenant_settings").select("school_name,motto,address,logo_url,brand_color,principal_signature_url,stamp_url").eq("tenant_id", c.tenant_id).maybeSingle();
  return { c, genuine: certificateGenuine(c), school: { name: s?.school_name ?? c.tenants?.name ?? "School", motto: s?.motto ?? null, address: s?.address ?? null, logo_url: s?.logo_url ?? null,
    brand_color: s?.brand_color ?? null, signature_url: s?.principal_signature_url ?? null, stamp_url: s?.stamp_url ?? null } };
}

// ---------------- what families see ----------------

/** Achievements, certificates, approved work, shared documents and live support plans for a family's children. */
export async function familyRecords(svc: any, tenantId: string, studentIds: string[]) {
  if (!studentIds.length) return { achievements: [], certificates: [], portfolio: [], documents: [], plans: [] };
  const [ach, certs, port, docs, plans] = await Promise.all([
    svc.from("student_achievements").select("id,student_id,kind,title,award,level,achieved_on").eq("tenant_id", tenantId).in("student_id", studentIds).eq("shared_with_family", true).order("achieved_on", { ascending: false }).limit(100),
    svc.from("certificates").select("id,student_id,kind,title,serial_no,issued_on,verify_token").eq("tenant_id", tenantId).in("student_id", studentIds).eq("shared_with_family", true).eq("status", "issued").order("issued_on", { ascending: false }),
    svc.from("portfolio_items").select("id,student_id,title,kind,description,link_url,path,feedback,created_at,subjects(name)").eq("tenant_id", tenantId).in("student_id", studentIds).eq("status", "approved").eq("shared_with_family", true).order("created_at", { ascending: false }).limit(60),
    svc.from("student_documents").select("id,student_id,kind,name,created_at").eq("tenant_id", tenantId).in("student_id", studentIds).eq("shared_with_family", true).eq("confidential", false).order("created_at", { ascending: false }),
    svc.from("ieps").select("id,student_id,title,starts_on,review_on,student_voice,parent_views,parent_agreed_at,iep_targets(target,strategies,success_criteria,progress,position)").eq("tenant_id", tenantId).in("student_id", studentIds).eq("status", "active")
  ]);
  return {
    achievements: ach.data ?? [], certificates: certs.data ?? [],
    portfolio: (port.data ?? []).map((p: any) => ({ ...p, has_file: Boolean(p.path), path: undefined })),
    documents: docs.data ?? [],
    plans: (plans.data ?? []).map((p: any) => ({ ...p, iep_targets: [...(p.iep_targets ?? [])].sort((a: any, b: any) => a.position - b.position) }))
  };
}

/** A short-lived link to a shared document or portfolio file, after checking the family may see it. */
export async function familyFileLink(svc: any, tenantId: string, studentIds: string[], kind: "document" | "portfolio", id: string) {
  const q = kind === "document"
    ? svc.from("student_documents").select("path,name").eq("tenant_id", tenantId).eq("id", id).in("student_id", studentIds).eq("shared_with_family", true).eq("confidential", false)
    : svc.from("portfolio_items").select("path,title").eq("tenant_id", tenantId).eq("id", id).in("student_id", studentIds).eq("status", "approved").eq("shared_with_family", true);
  const { data } = await q.maybeSingle();
  if (!data?.path) throw new Error("not found");
  const { data: link } = await svc.storage.from("student-documents").createSignedUrl(data.path, 120);
  if (!link?.signedUrl) throw new Error("could not open the file");
  return link.signedUrl as string;
}
