/**
 * Student information system: leaving, SEN, IEPs and certificates. Pure
 * functions and vocabularies only (no I/O), unit tested.
 */

export const MOVEMENT_LABEL: Record<string, string> = {
  admitted: "Admitted", promoted: "Promoted", repeated: "Repeated the year", class_change: "Moved class", transferred_in: "Joined from another school",
  transferred_out: "Transferred to another school", withdrawn: "Withdrawn", graduated: "Graduated", suspended: "Suspended", reinstated: "Reinstated",
  expelled: "Expelled", other: "Other"
};

export const LEAVING_KINDS = ["transferred", "withdrawn", "graduated", "expelled", "deceased", "other"] as const;
export type LeavingKind = (typeof LEAVING_KINDS)[number];
export const LEAVING_LABEL: Record<LeavingKind, string> = {
  transferred: "Transferred to another school", withdrawn: "Withdrawn by the family", graduated: "Completed school (graduated)", expelled: "Expelled", deceased: "Deceased", other: "Other"
};
/** The student status and history entry for each way of leaving. */
export function leavingEffect(kind: LeavingKind): { status: "graduated" | "withdrawn"; movement: string } {
  if (kind === "graduated") return { status: "graduated", movement: "graduated" };
  if (kind === "transferred") return { status: "withdrawn", movement: "transferred_out" };
  if (kind === "expelled") return { status: "withdrawn", movement: "expelled" };
  return { status: "withdrawn", movement: kind === "withdrawn" ? "withdrawn" : "other" };
}

export type ClearanceInput = { balance: number; unreturnedBooks: number; hostelBed: boolean; walletBalance: number; currency: string };
export type ClearanceItem = { key: string; label: string; ok: boolean; detail: string };
/** What should be settled before a child leaves. Nothing here blocks leaving; it is a checklist for the office. */
export function clearance(i: ClearanceInput, money: (n: number) => string): ClearanceItem[] {
  return [
    { key: "fees", label: "Fees", ok: i.balance <= 0, detail: i.balance > 0 ? `${money(i.balance)} still owed` : "Nothing owed" },
    { key: "library", label: "Library books", ok: i.unreturnedBooks === 0, detail: i.unreturnedBooks ? `${i.unreturnedBooks} book${i.unreturnedBooks === 1 ? "" : "s"} not returned` : "All returned" },
    { key: "boarding", label: "Boarding", ok: !i.hostelBed, detail: i.hostelBed ? "Still holds a bed (released when they leave)" : "No bed held" },
    { key: "wallet", label: "Tuck-shop wallet", ok: i.walletBalance <= 0, detail: i.walletBalance > 0 ? `${money(i.walletBalance)} to refund to the family` : "Empty" }
  ];
}

// ---------------- SEN ----------------

export const SEN_STATUS: Record<string, string> = { monitoring: "Monitoring", sen_support: "SEN support", ehcp: "EHC plan / statement", closed: "No longer on the register" };
export const SEN_AREAS: Record<string, string> = {
  cognition_learning: "Cognition and learning", communication_interaction: "Communication and interaction",
  semh: "Social, emotional and mental health", sensory_physical: "Sensory and/or physical"
};
export const SEN_NEEDS: Record<string, string> = {
  dyslexia: "Dyslexia", dyscalculia: "Dyscalculia", dyspraxia: "Dyspraxia (DCD)", adhd: "ADHD", autism: "Autism", speech_language: "Speech and language",
  mld: "Moderate learning difficulty", sld: "Severe learning difficulty", hearing: "Hearing impairment", visual: "Visual impairment", physical: "Physical disability",
  epilepsy: "Epilepsy", sickle_cell: "Sickle cell disease", anxiety: "Anxiety", gifted: "Gifted and talented", other: "Other"
};
export const ARRANGEMENTS: Record<string, string> = {
  reader: "Reader", scribe: "Scribe", rest_breaks: "Rest breaks", separate_room: "Separate room", enlarged_print: "Enlarged print",
  coloured_overlay: "Coloured overlay", assistive_tech: "Laptop / assistive technology", prompter: "Prompter", seating: "Front seating"
};
export const PROGRESS: Record<string, string> = { not_started: "Not started", emerging: "Emerging", developing: "Developing", secure: "Secure", achieved: "Achieved" };

/** Minutes added to an exam for a student with extra time (25% of 60 minutes = 15). */
export function extraMinutes(durationMinutes: number, pct: number | null | undefined): number {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  return Math.ceil((durationMinutes * p) / 100);
}

/** Where an IEP stands against its review date. */
export function iepReviewState(review_on: string | null, status: string, today = new Date().toISOString().slice(0, 10)): "none" | "due_soon" | "overdue" | "ok" {
  if (status !== "active" || !review_on) return "none";
  if (review_on < today) return "overdue";
  const days = (Date.parse(review_on) - Date.parse(today)) / 86400_000;
  return days <= 14 ? "due_soon" : "ok";
}

export function targetProgress(targets: { progress: string }[]) {
  const n = targets.length;
  const achieved = targets.filter(t => t.progress === "achieved").length;
  const onTrack = targets.filter(t => ["secure", "achieved"].includes(t.progress)).length;
  return { total: n, achieved, on_track: onTrack, pct: n ? Math.round((onTrack / n) * 100) : null };
}

// ---------------- certificates ----------------

export const CERT_KINDS = ["award", "transfer", "testimonial", "completion", "attendance", "participation", "custom"] as const;
export type CertKind = (typeof CERT_KINDS)[number];
export const CERT_LABEL: Record<CertKind, string> = {
  award: "Award certificate", transfer: "Transfer certificate", testimonial: "Testimonial", completion: "Certificate of completion",
  attendance: "Attendance award", participation: "Certificate of participation", custom: "Certificate"
};

export type CertFacts = {
  student: string; admission_no: string; date_of_birth?: string | null; gender?: string | null; admitted_on?: string | null; left_on?: string | null;
  last_class?: string | null; leaving_reason?: string | null; destination_school?: string | null; fees_cleared?: boolean | null;
  conduct?: string | null; years?: string | null; positions?: string[]; achievements?: string[]; attendance_rate?: number | null;
  award?: string | null; level?: string | null; achieved_on?: string | null; period?: string | null; remarks?: string | null;
};

const d = (s: string | null | undefined) => (s ? new Date(`${s}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "—");
const list = (xs: string[] | undefined) => (xs?.length ? xs.join("; ") : "None recorded");

/** Default title and wording for a certificate, from the facts. Staff may edit before issuing. */
export function certificateText(kind: CertKind, f: CertFacts, school: string, title?: string | null): { title: string; body: string } {
  switch (kind) {
    case "transfer":
      return { title: title || "Transfer Certificate", body: [
        `This is to certify that ${f.student} (admission number ${f.admission_no}) was a student of ${school}.`,
        `Date of birth: ${d(f.date_of_birth)}. Admitted: ${d(f.admitted_on)}. Left: ${d(f.left_on)}. Last class attended: ${f.last_class ?? "—"}.`,
        `Reason for leaving: ${f.leaving_reason || "—"}.${f.destination_school ? ` Proceeding to: ${f.destination_school}.` : ""}`,
        `Conduct: ${f.conduct || "Good"}. School fees: ${f.fees_cleared === false ? "not fully paid" : "fully paid"}.`,
        ...(f.remarks ? [`Remarks: ${f.remarks}`] : [])
      ].join("\n\n") };
    case "testimonial":
      return { title: title || "Testimonial", body: [
        `This is to certify that ${f.student} (admission number ${f.admission_no}), born on ${d(f.date_of_birth)}, attended ${school} from ${d(f.admitted_on)} to ${d(f.left_on)}${f.last_class ? `, completing ${f.last_class}` : ""}.`,
        `During this time ${f.gender === "male" ? "he" : f.gender === "female" ? "she" : "they"} held the following positions: ${list(f.positions)}.`,
        `Achievements: ${list(f.achievements)}.`,
        `${f.attendance_rate != null ? `Attendance: ${Math.round(f.attendance_rate * 100)}%. ` : ""}Conduct and character: ${f.conduct || "Good"}.`,
        f.remarks || `We recommend ${f.student} without reservation.`
      ].join("\n\n") };
    case "award":
      return { title: title || f.award || "Certificate of Achievement", body: `Presented to ${f.student} for ${f.award ? `${f.award}: ` : ""}${f.remarks || "outstanding achievement"}${f.level && f.level !== "school" ? ` (${f.level} level)` : ""}, ${d(f.achieved_on)}.` };
    case "attendance":
      return { title: title || "Attendance Award", body: `Presented to ${f.student} for ${f.attendance_rate != null && f.attendance_rate >= 0.995 ? "perfect" : "excellent"} attendance${f.attendance_rate != null ? ` (${Math.round(f.attendance_rate * 1000) / 10}%)` : ""}${f.period ? ` during ${f.period}` : ""}.` };
    case "completion":
      return { title: title || "Certificate of Completion", body: `This is to certify that ${f.student} has completed ${f.last_class ?? "the programme"} at ${school}${f.left_on ? ` on ${d(f.left_on)}` : ""}.${f.remarks ? `\n\n${f.remarks}` : ""}` };
    case "participation":
      return { title: title || "Certificate of Participation", body: `Presented to ${f.student} for taking part in ${f.remarks || "the event"}.` };
    default:
      return { title: title || "Certificate", body: f.remarks || `Presented to ${f.student}.` };
  }
}

/** Canonical text of what a certificate certifies, for signing. Order-independent for object keys. */
export function canonicalCertificate(c: { id: string; tenant_id: string; student_id: string; kind: string; serial_no: string; issued_on: string; title: string; body: string; data: Record<string, unknown> }): string {
  const sortKeys = (v: unknown): unknown => Array.isArray(v) ? v.map(sortKeys) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v as object).sort().map(k => [k, sortKeys((v as Record<string, unknown>)[k])])) : v;
  return JSON.stringify([c.id, c.tenant_id, c.student_id, c.kind, c.serial_no, c.issued_on, c.title.trim(), c.body.trim(), sortKeys(c.data ?? {})]);
}

/** Attendance rate from register marks (present and late count as attending). */
export function attendanceRate(marks: { status: string }[]): number | null {
  if (!marks.length) return null;
  return marks.filter(m => m.status === "present" || m.status === "late").length / marks.length;
}

/** "2019 – 2025" from admission and leaving dates. */
export function yearsAttended(admitted: string | null | undefined, left: string | null | undefined): string | null {
  if (!admitted) return null;
  const a = admitted.slice(0, 4), b = (left ?? new Date().toISOString()).slice(0, 4);
  return a === b ? a : `${a} – ${b}`;
}
