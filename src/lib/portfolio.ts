/**
 * Portfolios, share links and targets (phase 14o). Pure helpers, unit tested.
 */

export const IMAGE_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export type Target = { id: string; kind: "average" | "subject_score" | "attendance" | "personal"; target: number | null; subject_id: string | null; term_id: string | null; status: string; description: string | null };
export type Evidence = {
  /** Term average from the latest published report card (for the target's term when it has one). */
  averages: { term_id: string; average: number | null; subjects: { subject_id: string; total: number | null }[] }[];
  /** Present or late, as a share of marked days this term (0–100). */
  attendance: number | null;
};

/** Where a student stands against a target: the current figure and whether it is met. */
export function targetProgress(t: Target, e: Evidence): { current: number | null; met: boolean | null } {
  if (t.kind === "personal" || t.target === null) return { current: null, met: t.status === "met" ? true : t.status === "missed" ? false : null };
  const card = t.term_id ? e.averages.find(a => a.term_id === t.term_id) : e.averages[0];
  let current: number | null = null;
  if (t.kind === "average") current = card?.average ?? null;
  else if (t.kind === "subject_score") current = card?.subjects.find(s => s.subject_id === t.subject_id)?.total ?? null;
  else if (t.kind === "attendance") current = e.attendance;
  return { current, met: current === null ? null : current >= t.target };
}

/** A shared portfolio shows the first name and the first letter of the surname only. */
export const shareName = (first: string, last: string) => `${first} ${last ? `${last[0]!.toUpperCase()}.` : ""}`.trim();

export function shareState(s: { revoked_at: string | null; expires_at: string }, now = new Date()): "live" | "revoked" | "expired" {
  if (s.revoked_at) return "revoked";
  return Date.parse(s.expires_at) <= now.getTime() ? "expired" : "live";
}
