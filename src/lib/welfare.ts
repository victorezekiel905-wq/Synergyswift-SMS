/**
 * Pastoral care: safeguarding escalation timing, wellbeing check-ins, medication rounds
 * and immunisations. Pure functions.
 */

export const CONCERN_CATEGORIES: Record<string, string> = {
  physical: "Physical abuse", emotional: "Emotional abuse", sexual: "Sexual abuse", neglect: "Neglect", online: "Online safety", self_harm: "Self-harm or suicidal thoughts",
  bullying: "Bullying", exploitation: "Exploitation (child labour, trafficking)", radicalisation: "Radicalisation", fgm: "FGM", domestic: "Domestic violence at home", other: "Other"
};
export const SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type Severity = typeof SEVERITIES[number];

/** Hours a concern may wait for the safeguarding team before it escalates to the head. */
export function escalateAfterHours(severity: Severity, schoolHours: number) {
  const h = Math.max(1, schoolHours);
  return severity === "critical" ? Math.min(1, h) : severity === "high" ? Math.max(1, Math.ceil(h / 2)) : h;
}

export function escalationDue(c: { status: string; severity: Severity; created_at: string; escalated_at: string | null }, schoolHours: number, now = new Date()) {
  if (c.status !== "new" || c.escalated_at) return false;
  return now.getTime() - Date.parse(c.created_at) >= escalateAfterHours(c.severity, schoolHours) * 3_600_000;
}

// ---------- Wellbeing ----------
export const FEELINGS = ["happy", "calm", "excited", "proud", "tired", "worried", "stressed", "sad", "lonely", "angry", "scared", "unsafe", "hungry", "unwell"] as const;
const WORRYING = new Set(["scared", "unsafe", "lonely", "sad"]);
export const MOODS = ["", "Very low", "Low", "Okay", "Good", "Great"];

/** Does a check-in need someone to follow up today? */
export function needsFollowUp(c: { mood: number; feelings: string[]; wants_to_talk: boolean; student_id: string | null }) {
  if (!c.student_id) return null;
  if (c.wants_to_talk) return "asked to talk";
  if (c.feelings.includes("unsafe") || c.feelings.includes("scared")) return "feels unsafe or scared";
  if (c.mood <= 1) return "very low mood";
  if (c.mood <= 2 && c.feelings.some(f => WORRYING.has(f))) return "low mood";
  return null;
}

/** A class or school's mood: average, spread, most-named feelings, and how many need following up. */
export function moodSummary(items: { mood: number; feelings: string[]; wants_to_talk: boolean; student_id: string | null; followed_up_at?: string | null }[]) {
  const n = items.length;
  const spread = [1, 2, 3, 4, 5].map(m => items.filter(i => i.mood === m).length);
  const counts = new Map<string, number>();
  for (const i of items) for (const f of i.feelings) counts.set(f, (counts.get(f) ?? 0) + 1);
  return {
    count: n, average: n ? Math.round((items.reduce((s, i) => s + i.mood, 0) / n) * 10) / 10 : null, spread,
    feelings: [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 6).map(([feeling, count]) => ({ feeling, count })),
    to_follow_up: items.filter(i => needsFollowUp(i) && !i.followed_up_at).length
  };
}

/** Average mood by day, for a trend line. */
export function moodTrend(items: { mood: number; created_at: string }[], days: string[]) {
  return days.map(d => {
    const day = items.filter(i => i.created_at.slice(0, 10) === d);
    return { date: d, average: day.length ? Math.round((day.reduce((s, i) => s + i.mood, 0) / day.length) * 10) / 10 : null, count: day.length };
  });
}

// ---------- Medication ----------
export type Plan = { id: string; student_id: string; medicine: string; dose: string; times: string[]; as_needed: boolean; starts_on: string; ends_on: string | null; active: boolean };
export type Dose = { plan_id: string | null; given_at: string; status: string };

/**
 * Today's medication round: each scheduled time of each active plan, and whether it has been given
 * (a dose logged within 90 minutes of the time) or is due or overdue. `nowMinutes` is the school's local time.
 */
export function medicationRound(plans: Plan[], doses: (Dose & { local_minutes: number })[], today: string, nowMinutes: number) {
  const out: { plan: Plan; time: string; state: "given" | "refused" | "due" | "overdue" | "later" }[] = [];
  for (const p of plans) {
    if (!p.active || p.as_needed || p.starts_on > today || (p.ends_on && p.ends_on < today)) continue;
    for (const t of [...p.times].sort()) {
      const [h, m] = t.split(":").map(Number);
      const at = h * 60 + (m || 0);
      const logged = doses.find(d => d.plan_id === p.id && Math.abs(d.local_minutes - at) <= 90);
      const state = logged ? (logged.status === "given" ? "given" : "refused")
        : nowMinutes > at + 30 ? "overdue" : nowMinutes >= at - 30 ? "due" : "later";
      out.push({ plan: p, time: t, state });
    }
  }
  return out.sort((a, b) => a.time.localeCompare(b.time));
}

// ---------- Immunisations ----------
/** Vaccines on Nigeria's national schedule and ones schools often record (free text is allowed too). */
export const VACCINES = ["BCG", "OPV", "Hepatitis B", "Pentavalent (DPT-HepB-Hib)", "PCV", "IPV", "Rotavirus", "Measles", "Measles-Rubella", "Yellow fever", "Meningitis A",
  "HPV", "Tetanus-diphtheria (Td)", "Typhoid", "Hepatitis A", "Varicella", "COVID-19"];

export function immunisationsDue(records: { student_id: string; vaccine: string; next_due_on: string | null; given_on: string | null }[], today: string, within = 30) {
  // Only the latest record per vaccine counts: a later dose clears an earlier "next due".
  const latest = new Map<string, typeof records[number]>();
  for (const r of records) {
    const k = `${r.student_id}|${r.vaccine.toLowerCase()}`;
    const cur = latest.get(k);
    if (!cur || String(r.given_on ?? "") > String(cur.given_on ?? "")) latest.set(k, r);
  }
  const limit = new Date(Date.parse(`${today}T00:00:00Z`) + within * 86_400_000).toISOString().slice(0, 10);
  return [...latest.values()].filter(r => r.next_due_on && r.next_due_on <= limit)
    .map(r => ({ ...r, overdue: (r.next_due_on as string) < today })).sort((a, b) => String(a.next_due_on).localeCompare(String(b.next_due_on)));
}

/** Allergy severity first, for alert lists. */
export const ALLERGY_ORDER: Record<string, number> = { anaphylaxis: 0, severe: 1, moderate: 2, mild: 3, none: 4 };
