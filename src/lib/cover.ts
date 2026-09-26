/**
 * Staff absence and cover: which lessons need a teacher today, and who is
 * free to take each one. Pure functions, so the rules are unit-tested; the
 * database enforces the same rules (cover_guard) when a cover is saved.
 */

export type CoverLesson = { entryId: string; periodId: string; teacherId: string };
export type StaffMember = { id: string; name: string; role: string };
export type Candidate = { id: string; name: string; coversThisWeek: number; teacher: boolean };

/** Pure: ISO weekday (1 = Monday … 7 = Sunday) of a YYYY-MM-DD date. */
export function isoDay(date: string): number {
  const d = new Date(`${date}T12:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

/** Pure: Monday and Sunday of the week containing a date, as YYYY-MM-DD. */
export function weekBounds(date: string): { from: string; to: string } {
  const d = new Date(`${date}T12:00:00Z`);
  const start = new Date(d.getTime() - (isoDay(date) - 1) * 86400_000);
  const end = new Date(start.getTime() + 6 * 86400_000);
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

/**
 * Pure: ranked cover candidates for each lesson.
 *  - never someone teaching their own lesson in that period
 *  - never someone absent that day
 *  - never someone already covering another lesson in that period
 *  - teachers before other staff, then whoever has covered least this week
 */
export function suggestCover(p: {
  lessons: CoverLesson[];
  staff: StaffMember[];
  teachingThatDay: { teacherId: string; periodId: string }[];
  absent: Set<string>;
  assigned: { coverUserId: string; periodId: string; entryId: string }[];
  weekCounts: Map<string, number>;
  limit?: number;
}): Map<string, Candidate[]> {
  const busy = new Set(p.teachingThatDay.map(t => `${t.teacherId}|${t.periodId}`));
  const out = new Map<string, Candidate[]>();
  for (const l of p.lessons) {
    const covering = new Set(p.assigned.filter(a => a.periodId === l.periodId && a.entryId !== l.entryId).map(a => a.coverUserId));
    const list = p.staff
      .filter(s => !p.absent.has(s.id) && !busy.has(`${s.id}|${l.periodId}`) && !covering.has(s.id) && s.id !== l.teacherId)
      .map(s => ({ id: s.id, name: s.name, coversThisWeek: p.weekCounts.get(s.id) ?? 0, teacher: s.role === "teacher" }))
      .sort((a, b) => Number(b.teacher) - Number(a.teacher) || a.coversThisWeek - b.coversThisWeek || a.name.localeCompare(b.name));
    out.set(l.entryId, list.slice(0, p.limit ?? 8));
  }
  return out;
}
