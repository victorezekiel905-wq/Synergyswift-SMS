/**
 * Performance budgets (phase 14l). Pure helpers, unit tested: page-speed numbers
 * from real browsers (web vitals) and slow database calls, against the budgets.
 */

export type Budgets = { LCP: number; INP: number; CLS: number; FCP: number; TTFB: number; slow_call: number };
/** Google's "good" thresholds, and 800 ms for a database call. */
export const DEFAULT_BUDGETS: Budgets = { LCP: 2500, INP: 200, CLS: 0.1, FCP: 1800, TTFB: 800, slow_call: 800 };
export const VITALS = ["LCP", "INP", "CLS", "FCP", "TTFB"] as const;
export type Vital = (typeof VITALS)[number];

export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[i]!;
}

/** "/school/students/3f2b…/sen" → "/school/students/:id/sen", so pages group together. */
export function routePattern(path: string): string {
  return path.split("?")[0]!.replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "/:id").replace(/\/[0-9a-f]{24,}/gi, "/:token").replace(/\/\d+(?=\/|$)/g, "/:n").slice(0, 200) || "/";
}

export type Sample = { kind: "vital" | "slow_call"; name: string; path: string | null; value: number };

export function perfReport(samples: Sample[], budgets: Budgets) {
  const vitals = VITALS.map(name => {
    const v = samples.filter(s => s.kind === "vital" && s.name === name).map(s => s.value);
    const p75 = percentile(v, 75);
    return { name, p75, samples: v.length, budget: budgets[name], within: p75 === null ? null : p75 <= budgets[name] };
  });
  const byPage = new Map<string, number[]>();
  for (const s of samples) if (s.kind === "vital" && s.name === "LCP" && s.path) byPage.set(s.path, [...(byPage.get(s.path) ?? []), s.value]);
  const pages = [...byPage].filter(([, v]) => v.length >= 3).map(([path, v]) => ({ path, lcp_p75: percentile(v, 75)!, samples: v.length }))
    .sort((a, b) => b.lcp_p75 - a.lcp_p75).slice(0, 10).map(p => ({ ...p, within: p.lcp_p75 <= budgets.LCP }));
  const byCall = new Map<string, number[]>();
  for (const s of samples) if (s.kind === "slow_call") byCall.set(s.name, [...(byCall.get(s.name) ?? []), s.value]);
  const calls = [...byCall].map(([name, v]) => ({ name, count: v.length, p95: percentile(v, 95)!, worst: Math.max(...v) })).sort((a, b) => b.count - a.count || b.p95 - a.p95).slice(0, 15);
  return { vitals, pages, calls, ok: vitals.every(v => v.within !== false) && pages.every(p => p.within) };
}
