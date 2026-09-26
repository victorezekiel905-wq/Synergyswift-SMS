/**
 * Behaviour rules engine (pure part is unit-testable): given a student's
 * recent records, which active rules fire now?
 */
export type Rule = { id: string; name: string; kind: "positive" | "negative"; measure: "count" | "points"; threshold: number; window_days: number; action: string; notify_parent: boolean; active: boolean };
export type Rec = { kind: "positive" | "negative"; points: number; occurred_at: string };

/**
 * A rule fires when the new record pushes the student across the threshold
 * within the window (so it fires once per crossing, not on every record after).
 */
export function firedRules(rules: Rule[], records: Rec[], newRecord: Rec, now = new Date()): Rule[] {
  return rules.filter(r => {
    if (!r.active || r.kind !== newRecord.kind) return false;
    const since = now.getTime() - r.window_days * 86400_000;
    const inWindow = records.filter(x => x.kind === r.kind && new Date(x.occurred_at).getTime() >= since);
    const measure = (xs: Rec[]) => r.measure === "count" ? xs.length : xs.reduce((a, x) => a + Math.abs(x.points), 0);
    const before = measure(inWindow);
    const after = before + (r.measure === "count" ? 1 : Math.abs(newRecord.points));
    return before < r.threshold && after >= r.threshold;
  });
}
