import { describe, it, expect } from "vitest";
import {
  resolveModules, planModules, diffEffective, quote, bandFor, billingAction, nextPeriod, effectiveRoles, permitted, moduleBlockedForUser,
  platformAtLeast, DEFAULT_PLANS, MODULE_CATALOGUE, MODULE_KEYS, modulesInGroups, type CustomRole
} from "@/lib/saas";

const plan = (code: string) => DEFAULT_PLANS.find(p => p.code === code)!;

describe("module entitlement", () => {
  it("every module belongs to a group and keys are unique", () => {
    expect(new Set(MODULE_KEYS).size).toBe(MODULE_KEYS.length);
    expect(modulesInGroups(["core", "learning", "exams", "money", "safety", "engagement"])).toHaveLength(MODULE_CATALOGUE.length);
  });
  it("inherits from the plan", () => {
    const { effective } = resolveModules(planModules(plan("essentials").groups), []);
    expect(effective.results).toBe(true);
    expect(effective.exams).toBe(false);
    expect(effective.transport).toBe(false);
  });
  it("add-on groups extend the plan", () => {
    const { effective } = resolveModules(planModules(plan("essentials").groups, ["exams"]), []);
    expect(effective.exams).toBe(true);
  });
  it("ON and OFF overrides win; expired overrides fall back to the plan", () => {
    const now = new Date("2026-11-01T00:00:00Z");
    const { effective, rows } = resolveModules(planModules(plan("growth").groups), [
      { module: "library", mode: "off" },
      { module: "ai", mode: "on", expires_at: "2026-12-31T23:59:59Z" },
      { module: "transport", mode: "on", expires_at: "2026-10-01T00:00:00Z" }
    ], now);
    expect(effective.library).toBe(false);
    expect(effective.ai).toBe(true);
    expect(effective.transport).toBe(false);
    expect(rows.find(r => r.key === "transport")!.expired).toBe(true);
  });
  it("schools without a plan keep every module on", () => {
    const { effective } = resolveModules(null, [{ module: "hostel", mode: "off" }]);
    expect(effective.fees).toBe(true);
    expect(effective.hostel).toBe(false);
  });
  it("shows what saving would change", () => {
    expect(diffEffective({ fees: true, ai: false }, { fees: false, ai: true })).toEqual({ turnedOn: expect.arrayContaining(["ai"]), turnedOff: ["fees"] });
  });
});

describe("pricing", () => {
  it("bands by number of students", () => {
    expect(bandFor(80)).toBe(0);
    expect(bandFor(100)).toBe(0);
    expect(bandFor(101)).toBe(1);
    expect(bandFor(2000)).toBe(4);
    expect(bandFor(2001)).toBeNull();
  });
  it("prices plans, add-ons, discounts and termly billing", () => {
    expect(quote({ plan: plan("complete"), band: 0 }).annual).toBe(1_000_000);
    const q = quote({ plan: plan("essentials"), band: 2, addOns: ["exams", "core"] });
    expect(q.lines).toHaveLength(2); // core is already in the plan
    expect(q.annual).toBe(950_000 + 950_000);
    expect(quote({ plan: plan("growth"), band: 0, discountPct: 50 }).annual).toBe(400_000);
    expect(quote({ plan: plan("complete"), band: 0, cycle: "termly" }).perInvoice).toBe(366_667);
  });
  it("needs an agreed price above the largest band or for custom plans", () => {
    expect(quote({ plan: plan("complete"), band: null }).annual).toBeNull();
    expect(quote({ plan: plan("custom"), band: 1, customAnnual: 4_500_000 }).annual).toBe(4_500_000);
  });
});

describe("billing cycle", () => {
  const end = "2027-01-01T00:00:00Z";
  const sub = (status: any = "active", extra = {}) => ({ status, period_end: end, grace_days: 14, cancel_at_period_end: false, ...extra });
  const at = (s: string) => new Date(s);
  it("issues the renewal two weeks before the end", () => {
    expect(billingAction(sub(), { renewalOpen: false, renewalPaid: false }, at("2026-12-01T00:00:00Z"))).toBe("none");
    expect(billingAction(sub(), { renewalOpen: false, renewalPaid: false }, at("2026-12-20T00:00:00Z"))).toBe("issue_renewal");
    expect(billingAction(sub(), { renewalOpen: true, renewalPaid: false }, at("2026-12-20T00:00:00Z"))).toBe("none");
  });
  it("past due after the end, suspended after the grace period, fine once paid", () => {
    expect(billingAction(sub(), { renewalOpen: true, renewalPaid: false }, at("2027-01-02T00:00:00Z"))).toBe("mark_past_due");
    expect(billingAction(sub("past_due"), { renewalOpen: true, renewalPaid: false }, at("2027-01-10T00:00:00Z"))).toBe("none");
    expect(billingAction(sub("past_due"), { renewalOpen: true, renewalPaid: false }, at("2027-01-16T00:00:00Z"))).toBe("suspend");
    expect(billingAction(sub("past_due"), { renewalOpen: false, renewalPaid: true }, at("2027-01-16T00:00:00Z"))).toBe("none");
  });
  it("cancels at the end when asked", () => {
    expect(billingAction(sub("active", { cancel_at_period_end: true }), { renewalOpen: false, renewalPaid: false }, at("2027-01-01T00:00:01Z"))).toBe("cancel");
  });
  it("works out the next period", () => {
    expect(nextPeriod(end, "annual").end).toBe("2028-01-01T00:00:00.000Z");
    expect(nextPeriod(end, "termly").end).toBe("2027-05-01T00:00:00.000Z");
  });
});

describe("roles and privileges", () => {
  const exams: CustomRole = { id: "r", name: "Exams officer", grants: ["qa_officer", "hostel_warden"], deny_modules: ["fees"], deny_permissions: ["results.publish"] };
  it("custom roles add roles within what the platform allows", () => {
    const r = effectiveRoles(["teacher"], exams, ["qa_officer", "bursar"]);
    expect([...r].sort()).toEqual(["qa_officer", "teacher"]);
    expect(effectiveRoles(["teacher"], exams, null).has("hostel_warden")).toBe(true);
    expect(effectiveRoles(["school_admin"], null, []).has("school_admin")).toBe(true);
  });
  it("custom roles can take away modules and actions", () => {
    expect(permitted(exams, "results.publish")).toBe(false);
    expect(permitted(exams, "exams.publish")).toBe(true);
    expect(permitted(null, "results.publish")).toBe(true);
    expect(moduleBlockedForUser(exams, "fees")).toBe(true);
  });
  it("platform roles rank owner > admin > support", () => {
    expect(platformAtLeast("owner", "admin")).toBe(true);
    expect(platformAtLeast("support", "admin")).toBe(false);
    expect(platformAtLeast(null, "support")).toBe(false);
  });
});
