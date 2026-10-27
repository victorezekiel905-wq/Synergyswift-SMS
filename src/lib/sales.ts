/**
 * The platform's sales CRM (phase 14g-1): pipeline stages, lead scoring, and customer
 * health / churn risk. Pure functions; the server and the platform screens use them.
 */

export type Stage = "new" | "contacted" | "demo_booked" | "demo_done" | "trial" | "proposal" | "won" | "lost";
export const STAGES: { key: Stage; label: string; chance: number }[] = [
  { key: "new", label: "New", chance: 0.05 }, { key: "contacted", label: "Contacted", chance: 0.1 },
  { key: "demo_booked", label: "Demo booked", chance: 0.2 }, { key: "demo_done", label: "Demo done", chance: 0.35 },
  { key: "trial", label: "On trial", chance: 0.5 }, { key: "proposal", label: "Proposal sent", chance: 0.65 },
  { key: "won", label: "Won", chance: 1 }, { key: "lost", label: "Lost", chance: 0 }
];
export const stageLabel = (s: string) => STAGES.find(x => x.key === s)?.label ?? s;
export const SOURCES = ["website", "referral", "event", "cold_call", "social", "partner", "other"] as const;
export type Source = (typeof SOURCES)[number];
export const SOURCE_LABEL: Record<Source, string> = { website: "Website", referral: "Referral", event: "Event", cold_call: "Cold call", social: "Social media", partner: "Partner", other: "Other" };

export type LeadForScore = { stage: Stage; source: Source; students_estimate: number | null; last_activity_at: string | null; created_at: string; next_action_at: string | null };

/**
 * 0–100: how worth chasing a prospect is now. Size (bigger schools pay more), how far they
 * are in the pipeline, how warm the contact is (recent activity), where they came from
 * (referrals close best), and whether someone has a next step planned.
 */
export function leadScore(l: LeadForScore, now = new Date()): number {
  if (l.stage === "won") return 100;
  if (l.stage === "lost") return 0;
  const n = l.students_estimate ?? 0;
  const size = n >= 1000 ? 25 : n >= 500 ? 20 : n >= 250 ? 15 : n >= 100 ? 10 : n > 0 ? 5 : 3;
  const stage = { new: 5, contacted: 10, demo_booked: 20, demo_done: 28, trial: 33, proposal: 38 }[l.stage];
  const last = new Date(l.last_activity_at ?? l.created_at).getTime();
  const days = (now.getTime() - last) / 86_400_000;
  const warmth = days <= 3 ? 20 : days <= 7 ? 15 : days <= 14 ? 10 : days <= 30 ? 5 : 0;
  const source = { referral: 12, partner: 10, website: 9, event: 8, social: 5, cold_call: 3, other: 4 }[l.source];
  const planned = l.next_action_at && new Date(l.next_action_at).getTime() >= now.getTime() - 86_400_000 ? 5 : 0;
  return Math.max(0, Math.min(100, size + stage + warmth + source + planned));
}

/** Weighted pipeline value: each open deal's yearly value times its stage's chance of closing. */
export function weightedPipeline(leads: { stage: Stage; value_estimate: number | null }[]) {
  return Math.round(leads.reduce((s, l) => s + (l.stage === "won" || l.stage === "lost" ? 0 : (l.value_estimate ?? 0) * (STAGES.find(x => x.key === l.stage)?.chance ?? 0)), 0));
}

export type Metrics = {
  students: number; staff: number; parents_with_login: number; staff_signed_in_30: number; users_signed_in_30: number;
  actions_30: number; actions_prev_30: number; last_action_at: string | null; invoices_overdue: number; oldest_overdue_days: number;
  sub_status: string | null; period_end: string | null; status: string; created_at: string;
};
export type Health = { score: number; risk: "low" | "medium" | "high"; reasons: string[] };

/**
 * Customer health (0–100) and churn risk, with the reasons in plain words: are staff signing
 * in, is use falling, are bills overdue, is the renewal close, has the school gone quiet.
 */
export function customerHealth(m: Metrics, now = new Date()): Health {
  const reasons: string[] = [];
  let score = 100;
  const ageDays = (now.getTime() - new Date(m.created_at).getTime()) / 86_400_000;
  const staffShare = m.staff ? m.staff_signed_in_30 / m.staff : 0;
  if (m.status !== "active") { score -= 40; reasons.push(`School is ${m.status}`); }
  if (m.staff && staffShare < 0.25) { score -= 25; reasons.push(`Only ${m.staff_signed_in_30} of ${m.staff} staff signed in this month`); }
  else if (m.staff && staffShare < 0.5) { score -= 10; reasons.push(`${Math.round(staffShare * 100)}% of staff signed in this month`); }
  if (m.actions_prev_30 >= 20 && m.actions_30 < m.actions_prev_30 * 0.5) { score -= 20; reasons.push(`Use fell ${Math.round((1 - m.actions_30 / m.actions_prev_30) * 100)}% on last month`); }
  const quiet = m.last_action_at ? (now.getTime() - new Date(m.last_action_at).getTime()) / 86_400_000 : ageDays;
  if (ageDays > 14 && quiet > 14) { score -= 25; reasons.push(`No activity for ${Math.floor(quiet)} days`); }
  if (m.invoices_overdue) { score -= m.oldest_overdue_days > 30 ? 25 : 10; reasons.push(`${m.invoices_overdue} invoice${m.invoices_overdue === 1 ? "" : "s"} overdue (${m.oldest_overdue_days} days)`); }
  if (m.sub_status === "past_due" || m.sub_status === "suspended") { score -= 15; reasons.push(`Subscription ${m.sub_status.replace("_", " ")}`); }
  const toRenewal = m.period_end ? (new Date(m.period_end).getTime() - now.getTime()) / 86_400_000 : null;
  if (toRenewal !== null && toRenewal >= 0 && toRenewal <= 60) { score -= 5; reasons.push(`Renews in ${Math.ceil(toRenewal)} days`); }
  if (ageDays > 30 && m.students > 0 && m.parents_with_login === 0) { score -= 10; reasons.push("No parents signed up yet"); }
  if (ageDays > 21 && m.students === 0) { score -= 15; reasons.push("No students added yet"); }
  score = Math.max(0, Math.min(100, score));
  // A renewal within 60 days raises the risk one level (unless the school is clearly healthy).
  const renewingSoon = toRenewal !== null && toRenewal >= 0 && toRenewal <= 60;
  const base: Health["risk"] = score < 50 ? "high" : score < 80 ? "medium" : "low";
  const risk: Health["risk"] = !renewingSoon ? base : base === "medium" ? "high" : base === "low" && score < 90 ? "medium" : base;
  return { score, risk, reasons };
}

export const ONBOARDING: { key: "school_created" | "data_imported" | "staff_trained" | "parents_invited" | "go_live"; label: string; hint: string }[] = [
  { key: "school_created", label: "School created", hint: "Account, plan and modules set up" },
  { key: "data_imported", label: "Data imported", hint: "Students, classes and staff are in" },
  { key: "staff_trained", label: "Staff trained", hint: "Most staff have signed in" },
  { key: "parents_invited", label: "Parents invited", hint: "Parents have their sign-ins" },
  { key: "go_live", label: "Live", hint: "Used every school day" }
];

/** Steps the platform can tick by itself from what the school has done. */
export function autoOnboarding(m: Pick<Metrics, "students" | "staff" | "staff_signed_in_30" | "parents_with_login" | "actions_30">) {
  const done = new Set<string>(["school_created"]);
  if (m.students >= 10 && m.staff >= 3) done.add("data_imported");
  if (m.staff >= 3 && m.staff_signed_in_30 >= Math.ceil(m.staff * 0.5)) done.add("staff_trained");
  if (m.parents_with_login >= Math.max(1, Math.ceil(m.students * 0.25))) done.add("parents_invited");
  if (done.has("staff_trained") && m.actions_30 >= 100) done.add("go_live");
  return done;
}
