import { describe, it, expect } from "vitest";
import { chargesFor, siblingRanks, invoiceLines, splitInstallments, installmentStatus, lateFee, reminderDue, aging, statement, type Schedule, type Rule, type Award } from "@/lib/fee-rules";

const S: Schedule[] = [
  { fee_item_id: "tuition", class_group_id: null, category: null, amount: 100000, optional: false, name: "Tuition" },
  { fee_item_id: "tuition", class_group_id: "jss1", category: null, amount: 120000, optional: false, name: "Tuition" },
  { fee_item_id: "boarding", class_group_id: null, category: "boarding", amount: 80000, optional: false, name: "Boarding" },
  { fee_item_id: "tuition", class_group_id: "jss1", category: "staff_child", amount: 60000, optional: false, name: "Tuition" },
  { fee_item_id: "bus", class_group_id: null, category: null, amount: 30000, optional: true, name: "School bus" },
  { fee_item_id: "zero", class_group_id: null, category: null, amount: 0, optional: false, name: "Nothing" }
];

describe("charges", () => {
  it("picks the most specific amount for each item", () => {
    expect(chargesFor(S, { classGroupId: "jss2", category: null, chosenOptional: new Set() }).map(c => [c.fee_item_id, c.amount])).toEqual([["tuition", 100000]]);
    expect(chargesFor(S, { classGroupId: "jss1", category: "boarding", chosenOptional: new Set() }).map(c => [c.fee_item_id, c.amount])).toEqual([["tuition", 120000], ["boarding", 80000]]);
    expect(chargesFor(S, { classGroupId: "jss1", category: "staff_child", chosenOptional: new Set() }).map(c => c.amount)).toEqual([60000]);
  });
  it("adds optional extras only when chosen", () => {
    expect(chargesFor(S, { classGroupId: "jss2", category: null, chosenOptional: new Set(["bus"]) }).map(c => c.fee_item_id)).toEqual(["tuition", "bus"]);
  });
});

describe("siblings", () => {
  it("numbers children in a family from the eldest, linking families through any shared guardian", () => {
    const ranks = siblingRanks([
      { id: "ada", date_of_birth: "2012-01-01", admitted_on: null }, { id: "tunde", date_of_birth: "2014-05-01", admitted_on: null },
      { id: "bola", date_of_birth: "2016-03-01", admitted_on: null }, { id: "solo", date_of_birth: "2013-01-01", admitted_on: null }
    ], [{ student_id: "ada", guardian_id: "mum" }, { student_id: "tunde", guardian_id: "mum" }, { student_id: "tunde", guardian_id: "dad" }, { student_id: "bola", guardian_id: "dad" }, { student_id: "solo", guardian_id: "x" }]);
    expect(Object.fromEntries(ranks)).toEqual({ ada: 1, tunde: 2, bola: 3, solo: 1 });
  });
});

describe("discounts and awards", () => {
  const charges = [{ fee_item_id: "tuition", amount: 100000, name: "Tuition", optional: false }, { fee_item_id: "bus", amount: 20000, name: "Bus", optional: true }];
  const rules: Rule[] = [
    { id: "s2", name: "Second child 10%", kind: "sibling", percent: 10, amount: null, nth_child: 2, category: null, item_ids: ["tuition"], active: true },
    { id: "s3", name: "Third child 25%", kind: "sibling", percent: 25, amount: null, nth_child: 3, category: null, item_ids: ["tuition"], active: true },
    { id: "st", name: "Staff child", kind: "staff_child", percent: 50, amount: null, nth_child: null, category: null, item_ids: [], active: true }
  ];
  const award = (o: Partial<Award>): Award => ({ id: "a", name: "Scholarship", kind: "scholarship", percent: 50, amount: null, item_ids: ["tuition"], valid_from: "2026-01-01", valid_to: null, approved_by: "u", ...o });
  it("applies the best single rule", () => {
    expect(invoiceLines(charges, { rank: 3, staffChild: false, category: null, rules, awards: [], on: "2026-03-01" }).filter(l => l.kind === "discount")).toEqual([{ kind: "discount", description: "Third child 25%", amount: -25000, fee_item_id: null, source: "rule:s3" }]);
    expect(invoiceLines(charges, { rank: 3, staffChild: true, category: null, rules, awards: [], on: "2026-03-01" }).find(l => l.kind === "discount")?.amount).toBe(-60000);
    expect(invoiceLines(charges, { rank: 1, staffChild: false, category: null, rules, awards: [], on: "2026-03-01" })).toHaveLength(2);
  });
  it("adds approved, current awards but never below zero", () => {
    const l = invoiceLines(charges, { rank: 2, staffChild: false, category: null, rules, awards: [award({}), award({ id: "b", name: "Waiver", percent: null, amount: 500000, item_ids: [] })], on: "2026-03-01" });
    expect(l.map(x => x.amount)).toEqual([100000, 20000, -10000, -50000, -60000]);
    expect(l.reduce((a, x) => a + x.amount, 0)).toBe(0);
    expect(invoiceLines(charges, { rank: 1, staffChild: false, category: null, rules: [], awards: [award({ approved_by: null })], on: "2026-03-01" })).toHaveLength(2);
    expect(invoiceLines(charges, { rank: 1, staffChild: false, category: null, rules: [], awards: [award({ valid_to: "2026-02-01" })], on: "2026-03-01" })).toHaveLength(2);
  });
});

describe("instalments", () => {
  it("splits exactly and dates each part", () => {
    const parts = splitInstallments(100000.01, [{ label: "First", percent: 50, days_after: 0 }, { label: "Second", percent: 25, days_after: 30 }, { label: "Third", percent: 25, days_after: 60 }], "2026-01-10");
    expect(parts.map(p => [p.amount, p.due_date])).toEqual([[50000.01, "2026-01-10"], [25000, "2026-02-09"], [25000, "2026-03-11"]]);
    expect(parts.reduce((a, p) => a + p.amount, 0)).toBeCloseTo(100000.01, 2);
    expect(() => splitInstallments(100, [{ label: "x", percent: 90, days_after: 0 }], "2026-01-01")).toThrow(/100/);
  });
  it("covers the earliest instalments first", () => {
    const s = installmentStatus([{ seq: 1, amount: 500, due_date: "2026-01-10" }, { seq: 2, amount: 500, due_date: "2026-02-10" }, { seq: 3, amount: 500, due_date: "2026-04-10" }], 700, "2026-03-01");
    expect(s.map(x => [x.state, x.due])).toEqual([["paid", 0], ["overdue", 300], ["upcoming", 500]]);
  });
});

describe("late fees and reminders", () => {
  it("charges after the grace period only", () => {
    expect(lateFee({ overdue: 100000, dueDate: "2026-03-01", today: "2026-03-05", percent: 5, amount: 0, graceDays: 7 })).toBe(0);
    expect(lateFee({ overdue: 100000, dueDate: "2026-03-01", today: "2026-03-09", percent: 5, amount: 1000, graceDays: 7 })).toBe(6000);
    expect(lateFee({ overdue: 0, dueDate: "2026-03-01", today: "2026-04-09", percent: 5, amount: 0, graceDays: 7 })).toBe(0);
  });
  it("reminds before the due date, then every few days", () => {
    const base = { dueDate: "2026-03-10", daysBefore: 3, everyDays: 7 };
    expect(reminderDue({ ...base, today: "2026-03-07", lastReminded: null })).toBe(true);
    expect(reminderDue({ ...base, today: "2026-03-08", lastReminded: "2026-03-07" })).toBe(false);
    expect(reminderDue({ ...base, today: "2026-03-11", lastReminded: "2026-03-07" })).toBe(false);
    expect(reminderDue({ ...base, today: "2026-03-14", lastReminded: "2026-03-07" })).toBe(true);
    expect(reminderDue({ ...base, everyDays: 0, today: "2026-03-20", lastReminded: null })).toBe(false);
    expect(reminderDue({ ...base, dueDate: null, today: "2026-03-20", lastReminded: null })).toBe(false);
  });
});

describe("reports", () => {
  it("ages outstanding balances", () => {
    expect(aging([{ balance: 100, due_date: "2026-03-20" }, { balance: 50, due_date: "2026-02-20" }, { balance: 70, due_date: "2025-11-01" }, { balance: 0, due_date: "2025-01-01" }, { balance: 5, due_date: null }], "2026-03-10"))
      .toEqual({ current: 105, "1-30": 50, "31-60": 0, "61-90": 0, "90+": 70 });
  });
  it("builds a statement with opening and running balances", () => {
    const st = statement({ from: "2026-01-01", to: "2026-03-31",
      invoices: [{ date: "2025-09-10", ref: "INV-1", description: "First term", total: 100, void: false }, { date: "2026-01-08", ref: "INV-2", description: "Second term", total: 120, void: false }, { date: "2026-01-09", ref: "INV-3", description: "Void", total: 999, void: true }],
      payments: [{ date: "2025-10-01", ref: "RCT-1", description: "Cash", amount: 80, reversed: false }, { date: "2026-02-01", ref: "RCT-2", description: "Online", amount: 100, reversed: false }, { date: "2026-02-02", ref: "RCT-3", description: "Bounced", amount: 50, reversed: true }] });
    expect(st.opening).toBe(20);
    expect(st.lines.map(l => [l.ref, l.balance])).toEqual([["INV-2", 140], ["RCT-2", 40]]);
    expect(st).toMatchObject({ closing: 40, invoiced: 120, paid: 100 });
  });
});
