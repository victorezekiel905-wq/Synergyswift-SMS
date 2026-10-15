/**
 * People: leave days and balances, recruitment stages, onboarding/offboarding
 * checklists, expiry alerts and gaps in a staff record. Pure functions.
 */

export const LEAVE_TYPES = ["annual", "sick", "maternity", "paternity", "compassionate", "study", "unpaid", "other"] as const;
export type LeaveType = typeof LEAVE_TYPES[number];
export type LeavePolicy = { leave_type: LeaveType; days_per_year: number | null; paid: boolean; carry_over_max: number; needs_document: boolean; min_notice_days: number };

/** Sensible defaults (Nigerian Labour Act minimums are lower; schools usually give more). Annual uses each person's own allowance. */
export const DEFAULT_POLICIES: Record<LeaveType, Omit<LeavePolicy, "leave_type">> = {
  annual: { days_per_year: null, paid: true, carry_over_max: 5, needs_document: false, min_notice_days: 7 },
  sick: { days_per_year: 12, paid: true, carry_over_max: 0, needs_document: true, min_notice_days: 0 },
  maternity: { days_per_year: 84, paid: true, carry_over_max: 0, needs_document: true, min_notice_days: 30 },
  paternity: { days_per_year: 10, paid: true, carry_over_max: 0, needs_document: false, min_notice_days: 7 },
  compassionate: { days_per_year: 5, paid: true, carry_over_max: 0, needs_document: false, min_notice_days: 0 },
  study: { days_per_year: 10, paid: true, carry_over_max: 0, needs_document: true, min_notice_days: 14 },
  unpaid: { days_per_year: null, paid: false, carry_over_max: 0, needs_document: false, min_notice_days: 7 },
  other: { days_per_year: null, paid: true, carry_over_max: 0, needs_document: false, min_notice_days: 0 }
};

export function policyFor(type: LeaveType, saved: LeavePolicy[], annualAllowance: number): LeavePolicy {
  const p = saved.find(x => x.leave_type === type);
  const base = p ? { ...p, days_per_year: p.days_per_year === null ? null : Number(p.days_per_year), carry_over_max: Number(p.carry_over_max) } : { leave_type: type, ...DEFAULT_POLICIES[type] };
  if (type === "annual" && base.days_per_year === null) base.days_per_year = annualAllowance;
  return base;
}

const DAY = 86_400_000;
const utc = (d: string) => Date.parse(`${d}T00:00:00Z`);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Working days in a range, skipping weekends (ISO 1=Mon … 7=Sun) and school holidays; a half day counts 0.5. */
export function leaveDays(from: string, to: string, opts: { holidays?: Iterable<string>; weekdays?: number[]; halfDay?: boolean } = {}) {
  if (to < from) return 0;
  const holidays = new Set(opts.holidays ?? []);
  const weekdays = new Set(opts.weekdays ?? [1, 2, 3, 4, 5]);
  let n = 0;
  for (let t = utc(from); t <= utc(to); t += DAY) {
    const dow = ((new Date(t).getUTCDay() + 6) % 7) + 1;
    if (weekdays.has(dow) && !holidays.has(iso(t))) n++;
  }
  return opts.halfDay && from === to && n === 1 ? 0.5 : n;
}

/** Holiday events (which may span days) as a set of dates. */
export function holidayDates(events: { starts_at: string; ends_at?: string | null }[]) {
  const out = new Set<string>();
  for (const e of events) {
    const a = String(e.starts_at).slice(0, 10), b = String(e.ends_at ?? e.starts_at).slice(0, 10);
    for (let t = utc(a); t <= utc(b) && out.size < 5000; t += DAY) out.add(iso(t));
  }
  return out;
}

/** The leave year containing a date, starting on the first of a month. */
export function leaveYear(date: string, startMonth = 1) {
  const y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7));
  const startY = m >= startMonth ? y : y - 1;
  const from = `${startY}-${String(startMonth).padStart(2, "0")}-01`;
  const to = iso(Date.UTC(startY + 1, startMonth - 1, 1) - DAY);
  return { from, to, prevFrom: `${startY - 1}-${String(startMonth).padStart(2, "0")}-01`, prevTo: iso(utc(from) - DAY) };
}

export type Taken = { leave_type: LeaveType; days: number; status: string; starts_on: string };

/** Balances for the current leave year: entitlement, unused days carried in, taken, waiting for a decision, left. */
export function leaveBalances(p: { policies: LeavePolicy[]; annualAllowance: number; requests: Taken[]; today: string; startMonth?: number }) {
  const yr = leaveYear(p.today, p.startMonth ?? 1);
  const sum = (type: LeaveType, status: string[], from: string, to: string) =>
    p.requests.filter(r => r.leave_type === type && status.includes(r.status) && r.starts_on >= from && r.starts_on <= to).reduce((s, r) => s + Number(r.days), 0);
  return LEAVE_TYPES.map(type => {
    const pol = policyFor(type, p.policies, p.annualAllowance);
    const prevTaken = sum(type, ["approved"], yr.prevFrom, yr.prevTo);
    const carried = pol.days_per_year === null ? 0 : Math.min(pol.carry_over_max, Math.max(0, pol.days_per_year - prevTaken));
    const taken = sum(type, ["approved"], yr.from, yr.to), pending = sum(type, ["pending"], yr.from, yr.to);
    const entitlement = pol.days_per_year;
    return { leave_type: type, paid: pol.paid, entitlement, carried, taken, pending,
      remaining: entitlement === null ? null : Math.max(0, entitlement + carried - taken - pending) };
  });
}

/** Problems with a request before it is sent: notice, balance, missing document. */
export function checkLeave(p: { type: LeaveType; from: string; to: string; days: number; today: string; policy: LeavePolicy; remaining: number | null; hasDocument: boolean }) {
  const problems: string[] = [];
  if (p.to < p.from) problems.push("the end date is before the start date");
  if (p.days <= 0) problems.push("the dates contain no working days");
  const notice = Math.round((utc(p.from) - utc(p.today)) / DAY);
  if (p.policy.min_notice_days > 0 && notice < p.policy.min_notice_days && p.type !== "sick" && p.type !== "compassionate") {
    problems.push(`${p.type} leave needs ${p.policy.min_notice_days} days' notice`);
  }
  if (p.remaining !== null && p.days > p.remaining) problems.push(`only ${p.remaining} day${p.remaining === 1 ? "" : "s"} of ${p.type} leave left`);
  if (p.policy.needs_document && !p.hasDocument) problems.push(`attach a supporting document for ${p.type} leave`);
  return problems;
}

// ---------- Recruitment ----------
export const STAGES = ["applied", "shortlisted", "interview", "offer", "hired", "rejected", "withdrawn"] as const;
export type Stage = typeof STAGES[number];
const NEXT: Record<Stage, Stage[]> = {
  applied: ["shortlisted", "interview", "rejected"],
  shortlisted: ["interview", "offer", "rejected", "applied"],
  interview: ["offer", "rejected", "shortlisted"],
  offer: ["hired", "rejected", "interview"],
  hired: [],
  rejected: ["shortlisted"],
  withdrawn: []
};
export function canMove(from: Stage, to: Stage) { return NEXT[from].includes(to); }
export function nextStages(from: Stage) { return NEXT[from]; }

/** The panel's view of a candidate: average score and how many would hire. */
export function panelSummary(scores: { score: number; recommendation: "hire" | "maybe" | "no" }[]) {
  if (!scores.length) return { count: 0, average: null as number | null, hire: 0, maybe: 0, no: 0 };
  const average = Math.round((scores.reduce((s, x) => s + Number(x.score), 0) / scores.length) * 10) / 10;
  const by = (r: string) => scores.filter(s => s.recommendation === r).length;
  return { count: scores.length, average, hire: by("hire"), maybe: by("maybe"), no: by("no") };
}

/** Counts by stage for a pipeline header. */
export function pipeline(apps: { stage: Stage }[]) {
  return Object.fromEntries(STAGES.map(s => [s, apps.filter(a => a.stage === s).length])) as Record<Stage, number>;
}

// ---------- Checklists ----------
export type TemplateItem = { label: string; owner: string; due_days: number };
export const DEFAULT_TEMPLATES: { kind: "onboarding" | "offboarding"; name: string; items: TemplateItem[] }[] = [
  { kind: "onboarding", name: "New staff", items: [
    { label: "Signed contract and offer letter on file", owner: "hr_manager", due_days: 0 },
    { label: "Personal details, NIN, next of kin and bank details completed", owner: "staff", due_days: 3 },
    { label: "Pension (PFA and RSA PIN) and tax ID recorded", owner: "staff", due_days: 7 },
    { label: "Certificates and references collected and verified", owner: "hr_manager", due_days: 14 },
    { label: "Login created and roles given", owner: "school_admin", due_days: 1 },
    { label: "Email, devices and keys issued", owner: "it_admin", due_days: 2 },
    { label: "Salary profile set up for payroll", owner: "bursar", due_days: 14 },
    { label: "Safeguarding and child-protection briefing", owner: "hr_manager", due_days: 5 },
    { label: "Introduction to the team, timetable and classes", owner: "line_manager", due_days: 3 },
    { label: "Probation goals agreed", owner: "line_manager", due_days: 14 }
  ] },
  { kind: "offboarding", name: "Leaving staff", items: [
    { label: "Resignation or termination letter on file", owner: "hr_manager", due_days: 0 },
    { label: "Handover of classes, marks and schemes of work", owner: "line_manager", due_days: 7 },
    { label: "School property returned (laptop, keys, ID card, books)", owner: "it_admin", due_days: 10 },
    { label: "Final pay, leave owed and deductions settled", owner: "bursar", due_days: 14 },
    { label: "Exit interview", owner: "hr_manager", due_days: 10 },
    { label: "Login disabled and access removed", owner: "school_admin", due_days: 14 }
  ] }
];

export function materialise(items: TemplateItem[], startedOn: string) {
  return items.map((it, i) => ({ position: i, label: it.label, owner: it.owner, due_on: iso(utc(startedOn) + Math.max(0, Number(it.due_days) || 0) * DAY) }));
}

export const OWNER_LABELS: Record<string, string> = {
  hr_manager: "HR", school_admin: "Admin", principal: "Principal", it_admin: "IT", bursar: "Bursary", staff: "The staff member", line_manager: "Line manager"
};

// ---------- Alerts and gaps ----------
export type Alert = { kind: "contract" | "probation" | "qualification"; staff_id: string; staff_name: string; date: string; days: number; text: string };

/** Contracts ending, probations ending and licences expiring within a window (or already lapsed). */
export function dueSoon(p: { today: string; within: number;
  staff: { id: string; full_name: string; status: string; probation_ends_on: string | null }[];
  contracts: { staff_id: string; kind: string; ends_on: string | null; status: string }[];
  qualifications: { staff_id: string; title: string; expires_on: string | null }[] }): Alert[] {
  const names = new Map(p.staff.filter(s => s.status !== "exited").map(s => [s.id, s.full_name]));
  const out: Alert[] = [];
  const add = (kind: Alert["kind"], staffId: string, date: string | null, text: (d: number) => string) => {
    if (!date || !names.has(staffId)) return;
    const days = Math.round((utc(date) - utc(p.today)) / DAY);
    if (days <= p.within) out.push({ kind, staff_id: staffId, staff_name: names.get(staffId)!, date, days, text: text(days) });
  };
  const when = (d: number) => d < 0 ? `${-d} day${d === -1 ? "" : "s"} ago` : d === 0 ? "today" : `in ${d} day${d === 1 ? "" : "s"}`;
  for (const c of p.contracts) if (c.status === "active") add("contract", c.staff_id, c.ends_on, d => `${c.kind.replace("_", " ")} contract ${d < 0 ? "ended" : "ends"} ${when(d)}`);
  for (const s of p.staff) add("probation", s.id, s.probation_ends_on, d => `probation ${d < 0 ? "ended" : "ends"} ${when(d)}; confirm or extend`);
  for (const q of p.qualifications) add("qualification", q.staff_id, q.expires_on, d => `${q.title} ${d < 0 ? "expired" : "expires"} ${when(d)}`);
  return out.sort((a, b) => a.days - b.days || a.staff_name.localeCompare(b.staff_name));
}

/** What is missing from a staff record. */
export function profileGaps(p: { email: string | null; phone: string | null; personal: Record<string, unknown> | null; documents: { kind: string }[];
  contracts: { status: string }[]; hasSalaryProfile?: boolean }) {
  const gaps: string[] = [];
  const has = (k: string) => Boolean(p.personal && p.personal[k]);
  if (!p.email) gaps.push("email");
  if (!p.phone) gaps.push("phone");
  if (!has("date_of_birth")) gaps.push("date of birth");
  if (!has("nin")) gaps.push("NIN");
  if (!has("next_of_kin_name") || !has("next_of_kin_phone")) gaps.push("next of kin");
  if (!has("pfa_name") || !has("rsa_pin")) gaps.push("pension (PFA, RSA PIN)");
  if (!has("tin")) gaps.push("tax ID");
  if (!p.documents.some(d => d.kind === "cv")) gaps.push("CV");
  if (!p.contracts.some(c => c.status === "active")) gaps.push("active contract");
  if (p.hasSalaryProfile === false) gaps.push("salary profile");
  return gaps;
}

// ---------- Appraisals and CPD ----------
export type Criterion = { id: string; label: string; weight: number };
export const DEFAULT_CRITERIA: Criterion[] = [
  { id: "planning", label: "Planning and preparation", weight: 20 },
  { id: "teaching", label: "Teaching and learning in the classroom", weight: 25 },
  { id: "assessment", label: "Assessment, marking and feedback", weight: 20 },
  { id: "behaviour", label: "Classroom management and safeguarding", weight: 15 },
  { id: "professional", label: "Professional conduct, punctuality and teamwork", weight: 10 },
  { id: "growth", label: "Professional development", weight: 10 }
];

/** Weighted average of 1–5 scores over the criteria that were scored (null if none were). */
export function weightedScore(criteria: Criterion[], scores: Record<string, number | null | undefined>) {
  let w = 0, t = 0;
  for (const c of criteria) {
    const v = scores[c.id];
    if (typeof v !== "number" || !(v >= 1 && v <= 5)) continue;
    const weight = Math.max(0, Number(c.weight) || 0);
    w += weight; t += weight * v;
  }
  return w ? Math.round((t / w) * 10) / 10 : null;
}

export function ratingLabel(score: number | null) {
  if (score === null) return "not scored";
  return score >= 4.5 ? "outstanding" : score >= 3.5 ? "good" : score >= 2.5 ? "requires improvement" : "inadequate";
}

/** CPD hours in a period against the yearly target (only completed activities count; verified ones are shown apart). */
export function cpdSummary(items: { hours: number; status: string; starts_on: string; verified_at: string | null }[], target: number, from: string, to: string) {
  const inYear = items.filter(i => i.status === "completed" && i.starts_on >= from && i.starts_on <= to);
  const hours = Math.round(inYear.reduce((s, i) => s + Number(i.hours), 0) * 10) / 10;
  const verified = Math.round(inYear.filter(i => i.verified_at).reduce((s, i) => s + Number(i.hours), 0) * 10) / 10;
  return { hours, verified, target, remaining: Math.max(0, Math.round((target - hours) * 10) / 10), met: hours >= target, activities: inYear.length };
}

export const validNin = (s: string) => /^\d{11}$/.test(s.trim());
export const validRsaPin = (s: string) => /^PEN\d{12}$/i.test(s.trim());
