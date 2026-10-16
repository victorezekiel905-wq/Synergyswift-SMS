/**
 * Analytics: results by student, class, subject, teacher and year group,
 * value added (progress against what similar starting points predict),
 * and month-by-month finance and admissions figures. Pure and unit tested.
 */

// ---------------- results ----------------

export type ResultRow = {
  student_id: string; student: string; gender: string | null;
  class_group_id: string | null; class_name: string; level: string;
  subject_id: string; subject: string; teacher_id: string | null; teacher: string;
  total: number | null; passed: boolean | null;
};

export const BANDS = [
  { label: "70–100", min: 70 }, { label: "60–69", min: 60 }, { label: "50–59", min: 50 },
  { label: "40–49", min: 40 }, { label: "0–39", min: -Infinity }
] as const;
export const bandOf = (t: number) => BANDS.find(b => t >= b.min)!.label;

export type GroupStat = {
  key: string; label: string; n: number; students: number;
  mean: number | null; median: number | null; sd: number | null; pass_rate: number | null;
  bands: Record<string, number>;
};

const round1 = (v: number) => Math.round(v * 10) / 10;
export function mean(xs: number[]): number | null { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; }
export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
export function sd(xs: number[]): number | null {
  if (xs.length < 2) return null;
  const m = mean(xs)!;
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

/** Scores grouped by any key (class, subject, teacher, year group, gender…), best average first. Missing scores are left out. */
export function summariseBy(rows: ResultRow[], key: (r: ResultRow) => [string, string] | null, passMark = 40): GroupStat[] {
  const groups = new Map<string, { label: string; totals: number[]; students: Set<string>; passed: number }>();
  for (const r of rows) {
    if (r.total === null || !Number.isFinite(r.total)) continue;
    const k = key(r);
    if (!k) continue;
    const g = groups.get(k[0]) ?? { label: k[1], totals: [], students: new Set<string>(), passed: 0 };
    g.totals.push(r.total); g.students.add(r.student_id);
    if (r.passed ?? r.total >= passMark) g.passed++;
    groups.set(k[0], g);
  }
  return [...groups.entries()].map(([k, g]) => {
    const bands: Record<string, number> = Object.fromEntries(BANDS.map(b => [b.label, 0]));
    for (const t of g.totals) bands[bandOf(t)]++;
    const m = mean(g.totals), md = median(g.totals), s = sd(g.totals);
    return {
      key: k, label: g.label, n: g.totals.length, students: g.students.size,
      mean: m === null ? null : round1(m), median: md === null ? null : round1(md), sd: s === null ? null : round1(s),
      pass_rate: g.totals.length ? round1((g.passed / g.totals.length) * 100) : null, bands
    };
  }).sort((a, b) => (b.mean ?? -1) - (a.mean ?? -1) || a.label.localeCompare(b.label));
}

export const BY = {
  class: (r: ResultRow): [string, string] | null => (r.class_group_id ? [r.class_group_id, r.class_name] : null),
  subject: (r: ResultRow): [string, string] => [r.subject_id, r.subject],
  teacher: (r: ResultRow): [string, string] | null => (r.teacher_id ? [r.teacher_id, r.teacher] : null),
  level: (r: ResultRow): [string, string] => [r.level, r.level],
  gender: (r: ResultRow): [string, string] => [r.gender ?? "unknown", r.gender ?? "Not recorded"],
  student: (r: ResultRow): [string, string] => [r.student_id, r.student]
} as const;
export type ByKey = keyof typeof BY;

/** Cross table: e.g. subjects down the side, classes across, average in each cell. */
export function crossTab(rows: ResultRow[], down: ByKey, across: ByKey) {
  const d = BY[down], a = BY[across];
  const rowsMap = new Map<string, string>(), colsMap = new Map<string, string>();
  const cells = new Map<string, number[]>();
  for (const r of rows) {
    if (r.total === null) continue;
    const x = d(r), y = a(r);
    if (!x || !y) continue;
    rowsMap.set(x[0], x[1]); colsMap.set(y[0], y[1]);
    const k = `${x[0]}|${y[0]}`;
    cells.set(k, [...(cells.get(k) ?? []), r.total]);
  }
  const sortByLabel = (m: Map<string, string>) => [...m.entries()].map(([key, label]) => ({ key, label })).sort((p, q) => p.label.localeCompare(q.label, undefined, { numeric: true }));
  const rowsOut = sortByLabel(rowsMap), cols = sortByLabel(colsMap);
  return {
    rows: rowsOut, cols,
    cell: Object.fromEntries([...cells.entries()].map(([k, v]) => [k, { n: v.length, mean: round1(mean(v)!) }])) as Record<string, { n: number; mean: number }>
  };
}

// ---------------- value added ----------------

export type Fit = { slope: number; intercept: number; r2: number; n: number };

/** Least-squares line through (prior, current) pairs. Null when there is too little spread to fit. */
export function linearFit(xs: number[], ys: number[]): Fit | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  const mx = mean(xs.slice(0, n))!, my = mean(ys.slice(0, n))!;
  let sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (ys[i] - my); syy += (ys[i] - my) ** 2; }
  if (sxx === 0) return null;
  const slope = sxy / sxx, intercept = my - slope * mx;
  return { slope, intercept, r2: syy === 0 ? 1 : (sxy * sxy) / (sxx * syy), n };
}

export type VaPair = { key: string; label: string; student_id: string; subject_id: string; prior: number; current: number };
export type VaResult = { key: string; label: string; n: number; va: number | null; low: number | null; high: number | null; signal: "above" | "below" | "in_line" | "too_few" };

/**
 * Value added: each student's score is compared with what students with the
 * same starting score (last term) got in the same subject across the school,
 * and the differences are averaged per teacher (or class). A group counts as
 * above or below only when the 95% range around its average stays clear of
 * zero and there are at least `minN` scores. One line per subject, so a hard
 * subject does not count against its teacher.
 */
export function valueAdded(pairs: VaPair[], minN = 10): { fits: Record<string, Fit>; groups: VaResult[] } {
  const bySubject = new Map<string, VaPair[]>();
  for (const p of pairs) if (Number.isFinite(p.prior) && Number.isFinite(p.current)) bySubject.set(p.subject_id, [...(bySubject.get(p.subject_id) ?? []), p]);
  const fits: Record<string, Fit> = {};
  const residuals = new Map<string, { label: string; r: number[] }>();
  for (const [subject, ps] of bySubject) {
    const f = linearFit(ps.map(p => p.prior), ps.map(p => p.current));
    if (!f) continue;
    fits[subject] = f;
    for (const p of ps) {
      const g = residuals.get(p.key) ?? { label: p.label, r: [] };
      g.r.push(p.current - (f.intercept + f.slope * p.prior));
      residuals.set(p.key, g);
    }
  }
  const groups: VaResult[] = [...residuals.entries()].map(([key, g]) => {
    const n = g.r.length, m = mean(g.r)!, s = sd(g.r);
    if (n < minN || s === null) return { key, label: g.label, n, va: round1(m), low: null, high: null, signal: "too_few" as const };
    const half = 1.96 * s / Math.sqrt(n);
    const low = round1(m - half), high = round1(m + half);
    return { key, label: g.label, n, va: round1(m), low, high, signal: low > 0 ? "above" as const : high < 0 ? "below" as const : "in_line" as const };
  }).sort((a, b) => (b.va ?? 0) - (a.va ?? 0));
  return { fits, groups };
}

// ---------------- finance and admissions over time ----------------

/** "2026-10" for a date or timestamp, in the school's time zone. */
export function monthOf(at: string, timeZone = "UTC"): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(at)) return at.slice(0, 7);
  let tz = timeZone;
  try { new Intl.DateTimeFormat("en-GB", { timeZone: tz }); } catch { tz = "UTC"; }
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit" }).formatToParts(new Date(at)).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}`;
}

/** The last `count` months up to and including `latest` ("2026-10"), oldest first. */
export function monthsBack(latest: string, count: number): string[] {
  const [y, m] = latest.split("-").map(Number);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (count - 1 - i), 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

/** Totals per month (zero for months with nothing), oldest first. */
export function byMonth<T>(rows: T[], at: (r: T) => string | null, value: (r: T) => number, months: string[], timeZone = "UTC"): { month: string; value: number }[] {
  const sums = new Map(months.map(m => [m, 0]));
  for (const r of rows) {
    const a = at(r);
    if (!a) continue;
    const m = monthOf(a, timeZone);
    if (sums.has(m)) sums.set(m, sums.get(m)! + value(r));
  }
  return months.map(m => ({ month: m, value: Math.round(sums.get(m)! * 100) / 100 }));
}

const DONE = new Set(["enrolled"]);
const LOST = new Set(["rejected", "withdrawn"]);
/** Applications by where they came from: how many, how many enrolled, and the share that did (of those decided). */
export function admissionsBySource(apps: { source: string | null; status: string }[]) {
  const m = new Map<string, { source: string; applications: number; enrolled: number; lost: number; open: number }>();
  for (const a of apps) {
    const s = a.source || "unknown";
    const g = m.get(s) ?? { source: s, applications: 0, enrolled: 0, lost: 0, open: 0 };
    g.applications++;
    if (DONE.has(a.status)) g.enrolled++; else if (LOST.has(a.status)) g.lost++; else g.open++;
    m.set(s, g);
  }
  return [...m.values()].map(g => ({ ...g, conversion: g.enrolled + g.lost ? round1((g.enrolled / (g.enrolled + g.lost)) * 100) : null }))
    .sort((a, b) => b.applications - a.applications);
}

/** Billed and collected per class, with the share collected, worst collected first. */
export function collectionByClass(invoices: { class_name: string | null; total: number; amount_paid: number; status: string }[]) {
  const m = new Map<string, { class_name: string; billed: number; paid: number }>();
  for (const i of invoices) {
    if (i.status === "void") continue;
    const k = i.class_name ?? "No class";
    const g = m.get(k) ?? { class_name: k, billed: 0, paid: 0 };
    g.billed += Number(i.total) || 0; g.paid += Number(i.amount_paid) || 0;
    m.set(k, g);
  }
  return [...m.values()].map(g => ({ ...g, billed: Math.round(g.billed * 100) / 100, paid: Math.round(g.paid * 100) / 100,
    outstanding: Math.round(Math.max(0, g.billed - g.paid) * 100) / 100, rate: g.billed ? round1((g.paid / g.billed) * 100) : null }))
    .sort((a, b) => (a.rate ?? 101) - (b.rate ?? 101));
}
