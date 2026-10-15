/**
 * Timetable generator. Pure and unit-tested.
 *
 * Hard rules: a class has one lesson per slot; a teacher teaches one class per
 * slot (including lessons already fixed in other classes) and never in a slot
 * they are unavailable; a room holds one lesson per slot; subjects that need a
 * kind of room (a lab, the ICT suite) get one; double periods sit in two
 * periods next to each other with no break between; locked cells stay.
 * Soft rules: spread a subject across the week (at most one lesson per day
 * until the weekly count exceeds the number of days), avoid back-to-back
 * repeats, and balance each class's day.
 *
 * Several randomised attempts are made; the best one (fewest lessons left
 * unplaced, then lowest penalty) wins.
 */
export type Slot = { day: number; periodId: string };
export type Requirement = {
  classId: string; subjectId: string; teacherId: string | null; perWeek: number;
  /** How many of the weekly lessons are double periods (each double uses two of perWeek). */
  doubles?: number;
  /** A kind of room this subject needs, such as "lab" or "ict". */
  roomKind?: string | null;
};
export type Placed = { classId: string; day: number; periodId: string; subjectId: string; teacherId: string | null; locked?: boolean; roomId?: string | null };

export type GenerateInput = {
  days: number[];
  periodIds: string[];             // teaching periods in order (breaks removed)
  requirements: Requirement[];
  fixed: Placed[];                 // locked cells + lessons of classes not being regenerated
  /** Slots a teacher cannot teach (part-time days, duties). */
  unavailable?: { teacherId: string; day: number; periodId: string }[];
  rooms?: { id: string; kind: string }[];
  /** Each class's own room, used for lessons that need no special room. */
  homeRooms?: Record<string, string>;
  /** Pairs of periods that follow each other with no break between (for doubles). Defaults to neighbours in periodIds. */
  adjacent?: [string, string][];
  attempts?: number;
  seed?: number;
};

export type Unplaced = Requirement & { reason?: string };
export type GenerateResult = { placed: Placed[]; unplaced: Unplaced[]; penalty: number };

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 1_000_000) / 1_000_000; };
}

export function generateTimetable(input: GenerateInput): GenerateResult {
  const attempts = input.attempts ?? 40;
  let best: GenerateResult | null = null;
  for (let a = 0; a < attempts; a++) {
    const r = attempt(input, rng((input.seed ?? Date.now()) + a * 7919));
    const left = (x: GenerateResult) => x.unplaced.reduce((n, u) => n + u.perWeek, 0);
    if (!best || left(r) < left(best) || (left(r) === left(best) && r.penalty < best.penalty)) best = r;
    if (left(best) === 0 && best.penalty === 0) break;
  }
  return best!;
}

type Unit = { req: Requirement; size: 1 | 2 };

function attempt(input: GenerateInput, rand: () => number): GenerateResult {
  const key = (d: number, p: string) => `${d}|${p}`;
  const classBusy = new Map<string, Set<string>>();
  const teacherBusy = new Map<string, Set<string>>();
  const roomBusy = new Map<string, Set<string>>();
  const subjectDay = new Map<string, number>(); // class|subject|day -> count
  const classDay = new Map<string, number>();   // class|day -> count
  const at = new Map<string, string>();         // class|day|period -> subject
  const busy = (m: Map<string, Set<string>>, id: string | null | undefined, k: string) => Boolean(id && m.get(id)?.has(k));
  const take = (m: Map<string, Set<string>>, id: string | null | undefined, k: string) => { if (!id) return; if (!m.has(id)) m.set(id, new Set()); m.get(id)!.add(k); };
  const mark = (p: Placed) => {
    const k = key(p.day, p.periodId);
    take(classBusy, p.classId, k); take(teacherBusy, p.teacherId, k); take(roomBusy, p.roomId, k);
    subjectDay.set(`${p.classId}|${p.subjectId}|${p.day}`, (subjectDay.get(`${p.classId}|${p.subjectId}|${p.day}`) ?? 0) + 1);
    classDay.set(`${p.classId}|${p.day}`, (classDay.get(`${p.classId}|${p.day}`) ?? 0) + 1);
    at.set(`${p.classId}|${p.day}|${p.periodId}`, p.subjectId);
  };
  for (const f of input.fixed) mark(f);
  for (const u of input.unavailable ?? []) take(teacherBusy, u.teacherId, key(u.day, u.periodId));

  const roomsByKind = new Map<string, string[]>();
  for (const r of input.rooms ?? []) roomsByKind.set(r.kind, [...(roomsByKind.get(r.kind) ?? []), r.id]);
  const adjacent = input.adjacent ?? input.periodIds.slice(1).map((p, i) => [input.periodIds[i], p] as [string, string]);

  // Count fixed lessons against requirements so locked cells are not duplicated.
  const fixedCount = new Map<string, number>();
  for (const f of input.fixed) fixedCount.set(`${f.classId}|${f.subjectId}`, (fixedCount.get(`${f.classId}|${f.subjectId}`) ?? 0) + 1);

  const teacherLoad = new Map<string, number>();
  for (const r of input.requirements) if (r.teacherId) teacherLoad.set(r.teacherId, (teacherLoad.get(r.teacherId) ?? 0) + r.perWeek);

  const units: Unit[] = [];
  for (const r of input.requirements) {
    let need = Math.max(0, r.perWeek - (fixedCount.get(`${r.classId}|${r.subjectId}`) ?? 0));
    const doubles = Math.min(Math.max(0, r.doubles ?? 0), Math.floor(need / 2));
    for (let i = 0; i < doubles; i++) { units.push({ req: r, size: 2 }); need -= 2; }
    for (let i = 0; i < need; i++) units.push({ req: r, size: 1 });
  }
  // Most constrained first: doubles, special rooms, busiest teachers, then random.
  const weight = (u: Unit) => (u.size === 2 ? 1000 : 0) + (u.req.roomKind ? 500 : 0) + (teacherLoad.get(u.req.teacherId ?? "") ?? 0);
  units.sort((x, y) => weight(y) - weight(x) || rand() - 0.5);

  const perWeek = new Map(input.requirements.map(r => [`${r.classId}|${r.subjectId}`, r.perWeek]));
  const placed: Placed[] = [];
  const unplaced: Unplaced[] = [];
  let penalty = 0;

  const freeRoom = (u: Unit, day: number, periods: string[]): string | null | false => {
    const ks = periods.map(p => key(day, p));
    if (u.req.roomKind) {
      const options = roomsByKind.get(u.req.roomKind) ?? [];
      const ok = options.filter(r => ks.every(k => !roomBusy.get(r)?.has(k)));
      return ok.length ? ok[Math.floor(rand() * ok.length)] : false;
    }
    const home = input.homeRooms?.[u.req.classId];
    return home && ks.every(k => !roomBusy.get(home)?.has(k)) ? home : null;
  };

  for (const u of units) {
    const l = u.req;
    const candidates: string[][] = u.size === 1 ? input.periodIds.map(p => [p]) : adjacent.map(pair => [...pair]);
    let best: { day: number; periods: string[]; room: string | null; cost: number } | null = null;
    const maxPerDay = Math.ceil((perWeek.get(`${l.classId}|${l.subjectId}`) ?? 1) / input.days.length);
    for (const day of input.days) {
      for (const periods of candidates) {
        const ks = periods.map(p => key(day, p));
        if (ks.some(k => busy(classBusy, l.classId, k) || busy(teacherBusy, l.teacherId, k))) continue;
        const room = freeRoom(u, day, periods);
        if (room === false) continue;
        const sameDay = subjectDay.get(`${l.classId}|${l.subjectId}|${day}`) ?? 0;
        const allowed = u.size === 2 ? 0 : maxPerDay;
        let cost = sameDay + (u.size === 2 ? 0 : 1) > Math.max(allowed, 1) || (u.size === 2 && sameDay > 0) ? 100 * (sameDay + 1) : 0;
        if (u.size === 1) {
          const idx = input.periodIds.indexOf(periods[0]);
          const prev = idx > 0 ? at.get(`${l.classId}|${day}|${input.periodIds[idx - 1]}`) : undefined;
          const next = idx < input.periodIds.length - 1 ? at.get(`${l.classId}|${day}|${input.periodIds[idx + 1]}`) : undefined;
          if (prev === l.subjectId || next === l.subjectId) cost += 10;
        }
        cost += (classDay.get(`${l.classId}|${day}`) ?? 0) * 0.5 + rand() * 0.4;
        if (!best || cost < best.cost) best = { day, periods, room, cost };
      }
    }
    if (!best) {
      const reason = l.roomKind && !(roomsByKind.get(l.roomKind) ?? []).length ? `no ${l.roomKind} room is set up`
        : u.size === 2 ? "no two periods in a row are free for the class and teacher" : "no free period for the class and teacher";
      unplaced.push({ ...l, perWeek: u.size, reason });
      continue;
    }
    penalty += Math.floor(best.cost >= 100 ? 100 : best.cost >= 10 ? 10 : 0);
    for (const periodId of best.periods) {
      const p: Placed = { classId: l.classId, day: best.day, periodId, subjectId: l.subjectId, teacherId: l.teacherId, roomId: best.room };
      mark(p);
      placed.push(p);
    }
  }
  // Merge identical unplaced lessons back into counts for reporting.
  const merged = new Map<string, Unplaced>();
  for (const u of unplaced) {
    const k = `${u.classId}|${u.subjectId}`;
    const m = merged.get(k);
    merged.set(k, m ? { ...m, perWeek: m.perWeek + u.perWeek } : { ...u });
  }
  return { placed, unplaced: [...merged.values()], penalty };
}

/** Periods that follow each other with no break in between, from the school day's periods in order. */
export function adjacentPeriods(periods: { id: string; is_break: boolean; position: number }[]): [string, string][] {
  const sorted = [...periods].sort((a, b) => a.position - b.position);
  const out: [string, string][] = [];
  for (let i = 1; i < sorted.length; i++) if (!sorted[i - 1].is_break && !sorted[i].is_break) out.push([sorted[i - 1].id, sorted[i].id]);
  return out;
}

/** Clash check for manual edits (pure): returns human-readable problems. */
export function findClashes(entries: Placed[]): string[] {
  const seen = new Map<string, Placed>();
  const rooms = new Map<string, Placed>();
  const problems: string[] = [];
  for (const e of entries) {
    if (e.teacherId) {
      const k = `${e.teacherId}|${e.day}|${e.periodId}`;
      const other = seen.get(k);
      if (other && other.classId !== e.classId) problems.push(`Teacher double-booked on day ${e.day} (${e.periodId})`);
      seen.set(k, e);
    }
    if (e.roomId) {
      const k = `${e.roomId}|${e.day}|${e.periodId}`;
      const other = rooms.get(k);
      if (other && other.classId !== e.classId) problems.push(`Room double-booked on day ${e.day} (${e.periodId})`);
      rooms.set(k, e);
    }
  }
  return problems;
}
