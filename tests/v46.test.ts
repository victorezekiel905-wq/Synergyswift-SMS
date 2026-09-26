import { describe, it, expect } from "vitest";
import { riskScore } from "@/lib/risk";
import { generateTimetable, findClashes, type Requirement } from "@/lib/timetable";
import { computePayslip, workingDaysInMonth, leaveDaysInMonth } from "@/lib/payroll";
import { normaliseVerification, matchesExpected, verifyWebhook, toMinor } from "@/lib/payments";
import { applicableCharges } from "@/lib/fees";
import { smsText, normalizePhone } from "@/lib/messaging/providers";
import { absence, feeReminder, admissionUpdate } from "@/lib/messaging/notices";
import { createHmac } from "crypto";

describe("early-warning risk", () => {
  it("is low for a healthy student", () => {
    expect(riskScore({ attendanceRate: 0.97, average: 72, previousAverage: 70, failingSubjects: 0, passMark: 40, negativePoints: 0, missingHomework: 0 }))
      .toEqual({ score: 0, level: "low", factors: [] });
  });
  it("explains a high score with its biggest factors first", () => {
    const r = riskScore({ attendanceRate: 0.65, average: 38, previousAverage: 55, failingSubjects: 4, passMark: 40, negativePoints: 12, missingHomework: 5 });
    expect(r.level).toBe("high");
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.factors[0].factor).toBe("attendance");
    expect(r.factors.map(f => f.factor).sort()).toEqual(["attendance", "behaviour", "failing_subjects", "falling", "homework", "low_average"]);
  });
  it("handles missing data without inventing risk", () => {
    expect(riskScore({ attendanceRate: null, average: null, previousAverage: null, failingSubjects: 0, passMark: 50, negativePoints: 0, missingHomework: 0 }).score).toBe(0);
  });
});

describe("timetable generator", () => {
  const days = [1, 2, 3, 4, 5];
  const periods = ["p1", "p2", "p3", "p4", "p5", "p6"];
  const req: Requirement[] = [
    { classId: "A", subjectId: "maths", teacherId: "t1", perWeek: 5 },
    { classId: "A", subjectId: "eng", teacherId: "t2", perWeek: 5 },
    { classId: "A", subjectId: "bio", teacherId: "t3", perWeek: 3 },
    { classId: "B", subjectId: "maths", teacherId: "t1", perWeek: 5 },
    { classId: "B", subjectId: "eng", teacherId: "t2", perWeek: 5 },
    { classId: "B", subjectId: "chem", teacherId: "t3", perWeek: 3 }
  ];
  it("places every lesson without clashes and spreads subjects across the week", () => {
    const r = generateTimetable({ days, periodIds: periods, requirements: req, fixed: [], seed: 42, attempts: 20 });
    expect(r.unplaced).toEqual([]);
    expect(r.placed).toHaveLength(26);
    expect(findClashes(r.placed)).toEqual([]);
    const slotKeys = r.placed.map(p => `${p.classId}|${p.day}|${p.periodId}`);
    expect(new Set(slotKeys).size).toBe(slotKeys.length);
    for (const d of days) expect(r.placed.filter(p => p.classId === "A" && p.subjectId === "maths" && p.day === d)).toHaveLength(1);
  });
  it("keeps locked cells and never double-books the teacher", () => {
    const fixed = [{ classId: "C", day: 1, periodId: "p1", subjectId: "maths", teacherId: "t1", locked: true }];
    const r = generateTimetable({ days, periodIds: periods, requirements: req, fixed, seed: 7, attempts: 20 });
    expect(r.placed.some(p => p.teacherId === "t1" && p.day === 1 && p.periodId === "p1")).toBe(false);
  });
  it("reports what cannot fit", () => {
    const r = generateTimetable({ days: [1], periodIds: ["p1", "p2"], requirements: [{ classId: "A", subjectId: "x", teacherId: "t", perWeek: 3 }], fixed: [], seed: 1, attempts: 3 });
    expect(r.unplaced).toEqual([{ classId: "A", subjectId: "x", teacherId: "t", perWeek: 1 }]);
  });
});

describe("payroll", () => {
  it("counts working days and leave inside the month", () => {
    expect(workingDaysInMonth("2026-09")).toBe(22);
    expect(workingDaysInMonth("2026-02")).toBe(20);
    expect(leaveDaysInMonth("2026-09", "2026-08-28", "2026-09-04")).toBe(4);
    expect(leaveDaysInMonth("2026-09", "2026-10-01", "2026-10-05")).toBe(0);
  });
  it("computes gross, pension, tax, other deductions and net", () => {
    const r = computePayslip({ basic: 100000, allowances: [{ name: "Housing", amount: 20000 }], deductions: [{ name: "Loan", amount: 5000 }, { name: "Union dues", percent: 1 }], tax_percent: 10, pension_percent: 8 });
    expect(r.gross).toBe(120000);
    expect(r.deductions.find(d => d.name.startsWith("Pension"))!.amount).toBe(8000);
    expect(r.deductions.find(d => d.name.startsWith("Tax"))!.amount).toBe(11200);
    expect(r.totalDeductions).toBe(8000 + 11200 + 5000 + 1000);
    expect(r.net).toBe(120000 - 25200);
  });
  it("prorates unpaid leave and never goes negative", () => {
    const r = computePayslip({ basic: 22000, allowances: [], deductions: [], tax_percent: 0, pension_percent: 0 }, { unpaidLeaveDays: 2, workingDays: 22 });
    expect(r.leaveDeduction).toBe(2000);
    expect(r.gross).toBe(20000);
    expect(computePayslip({ basic: 1000, allowances: [], deductions: [{ name: "Big", amount: 5000 }], tax_percent: 0, pension_percent: 0 }).net).toBe(0);
  });
});

describe("payments", () => {
  it("normalises provider responses and demands an exact amount match", () => {
    const ps = normaliseVerification("paystack", { data: { status: "success", amount: 1500050, currency: "NGN" } });
    expect(ps).toEqual({ status: "success", amount: 15000.5, currency: "NGN" });
    expect(matchesExpected(ps, 15000.5, "ngn")).toBe(true);
    expect(matchesExpected(ps, 15000, "NGN")).toBe(false);
    const fw = normaliseVerification("flutterwave", { data: { status: "successful", amount: 200, currency: "ngn" } });
    expect(fw.status).toBe("success");
    expect(normaliseVerification("paystack", { data: { status: "abandoned" } }).status).toBe("failed");
    expect(toMinor(0.1 + 0.2)).toBe(30);
  });
  it("checks webhook signatures", () => {
    const body = JSON.stringify({ event: "charge.success" });
    const sig = createHmac("sha512", "sk_test").update(body).digest("hex");
    expect(verifyWebhook("paystack", body, new Headers({ "x-paystack-signature": sig }), { paystack: "sk_test", flutterwave: undefined })).toBe(true);
    expect(verifyWebhook("paystack", body + " ", new Headers({ "x-paystack-signature": sig }), { paystack: "sk_test", flutterwave: undefined })).toBe(false);
    expect(verifyWebhook("flutterwave", body, new Headers({ "verif-hash": "h1" }), { paystack: undefined, flutterwave: "h1" })).toBe(true);
    expect(verifyWebhook("flutterwave", body, new Headers({}), { paystack: undefined, flutterwave: "h1" })).toBe(false);
  });
});

describe("fees", () => {
  it("applies class-specific fees over school-wide ones and skips optional or zero fees", () => {
    const rows = [
      { fee_item_id: "tuition", class_group_id: null, amount: 100, optional: false, name: "Tuition" },
      { fee_item_id: "tuition", class_group_id: "jss3", amount: 150, optional: false, name: "Tuition" },
      { fee_item_id: "bus", class_group_id: null, amount: 30, optional: true, name: "Bus" },
      { fee_item_id: "lab", class_group_id: null, amount: 0, optional: false, name: "Lab" }
    ];
    expect(applicableCharges(rows, "jss1").map(c => [c.fee_item_id, c.amount])).toEqual([["tuition", 100]]);
    expect(applicableCharges(rows, "jss3").map(c => [c.fee_item_id, c.amount])).toEqual([["tuition", 150]]);
  });
});

describe("SMS and notices", () => {
  it("strips WhatsApp formatting and caps length", () => {
    expect(smsText("*School*\n\n\nHello _there_")).toBe("School\nHello there");
    expect(smsText("x".repeat(600))).toHaveLength(459);
    expect(normalizePhone("0803 123 4567")).toBe("2348031234567");
  });
  it("builds the new notices with links and parameters", () => {
    const b = { schoolName: "Green Hills" };
    expect(absence(b, { guardianName: "G", studentName: "Ada", date: "Mon 21 Sep", status: "absent" }).wa.text).toContain("absent");
    const f = feeReminder(b, { guardianName: "G", studentName: "Ada", balance: "₦50,000", title: "School fees", due: "30 Sep", link: "https://x/pay/t" });
    expect(f.text).toContain("https://x/pay/t");
    expect(f.wa.params).toHaveLength(5);
    expect(admissionUpdate(b, { guardianName: "G", childName: "Kid", applicationNo: "APP-1", status: "offered", link: "l" }).text).toContain("offered a place");
  });
});

import { firedRules, type Rule } from "@/lib/behaviour";

describe("behaviour rules", () => {
  const rule: Rule = { id: "r", name: "3 strikes", kind: "negative", measure: "count", threshold: 3, window_days: 14, action: "Detention", notify_parent: true, active: true };
  const now = new Date("2026-09-25T10:00:00Z");
  const rec = (daysAgo: number, points = -1) => ({ kind: "negative" as const, points, occurred_at: new Date(now.getTime() - daysAgo * 86400_000).toISOString() });
  it("fires once when the threshold is crossed inside the window", () => {
    expect(firedRules([rule], [rec(1), rec(2)], rec(0), now).map(r => r.id)).toEqual(["r"]);
    expect(firedRules([rule], [rec(1), rec(2), rec(3)], rec(0), now)).toEqual([]);
  });
  it("ignores old records, other kinds and inactive rules", () => {
    expect(firedRules([rule], [rec(20), rec(30)], rec(0), now)).toEqual([]);
    expect(firedRules([rule], [rec(1), rec(2)], { kind: "positive", points: 2, occurred_at: now.toISOString() }, now)).toEqual([]);
    expect(firedRules([{ ...rule, active: false }], [rec(1), rec(2)], rec(0), now)).toEqual([]);
  });
  it("supports point totals", () => {
    const pts: Rule = { ...rule, measure: "points", threshold: 5 };
    expect(firedRules([pts], [rec(1, -2), rec(2, -2)], rec(0, -2), now).length).toBe(1);
  });
});
