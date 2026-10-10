/**
 * Parent and community CRM logic. Pure functions only (no I/O), unit tested.
 */
import { escapeHtml, layout, type Brand, type Rendered } from "./messaging/templates";

// ---------------- tickets ----------------

export const TICKET_KINDS = ["complaint", "request", "enquiry", "feedback"] as const;
export const TICKET_CATEGORIES = ["academic", "fees", "transport", "safety", "bullying", "facilities", "food", "health", "staff", "communication", "admissions", "other"] as const;
export const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export const TICKET_STATUSES = ["open", "in_progress", "waiting", "resolved", "closed"] as const;
export type Priority = (typeof PRIORITIES)[number];
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export const CATEGORY_LABEL: Record<(typeof TICKET_CATEGORIES)[number], string> = {
  academic: "Academics", fees: "Fees", transport: "Transport", safety: "Safety", bullying: "Bullying", facilities: "Facilities",
  food: "Food", health: "Health", staff: "Staff conduct", communication: "Communication", admissions: "Admissions", other: "Other"
};
export const STATUS_LABEL: Record<TicketStatus, string> = { open: "Open", in_progress: "In progress", waiting: "Waiting for family", resolved: "Resolved", closed: "Closed" };

export type Sla = { respond: number; resolve: number };   // hours
export const DEFAULT_SLA: Record<Priority, Sla> = {
  urgent: { respond: 2, resolve: 24 },
  high: { respond: 8, resolve: 72 },
  normal: { respond: 24, resolve: 120 },
  low: { respond: 48, resolve: 240 }
};

/** The school's SLA for a priority, falling back to the defaults for anything missing or invalid. */
export function slaFor(priority: Priority, custom?: Record<string, Partial<Sla>> | null): Sla {
  const d = DEFAULT_SLA[priority], c = custom?.[priority] ?? {};
  const ok = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n > 0 && n <= 24 * 90;
  return { respond: ok(c.respond) ? c.respond! : d.respond, resolve: ok(c.resolve) ? c.resolve! : d.resolve };
}

export function dueDates(priority: Priority, createdAt: Date, custom?: Record<string, Partial<Sla>> | null) {
  const s = slaFor(priority, custom);
  return {
    respond_due_at: new Date(createdAt.getTime() + s.respond * 3600_000).toISOString(),
    resolve_due_at: new Date(createdAt.getTime() + s.resolve * 3600_000).toISOString()
  };
}

export type SlaTicket = { status: string; respond_due_at: string | null; resolve_due_at: string | null; first_response_at: string | null; resolved_at: string | null };
export type ClockState = "met" | "breached" | "running" | "late";   // late = answered or resolved after the deadline

function clock(due: string | null, doneAt: string | null, now: Date): { state: ClockState; minutes: number } {
  if (!due) return { state: doneAt ? "met" : "running", minutes: 0 };
  const d = new Date(due).getTime();
  if (doneAt) return new Date(doneAt).getTime() <= d ? { state: "met", minutes: 0 } : { state: "late", minutes: Math.round((new Date(doneAt).getTime() - d) / 60000) };
  const left = Math.round((d - now.getTime()) / 60000);
  return left >= 0 ? { state: "running", minutes: left } : { state: "breached", minutes: -left };
}

/** Where a ticket stands against its response and resolution deadlines. */
export function slaState(t: SlaTicket, now = new Date()) {
  const done = t.status === "resolved" || t.status === "closed";
  const respond = clock(t.respond_due_at, t.first_response_at ?? (done ? t.resolved_at : null), now);
  const resolve = clock(t.resolve_due_at, done ? (t.resolved_at ?? now.toISOString()) : null, now);
  return { respond, resolve, breached: respond.state === "breached" || resolve.state === "breached" };
}

/** Escalation level a ticket should be at now: 2 when resolution is overdue, 1 when the first response is. */
export function escalationLevel(t: SlaTicket, now = new Date()): 0 | 1 | 2 {
  const s = slaState(t, now);
  if (s.resolve.state === "breached") return 2;
  if (s.respond.state === "breached") return 1;
  return 0;
}

// ---------------- surveys and NPS ----------------

export type Question = { id: string; type: "nps" | "rating" | "choice" | "text"; label: string; options?: string[]; required?: boolean };

export const NPS_QUESTION: Question = { id: "nps", type: "nps", label: "How likely are you to recommend our school to a friend or family member?", required: true };
export const DEFAULT_SURVEY: Question[] = [
  NPS_QUESTION,
  { id: "why", type: "text", label: "What is the main reason for your score?" },
  { id: "teaching", type: "rating", label: "How happy are you with the teaching?" },
  { id: "communication", type: "rating", label: "How happy are you with how the school keeps you informed?" },
  { id: "improve", type: "text", label: "What one thing should we improve?" }
];

export function npsCategory(score: number | null | undefined): "promoter" | "passive" | "detractor" | null {
  if (score === null || score === undefined || !Number.isFinite(score)) return null;
  return score >= 9 ? "promoter" : score >= 7 ? "passive" : "detractor";
}

/** Net Promoter Score: % promoters minus % detractors, from -100 to 100. */
export function npsSummary(scores: (number | null | undefined)[]) {
  const valid = scores.filter((s): s is number => typeof s === "number" && s >= 0 && s <= 10);
  const promoters = valid.filter(s => s >= 9).length, detractors = valid.filter(s => s <= 6).length;
  return {
    responses: valid.length, promoters, passives: valid.length - promoters - detractors, detractors,
    nps: valid.length ? Math.round(((promoters - detractors) / valid.length) * 100) : null
  };
}

/** Checks a family's answers against the survey's questions. Unknown answers are dropped. */
export function validateAnswers(questions: Question[], raw: Record<string, unknown>) {
  const answers: Record<string, string | number> = {};
  const errors: string[] = [];
  for (const q of questions) {
    const v = raw[q.id];
    const empty = v === undefined || v === null || v === "";
    if (empty) { if (q.required) errors.push(`please answer: ${q.label}`); continue; }
    if (q.type === "nps" || q.type === "rating") {
      const n = Number(v), max = q.type === "nps" ? 10 : 5, min = q.type === "nps" ? 0 : 1;
      if (!Number.isInteger(n) || n < min || n > max) { errors.push(`${q.label}: choose ${min}–${max}`); continue; }
      answers[q.id] = n;
    } else if (q.type === "choice") {
      if (!q.options?.includes(String(v))) { errors.push(`${q.label}: choose one of the options`); continue; }
      answers[q.id] = String(v);
    } else {
      answers[q.id] = String(v).trim().slice(0, 2000);
    }
  }
  const npsQ = questions.find(q => q.type === "nps");
  return { answers, errors, nps: npsQ && typeof answers[npsQ.id] === "number" ? (answers[npsQ.id] as number) : null };
}

/** Average of each rating question and the choice counts, for the results view. */
export function summariseQuestions(questions: Question[], responses: { answers: Record<string, unknown> }[]) {
  return questions.map(q => {
    const vals = responses.map(r => r.answers?.[q.id]).filter(v => v !== undefined && v !== null && v !== "");
    if (q.type === "rating") {
      const nums = vals.map(Number).filter(n => n >= 1 && n <= 5);
      return { id: q.id, type: q.type, label: q.label, count: nums.length, average: nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10 : null };
    }
    if (q.type === "nps") return { id: q.id, type: q.type, label: q.label, count: vals.length, ...npsSummary(vals.map(Number)) };
    if (q.type === "choice") {
      const counts: Record<string, number> = Object.fromEntries((q.options ?? []).map(o => [o, 0]));
      for (const v of vals) counts[String(v)] = (counts[String(v)] ?? 0) + 1;
      return { id: q.id, type: q.type, label: q.label, count: vals.length, counts };
    }
    return { id: q.id, type: q.type, label: q.label, count: vals.length, texts: vals.map(String).slice(-200).reverse() };
  });
}

// ---------------- retention ----------------

export type RetentionInput = {
  balance: number;                  // unpaid fees across the family's invoices
  overdueInvoices: number;          // invoices past their due date and unpaid
  lastNps: number | null;
  openTickets: number;
  breachedTickets: number;          // open tickets past their SLA
  attendanceRate: number | null;    // 0–1 over the last 30 days, lowest child
  reenrolment: "returning" | "not_returning" | "undecided" | "no_response" | null;   // null = no open round
  siblingLeft: boolean;             // a child withdrew in the last year
  daysSinceContact: number | null;  // since the school last spoke with the family
};
export type RetentionRisk = { score: number; level: "low" | "medium" | "high"; reasons: string[] };

/**
 * Likelihood a family leaves, 0–100, with plain reasons.
 * Re-enrolment intent outweighs everything else because the family said so.
 */
export function retentionRisk(i: RetentionInput): RetentionRisk {
  const parts: { pts: number; why: string }[] = [];
  if (i.reenrolment === "not_returning") parts.push({ pts: 60, why: "Said their child will not return" });
  else if (i.reenrolment === "undecided") parts.push({ pts: 25, why: "Undecided about next session" });
  else if (i.reenrolment === "no_response") parts.push({ pts: 10, why: "Has not answered the re-enrolment form" });
  if (i.lastNps !== null) {
    if (i.lastNps <= 4) parts.push({ pts: 25, why: `Gave an NPS of ${i.lastNps}` });
    else if (i.lastNps <= 6) parts.push({ pts: 15, why: `Gave an NPS of ${i.lastNps}` });
  }
  if (i.overdueInvoices > 0) parts.push({ pts: Math.min(20, 10 + i.overdueInvoices * 5), why: `${i.overdueInvoices} overdue invoice${i.overdueInvoices === 1 ? "" : "s"}` });
  if (i.breachedTickets > 0) parts.push({ pts: 15, why: `${i.breachedTickets} complaint${i.breachedTickets === 1 ? "" : "s"} past the promised time` });
  else if (i.openTickets > 0) parts.push({ pts: 8, why: `${i.openTickets} open complaint${i.openTickets === 1 ? "" : "s"}` });
  if (i.attendanceRate !== null && i.attendanceRate < 0.85) parts.push({ pts: i.attendanceRate < 0.7 ? 15 : 8, why: `Attendance ${Math.round(i.attendanceRate * 100)}%` });
  if (i.siblingLeft) parts.push({ pts: 15, why: "A sibling left the school this year" });
  if (i.daysSinceContact !== null && i.daysSinceContact > 120 && parts.length) parts.push({ pts: 5, why: `No contact for ${i.daysSinceContact} days` });
  const score = Math.min(100, parts.reduce((a, p) => a + p.pts, 0));
  return { score, level: score >= 50 ? "high" : score >= 25 ? "medium" : "low", reasons: parts.sort((a, b) => b.pts - a.pts).map(p => p.why) };
}

// ---------------- families and segments ----------------

export type FamilySummary = {
  id: string; full_name: string; email: string | null; phone: string | null; whatsapp_phone: string | null; language: string | null;
  notify_email: boolean; notify_whatsapp: boolean; notify_sms: boolean; marketing_opt_out: boolean;
  children: { id: string; name: string; class_group_id: string | null; class_name: string | null; level: string | null }[];
  balance: number; overdue_invoices: number; last_nps: number | null; open_tickets: number; breached_tickets: number;
  attendance_rate: number | null; reenrolment: RetentionInput["reenrolment"]; referrals: number; last_contact_at: string | null;
  sibling_left: boolean; risk: RetentionRisk;
};

export type SegmentRules = {
  class_group_ids?: string[]; levels?: string[]; languages?: string[];
  min_balance?: number | null; overdue?: boolean;
  nps?: ("promoter" | "passive" | "detractor" | "none")[];
  risk?: ("low" | "medium" | "high")[];
  reenrolment?: ("returning" | "not_returning" | "undecided" | "no_response")[];
  open_ticket?: boolean; min_children?: number | null; referrers?: boolean;
  channel?: "email" | "whatsapp" | "sms" | null;
};

/** True when a family fits every rule that is set. Empty rules match everyone. */
export function matchesSegment(f: FamilySummary, r: SegmentRules): boolean {
  if (r.class_group_ids?.length && !f.children.some(c => c.class_group_id && r.class_group_ids!.includes(c.class_group_id))) return false;
  if (r.levels?.length && !f.children.some(c => c.level && r.levels!.includes(c.level))) return false;
  if (r.languages?.length && !r.languages.includes(f.language ?? "en")) return false;
  if (r.min_balance != null && f.balance < r.min_balance) return false;
  if (r.overdue && f.overdue_invoices === 0) return false;
  if (r.nps?.length && !r.nps.includes(npsCategory(f.last_nps) ?? "none")) return false;
  if (r.risk?.length && !r.risk.includes(f.risk.level)) return false;
  if (r.reenrolment?.length && (!f.reenrolment || !r.reenrolment.includes(f.reenrolment))) return false;
  if (r.open_ticket && f.open_tickets === 0) return false;
  if (r.min_children != null && f.children.length < r.min_children) return false;
  if (r.referrers && f.referrals === 0) return false;
  if (r.channel === "email" && !f.email) return false;
  if (r.channel === "whatsapp" && !(f.whatsapp_phone || f.phone)) return false;
  if (r.channel === "sms" && !f.phone) return false;
  return true;
}

/** Human-readable summary of a segment's rules, e.g. "JSS1 · owes ₦50,000+ · detractors". */
export function describeSegment(r: SegmentRules, names: { classes?: Record<string, string>; money?: (n: number) => string } = {}): string {
  const out: string[] = [];
  if (r.class_group_ids?.length) out.push(r.class_group_ids.map(id => names.classes?.[id] ?? "a class").join(", "));
  if (r.levels?.length) out.push(r.levels.join(", "));
  if (r.languages?.length) out.push(`language: ${r.languages.join(", ")}`);
  if (r.min_balance != null) out.push(`owes ${names.money ? names.money(r.min_balance) : r.min_balance}+`);
  if (r.overdue) out.push("overdue fees");
  if (r.nps?.length) out.push(r.nps.map(n => n === "none" ? "no NPS yet" : `${n}s`).join(" or "));
  if (r.risk?.length) out.push(`${r.risk.join("/")} retention risk`);
  if (r.reenrolment?.length) out.push(`re-enrolment: ${r.reenrolment.map(x => x.replace("_", " ")).join(", ")}`);
  if (r.open_ticket) out.push("open complaint");
  if (r.min_children != null) out.push(`${r.min_children}+ children`);
  if (r.referrers) out.push("has referred a family");
  if (r.channel) out.push(`reachable by ${r.channel}`);
  return out.join(" · ") || "Every family";
}

// ---------------- campaigns and newsletters ----------------

export type Block = { heading?: string | null; text?: string | null; image_url?: string | null; link_url?: string | null; link_label?: string | null };
export type CampaignContent = { kind: "campaign" | "newsletter"; subject: string; body: string; blocks: Block[] };
export type Recipient = { name: string; unsubscribeUrl?: string | null };

/** Replaces {name}, {first_name} and {school} in a message. */
export function merge(text: string, r: Recipient, school: string): string {
  const first = r.name.trim().split(/\s+/).filter(w => !/^(mr|mrs|ms|miss|dr|prof|chief|alhaji|alhaja|pastor|engr)\.?$/i.test(w))[0] ?? r.name;
  return text.replace(/\{name\}/g, r.name).replace(/\{first_name\}/g, first).replace(/\{school\}/g, school);
}

const safeUrl = (u: string | null | undefined) => (u && /^https:\/\/[^\s"'<>]+$/i.test(u.trim()) ? u.trim() : null);
const paras = (t: string) => escapeHtml(t).split(/\n{2,}/).map(x => `<p style="margin:0 0 12px;line-height:1.55">${x.replace(/\n/g, "<br>")}</p>`).join("");

/** Email, WhatsApp and SMS versions of a campaign or newsletter for one person. */
export function renderCampaign(b: Brand, c: CampaignContent, r: Recipient): Rendered {
  const subject = merge(c.subject, r, b.schoolName);
  const body = merge(c.body, r, b.schoolName);
  const blocks = c.kind === "newsletter" ? c.blocks.filter(x => x.heading || x.text || safeUrl(x.image_url)) : [];
  const blockHtml = blocks.map(x => {
    const img = safeUrl(x.image_url), link = safeUrl(x.link_url);
    return `<div style="margin:18px 0;padding-top:14px;border-top:1px solid #e2e8f0">
${img ? `<img src="${escapeHtml(img)}" alt="" width="512" style="width:100%;max-width:512px;border-radius:8px;margin-bottom:10px">` : ""}
${x.heading ? `<h2 style="margin:0 0 8px;font-size:16px">${escapeHtml(merge(x.heading, r, b.schoolName))}</h2>` : ""}
${x.text ? paras(merge(x.text, r, b.schoolName)) : ""}
${link ? `<p style="margin:0"><a href="${escapeHtml(link)}" style="font-weight:600">${escapeHtml(x.link_label || "Read more")} →</a></p>` : ""}</div>`;
  }).join("");
  // Our own link (http only when running locally), so it is not held to the https rule for content links.
  const unsub = r.unsubscribeUrl && /^https?:\/\/[^\s"'<>]+$/i.test(r.unsubscribeUrl) ? r.unsubscribeUrl : null;
  const footer = unsub ? `<p style="margin-top:20px;font-size:12px;color:#64748b">Don't want these updates? <a href="${escapeHtml(unsub)}" style="color:#64748b">Unsubscribe</a>.</p>` : "";
  const blockText = blocks.map(x => [x.heading ? merge(x.heading, r, b.schoolName).toUpperCase() : "", x.text ? merge(x.text, r, b.schoolName) : "", safeUrl(x.link_url) ?? ""].filter(Boolean).join("\n")).join("\n\n");
  const text = [body, blockText].filter(Boolean).join("\n\n");
  const short = [body, ...blocks.map(x => x.heading ? merge(x.heading, r, b.schoolName) : "").filter(Boolean)].filter(Boolean).join("\n• ");
  return {
    subject,
    text: `${text}\n\n${b.schoolName}${unsub ? `\nUnsubscribe: ${unsub}` : ""}`,
    html: layout(b, subject, `${paras(body)}${blockHtml}${footer}`),
    wa: { template: null, params: [], text: `*${b.schoolName}*\n*${subject}*\n${short}`.slice(0, 1500) }
  };
}

/** Rough SMS count (GSM-7: 160 characters, 153 per part once split). */
export function smsParts(text: string): number {
  const n = text.length;
  return n <= 160 ? 1 : Math.ceil(n / 153);
}

// ---------------- re-enrolment ----------------

export const REENROL_REASONS = ["fees", "relocation", "academics", "distance", "another_school", "dissatisfied", "graduating", "other"] as const;
export const REASON_LABEL: Record<(typeof REENROL_REASONS)[number], string> = {
  fees: "Fees", relocation: "Moving away", academics: "Academic reasons", distance: "Distance / transport", another_school: "Chose another school",
  dissatisfied: "Not happy with the school", graduating: "Finishing at this school", other: "Other"
};

/** Re-enrolment progress for a round: counts per intent and the reasons families gave for leaving. */
export function reenrolmentSummary(studentIds: string[], responses: { student_id: string; intent: string; reason: string | null }[]) {
  const by = new Map(responses.map(r => [r.student_id, r]));
  const out = { students: studentIds.length, returning: 0, not_returning: 0, undecided: 0, no_response: 0, reasons: {} as Record<string, number> };
  for (const id of studentIds) {
    const r = by.get(id);
    if (!r) { out.no_response++; continue; }
    if (r.intent === "returning" || r.intent === "not_returning" || r.intent === "undecided") out[r.intent]++;
    if (r.intent === "not_returning") out.reasons[r.reason ?? "other"] = (out.reasons[r.reason ?? "other"] ?? 0) + 1;
  }
  return { ...out, response_rate: out.students ? Math.round(((out.students - out.no_response) / out.students) * 100) : 0 };
}
