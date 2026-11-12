/**
 * Who gets a sign-up reminder (pure, unit tested). A first reminder goes `afterDays` after
 * the record was made, then one every `everyDays`, up to `max` sends in all (the first send
 * counts as one). lib/sign-up-reminders-server.ts does the sending.
 */
export type ReminderRule = { afterDays: number; everyDays: number; max: number };
export const STAFF_RULE: ReminderRule = { afterDays: 3, everyDays: 4, max: 3 };
export const PARENT_RULE: ReminderRule = { afterDays: 7, everyDays: 7, max: 3 };

const DAY = 86_400_000;

/** `sends`: when this person was sent their code or link before (any order). */
export function reminderDue(createdAt: string, sends: string[], now: Date, rule: ReminderRule): boolean {
  const made = Date.parse(createdAt);
  if (!Number.isFinite(made) || now.getTime() - made < rule.afterDays * DAY) return false;
  if (sends.length >= rule.max) return false;
  // The first send went out when they were added; the first reminder waits `afterDays`, later ones `everyDays`.
  const last = Math.max(0, ...sends.map(s => Date.parse(s)).filter(Number.isFinite));
  const gap = sends.length <= 1 ? rule.afterDays : rule.everyDays;
  return now.getTime() - last >= gap * DAY;
}

/**
 * The Monday line for admins. Waiting: people who were sent a code, link or one-time password
 * and have not signed in. No contact: parents with no working email or phone, whom nothing
 * could be sent to. (Parents using their private link on a phone are not waiting.) Null when
 * there is nothing to say.
 */
export function digestText(p: { staffWaiting: number; parentsWaiting: number; parentsNoContact?: number }): string | null {
  const parts: string[] = [];
  if (p.staffWaiting) parts.push(`${p.staffWaiting} member${p.staffWaiting === 1 ? "" : "s"} of staff`);
  if (p.parentsWaiting) parts.push(`${p.parentsWaiting} parent${p.parentsWaiting === 1 ? "" : "s"}`);
  const none = p.parentsNoContact ?? 0;
  const out: string[] = [];
  if (parts.length) out.push(`${parts.join(" and ")} ${p.staffWaiting + p.parentsWaiting === 1 ? "has" : "have"} not signed in yet. Reminders are sent by themselves; you can also send a link or code again from School office → Onboarding.`);
  if (none) out.push(`${none} parent${none === 1 ? " has" : "s have"} no working email or phone on record, so nothing could be sent: check their details under Students & parents.`);
  return out.length ? out.join(" ") : null;
}
