import { describe, expect, it } from "vitest";
import { attendanceByDay, attendanceRate, countBy, dayIn, feeSummary, highlights, lastDays, lastMonths, pct, sumByMonth } from "@/lib/analysis";

describe("analysis dashboard figures", () => {
  it("percentages never divide by zero", () => {
    expect(pct(1, 3)).toBe(33.3);
    expect(pct(5, 0)).toBeNull();
  });

  it("counts days and months across month and year ends", () => {
    expect(lastDays("2026-03-02", 3)).toEqual(["2026-02-28", "2026-03-01", "2026-03-02"]);
    expect(lastMonths("2026-02-15", 4)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });

  it("counts a moment on the school's own day", () => {
    expect(dayIn("2026-11-08T23:30:00Z", "Africa/Lagos")).toBe("2026-11-09");
    expect(dayIn("2026-11-08T23:30:00Z", "Not/AZone")).toBe("2026-11-08");
  });

  it("attendance: late counts as present; days with no register have no rate", () => {
    const marks = [{ date: "2026-11-02", status: "present" }, { date: "2026-11-02", status: "late" }, { date: "2026-11-02", status: "absent" }, { date: "2026-11-02", status: "excused" }];
    const d = attendanceByDay(marks, ["2026-11-01", "2026-11-02"]);
    expect(d[0]).toEqual({ date: "2026-11-01", marked: 0, rate: null });
    expect(d[1]!.rate).toBe(50);
    expect(attendanceRate(marks)).toBe(50);
  });

  it("fees: voided invoices left out, overpayments capped, overdue only when owed and past due", () => {
    const s = feeSummary([
      { total: 100000, amount_paid: 100000, status: "paid", due_date: "2026-10-01" },
      { total: 100000, amount_paid: 40000, status: "part_paid", due_date: "2026-10-01" },
      { total: 50000, amount_paid: 60000, status: "paid", due_date: "2026-12-01" },
      { total: 999999, amount_paid: 0, status: "void", due_date: "2026-10-01" }
    ], "2026-11-09");
    expect(s).toEqual({ billed: 250000, collected: 190000, outstanding: 60000, rate: 76, overdue_invoices: 1, overdue_amount: 60000 });
  });

  it("money by month in the school's time zone", () => {
    const r = sumByMonth([{ at: "2026-10-31T23:30:00Z", amount: 500 }, { at: "2026-10-15T10:00:00Z", amount: "250.5" }, { at: null, amount: 9 }], ["2026-10", "2026-11"], "Africa/Lagos");
    expect(r).toEqual([{ month: "2026-10", amount: 250.5 }, { month: "2026-11", amount: 500 }]);
  });

  it("groups and orders counts, with blanks as 'Not set'", () => {
    expect(countBy([{ c: "JSS 1" }, { c: "JSS 2" }, { c: "JSS 1" }, { c: null }], r => r.c)).toEqual([
      { key: "JSS 1", count: 2 }, { key: "JSS 2", count: 1 }, { key: "Not set", count: 1 }]);
  });

  it("highlights point at what needs attention, or say all is well", () => {
    expect(highlights({ attendance_today: 80, attendance_30: 92, fee_rate: 40, overdue_invoices: 3 }).map(h => h.tone)).toEqual(["bad", "bad", "warn"]);
    expect(highlights({ attendance_today: 97, attendance_30: 95, fee_rate: 90, overdue_invoices: 0 })).toEqual([{ tone: "good", text: "Nothing needs your attention right now.", href: "/school" }]);
  });
});
