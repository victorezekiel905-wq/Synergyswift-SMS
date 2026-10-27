/**
 * Admissions CRM logic. Pure functions only (no I/O), unit tested.
 */

export const STAGES = ["enquiry", "tour_booked", "applied", "assessed", "offered", "accepted", "enrolled", "lost"] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABEL: Record<Stage, string> = {
  enquiry: "Enquiry", tour_booked: "Tour booked", applied: "Applied", assessed: "Assessed",
  offered: "Offer", accepted: "Accepted", enrolled: "Enrolled", lost: "Lost"
};
export const SOURCES = ["website", "whatsapp", "facebook", "instagram", "walk_in", "phone", "open_day", "referral", "agent", "email", "other"] as const;
export type Source = (typeof SOURCES)[number];
export const SOURCE_LABEL: Record<Source, string> = {
  website: "Website", whatsapp: "WhatsApp", facebook: "Facebook", instagram: "Instagram", walk_in: "Walk-in", phone: "Phone call",
  open_day: "Open day", referral: "Referral", agent: "Agent", email: "Email", other: "Other"
};

/** Where a lead stands once it has an application. Rejected, withdrawn, declined and expired count as lost. */
export function stageForApplication(status: string, current: Stage = "applied"): Stage {
  switch (status) {
    case "new": case "reviewing": return STAGES.indexOf(current) > STAGES.indexOf("applied") && current !== "lost" ? current : "applied";
    case "assessment": case "interview": case "waitlisted": return "assessed";
    case "offered": return "offered";
    case "accepted": return "accepted";
    case "enrolled": return "enrolled";
    case "rejected": case "withdrawn": case "declined": case "expired": return "lost";
    default: return current;
  }
}

/** Source from campaign tags and the page that sent the visitor. */
export function detectSource(utm: Record<string, string | undefined>, referrer?: string | null, ref?: string | null): Source {
  if (ref) return "referral";
  const s = `${utm.utm_source ?? ""} ${utm.utm_medium ?? ""}`.toLowerCase();
  const r = String(referrer ?? "").toLowerCase();
  if (/whatsapp|wa\.me/.test(s + r)) return "whatsapp";
  if (/instagram|\big\b/.test(s) || /instagram\.com/.test(r)) return "instagram";
  if (/facebook|\bfb\b|meta/.test(s) || /facebook\.com|fb\.com/.test(r)) return "facebook";
  if (/email|newsletter/.test(s)) return "email";
  if (/agent/.test(s)) return "agent";
  return "website";
}

export function normalizePhone(p: string | null | undefined): string {
  const d = String(p ?? "").replace(/[^\d+]/g, "");
  if (!d) return "";
  if (d.startsWith("+")) return d;
  if (d.startsWith("234")) return `+${d}`;
  if (d.startsWith("0") && d.length === 11) return `+234${d.slice(1)}`;   // Nigerian local format
  return d;
}

/** An existing lead for the same family (same phone or email), so enquiries do not duplicate. */
export function findDuplicate<T extends { phone?: string | null; email?: string | null; stage?: string }>(leads: T[], phone?: string | null, email?: string | null): T | null {
  const p = normalizePhone(phone), e = String(email ?? "").trim().toLowerCase();
  return leads.find(l => (p && normalizePhone(l.phone) === p) || (e && String(l.email ?? "").trim().toLowerCase() === e)) ?? null;
}

export type ScoreInput = {
  stage: Stage; source: Source; email?: string | null; phone?: string | null; child_dob?: string | null; applying_for?: string | null;
  sibling?: boolean; tourAttended?: boolean; tourBooked?: boolean; feePaid?: boolean; assessmentPct?: number | null;
  contacts?: number; daysSinceContact?: number | null; documents?: number;
};

/**
 * Lead score 0–100: how likely this family is to enrol, from intent shown
 * (stage, tour, fee, documents), fit (complete details, sibling, assessment)
 * and engagement (recent contact). The reasons explain the number.
 */
export function scoreLead(i: ScoreInput): { score: number; reasons: string[] } {
  if (i.stage === "enrolled") return { score: 100, reasons: ["enrolled"] };
  if (i.stage === "lost") return { score: 0, reasons: ["lost"] };
  let s = 0;
  const why: string[] = [];
  const add = (n: number, r: string) => { s += n; why.push(`${n > 0 ? "+" : ""}${n} ${r}`); };
  const stagePts: Record<string, number> = { enquiry: 5, tour_booked: 15, applied: 25, assessed: 32, offered: 40, accepted: 55 };
  add(stagePts[i.stage] ?? 0, `stage: ${i.stage.replace("_", " ")}`);
  const srcPts: Partial<Record<Source, number>> = { referral: 12, walk_in: 10, open_day: 10, phone: 6, whatsapp: 5, website: 4, email: 3, agent: 4, facebook: 2, instagram: 2 };
  if (srcPts[i.source]) add(srcPts[i.source]!, `source: ${i.source.replace("_", " ")}`);
  if (i.phone && i.email) add(4, "phone and email given");
  if (i.applying_for) add(2, "class chosen");
  if (i.child_dob) add(2, "date of birth given");
  if (i.sibling) add(10, "sibling already at the school");
  if (i.tourAttended) add(10, "attended a tour");
  else if (i.tourBooked) add(4, "booked a tour");
  if (i.feePaid) add(8, "paid the application fee");
  if ((i.documents ?? 0) > 0) add(Math.min(6, (i.documents ?? 0) * 2), "uploaded documents");
  if (i.assessmentPct !== null && i.assessmentPct !== undefined) {
    if (i.assessmentPct >= 70) add(6, "strong assessment");
    else if (i.assessmentPct < 40) add(-6, "weak assessment");
  }
  if ((i.contacts ?? 0) > 0) add(Math.min(5, i.contacts ?? 0), "conversations so far");
  if (i.daysSinceContact !== null && i.daysSinceContact !== undefined) {
    if (i.daysSinceContact > 30) add(-10, "no contact for over a month");
    else if (i.daysSinceContact > 14) add(-5, "no contact for two weeks");
  }
  return { score: Math.max(0, Math.min(99, Math.round(s))), reasons: why };
}

/**
 * Merge fields for letters and follow-up messages: {parent}, {child},
 * {school}, {level}, {link}, {date}, {fee}, {expires}, {application_no}.
 * Unknown fields are left as they are so mistakes are visible.
 */
export function renderTemplate(text: string, vars: Record<string, string | number | null | undefined>): string {
  return String(text ?? "").replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] === undefined || vars[k] === null ? m : String(vars[k])));
}

export const DEFAULT_TEMPLATES = {
  offer: {
    subject: "Offer of admission: {child}",
    body: "Dear {parent},\n\nWe are pleased to offer {child} a place in {level} at {school}.\n\nTo accept, sign this letter online{fee_line} by {expires}. After that date the place may be offered to another child.\n\nWe look forward to welcoming {child}.\n\nYours faithfully,\n{principal}\nFor {school}"
  },
  waitlist: {
    subject: "Waiting list: {child}",
    body: "Dear {parent},\n\nThank you for applying to {school}. {level} is full at the moment, so {child} has been placed on our waiting list. We will contact you as soon as a place becomes available.\n\nYours faithfully,\n{school}"
  },
  regret: {
    subject: "Your application for {child}",
    body: "Dear {parent},\n\nThank you for your interest in {school}. After careful consideration we are unable to offer {child} a place in {level} this time. We wish {child} every success.\n\nYours faithfully,\n{school}"
  }
} as const;

/** iCalendar file for a booking, so families can add the visit to their phone calendar. */
const organiserEmail = () => (process.env.EMAIL_FROM ?? "").replace(/^.*<|>.*$/g, "").trim() || null;

export function buildIcs(e: { uid: string; title: string; starts_at: string; ends_at?: string | null; location?: string | null; details?: string | null; organizer: string }): string {
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const start = new Date(e.starts_at);
  const end = e.ends_at ? new Date(e.ends_at) : new Date(start.getTime() + 60 * 60_000);
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, m => `\\${m}`);
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Synergy Swift//Admissions//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT", `UID:${e.uid}@synergyswift`, `DTSTAMP:${fmt(new Date())}`, `DTSTART:${fmt(start)}`, `DTEND:${fmt(end)}`,
    `SUMMARY:${esc(e.title)}`, ...(e.location ? [`LOCATION:${esc(e.location)}`] : []), ...(e.details ? [`DESCRIPTION:${esc(e.details)}`] : []),
    // The organiser's address is the school's sending address, when one is set up.
    ...(organiserEmail() ? [`ORGANIZER;CN=${esc(e.organizer)}:MAILTO:${organiserEmail()}`] : []),
    "BEGIN:VALARM", "TRIGGER:-PT2H", "ACTION:DISPLAY", "DESCRIPTION:Reminder", "END:VALARM",
    "END:VEVENT", "END:VCALENDAR", ""
  ].join("\r\n");
}

/** Seats left per level (capacity minus accepted and enrolled), for offers and the waitlist. */
export function seatsLeft(capacity: { level: string; seats: number }[], apps: { applying_for: string; status: string }[]) {
  const taken = new Map<string, number>();
  for (const a of apps) if (["accepted", "enrolled", "offered"].includes(a.status)) taken.set(a.applying_for, (taken.get(a.applying_for) ?? 0) + 1);
  return new Map(capacity.map(c => [c.level, Math.max(0, c.seats - (taken.get(c.level) ?? 0))]));
}

// ---------- analytics ----------
export type LeadRow = { id: string; stage: Stage; source: Source; owner_id: string | null; created_at: string; first_response_at: string | null; utm?: Record<string, string> | null; lost_reason?: string | null };

/** Funnel: leads that reached each stage (a lead at "offered" also passed "applied"), with step-to-step conversion. */
export function funnel(leads: LeadRow[]) {
  const order: Stage[] = ["enquiry", "tour_booked", "applied", "assessed", "offered", "accepted", "enrolled"];
  const reached = (l: LeadRow, s: Stage) => l.stage !== "lost" ? order.indexOf(l.stage) >= order.indexOf(s) : false;
  const rows = order.map(s => ({ stage: s, count: s === "enquiry" ? leads.length : leads.filter(l => reached(l, s)).length }));
  // Tours are optional: conversion into "applied" is measured from all leads, not from tours.
  return rows.map((r, i) => ({ ...r, from_previous: i === 0 ? null : (() => {
    const prev = r.stage === "applied" ? rows[0].count : rows[i - 1].count;
    return prev ? Math.round((r.count / prev) * 1000) / 10 : null;
  })() }));
}

/**
 * Per source: enquiries, applications, enrolments, conversion, spend and cost per enquiry and
 * enrolment; with `revenue` (fees billed to the children each lead brought in), the return:
 * fees billed for every naira of marketing spend.
 */
export function bySource(leads: LeadRow[], costs: { source: string; amount: number }[], revenue?: Map<string, number>) {
  return SOURCES.map(source => {
    const mine = leads.filter(l => l.source === source);
    const enrolled = mine.filter(l => l.stage === "enrolled").length;
    const applied = mine.filter(l => !["enquiry", "tour_booked", "lost"].includes(l.stage) || l.stage === "enrolled").length;
    const spend = costs.filter(c => c.source === source).reduce((a, c) => a + Number(c.amount), 0);
    const billed = revenue ? Math.round(mine.reduce((a, l) => a + (revenue.get(l.id) ?? 0), 0)) : null;
    return {
      source, leads: mine.length, applied, enrolled,
      conversion: mine.length ? Math.round((enrolled / mine.length) * 1000) / 10 : null,
      spend, cost_per_lead: mine.length && spend ? Math.round(spend / mine.length) : null, cost_per_enrolment: enrolled && spend ? Math.round(spend / enrolled) : null,
      revenue: billed, return_per_naira: billed !== null && spend ? Math.round((billed / spend) * 10) / 10 : null
    };
  }).filter(r => r.leads || r.spend);
}

export function staffPerformance(leads: LeadRow[], names: Map<string, string>) {
  const owners = [...new Set(leads.map(l => l.owner_id).filter((x): x is string => Boolean(x)))];
  return owners.map(id => {
    const mine = leads.filter(l => l.owner_id === id);
    const responded = mine.filter(l => l.first_response_at);
    const hours = responded.map(l => (new Date(l.first_response_at!).getTime() - new Date(l.created_at).getTime()) / 3_600_000).filter(h => h >= 0).sort((a, b) => a - b);
    const median = hours.length ? hours[Math.floor((hours.length - 1) / 2)] : null;
    const enrolled = mine.filter(l => l.stage === "enrolled").length;
    return { owner_id: id, name: names.get(id) ?? "Staff", leads: mine.length, enrolled, conversion: mine.length ? Math.round((enrolled / mine.length) * 1000) / 10 : null,
      median_first_response_hours: median === null ? null : Math.round(median * 10) / 10, not_contacted: mine.filter(l => !l.first_response_at && l.stage === "enquiry").length };
  }).sort((a, b) => b.enrolled - a.enrolled || b.leads - a.leads);
}

/** Leads and enrolments per month, for seasonal trends (oldest first). */
export function monthlyTrend(leads: LeadRow[]) {
  const m = new Map<string, { month: string; leads: number; enrolled: number }>();
  for (const l of leads) {
    const k = l.created_at.slice(0, 7);
    const row = m.get(k) ?? { month: k, leads: 0, enrolled: 0 };
    row.leads++;
    if (l.stage === "enrolled") row.enrolled++;
    m.set(k, row);
  }
  return [...m.values()].sort((a, b) => a.month.localeCompare(b.month));
}

export function lostReasons(leads: LeadRow[]) {
  const m = new Map<string, number>();
  for (const l of leads) if (l.stage === "lost") { const r = (l.lost_reason ?? "").trim() || "No reason given"; m.set(r, (m.get(r) ?? 0) + 1); }
  return [...m].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);
}
