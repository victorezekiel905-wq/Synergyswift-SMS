/**
 * Staff time (phase 14i-1): shifts, who is late or left early, absences, and the
 * optional payroll deductions. Pure functions only (no I/O), unit tested.
 *
 * Shift hours are wall-clock times in the school's time zone. A shift may run
 * overnight (ends earlier than it starts). Sign-ins from three hours before the
 * start to four hours after the end belong to that day's shift.
 */

export type Shift = {
  id: string; name: string; starts_at: string; ends_at: string; days: number[];
  grace_minutes: number; early_leave_minutes: number; campus: string | null; active?: boolean; works_holidays?: boolean;
};
export type Assignment = { staff_id: string; shift_id: string; starts_on: string; ends_on: string | null };
export type ClockEvent = { direction: "in" | "out"; at: string };
export type TimeRequest = { kind: "late_arrival" | "early_departure" | "missed_clock"; on_date: string; status: string };
export type DayStatus = "present" | "late" | "absent" | "not_in_yet" | "upcoming" | "leave" | "holiday";
export type DayRecord = {
  date: string; shift: string; campus: string | null; status: DayStatus;
  in: string | null; out: string | null; late_minutes: number; early_minutes: number;
  late_excused: boolean; early_excused: boolean;
};
export type LateRules = {
  late_deduction_mode: "off" | "per_late" | "per_minute"; late_deduction_amount: number;
  late_free_per_month: number; early_counts_as_late: boolean; absence_deduction: boolean;
};
export const NO_RULES: LateRules = { late_deduction_mode: "off", late_deduction_amount: 0, late_free_per_month: 3, early_counts_as_late: true, absence_deduction: false };

const BEFORE_MS = 3 * 3600_000, AFTER_MS = 4 * 3600_000;

const minutesOf = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return (h || 0) * 60 + (m || 0); };

/** The wall-clock parts of an instant in a time zone. */
function zoneParts(d: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
    .formatToParts(d).reduce<Record<string, string>>((a, p) => (a[p.type] = p.value, a), {});
  return { y: +parts.year!, mo: +parts.month!, d: +parts.day!, h: +parts.hour!, mi: +parts.minute!, s: +parts.second! };
}

/** The instant a wall-clock time on a date happens in a time zone. */
export function zonedInstant(date: string, hhmm: string, timeZone: string, addDays = 0): Date {
  const [y, mo, d] = date.split("-").map(Number);
  const wall = Date.UTC(y!, mo! - 1, d! + addDays, 0, minutesOf(hhmm));
  let guess = wall;
  for (let i = 0; i < 2; i++) {
    const p = zoneParts(new Date(guess), timeZone);
    const seen = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
    guess += wall - seen;
  }
  return new Date(guess);
}

/** YYYY-MM-DD of an instant in a time zone. */
export function localDate(d: Date, timeZone: string): string {
  const p = zoneParts(d, timeZone);
  return `${p.y}-${String(p.mo).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

/** ISO weekday of a date (1 = Monday … 7 = Sunday). */
export function isoWeekday(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const w = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
  return w === 0 ? 7 : w;
}

export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const [y, m, d] = from.split("-").map(Number);
  for (let t = Date.UTC(y!, m! - 1, d!); ; t += 86_400_000) {
    const s = new Date(t).toISOString().slice(0, 10);
    if (s > to) break;
    out.push(s);
    if (out.length > 400) break;
  }
  return out;
}

/** The shifts someone works on a date (more than one for a split shift). */
export function shiftsOn(staffId: string, date: string, assignments: Assignment[], shifts: Map<string, Shift>): Shift[] {
  const wd = isoWeekday(date);
  return assignments
    .filter(a => a.staff_id === staffId && a.starts_on <= date && (!a.ends_on || a.ends_on >= date))
    .map(a => shifts.get(a.shift_id))
    .filter((s): s is Shift => Boolean(s && s.active !== false && s.days.includes(wd)))
    .sort((a, b) => minutesOf(a.starts_at) - minutesOf(b.starts_at));
}

export function shiftWindow(shift: Shift, date: string, timeZone: string) {
  const start = zonedInstant(date, shift.starts_at, timeZone);
  const overnight = minutesOf(shift.ends_at) <= minutesOf(shift.starts_at);
  const end = zonedInstant(date, shift.ends_at, timeZone, overnight ? 1 : 0);
  return { start, end, from: new Date(start.getTime() - BEFORE_MS), to: new Date(end.getTime() + AFTER_MS) };
}

/** Is a sign-in late for this shift, and is a sign-out early? Used at the gate as people clock. */
export function clockFlags(shift: Shift, date: string, timeZone: string, at: Date, direction: "in" | "out") {
  const w = shiftWindow(shift, date, timeZone);
  if (direction === "in") return { late: at.getTime() > w.start.getTime() + shift.grace_minutes * 60_000, early: false };
  return { late: false, early: at.getTime() < w.end.getTime() - shift.early_leave_minutes * 60_000 && at.getTime() > w.start.getTime() };
}

/** One person's day on one shift. */
export function dayRecord(p: {
  shift: Shift; date: string; timeZone: string; events: ClockEvent[]; requests: TimeRequest[];
  onLeave: boolean; holiday: boolean; now: Date;
}): DayRecord {
  const { shift, date } = p;
  const w = shiftWindow(shift, date, p.timeZone);
  const inWindow = p.events
    .map(e => ({ ...e, t: new Date(e.at).getTime() }))
    .filter(e => e.t >= w.from.getTime() && e.t <= w.to.getTime())
    .sort((a, b) => a.t - b.t);
  const firstIn = inWindow.find(e => e.direction === "in") ?? null;
  const last = inWindow[inWindow.length - 1] ?? null;
  const lastOut = last && last.direction === "out" && firstIn && last.t > firstIn.t ? last : null;
  const approved = (k: TimeRequest["kind"]) => p.requests.some(r => r.on_date === date && r.kind === k && r.status === "approved");
  const base: DayRecord = {
    date, shift: shift.name, campus: shift.campus, status: "present", in: firstIn ? new Date(firstIn.t).toISOString() : null,
    out: lastOut ? new Date(lastOut.t).toISOString() : null, late_minutes: 0, early_minutes: 0, late_excused: false, early_excused: false
  };
  if (p.holiday && !shift.works_holidays) return { ...base, status: "holiday" };
  if (p.onLeave && !firstIn) return { ...base, status: "leave" };
  if (!firstIn) {
    const now = p.now.getTime();
    if (now < w.start.getTime() + shift.grace_minutes * 60_000) return { ...base, status: "upcoming" };
    return { ...base, status: now < w.end.getTime() ? "not_in_yet" : "absent" };
  }
  const late = Math.floor((firstIn.t - w.start.getTime()) / 60_000);
  const isLate = late > shift.grace_minutes;
  const early = lastOut ? Math.floor((w.end.getTime() - lastOut.t) / 60_000) : 0;
  const isEarly = Boolean(lastOut) && early > shift.early_leave_minutes;
  return {
    ...base, status: isLate ? "late" : "present",
    late_minutes: isLate ? late : 0, early_minutes: isEarly ? early : 0,
    late_excused: isLate && approved("late_arrival"), early_excused: isEarly && approved("early_departure")
  };
}

export type MonthSummary = {
  scheduled: number; present: number; late: number; late_excused: number; late_minutes: number;
  early: number; early_excused: number; absent: number; leave: number; holiday: number;
  /** Unexcused lates (and early departures when they count), in date order, in minutes. */
  chargeable: number[];
};

export function summarise(records: DayRecord[], rules: Pick<LateRules, "early_counts_as_late"> = NO_RULES): MonthSummary {
  const s: MonthSummary = { scheduled: 0, present: 0, late: 0, late_excused: 0, late_minutes: 0, early: 0, early_excused: 0, absent: 0, leave: 0, holiday: 0, chargeable: [] };
  for (const r of [...records].sort((a, b) => a.date.localeCompare(b.date))) {
    if (r.status === "upcoming" || r.status === "not_in_yet") continue;
    if (r.status === "holiday") { s.holiday++; continue; }
    s.scheduled++;
    if (r.status === "leave") { s.leave++; continue; }
    if (r.status === "absent") { s.absent++; continue; }
    s.present++;
    if (r.late_minutes > 0) {
      if (r.late_excused) s.late_excused++;
      else { s.late++; s.late_minutes += r.late_minutes; s.chargeable.push(r.late_minutes); }
    }
    if (r.early_minutes > 0) {
      if (r.early_excused) s.early_excused++;
      else { s.early++; if (rules.early_counts_as_late) s.chargeable.push(r.early_minutes); }
    }
  }
  return s;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The month's deductions under the school's rules: the first few lates are free,
 * then a fixed amount per late (or per minute late); unexcused absent days cost a
 * day's basic pay (folded into pay like unpaid leave, so it is returned as days).
 */
export function attendanceDeductions(s: MonthSummary, rules: LateRules) {
  const lines: { name: string; amount: number }[] = [];
  const over = s.chargeable.slice(Math.max(0, rules.late_free_per_month));
  if (rules.late_deduction_mode === "per_late" && over.length && rules.late_deduction_amount > 0) {
    lines.push({ name: `Lateness (${over.length} after ${rules.late_free_per_month} free)`, amount: r2(over.length * rules.late_deduction_amount) });
  } else if (rules.late_deduction_mode === "per_minute" && over.length && rules.late_deduction_amount > 0) {
    const mins = over.reduce((a, m) => a + m, 0);
    lines.push({ name: `Lateness (${mins} min after ${rules.late_free_per_month} free)`, amount: r2(mins * rules.late_deduction_amount) });
  }
  return { lines, absentDays: rules.absence_deduction ? s.absent : 0 };
}

/** Plain words for a day status. */
export const STATUS_LABEL: Record<DayStatus, string> = {
  present: "On time", late: "Late", absent: "Absent", not_in_yet: "Not in yet", upcoming: "Shift not started", leave: "On leave", holiday: "Holiday"
};
