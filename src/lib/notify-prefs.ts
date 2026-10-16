/**
 * Notification choices: which groups of messages a person has turned off and
 * their quiet hours. Safety messages (emergencies, safeguarding, pickup codes,
 * sick bay, trips) always go through at once. Pure and unit tested.
 */
import { localParts, zonedToUtc, addDays } from "./attendance";
import { minutesOf } from "./portal";

export type GroupId = "safety" | "attendance" | "learning" | "fees" | "messages" | "transport" | "activities" | "work" | "other";
export const GROUPS: { id: GroupId; label: string; hint: string; canMute: boolean }[] = [
  { id: "safety", label: "Safety", hint: "Emergencies, safeguarding, pickup codes, sick bay, trips", canMute: false },
  { id: "attendance", label: "Attendance", hint: "Sign-in and out, absences, lateness, exeats", canMute: true },
  { id: "learning", label: "Learning and results", hint: "Results, report cards, homework, exams", canMute: true },
  { id: "fees", label: "Fees and wallet", hint: "Invoices, receipts, reminders, wallet top-ups", canMute: true },
  { id: "messages", label: "Messages and notices", hint: "Messages, announcements, newsletters, surveys, meetings", canMute: true },
  { id: "transport", label: "School bus", hint: "Bus on its way, near your stop", canMute: true },
  { id: "activities", label: "Clubs, events and library", hint: "Clubs, events, competitions, library books", canMute: true },
  { id: "work", label: "Work (staff)", hint: "Leave, payslips, approvals, tasks, cover", canMute: true },
  { id: "other", label: "Everything else", hint: "", canMute: true }
];
export const MUTABLE = GROUPS.filter(g => g.canMute).map(g => g.id);

// First match wins, so safety comes first.
const RULES: [GroupId, RegExp][] = [
  ["safety", /emergency|safeguard|pickup|health|sick|medic|wellbeing|trip|late_return|missing|lockdown/],
  ["attendance", /absen|attendance|gate|sign_?in|sign_?out|late\b|lateness|exeat|boarding_roll|roll_call|register/],
  ["learning", /result|report|homework|exam|marking|score|learning|tutor|lesson|assign|grade|portfolio|achievement/],
  ["fees", /fee|invoice|payment|receipt|wallet|scholarship|instal|balance|debt/],
  ["transport", /bus|transport|route/],
  ["activities", /club|event|competition|library|book|activity|alumni/],
  ["work", /schedul|leave|payslip|payroll|appraisal|recruit|hr_|contract|detention_duty|pastoral_referral|cover|requisition|approv|task|checklist|duty|purchase|procure/],
  ["messages", /message|broadcast|notice|announce|newsletter|survey|reenrol|meeting|conference|campaign|community|support|ticket|complaint/]
];

/** The group a message kind belongs to. */
export function groupOf(kind: string): GroupId {
  const k = (kind || "").toLowerCase();
  for (const [g, re] of RULES) if (re.test(k)) return g;
  return "other";
}

export type Prefs = { muted?: string[] | null; quiet_from?: string | null; quiet_to?: string | null };

/** Turned off by the person (safety never is). */
export function isMuted(prefs: Prefs | null | undefined, kind: string): boolean {
  const g = groupOf(kind);
  return g !== "safety" && Boolean(prefs?.muted?.includes(g));
}

/** Channels that wait during quiet hours. Email is read when the person chooses, so it is not held. */
export const HELD_CHANNELS = new Set(["push", "sms", "whatsapp"]);

/**
 * When a message held for quiet hours may go: the end of the quiet period
 * (in the school's time zone), or null if it may go now. Quiet hours may run
 * past midnight (e.g. 21:00 to 06:30).
 */
export function quietUntil(prefs: Prefs | null | undefined, kind: string, channel: string, now: Date, timeZone: string): Date | null {
  if (!prefs?.quiet_from || !prefs.quiet_to || !HELD_CHANNELS.has(channel) || groupOf(kind) === "safety") return null;
  const from = minutesOf(prefs.quiet_from), to = minutesOf(prefs.quiet_to);
  if (from === to) return null;
  const { date, minutes } = localParts(now, timeZone);
  const wraps = from > to;
  const inside = wraps ? minutes >= from || minutes < to : minutes >= from && minutes < to;
  if (!inside) return null;
  // Ends later today, unless the window wraps and we are before midnight.
  const endDay = wraps && minutes >= from ? addDays(date, 1) : date;
  const hh = String(Math.floor(to / 60)).padStart(2, "0"), mm = String(to % 60).padStart(2, "0");
  return zonedToUtc(`${endDay}T${hh}:${mm}`, timeZone);
}

/** Keeps only valid group names and a complete pair of quiet times. */
export function cleanPrefs(input: { muted?: unknown; quiet_from?: unknown; quiet_to?: unknown }): { muted: GroupId[]; quiet_from: string | null; quiet_to: string | null } {
  const muted = Array.isArray(input.muted) ? [...new Set(input.muted.filter((m): m is GroupId => typeof m === "string" && (MUTABLE as string[]).includes(m)))] : [];
  const t = (v: unknown) => (typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : null);
  let qf = t(input.quiet_from), qt = t(input.quiet_to);
  if (!qf || !qt || qf === qt) { qf = null; qt = null; }
  return { muted, quiet_from: qf, quiet_to: qt };
}
