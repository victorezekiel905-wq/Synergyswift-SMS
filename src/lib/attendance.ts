/**
 * Attendance rules: registers, school days, chronic absence, trends, staff
 * clock-in days, parent absence requests, and reading clocking-machine logs.
 * Pure and unit tested.
 */

export type Mark = "present" | "absent" | "late" | "excused";
export type MarkRow = { student_id: string; date: string; status: Mark };
export type Summary = { present: number; absent: number; late: number; excused: number; days: number; rate: number | null };

/** Present and late count as attended; excused days count in the total (they are still missed learning). */
export function summarize(rows: { status: Mark }[]): Summary {
  const s = { present: 0, absent: 0, late: 0, excused: 0 };
  for (const r of rows) s[r.status]++;
  const days = s.present + s.absent + s.late + s.excused;
  return { ...s, days, rate: days ? Math.round(((s.present + s.late) / days) * 1000) / 10 : null };
}

// ---------------- dates ----------------

const d2s = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (date: string, n: number) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d2s(d); };
/** 1 = Monday … 7 = Sunday. */
export const weekday = (date: string) => ((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;

/** School days between two dates (inclusive): the school's weekdays, minus holidays and closures. */
export function schoolDays(from: string, to: string, opts: { weekdays?: number[]; closed?: Iterable<string> } = {}): string[] {
  const wd = new Set(opts.weekdays ?? [1, 2, 3, 4, 5]);
  const closed = new Set(opts.closed ?? []);
  const out: string[] = [];
  for (let d = from, i = 0; d <= to && i < 800; d = addDays(d, 1), i++) if (wd.has(weekday(d)) && !closed.has(d)) out.push(d);
  return out;
}

/** Every date covered by holiday events (start and end dates inclusive, in the school's dates). */
export function closedDates(events: { starts_on: string; ends_on: string | null }[]): string[] {
  const out: string[] = [];
  for (const e of events) for (let d = e.starts_on, i = 0; d <= (e.ends_on ?? e.starts_on) && i < 400; d = addDays(d, 1), i++) out.push(d);
  return out;
}

/** The date and minutes-past-midnight of an instant in a time zone. */
export function localParts(at: Date, timeZone: string): { date: string; minutes: number } {
  let tz = timeZone;
  try { new Intl.DateTimeFormat("en-GB", { timeZone: tz }); } catch { tz = "UTC"; }
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
    .formatToParts(at).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: (Number(p.hour) % 24) * 60 + Number(p.minute) };
}

/** A wall-clock time in a time zone ("2026-03-02 07:45:10") as a UTC instant. */
export function zonedToUtc(local: string, timeZone: string): Date | null {
  const m = local.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0));
  // Work out the zone's offset at that moment and correct once (good enough except in the hour a clock changes).
  let tz = timeZone;
  try { new Intl.DateTimeFormat("en-GB", { timeZone: tz }); } catch { tz = "UTC"; }
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })
    .formatToParts(new Date(guess)).map(x => [x.type, x.value]));
  const asLocal = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return new Date(guess - (asLocal - guess));
}
const hm = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + (m || 0); };

// ---------------- analytics ----------------

/** Students whose attendance is below the threshold (default 90%) over enough marked days. */
export function chronicAbsence(rows: MarkRow[], opts: { thresholdPct?: number; minDays?: number } = {}) {
  const threshold = opts.thresholdPct ?? 90, minDays = opts.minDays ?? 10;
  const by = new Map<string, MarkRow[]>();
  for (const r of rows) { const l = by.get(r.student_id) ?? []; l.push(r); by.set(r.student_id, l); }
  const out: { student_id: string; rate: number; absent: number; late: number; days: number; severe: boolean }[] = [];
  for (const [id, l] of by) {
    const s = summarize(l);
    if (s.days >= minDays && s.rate !== null && s.rate < threshold) out.push({ student_id: id, rate: s.rate, absent: s.absent + s.excused, late: s.late, days: s.days, severe: s.rate < 80 });
  }
  return out.sort((a, b) => a.rate - b.rate);
}

/** Students late at least `min` times. */
export function frequentLateness(rows: MarkRow[], min = 5) {
  const n = new Map<string, number>();
  for (const r of rows) if (r.status === "late") n.set(r.student_id, (n.get(r.student_id) ?? 0) + 1);
  return [...n].filter(([, c]) => c >= min).map(([student_id, late]) => ({ student_id, late })).sort((a, b) => b.late - a.late);
}

/** Attendance rate per day, oldest first. */
export function dailyTrend(rows: { date: string; status: Mark }[]) {
  const by = new Map<string, { status: Mark }[]>();
  for (const r of rows) { const l = by.get(r.date) ?? []; l.push(r); by.set(r.date, l); }
  return [...by].sort(([a], [b]) => a.localeCompare(b)).map(([date, l]) => { const s = summarize(l); return { date, rate: s.rate ?? 0, marked: s.days, absent: s.absent + s.excused, late: s.late }; });
}

/** Rate by day of the week (Mondays and Fridays often dip). */
export function weekdayPattern(rows: { date: string; status: Mark }[]) {
  const by = new Map<number, { status: Mark }[]>();
  for (const r of rows) { const w = weekday(r.date); const l = by.get(w) ?? []; l.push(r); by.set(w, l); }
  return [...by].sort(([a], [b]) => a - b).map(([day, l]) => ({ day, rate: summarize(l).rate ?? 0, marked: l.length }));
}

/** Change between the first and second half of a trend, in percentage points. */
export function trendDirection(trend: { rate: number }[]): number | null {
  if (trend.length < 4) return null;
  const half = Math.floor(trend.length / 2);
  const avg = (xs: { rate: number }[]) => xs.reduce((a, x) => a + x.rate, 0) / xs.length;
  return Math.round((avg(trend.slice(half)) - avg(trend.slice(0, half))) * 10) / 10;
}

// ---------------- per-lesson registers ----------------

/** Students present for the day (register or gate) but marked absent in a lesson: possible truancy. */
export function missedLessons(dayPresent: Set<string>, lessonMarks: { student_id: string; status: Mark; period_id: string }[]) {
  const out = new Map<string, string[]>();
  for (const m of lessonMarks) if (m.status === "absent" && dayPresent.has(m.student_id)) out.set(m.student_id, [...(out.get(m.student_id) ?? []), m.period_id]);
  return out;
}

// ---------------- staff ----------------

export type StaffDay = { first_in: string | null; last_out: string | null; minutes: number; late: boolean; open: boolean };
/** A member of staff's day from their gate or clocking events (in time order or not). */
export function staffDay(events: { direction: "in" | "out"; at: string }[], startTime: string, timeZone: string): StaffDay {
  const ev = [...events].sort((a, b) => a.at.localeCompare(b.at));
  const firstIn = ev.find(e => e.direction === "in") ?? null;
  const lastOut = [...ev].reverse().find(e => e.direction === "out") ?? null;
  let minutes = 0, since: number | null = null;
  for (const e of ev) {
    const t = Date.parse(e.at);
    if (e.direction === "in") { if (since === null) since = t; }
    else if (since !== null) { minutes += (t - since) / 60000; since = null; }
  }
  return { first_in: firstIn?.at ?? null, last_out: lastOut?.at ?? null, minutes: Math.round(minutes),
    late: firstIn ? localParts(new Date(firstIn.at), timeZone).minutes > hm(startTime) : false, open: since !== null };
}

// ---------------- parent absence requests ----------------

/** School days a request covers, and whether it can still be asked for (not more than 7 days back). */
export function requestDays(startsOn: string, endsOn: string, today: string, closed: Iterable<string> = []) {
  if (endsOn < startsOn) return { ok: false as const, reason: "the end date is before the start date" };
  if (startsOn < addDays(today, -7)) return { ok: false as const, reason: "absences more than a week ago must be explained to the school directly" };
  if (endsOn > addDays(today, 120)) return { ok: false as const, reason: "requests can be made up to four months ahead" };
  const days = schoolDays(startsOn, endsOn, { closed });
  if (!days.length) return { ok: false as const, reason: "there are no school days in those dates" };
  if (days.length > 60) return { ok: false as const, reason: "please talk to the school about absences longer than 60 school days" };
  return { ok: true as const, days };
}

// ---------------- clocking machines (ZKTeco ADMS "ATTLOG") ----------------

export type DevicePunch = { pin: string; local: string; direction: "in" | "out" | "auto"; verify: "fingerprint" | "face" | "card" | "password" | "palm" | "other" };
const VERIFY: Record<string, DevicePunch["verify"]> = { "0": "password", "1": "fingerprint", "2": "card", "3": "password", "4": "card", "15": "face", "25": "palm" };

/**
 * Lines like "1023\t2026-03-02 07:45:10\t0\t1\t0\t0" (PIN, local time, state, verify method …).
 * State 0 = check in, 1 = check out; anything else is treated as automatic.
 */
export function parseAttlog(text: string): DevicePunch[] {
  const out: DevicePunch[] = [];
  for (const line of text.split(/\r?\n/).slice(0, 5000)) {
    const f = line.split("\t").map(x => x.trim());
    if (f.length < 2 || !/^[\w-]{1,24}$/.test(f[0]) || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(f[1])) continue;
    out.push({ pin: f[0], local: f[1], direction: f[2] === "0" ? "in" : f[2] === "1" ? "out" : "auto", verify: VERIFY[f[3] ?? ""] ?? "other" });
  }
  return out;
}
