/**
 * Timetable generator. Pure and unit-tested.
 *
 * Hard rules: a class has one lesson per slot; a teacher teaches one class per
 * slot (including lessons already fixed in other classes); locked cells stay.
 * Soft rules: spread a subject across the week (at most one lesson per day
 * until the weekly count exceeds the number of days), avoid back-to-back
 * repeats, and balance each class's day.
 *
 * Several randomised attempts are made; the best one (fewest lessons left
 * unplaced, then lowest penalty) wins.
 */
export type Slot = { day: number; periodId: string };
export type Requirement = { classId: string; subjectId: string; teacherId: string | null; perWeek: number };
export type Placed = { classId: string; day: number; periodId: string; subjectId: string; teacherId: string | null; locked?: boolean };

export type GenerateInput = {
  days: number[];
  periodIds: string[];             // teaching periods in order (breaks removed)
  requirements: Requirement[];
  fixed: Placed[];                 // locked cells + lessons of classes not being regenerated
  attempts?: number;
  seed?: number;
};

export type GenerateResult = { placed: Placed[]; unplaced: Requirement[]; penalty: number };

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 1_000_000) / 1_000_000; };
}

export function generateTimetable(input: GenerateInput): GenerateResult {
  const attempts = input.attempts ?? 40;
  let best: GenerateResult | null = null;
  for (let a = 0; a < attempts; a++) {
    const r = attempt(input, rng((input.seed ?? Date.now()) + a * 7919));
    if (!best || r.unplaced.length < best.unplaced.length || (r.unplaced.length === best.unplaced.length && r.penalty < best.penalty)) best = r;
    if (best.unplaced.length === 0 && best.penalty === 0) break;
  }
  return best!;
}

function attempt(input: GenerateInput, rand: () => number): GenerateResult {
  const key = (d: number, p: string) => `${d}|${p}`;
  const classBusy = new Map<string, Set<string>>();
  const teacherBusy = new Map<string, Set<string>>();
  const subjectDay = new Map<string, number>(); // class|subject|day -> count
  const classDay = new Map<string, number>();   // class|day -> count
  const at = new Map<string, string>();         // class|day|period -> subject
  const mark = (p: Placed) => {
    const k = key(p.day, p.periodId);
    if (!classBusy.has(p.classId)) classBusy.set(p.classId, new Set());
    classBusy.get(p.classId)!.add(k);
    if (p.teacherId) { if (!teacherBusy.has(p.teacherId)) teacherBusy.set(p.teacherId, new Set()); teacherBusy.get(p.teacherId)!.add(k); }
    subjectDay.set(`${p.classId}|${p.subjectId}|${p.day}`, (subjectDay.get(`${p.classId}|${p.subjectId}|${p.day}`) ?? 0) + 1);
    classDay.set(`${p.classId}|${p.day}`, (classDay.get(`${p.classId}|${p.day}`) ?? 0) + 1);
    at.set(`${p.classId}|${p.day}|${p.periodId}`, p.subjectId);
  };
  for (const f of input.fixed) mark(f);

  // Count fixed lessons against requirements so locked cells are not duplicated.
  const fixedCount = new Map<string, number>();
  for (const f of input.fixed) fixedCount.set(`${f.classId}|${f.subjectId}`, (fixedCount.get(`${f.classId}|${f.subjectId}`) ?? 0) + 1);

  const teacherLoad = new Map<string, number>();
  for (const r of input.requirements) if (r.teacherId) teacherLoad.set(r.teacherId, (teacherLoad.get(r.teacherId) ?? 0) + r.perWeek);

  const lessons: Requirement[] = [];
  for (const r of input.requirements) {
    const need = Math.max(0, r.perWeek - (fixedCount.get(`${r.classId}|${r.subjectId}`) ?? 0));
    for (let i = 0; i < need; i++) lessons.push({ ...r, perWeek: 1 });
  }
  // Most constrained first: busiest teachers, then random.
  lessons.sort((x, y) => (teacherLoad.get(y.teacherId ?? "") ?? 0) - (teacherLoad.get(x.teacherId ?? "") ?? 0) || rand() - 0.5);

  const perWeek = new Map(input.requirements.map(r => [`${r.classId}|${r.subjectId}`, r.perWeek]));
  const placed: Placed[] = [];
  const unplaced: Requirement[] = [];
  let penalty = 0;
  const slots: Slot[] = input.days.flatMap(d => input.periodIds.map(p => ({ day: d, periodId: p })));

  for (const l of lessons) {
    let bestSlot: Slot | null = null, bestCost = Infinity;
    const maxPerDay = Math.ceil((perWeek.get(`${l.classId}|${l.subjectId}`) ?? 1) / input.days.length);
    for (const s of slots) {
      const k = key(s.day, s.periodId);
      if (classBusy.get(l.classId)?.has(k)) continue;
      if (l.teacherId && teacherBusy.get(l.teacherId)?.has(k)) continue;
      const sameDay = subjectDay.get(`${l.classId}|${l.subjectId}|${s.day}`) ?? 0;
      let cost = sameDay >= maxPerDay ? 100 * (sameDay - maxPerDay + 1) : 0;
      const idx = input.periodIds.indexOf(s.periodId);
      const prev = idx > 0 ? at.get(`${l.classId}|${s.day}|${input.periodIds[idx - 1]}`) : undefined;
      const next = idx < input.periodIds.length - 1 ? at.get(`${l.classId}|${s.day}|${input.periodIds[idx + 1]}`) : undefined;
      if (prev === l.subjectId || next === l.subjectId) cost += 10;
      cost += (classDay.get(`${l.classId}|${s.day}`) ?? 0) * 0.5 + rand() * 0.4;
      if (cost < bestCost) { bestCost = cost; bestSlot = s; }
    }
    if (!bestSlot) { unplaced.push(l); continue; }
    const p: Placed = { classId: l.classId, day: bestSlot.day, periodId: bestSlot.periodId, subjectId: l.subjectId, teacherId: l.teacherId };
    penalty += Math.floor(bestCost >= 100 ? 100 : bestCost >= 10 ? 10 : 0);
    mark(p);
    placed.push(p);
  }
  // Merge identical unplaced lessons back into counts for reporting.
  const merged = new Map<string, Requirement>();
  for (const u of unplaced) {
    const k = `${u.classId}|${u.subjectId}`;
    const m = merged.get(k);
    merged.set(k, m ? { ...m, perWeek: m.perWeek + 1 } : { ...u });
  }
  return { placed, unplaced: [...merged.values()], penalty };
}

/** Clash check for manual edits (pure): returns human-readable problems. */
export function findClashes(entries: Placed[]): string[] {
  const seen = new Map<string, Placed>();
  const problems: string[] = [];
  for (const e of entries) {
    if (!e.teacherId) continue;
    const k = `${e.teacherId}|${e.day}|${e.periodId}`;
    const other = seen.get(k);
    if (other && other.classId !== e.classId) problems.push(`Teacher double-booked on day ${e.day} (${e.periodId})`);
    seen.set(k, e);
  }
  return problems;
}
