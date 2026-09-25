/**
 * Result computation engine. Pure functions only (no I/O) so it is fully
 * unit-testable. Every school (tenant) defines its own grading scheme:
 *   - components (CA1, CA2, Exam…) with a max score and a % weight
 *   - grade bands (A1 75–100 "Excellent", …)
 *   - pass mark, rounding, whether positions are shown
 */

export type Band = { grade: string; min_score: number; max_score: number; remark?: string | null; grade_point?: number | null };
export type Component = { id: string; name: string; max_score: number; weight: number; position?: number };
export type Scheme = {
  pass_mark: number;
  decimals: number;
  show_position: boolean;
  bands: Band[];
  components: Component[];
};

export type ScoreRow = { student_id: string; subject_id: string; component_id: string; score: number | null };

export type SubjectResult = {
  subject_id: string;
  subject: string;
  components: Record<string, number | null>;
  total: number | null;
  grade: string | null;
  remark: string | null;
  grade_point: number | null;
  passed: boolean | null;
  position: number | null;
  class_average: number | null;
  highest: number | null;
  lowest: number | null;
  complete: boolean;
};

export type StudentResult = {
  student_id: string;
  subjects: SubjectResult[];
  total: number;
  average: number | null;
  gpa: number | null;
  subjects_taken: number;
  subjects_passed: number;
  position: number | null;
  class_size: number;
};

export function round(n: number, decimals: number): number {
  const f = Math.pow(10, decimals);
  return Math.round((n + Number.EPSILON) * f) / f;
}

/** Validates a scheme; returns human-readable problems (empty = valid). */
export function validateScheme(scheme: Pick<Scheme, "bands" | "components">): string[] {
  const problems: string[] = [];
  if (scheme.components.length === 0) problems.push("Add at least one assessment component.");
  const weight = scheme.components.reduce((s, c) => s + Number(c.weight), 0);
  if (scheme.components.length && Math.abs(weight - 100) > 0.001) {
    problems.push(`Component weights must add up to 100 (currently ${round(weight, 2)}).`);
  }
  for (const c of scheme.components) {
    if (!(Number(c.max_score) > 0)) problems.push(`Component "${c.name}" needs a max score above 0.`);
  }
  if (scheme.bands.length === 0) problems.push("Add at least one grade band.");
  const sorted = [...scheme.bands].sort((a, b) => a.min_score - b.min_score);
  for (let i = 0; i < sorted.length; i++) {
    const b = sorted[i];
    if (b.max_score < b.min_score) problems.push(`Band ${b.grade}: max is below min.`);
    if (i > 0 && b.min_score <= sorted[i - 1].max_score) {
      problems.push(`Bands ${sorted[i - 1].grade} and ${b.grade} overlap.`);
    }
  }
  const grades = new Set<string>();
  for (const b of scheme.bands) {
    if (grades.has(b.grade)) problems.push(`Grade "${b.grade}" is defined twice.`);
    grades.add(b.grade);
  }
  return problems;
}

/**
 * Weighted subject total out of 100: sum of (score / max) × weight.
 * Returns null when no component has a score (subject not taken).
 * Scores are clamped to [0, max].
 */
export function subjectTotal(scores: Record<string, number | null | undefined>, components: Component[], decimals = 2) {
  let total = 0;
  let any = false;
  let complete = true;
  for (const c of components) {
    const raw = scores[c.id];
    if (raw === null || raw === undefined || Number.isNaN(Number(raw))) { complete = false; continue; }
    const s = Math.min(Math.max(Number(raw), 0), Number(c.max_score));
    total += (s / Number(c.max_score)) * Number(c.weight);
    any = true;
  }
  return { total: any ? round(total, decimals) : null, complete: any && complete };
}

/**
 * Band lookup that tolerates decimals falling between integer bands
 * (e.g. 69.5 with bands 60–69 and 70–100 lands in 60–69): the highest band
 * whose min_score ≤ total wins.
 */
export function gradeFor(total: number | null, bands: Band[]): Band | null {
  if (total === null) return null;
  const sorted = [...bands].sort((a, b) => b.min_score - a.min_score);
  for (const b of sorted) if (total >= b.min_score) return b;
  return sorted.length ? sorted[sorted.length - 1] : null;
}

/** Standard competition ranking ("1224"): equal values share a position. */
export function rank(rows: { id: string; value: number | null }[], decimals = 2): Map<string, number> {
  const ranked = rows.filter(r => r.value !== null)
    .map(r => ({ id: r.id, v: round(r.value as number, decimals) }))
    .sort((a, b) => b.v - a.v);
  const out = new Map<string, number>();
  let prev: number | null = null;
  let pos = 0;
  ranked.forEach((r, i) => {
    if (prev === null || r.v !== prev) pos = i + 1;
    out.set(r.id, pos);
    prev = r.v;
  });
  return out;
}

export function ordinal(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** Computes every student's report for one class group and term. */
export function computeClassResults(input: {
  studentIds: string[];
  subjects: { id: string; name: string }[];
  scores: ScoreRow[];
  scheme: Scheme;
}): StudentResult[] {
  const { studentIds, subjects, scores, scheme } = input;
  const d = scheme.decimals ?? 1;
  const comps = [...scheme.components].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  // student → subject → component → score
  const grid = new Map<string, Map<string, Record<string, number | null>>>();
  for (const s of scores) {
    if (!grid.has(s.student_id)) grid.set(s.student_id, new Map());
    const bySubj = grid.get(s.student_id)!;
    if (!bySubj.has(s.subject_id)) bySubj.set(s.subject_id, {});
    bySubj.get(s.subject_id)![s.component_id] = s.score === null ? null : Number(s.score);
  }

  const perStudent = new Map<string, SubjectResult[]>();
  for (const sid of studentIds) perStudent.set(sid, []);

  for (const subj of subjects) {
    const rows: { id: string; value: number | null }[] = [];
    for (const sid of studentIds) {
      const compScores = grid.get(sid)?.get(subj.id) ?? {};
      const { total, complete } = subjectTotal(compScores, comps, 4);
      const shown = total === null ? null : round(total, d);
      rows.push({ id: sid, value: shown });
      const band = gradeFor(shown, scheme.bands);
      const components: Record<string, number | null> = {};
      for (const c of comps) components[c.id] = compScores[c.id] ?? null;
      perStudent.get(sid)!.push({
        subject_id: subj.id, subject: subj.name, components,
        total: shown,
        grade: band?.grade ?? null, remark: band?.remark ?? null,
        grade_point: band?.grade_point ?? null,
        passed: shown === null ? null : shown >= scheme.pass_mark,
        position: null, class_average: null, highest: null, lowest: null, complete
      });
    }
    const vals = rows.map(r => r.value).filter((v): v is number => v !== null);
    const positions = rank(rows, d);
    const avg = vals.length ? round(vals.reduce((a, b) => a + b, 0) / vals.length, d) : null;
    const hi = vals.length ? Math.max(...vals) : null;
    const lo = vals.length ? Math.min(...vals) : null;
    for (const sid of studentIds) {
      const r = perStudent.get(sid)!.find(x => x.subject_id === subj.id)!;
      r.position = scheme.show_position && r.total !== null ? positions.get(sid) ?? null : null;
      r.class_average = avg; r.highest = hi; r.lowest = lo;
    }
  }

  const results: StudentResult[] = studentIds.map(sid => {
    const subs = perStudent.get(sid)!;
    const taken = subs.filter(s => s.total !== null);
    const total = round(taken.reduce((a, s) => a + (s.total as number), 0), d);
    const gps = taken.map(s => s.grade_point).filter((g): g is number => g !== null && g !== undefined);
    return {
      student_id: sid,
      subjects: subs,
      total,
      average: taken.length ? round(total / taken.length, d) : null,
      gpa: gps.length ? round(gps.reduce((a, b) => a + Number(b), 0) / gps.length, 2) : null,
      subjects_taken: taken.length,
      subjects_passed: taken.filter(s => s.passed).length,
      position: null,
      class_size: studentIds.length
    };
  });

  if (scheme.show_position) {
    const pos = rank(results.map(r => ({ id: r.student_id, value: r.average })), d);
    for (const r of results) r.position = pos.get(r.student_id) ?? null;
  }
  return results;
}

/** Cumulative (session) average from term averages. */
export function cumulativeAverage(termAverages: (number | null)[], decimals = 1): number | null {
  const v = termAverages.filter((x): x is number => x !== null && x !== undefined);
  return v.length ? round(v.reduce((a, b) => a + b, 0) / v.length, decimals) : null;
}

/** Default scheme a new school starts from (editable). WAEC-style bands. */
export const DEFAULT_SCHEME = {
  name: "Standard (CA 40 / Exam 60)",
  pass_mark: 40,
  components: [
    { name: "CA 1", max_score: 20, weight: 20, position: 1 },
    { name: "CA 2", max_score: 20, weight: 20, position: 2 },
    { name: "Exam", max_score: 60, weight: 60, position: 3 }
  ],
  bands: [
    { grade: "A1", min_score: 75, max_score: 100, remark: "Excellent", grade_point: 5 },
    { grade: "B2", min_score: 70, max_score: 74.99, remark: "Very good", grade_point: 4.5 },
    { grade: "B3", min_score: 65, max_score: 69.99, remark: "Good", grade_point: 4 },
    { grade: "C4", min_score: 60, max_score: 64.99, remark: "Credit", grade_point: 3.5 },
    { grade: "C5", min_score: 55, max_score: 59.99, remark: "Credit", grade_point: 3 },
    { grade: "C6", min_score: 50, max_score: 54.99, remark: "Credit", grade_point: 2.5 },
    { grade: "D7", min_score: 45, max_score: 49.99, remark: "Pass", grade_point: 2 },
    { grade: "E8", min_score: 40, max_score: 44.99, remark: "Pass", grade_point: 1 },
    { grade: "F9", min_score: 0, max_score: 39.99, remark: "Fail", grade_point: 0 }
  ]
};
