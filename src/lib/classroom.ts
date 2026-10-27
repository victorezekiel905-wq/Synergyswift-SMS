/** Classroom points and tools: pure helpers, safe for the browser. Unit tested. */

/** A class's points: totals per student and for the class, newest first. */
export function pointTotals(events: { student_id: string; points: number }[]) {
  const byStudent = new Map<string, { positive: number; needsWork: number; net: number }>();
  let classNet = 0;
  for (const e of events) {
    const t = byStudent.get(e.student_id) ?? { positive: 0, needsWork: 0, net: 0 };
    if (e.points > 0) t.positive += e.points; else t.needsWork += -e.points;
    t.net += e.points;
    classNet += e.points;
    byStudent.set(e.student_id, t);
  }
  const all = [...byStudent.values()];
  const pos = all.reduce((s, t) => s + t.positive, 0), neg = all.reduce((s, t) => s + t.needsWork, 0);
  return { byStudent, classNet, positiveShare: pos + neg ? Math.round((pos / (pos + neg)) * 100) : null };
}

/** Random fair groups for the group maker: sizes differ by at most one. */
export function makeGroups<T>(items: T[], groups: number, rand: () => number = Math.random): T[][] {
  const n = Math.max(1, Math.min(groups, items.length || 1));
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  const out: T[][] = Array.from({ length: n }, () => []);
  a.forEach((x, i) => out[i % n].push(x));
  return out;
}

/** Who may appear in a class story photo: tagged children whose parents gave photo consent (when the school requires it). */
export function storyPhotoAllowed(tagged: string[], consented: Set<string>, required: boolean): { ok: boolean; missing: string[] } {
  if (!required) return { ok: true, missing: [] };
  const missing = tagged.filter(id => !consented.has(id));
  return { ok: missing.length === 0, missing };
}
