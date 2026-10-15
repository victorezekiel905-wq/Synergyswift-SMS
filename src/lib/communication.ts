/**
 * Communication rules: template placeholders, safeguarding checks on
 * messages, messaging hours, read receipts, parent-teacher evening slots and
 * emergency wording. Pure and unit tested.
 */
import { localParts, weekday, zonedToUtc } from "./attendance";

// ---------------- templates ----------------

export const PLACEHOLDERS: Record<string, string> = {
  parent_name: "the parent's name", child_name: "the child's first name", child_names: "all their children's first names", class: "the child's class",
  school: "the school's name", date: "today's date"
};

/** Fills {placeholders}; unknown or empty ones become a neutral word rather than staying as braces. */
export function fillTemplate(text: string, vars: Partial<Record<keyof typeof PLACEHOLDERS, string | null | undefined>>): string {
  const fallback: Record<string, string> = { parent_name: "Parent", child_name: "your child", child_names: "your children", class: "their class", school: "the school", date: "today" };
  return text.replace(/\{\s*([a-z_]+)\s*\}/g, (m, k: string) => (k in PLACEHOLDERS ? (vars[k as keyof typeof PLACEHOLDERS] || fallback[k]) : m));
}

/** "Ada", "Ada and Tunde", "Ada, Tunde and Bola". */
export function joinNames(names: string[]): string {
  const n = [...new Set(names.filter(Boolean))];
  return n.length <= 1 ? (n[0] ?? "") : `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`;
}

// ---------------- safeguarding ----------------

const RULES: { reason: string; re: RegExp }[] = [
  { reason: "a phone number", re: /(?:\+?\d[\s-]?){10,14}/ },
  { reason: "an email address", re: /[^\s@]+@[^\s@]+\.[a-z]{2,}/i },
  { reason: "a social media or private chat app", re: /\b(whats\s?app|snap\s?chat|insta(gram)?|telegram|tik\s?tok|facebook|messenger|discord|signal app|dm me|my handle|add me on)\b/i },
  { reason: "a request to meet or keep a secret", re: /\b(meet me|meet up|come (to|over to) my (house|place|room)|my house after|don'?t tell (anyone|your parents|your mum|your dad)|our (little )?secret|keep (this|it) (a )?secret|delete (this|these|the) (message|chat)s?|just (you and me|between us))\b/i },
  { reason: "a sign the student may be at risk", re: /\b(kill myself|want to die|end my life|suicid\w*|self[- ]?harm|cut(ting)? myself|hurt myself|nobody (cares|would care)|he (touched|hurts?|hit) me|she (touched|hurts?|hit) me|touched me|abus(e|ed|ing)|beat(s|en)? me)\b/i },
  { reason: "a remark about appearance", re: /\b(sexy|hot body|you look (hot|sexy|beautiful)|send (me )?(a )?(pic|photo|picture)s?)\b/i }
];

/** Reasons a message should be looked at by a safeguarding lead (empty = none). */
export function safeguardingFlags(text: string): string[] {
  return RULES.filter(r => r.re.test(text)).map(r => r.reason);
}

/** Staff may message students only on school days within the school's hours. */
export function withinMessagingHours(now: Date, timeZone: string, from: string, to: string, weekdays: number[] = [1, 2, 3, 4, 5]): boolean {
  const { date, minutes } = localParts(now, timeZone);
  const m = (t: string) => { const [h, mm] = t.split(":").map(Number); return h * 60 + (mm || 0); };
  return weekdays.includes(weekday(date)) && minutes >= m(from) && minutes < m(to);
}

// ---------------- read receipts ----------------

export function readStats(rows: { read_at: string | null; acknowledged_at: string | null; delivered_at?: string | null }[]) {
  const total = rows.length, read = rows.filter(r => r.read_at).length, acked = rows.filter(r => r.acknowledged_at).length;
  const pct = (n: number) => (total ? Math.round((n / total) * 1000) / 10 : 0);
  return { total, read, acknowledged: acked, unread: total - read, read_pct: pct(read), ack_pct: pct(acked) };
}

// ---------------- parent-teacher evenings ----------------

/** Appointment slots for one teacher, in UTC, from the evening's local start and end times. */
export function conferenceSlots(p: { date: string; start: string; end: string; slotMinutes: number; gapMinutes: number; timeZone: string }) {
  const start = zonedToUtc(`${p.date} ${p.start.slice(0, 5)}`, p.timeZone), end = zonedToUtc(`${p.date} ${p.end.slice(0, 5)}`, p.timeZone);
  if (!start || !end || end <= start) return [];
  const out: { starts_at: string; ends_at: string }[] = [];
  const step = (p.slotMinutes + p.gapMinutes) * 60_000;
  for (let t = start.getTime(); t + p.slotMinutes * 60_000 <= end.getTime() && out.length < 80; t += step) {
    out.push({ starts_at: new Date(t).toISOString(), ends_at: new Date(t + p.slotMinutes * 60_000).toISOString() });
  }
  return out;
}

/** A parent cannot be in two appointments at once. */
export function clashesWith(slot: { starts_at: string; ends_at: string }, booked: { starts_at: string; ends_at: string }[]) {
  return booked.some(b => Date.parse(b.starts_at) < Date.parse(slot.ends_at) && Date.parse(slot.starts_at) < Date.parse(b.ends_at));
}

// ---------------- emergencies ----------------

export const EMERGENCY_TEMPLATES: { key: string; name: string; title: string; body: string }[] = [
  { key: "closure", name: "School closed today", title: "School is closed today", body: "{school} is closed today. Please keep your child at home. We will tell you as soon as we reopen." },
  { key: "early", name: "Early dismissal", title: "Early dismissal today", body: "{school} is closing early today. Please collect {child_names} from [time] at [place]. Children will stay supervised until they are collected." },
  { key: "lockdown", name: "Lockdown in progress", title: "Lockdown: please do not come to the school", body: "{school} is in lockdown as a precaution. All children are safe and supervised indoors. Please do not come to the school or call; we will update you here." },
  { key: "weather", name: "Weather or flooding", title: "Weather warning", body: "Because of [weather], {school} [is closed / will open late at time]. Please check this channel for updates." },
  { key: "clear", name: "All clear", title: "All clear", body: "The situation at {school} is over and everyone is safe. Normal routines resume [from time]. Thank you for your patience." }
];
