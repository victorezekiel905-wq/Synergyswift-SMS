/**
 * Exam-hall check-in and the live board (phase 14i-2). Pure functions, unit tested.
 */
import { zonedInstant } from "./staff-time";

export type SeriesSession = { label: string; start: string; minutes: number };
export type SeatRow = { student_id: string; paper_id: string; hall_id: string; label: string; name: string; user_id: string | null };
export type CheckinRow = { student_id: string; paper_id: string; checked_in_at: string };
export type AttemptRow = { student_user_id: string; exam_id: string; status: string };
export type DutyRow = { id: string; hall_id: string; staff_user_id: string; name: string; chief: boolean; checked_in_at: string | null; cover_for: string | null };
export type DutyState = "here" | "expected" | "late" | "away";

/** When a session runs on a date, in the school's time zone. */
export function slotTimes(sessions: SeriesSession[], date: string, session: number, timeZone: string) {
  const s = sessions[session];
  if (!s) return null;
  const start = zonedInstant(date, s.start, timeZone);
  return { label: s.label, start, end: new Date(start.getTime() + s.minutes * 60_000) };
}

/** The session running (or next today) at a moment, for opening the board on the right slot. */
export function currentSession(sessions: SeriesSession[], date: string, timeZone: string, now: Date): number {
  let best = 0;
  sessions.forEach((_, i) => { const t = slotTimes(sessions, date, i, timeZone)!; if (now.getTime() >= t.start.getTime() - 45 * 60_000) best = i; });
  return best;
}

export function dutyState(d: DutyRow, away: Set<string>, start: Date, now: Date): DutyState {
  if (d.checked_in_at) return "here";
  if (away.has(d.staff_user_id)) return "away";
  return now.getTime() > start.getTime() - 10 * 60_000 ? "late" : "expected";
}

export function hallBoard(p: {
  halls: { id: string; name: string }[]; papers: { id: string; title: string; exam_id: string | null }[];
  seats: SeatRow[]; checkins: CheckinRow[]; attempts: AttemptRow[]; duties: DutyRow[]; away: Set<string>; start: Date; now: Date;
}) {
  const checked = new Set(p.checkins.map(c => `${c.paper_id}|${c.student_id}`));
  const paperBy = new Map(p.papers.map(x => [x.id, x]));
  const attempt = new Map(p.attempts.map(a => [`${a.exam_id}|${a.student_user_id}`, a.status]));
  const started = p.now.getTime() >= p.start.getTime();
  return p.halls.map(h => {
    const seats = p.seats.filter(s => s.hall_id === h.id).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
    const status = (s: SeatRow) => {
      const exam = paperBy.get(s.paper_id)?.exam_id;
      return exam && s.user_id ? attempt.get(`${exam}|${s.user_id}`) ?? null : null;
    };
    const missing = seats.filter(s => !checked.has(`${s.paper_id}|${s.student_id}`))
      .map(s => ({ student_id: s.student_id, paper_id: s.paper_id, name: s.name, seat: s.label, paper: paperBy.get(s.paper_id)?.title ?? "" }));
    const duties = p.duties.filter(d => d.hall_id === h.id).map(d => ({ ...d, state: dutyState(d, p.away, p.start, p.now) }));
    return {
      hall_id: h.id, name: h.name, expected: seats.length, checked_in: seats.length - missing.length,
      started: seats.filter(s => ["in_progress", "locked", "submitted", "graded"].includes(status(s) ?? "")).length,
      submitted: seats.filter(s => ["submitted", "graded"].includes(status(s) ?? "")).length,
      missing, missing_after_start: started ? missing.length : 0, duties,
      needs_cover: !duties.length || duties.some(d => d.state === "away" || (d.state === "late" && p.now.getTime() > p.start.getTime() + 5 * 60_000))
    };
  }).filter(h => h.expected > 0 || h.duties.length > 0);
}

/** Who could cover: free in this slot, not away, those already at school first. */
export function coverCandidates(staff: { id: string; name: string }[], busy: Set<string>, away: Set<string>, atSchool: Set<string>) {
  return staff.filter(s => !busy.has(s.id) && !away.has(s.id))
    .map(s => ({ ...s, at_school: atSchool.has(s.id) }))
    .sort((a, b) => Number(b.at_school) - Number(a.at_school) || a.name.localeCompare(b.name));
}
