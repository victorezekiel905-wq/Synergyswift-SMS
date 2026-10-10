/**
 * Exam-series planning: timetable, hall allocation with mixed seating, and
 * invigilation roster. Pure functions only (no I/O), unit tested.
 */

export type Slot = { key: string; date: string; session: number; minutes: number };
export type PaperIn = { id: string; classGroupIds: string[]; duration: number; fixedSlot?: string | null };

/** Slots for every weekday between two dates (inclusive), one per session. */
export function buildSlots(startsOn: string, endsOn: string, sessions: { minutes: number }[], opts: { skipWeekends?: boolean; skipDates?: string[] } = {}): Slot[] {
  const out: Slot[] = [];
  const skip = new Set(opts.skipDates ?? []);
  const d = new Date(`${startsOn}T00:00:00Z`), end = new Date(`${endsOn}T00:00:00Z`);
  for (let guard = 0; d <= end && guard < 400; guard++, d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    const dow = d.getUTCDay();
    if ((opts.skipWeekends ?? true) && (dow === 0 || dow === 6)) continue;
    if (skip.has(iso)) continue;
    sessions.forEach((s, i) => out.push({ key: `${iso}#${i}`, date: iso, session: i, minutes: s.minutes }));
  }
  return out;
}

/**
 * Places papers into slots so that no class sits two papers at once, no class
 * sits more than `maxPerDay` papers a day, and every paper fits its session.
 * Hardest papers (most clashes, longest) go first; among the allowed slots the
 * one that keeps each class's papers most spread out is chosen. Papers with a
 * fixed slot keep it.
 */
export function scheduleExams(papers: PaperIn[], slots: Slot[], opts: { maxPerDay?: number } = {}) {
  const maxPerDay = opts.maxPerDay ?? 2;
  const assigned = new Map<string, string>();       // paper → slot key
  const bySlot = new Map<string, Set<string>>();    // slot → class ids busy
  const perDay = new Map<string, number>();         // `${class}|${date}` → papers
  const lastDayIdx = new Map<string, number[]>();   // class → day indexes used
  const slotByKey = new Map(slots.map(s => [s.key, s]));
  const dayIndex = new Map([...new Set(slots.map(s => s.date))].sort().map((d, i) => [d, i]));
  const clashes = (p: PaperIn) => papers.filter(o => o.id !== p.id && o.classGroupIds.some(c => p.classGroupIds.includes(c))).length;

  const place = (p: PaperIn, s: Slot) => {
    assigned.set(p.id, s.key);
    const busy = bySlot.get(s.key) ?? new Set<string>();
    for (const c of p.classGroupIds) {
      busy.add(c);
      perDay.set(`${c}|${s.date}`, (perDay.get(`${c}|${s.date}`) ?? 0) + 1);
      lastDayIdx.set(c, [...(lastDayIdx.get(c) ?? []), dayIndex.get(s.date)!]);
    }
    bySlot.set(s.key, busy);
  };
  const fits = (p: PaperIn, s: Slot) =>
    s.minutes >= p.duration &&
    !p.classGroupIds.some(c => bySlot.get(s.key)?.has(c)) &&
    p.classGroupIds.every(c => (perDay.get(`${c}|${s.date}`) ?? 0) < maxPerDay);

  for (const p of papers) {
    const s = p.fixedSlot ? slotByKey.get(p.fixedSlot) : undefined;
    if (s) place(p, s);
  }
  const order = papers.filter(p => !assigned.has(p.id))
    .sort((a, b) => clashes(b) - clashes(a) || b.duration - a.duration || a.id.localeCompare(b.id));
  const unscheduled: string[] = [];
  for (const p of order) {
    let best: Slot | null = null, bestScore = -Infinity;
    for (const s of slots) {
      if (!fits(p, s)) continue;
      // Spread: distance (in days) to the nearest paper each class already has; earlier slots break ties.
      const di = dayIndex.get(s.date)!;
      const gaps = p.classGroupIds.map(c => { const used = lastDayIdx.get(c) ?? []; return used.length ? Math.min(...used.map(u => Math.abs(u - di))) : 3; });
      const score = Math.min(...gaps, 3) * 10 - di * 0.01 - s.session * 0.001;
      if (score > bestScore) { bestScore = score; best = s; }
    }
    if (best) place(p, best); else unscheduled.push(p.id);
  }
  return { assignments: assigned, unscheduled };
}

export type Hall = { id: string; name: string; capacity: number; rows: number; cols: number };
export type Candidate = { studentId: string; paperId: string; classGroupId: string; name: string };
export type Seat = { studentId: string; paperId: string; hallId: string; row: number; col: number; label: string };

export const seatLabel = (row: number, col: number) => `${String.fromCharCode(65 + (row % 26))}${row >= 26 ? Math.floor(row / 26) : ""}${col + 1}`;

/**
 * Seats everyone sitting in one slot. Candidates from different papers and
 * classes are interleaved so neighbours differ wherever possible. With
 * spacing "alternate", every other seat in a row is left empty when the halls
 * are big enough. Halls are filled largest first.
 */
export function allocateSeats(candidates: Candidate[], halls: Hall[], opts: { spacing?: "every_seat" | "alternate" } = {}) {
  // Round-robin across (paper, class) groups so consecutive candidates differ.
  const groups = new Map<string, Candidate[]>();
  for (const c of [...candidates].sort((a, b) => a.name.localeCompare(b.name))) {
    const k = `${c.paperId}|${c.classGroupId}`;
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }
  const queues = [...groups.values()].sort((a, b) => b.length - a.length);
  const ordered: Candidate[] = [];
  while (queues.some(q => q.length)) for (const q of queues) { const x = q.shift(); if (x) ordered.push(x); }

  const usable = [...halls].filter(h => h.capacity > 0).sort((a, b) => b.capacity - a.capacity);
  const total = usable.reduce((a, h) => a + seatsIn(h).length, 0);
  const spaced = opts.spacing === "alternate" && total >= ordered.length * 2;
  const seats: Seat[] = [];
  let i = 0;
  for (const h of usable) {
    // Snake order (left→right, then right→left) keeps the interleaving between rows too.
    for (const pos of seatsIn(h)) {
      if (i >= ordered.length) break;
      if (spaced && (pos.row + pos.col) % 2 === 1) continue;
      const c = ordered[i++];
      seats.push({ studentId: c.studentId, paperId: c.paperId, hallId: h.id, row: pos.row, col: pos.col, label: seatLabel(pos.row, pos.col) });
    }
  }
  return { seats, unseated: ordered.slice(i).map(c => c.studentId), spaced };
}

function seatsIn(h: Hall) {
  const rows = Math.max(1, h.rows || Math.ceil(h.capacity / Math.max(1, h.cols || 6)));
  const cols = Math.max(1, h.cols || Math.ceil(h.capacity / rows));
  const out: { row: number; col: number }[] = [];
  for (let r = 0; r < rows && out.length < h.capacity; r++) {
    for (let k = 0; k < cols && out.length < h.capacity; k++) out.push({ row: r, col: r % 2 ? cols - 1 - k : k });
  }
  return out;
}

/** Neighbouring seats (left/right/front/back) held by candidates of the same paper. */
export function sameNeighbours(seats: Seat[]) {
  const at = new Map(seats.map(s => [`${s.hallId}|${s.row}|${s.col}`, s]));
  let n = 0;
  for (const s of seats) {
    for (const [dr, dc] of [[0, 1], [1, 0]]) {
      const o = at.get(`${s.hallId}|${s.row + dr}|${s.col + dc}`);
      if (o && o.paperId === s.paperId) n++;
    }
  }
  return n;
}

export type HallSession = { slotKey: string; hallId: string; candidates: number; subjectIds: string[] };
export type Invigilator = { id: string; busySlots?: string[]; subjectIds?: string[] };

/**
 * Invigilation roster: every hall in use gets ceil(candidates / ratio)
 * invigilators (at least one). Nobody is in two places at once, teachers do
 * not invigilate their own subject when someone else can, and the load is
 * spread evenly (fewest duties first). The first person in each hall is chief.
 */
export function assignInvigilators(sessions: HallSession[], staff: Invigilator[], opts: { ratio?: number } = {}) {
  const ratio = Math.max(5, opts.ratio ?? 30);
  const load = new Map(staff.map(s => [s.id, 0]));
  const busy = new Map(staff.map(s => [s.id, new Set(s.busySlots ?? [])]));
  const duties: { slotKey: string; hallId: string; staffId: string; chief: boolean }[] = [];
  const short: { slotKey: string; hallId: string; missing: number }[] = [];
  const ordered = [...sessions].sort((a, b) => a.slotKey.localeCompare(b.slotKey) || b.candidates - a.candidates);
  for (const s of ordered) {
    const need = Math.max(1, Math.ceil(s.candidates / ratio));
    for (let k = 0; k < need; k++) {
      const free = staff.filter(p => !busy.get(p.id)!.has(s.slotKey));
      const pick = free.sort((a, b) => {
        const ownA = (a.subjectIds ?? []).some(x => s.subjectIds.includes(x)) ? 1 : 0;
        const ownB = (b.subjectIds ?? []).some(x => s.subjectIds.includes(x)) ? 1 : 0;
        return ownA - ownB || load.get(a.id)! - load.get(b.id)! || a.id.localeCompare(b.id);
      })[0];
      if (!pick) { short.push({ slotKey: s.slotKey, hallId: s.hallId, missing: need - k }); break; }
      busy.get(pick.id)!.add(s.slotKey);
      load.set(pick.id, load.get(pick.id)! + 1);
      duties.push({ slotKey: s.slotKey, hallId: s.hallId, staffId: pick.id, chief: k === 0 });
    }
  }
  return { duties, short, load };
}
