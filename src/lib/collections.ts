/**
 * Fee collections (phase 14g-2): whether a promise to pay was kept, and the next step for a
 * family that owes. Pure functions; collections-server.ts applies them.
 */

export const LEVELS = ["No action yet", "Reminded", "Bursar has called", "Principal's letter", "Final notice"] as const;

export type PromiseState = "open" | "kept" | "broken";

/** Kept once payments since the promise cover it (even early); broken when its date has passed without that. */
export function promiseState(p: { amount: number; promised_by: string }, paidSince: number, today: string): PromiseState {
  if (paidSince + 0.005 >= p.amount) return "kept";
  return p.promised_by < today ? "broken" : "open";
}

export type FamilyDebt = {
  balance: number; daysOverdue: number; level: number; lastContactDays: number | null;
  openPromise: { amount: number; promised_by: string } | null; brokenPromises: number;
};

/**
 * What to do next for a family that owes, in plain words, and the escalation level that step
 * belongs to. Waits while a promise is open; follows up a broken promise first; then rises
 * with how long the money has been overdue and how far it has already gone.
 */
export function nextStep(f: FamilyDebt, today: string): { label: string; level: number; urgent: boolean } {
  if (f.balance <= 0) return { label: "Nothing owed", level: 0, urgent: false };
  if (f.openPromise) return { label: `Wait: promised to pay by ${f.openPromise.promised_by}`, level: f.level, urgent: false };
  if (f.brokenPromises > 0 && (f.lastContactDays === null || f.lastContactDays > 2)) return { label: "Call: a promise to pay was not kept", level: Math.max(f.level, 2), urgent: true };
  if (f.daysOverdue <= 0) return { label: "Not yet due", level: 0, urgent: false };
  if (f.level < 1) return { label: "Send a friendly reminder", level: 1, urgent: false };
  if (f.lastContactDays === null || f.lastContactDays >= 7) {
    if (f.daysOverdue >= 90 && f.level >= 3) return { label: "Final notice", level: 4, urgent: true };
    if (f.daysOverdue >= 60 && f.level >= 2) return { label: "Principal's letter", level: 3, urgent: true };
    if (f.daysOverdue >= 14) return { label: "Call the family and agree a date", level: Math.max(f.level, 2), urgent: f.daysOverdue >= 30 };
    return { label: "Send a reminder", level: Math.max(f.level, 1), urgent: false };
  }
  return { label: `Contacted ${f.lastContactDays} day${f.lastContactDays === 1 ? "" : "s"} ago: give it time`, level: f.level, urgent: false };
}

/** Fundraising progress for the public page and the dashboard. */
export function progress(raised: number, goal: number | null) {
  if (!goal) return null;
  return Math.max(0, Math.min(100, Math.round((raised / goal) * 100)));
}

export function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "appeal";
}
