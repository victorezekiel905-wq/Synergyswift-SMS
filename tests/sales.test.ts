import { describe, expect, it } from "vitest";
import { autoOnboarding, customerHealth, leadScore, weightedPipeline, type Metrics } from "@/lib/sales";

const now = new Date("2026-11-01T10:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();

describe("lead score", () => {
  it("ranks a large, warm, referred school in proposal above a small cold one", () => {
    const hot = leadScore({ stage: "proposal", source: "referral", students_estimate: 1200, last_activity_at: daysAgo(1), created_at: daysAgo(20), next_action_at: daysAgo(-2) }, now);
    const cold = leadScore({ stage: "new", source: "cold_call", students_estimate: 80, last_activity_at: null, created_at: daysAgo(60), next_action_at: null }, now);
    expect(hot).toBeGreaterThan(80);
    expect(cold).toBeLessThan(25);
  });
  it("is 100 when won and 0 when lost", () => {
    const base = { source: "website" as const, students_estimate: 300, last_activity_at: null, created_at: daysAgo(1), next_action_at: null };
    expect(leadScore({ ...base, stage: "won" }, now)).toBe(100);
    expect(leadScore({ ...base, stage: "lost" }, now)).toBe(0);
  });
  it("cools as the last contact gets older", () => {
    const at = (d: number) => leadScore({ stage: "contacted", source: "website", students_estimate: 300, last_activity_at: daysAgo(d), created_at: daysAgo(90), next_action_at: null }, now);
    expect(at(1)).toBeGreaterThan(at(10));
    expect(at(10)).toBeGreaterThan(at(40));
  });
});

describe("pipeline", () => {
  it("weights open deals by their chance of closing", () => {
    expect(weightedPipeline([{ stage: "proposal", value_estimate: 1_000_000 }, { stage: "won", value_estimate: 5_000_000 }, { stage: "new", value_estimate: 2_000_000 }])).toBe(750_000);
  });
});

const healthy: Metrics = { students: 600, staff: 40, parents_with_login: 400, staff_signed_in_30: 35, users_signed_in_30: 500, actions_30: 900, actions_prev_30: 850,
  last_action_at: daysAgo(0), invoices_overdue: 0, oldest_overdue_days: 0, sub_status: "active", period_end: daysAgo(-200), status: "active", created_at: daysAgo(400) };

describe("customer health", () => {
  it("is low risk for a school in steady use", () => {
    const h = customerHealth(healthy, now);
    expect(h.risk).toBe("low");
    expect(h.score).toBeGreaterThanOrEqual(90);
  });
  it("flags falling use, quiet staff and overdue bills with reasons", () => {
    const h = customerHealth({ ...healthy, staff_signed_in_30: 5, actions_30: 200, invoices_overdue: 1, oldest_overdue_days: 45 }, now);
    expect(h.risk).toBe("high");
    expect(h.reasons.join(" | ")).toMatch(/staff signed in/);
    expect(h.reasons.join(" | ")).toMatch(/Use fell 76%/);
    expect(h.reasons.join(" | ")).toMatch(/overdue/);
  });
  it("raises the risk a level when the renewal is close", () => {
    const soon = { ...healthy, period_end: daysAgo(-30) };
    const fine = customerHealth(soon, now);
    expect(fine.reasons.some(r => /Renews in 30 days/.test(r))).toBe(true);
    expect(fine.risk).toBe("low");
    expect(customerHealth({ ...soon, staff_signed_in_30: 15 }, now).risk).toBe("medium");
    expect(customerHealth({ ...soon, staff_signed_in_30: 5 }, now).risk).toBe("high");
    expect(customerHealth({ ...healthy, staff_signed_in_30: 5 }, now).risk).toBe("medium");
  });
  it("notices a school that went quiet", () => {
    const h = customerHealth({ ...healthy, last_action_at: daysAgo(20) }, now);
    expect(h.reasons.some(r => /No activity for 20 days/.test(r))).toBe(true);
  });
});

describe("onboarding", () => {
  it("ticks steps from what the school has done", () => {
    expect([...autoOnboarding({ students: 0, staff: 1, staff_signed_in_30: 1, parents_with_login: 0, actions_30: 0 })]).toEqual(["school_created"]);
    expect([...autoOnboarding({ students: 500, staff: 30, staff_signed_in_30: 25, parents_with_login: 200, actions_30: 400 })].sort())
      .toEqual(["data_imported", "go_live", "parents_invited", "school_created", "staff_trained"]);
  });
});
