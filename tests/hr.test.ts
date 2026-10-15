import { describe, it, expect } from "vitest";
import { leaveDays, holidayDates, leaveYear, leaveBalances, checkLeave, policyFor, canMove, nextStages, panelSummary, pipeline, materialise, DEFAULT_TEMPLATES,
  dueSoon, profileGaps, validNin, validRsaPin, type LeavePolicy } from "@/lib/hr";

describe("leave days", () => {
  it("counts working days, skipping weekends and holidays", () => {
    expect(leaveDays("2026-10-12", "2026-10-16")).toBe(5);            // Mon–Fri
    expect(leaveDays("2026-10-16", "2026-10-19")).toBe(2);            // Fri, Mon
    expect(leaveDays("2026-10-12", "2026-10-16", { holidays: ["2026-10-14"] })).toBe(4);
    expect(leaveDays("2026-10-17", "2026-10-18")).toBe(0);
    expect(leaveDays("2026-10-19", "2026-10-12")).toBe(0);
    expect(leaveDays("2026-10-17", "2026-10-17", { weekdays: [6] })).toBe(1);
  });
  it("counts a half day as 0.5, only for a single working day", () => {
    expect(leaveDays("2026-10-12", "2026-10-12", { halfDay: true })).toBe(0.5);
    expect(leaveDays("2026-10-12", "2026-10-13", { halfDay: true })).toBe(2);
    expect(leaveDays("2026-10-17", "2026-10-17", { halfDay: true })).toBe(0);
  });
  it("spreads holidays over their days", () => {
    expect([...holidayDates([{ starts_at: "2026-12-24T00:00:00Z", ends_at: "2026-12-26T23:00:00Z" }, { starts_at: "2026-10-01T09:00:00Z" }])])
      .toEqual(["2026-12-24", "2026-12-25", "2026-12-26", "2026-10-01"]);
  });
  it("finds the leave year", () => {
    expect(leaveYear("2026-10-15")).toEqual({ from: "2026-01-01", to: "2026-12-31", prevFrom: "2025-01-01", prevTo: "2025-12-31" });
    expect(leaveYear("2026-08-15", 9)).toEqual({ from: "2025-09-01", to: "2026-08-31", prevFrom: "2024-09-01", prevTo: "2025-08-31" });
    expect(leaveYear("2026-09-01", 9).from).toBe("2026-09-01");
  });
});

describe("balances and checks", () => {
  const policies: LeavePolicy[] = [{ leave_type: "sick", days_per_year: 10, paid: true, carry_over_max: 0, needs_document: true, min_notice_days: 0 }];
  const requests = [
    { leave_type: "annual" as const, days: 15, status: "approved", starts_on: "2025-06-01" },   // last year: 5 unused, carry 5
    { leave_type: "annual" as const, days: 4, status: "approved", starts_on: "2026-03-02" },
    { leave_type: "annual" as const, days: 2.5, status: "pending", starts_on: "2026-11-02" },
    { leave_type: "annual" as const, days: 3, status: "rejected", starts_on: "2026-04-01" },
    { leave_type: "sick" as const, days: 2, status: "approved", starts_on: "2026-05-01" }
  ];
  const b = leaveBalances({ policies, annualAllowance: 20, requests, today: "2026-10-15" });
  it("adds carried days and takes off approved and pending", () => {
    expect(b.find(x => x.leave_type === "annual")).toEqual({ leave_type: "annual", paid: true, entitlement: 20, carried: 5, taken: 4, pending: 2.5, remaining: 18.5 });
    expect(b.find(x => x.leave_type === "sick")).toMatchObject({ entitlement: 10, carried: 0, taken: 2, remaining: 8 });
    expect(b.find(x => x.leave_type === "unpaid")).toMatchObject({ entitlement: null, remaining: null, paid: false });
    expect(b.find(x => x.leave_type === "maternity")!.entitlement).toBe(84);
  });
  it("uses saved policies over defaults, and the person's allowance for annual leave", () => {
    expect(policyFor("annual", [], 25).days_per_year).toBe(25);
    expect(policyFor("sick", policies, 25).days_per_year).toBe(10);
  });
  it("checks notice, balance and documents", () => {
    const annual = policyFor("annual", [], 20);
    expect(checkLeave({ type: "annual", from: "2026-10-19", to: "2026-10-23", days: 5, today: "2026-10-15", policy: annual, remaining: 3, hasDocument: false }))
      .toEqual(["annual leave needs 7 days' notice", "only 3 days of annual leave left"]);
    const sick = policyFor("sick", policies, 20);
    expect(checkLeave({ type: "sick", from: "2026-10-15", to: "2026-10-15", days: 1, today: "2026-10-15", policy: sick, remaining: 8, hasDocument: false }))
      .toEqual(["attach a supporting document for sick leave"]);
    expect(checkLeave({ type: "sick", from: "2026-10-15", to: "2026-10-15", days: 1, today: "2026-10-15", policy: sick, remaining: 8, hasDocument: true })).toEqual([]);
  });
});

describe("recruitment", () => {
  it("moves candidates through sensible stages", () => {
    expect(canMove("applied", "shortlisted")).toBe(true);
    expect(canMove("applied", "hired")).toBe(false);
    expect(canMove("offer", "hired")).toBe(true);
    expect(nextStages("hired")).toEqual([]);
    expect(nextStages("withdrawn")).toEqual([]);
  });
  it("summarises the panel", () => {
    expect(panelSummary([{ score: 4, recommendation: "hire" }, { score: 3, recommendation: "maybe" }, { score: 5, recommendation: "hire" }]))
      .toEqual({ count: 3, average: 4, hire: 2, maybe: 1, no: 0 });
    expect(panelSummary([]).average).toBeNull();
    expect(pipeline([{ stage: "applied" }, { stage: "applied" }, { stage: "hired" }])).toMatchObject({ applied: 2, hired: 1, offer: 0 });
  });
});

describe("checklists, alerts and gaps", () => {
  it("dates checklist items from the start", () => {
    const items = materialise(DEFAULT_TEMPLATES[0].items.slice(0, 2), "2026-10-15");
    expect(items).toEqual([{ position: 0, label: DEFAULT_TEMPLATES[0].items[0].label, owner: "hr_manager", due_on: "2026-10-15" },
      { position: 1, label: DEFAULT_TEMPLATES[0].items[1].label, owner: "staff", due_on: "2026-10-18" }]);
  });
  it("lists what is due soon, overdue first, ignoring people who left", () => {
    const a = dueSoon({ today: "2026-10-15", within: 30,
      staff: [{ id: "s1", full_name: "Ada", status: "active", probation_ends_on: "2026-11-01" }, { id: "s2", full_name: "Bola", status: "exited", probation_ends_on: "2026-10-20" }],
      contracts: [{ staff_id: "s1", kind: "fixed_term", ends_on: "2026-10-10", status: "active" }, { staff_id: "s1", kind: "fixed_term", ends_on: "2026-10-12", status: "ended" },
        { staff_id: "s1", kind: "permanent", ends_on: null, status: "active" }],
      qualifications: [{ staff_id: "s1", title: "TRCN licence", expires_on: "2027-06-01" }, { staff_id: "s1", title: "First aid", expires_on: "2026-10-16" }] });
    expect(a.map(x => [x.kind, x.days])).toEqual([["contract", -5], ["qualification", 1], ["probation", 17]]);
    expect(a[0].text).toBe("fixed term contract ended 5 days ago");
    expect(a[1].text).toBe("First aid expires in 1 day");
  });
  it("lists gaps in a record", () => {
    expect(profileGaps({ email: "a@b.c", phone: null, personal: { nin: "12345678901", date_of_birth: "1990-01-01", next_of_kin_name: "X" }, documents: [{ kind: "cv" }],
      contracts: [], hasSalaryProfile: false })).toEqual(["phone", "next of kin", "pension (PFA, RSA PIN)", "tax ID", "active contract", "salary profile"]);
  });
  it("validates NIN and RSA PIN", () => {
    expect(validNin("12345678901")).toBe(true);
    expect(validNin("1234567890")).toBe(false);
    expect(validRsaPin("pen100012345678")).toBe(true);
    expect(validRsaPin("PEN12345")).toBe(false);
  });
});

import { weightedScore, ratingLabel, cpdSummary, DEFAULT_CRITERIA } from "@/lib/hr";
describe("appraisals and CPD", () => {
  it("weights the scores that were given", () => {
    const c = [{ id: "a", label: "A", weight: 30 }, { id: "b", label: "B", weight: 10 }, { id: "c", label: "C", weight: 60 }];
    expect(weightedScore(c, { a: 4, b: 2, c: 5 })).toBe(4.4);
    expect(weightedScore(c, { a: 4, b: null })).toBe(4);
    expect(weightedScore(c, { a: 9 })).toBeNull();
    expect(DEFAULT_CRITERIA.reduce((s, x) => s + x.weight, 0)).toBe(100);
    expect([ratingLabel(4.6), ratingLabel(3.5), ratingLabel(2.9), ratingLabel(1), ratingLabel(null)]).toEqual(["outstanding", "good", "requires improvement", "inadequate", "not scored"]);
  });
  it("counts completed CPD in the year against the target", () => {
    const items = [{ hours: 6, status: "completed", starts_on: "2026-02-01", verified_at: "x" }, { hours: 3.5, status: "completed", starts_on: "2026-05-01", verified_at: null },
      { hours: 10, status: "planned", starts_on: "2026-06-01", verified_at: null }, { hours: 8, status: "completed", starts_on: "2025-12-01", verified_at: "x" }];
    expect(cpdSummary(items, 20, "2026-01-01", "2026-12-31")).toEqual({ hours: 9.5, verified: 6, target: 20, remaining: 10.5, met: false, activities: 2 });
  });
});
