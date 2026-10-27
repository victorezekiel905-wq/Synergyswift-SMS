import { describe, it, expect } from "vitest";
import { revenueSummary, annualPrice, healthState, type SubRow } from "@/lib/platform-centre";
import { DEFAULT_GROUP_PRICES } from "@/lib/saas";

const NOW = new Date("2026-10-27T12:00:00Z");
const plans = [{ id: "p1", name: "Complete", groups: ["core", "learning", "exams", "money", "safety", "engagement"], prices: [1_000_000, 2_100_000, 3_800_000, 6_700_000, 11_000_000] },
  { id: "p2", name: "Essentials", groups: ["core"], prices: [250_000, 530_000, 950_000, 1_680_000, 2_800_000] }];
const sub = (tenant_id: string, o: Partial<SubRow>): SubRow => ({ tenant_id, status: "active", plan_id: "p1", band: 0, add_on_groups: [], custom_annual: null, discount_pct: 0,
  created_at: "2026-01-10T00:00:00Z", updated_at: null, period_end: "2027-01-10T00:00:00Z", ...o });

describe("super admin revenue", () => {
  it("prices a school like its invoice: plan, band, add-ons, agreed price, discount", () => {
    expect(annualPrice(sub("a", {}), plans[0], DEFAULT_GROUP_PRICES)).toBe(1_000_000);
    expect(annualPrice(sub("a", { plan_id: "p2", band: 1, add_on_groups: ["exams"] }), plans[1], DEFAULT_GROUP_PRICES)).toBe(530_000 + DEFAULT_GROUP_PRICES.exams[1]!);
    expect(annualPrice(sub("a", { custom_annual: 900_000, discount_pct: 10 }), plans[0], DEFAULT_GROUP_PRICES)).toBe(810_000);
  });
  it("adds up MRR and ARR from paying schools, with trials, churn and renewals apart", () => {
    const s = revenueSummary([
      sub("a", {}),                                                    // 1.0m a year
      sub("b", { plan_id: "p2", band: 2, status: "past_due" }),        // 950k
      sub("c", { status: "trial" }),
      sub("d", { status: "cancelled", updated_at: "2026-10-20T00:00:00Z" }),
      sub("e", { band: 1, created_at: "2026-10-15T00:00:00Z", period_end: "2026-12-01T00:00:00Z" }),   // new, renewing soon: 2.1m
      sub("f", { status: "cancelled", created_at: "2025-01-01T00:00:00Z" }), sub("f", { created_at: "2026-02-01T00:00:00Z" })   // latest counts
    ], plans, DEFAULT_GROUP_PRICES, NOW);
    expect(s.mrr).toBe(Math.round((1_000_000 + 950_000 + 2_100_000 + 1_000_000) / 12));
    expect(s.arr).toBe(5_050_000);
    expect(s.counts).toEqual({ paying: 4, trial: 1, past_due: 1, suspended: 0, cancelled: 1 });
    expect(s.past_due_mrr).toBe(Math.round(950_000 / 12));
    expect(s.new_mrr_30).toBe(Math.round(2_100_000 / 12));
    expect(s.churned_mrr_30).toBe(Math.round(1_000_000 / 12));
    expect(s.renewing_60_mrr).toBe(Math.round(2_100_000 / 12));
    expect(s.by_plan.map(p => [p.plan, p.schools])).toEqual([["Complete", 3], ["Essentials", 1]]);
  });
  it("says plainly when the system needs attention", () => {
    expect(healthState({ outboxOldestMin: 2, outboxFailed24: 0, webhookFailed24: 0, cronMinutesAgo: 1 })).toEqual({ ok: true, issues: [] });
    const bad = healthState({ outboxOldestMin: 40, outboxFailed24: 50, webhookFailed24: 3, cronMinutesAgo: null });
    expect(bad.ok).toBe(false);
    expect(bad.issues.length).toBe(4);
  });
});
