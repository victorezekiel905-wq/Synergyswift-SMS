import { describe, it, expect } from "vitest";
import {
  dayPlan, minutesOf, homeworkStatus, feeSummary, rate, attendanceRate, trend, sparkline, targetTone,
  kpis, cleanTargets, teacherTasks, childGlance, type PeriodRow, type LessonRow
} from "@/lib/portal";

const P = (id: string, pos: number, s: string, e: string, brk = false): PeriodRow => ({ id, name: id, starts_at: s, ends_at: e, position: pos, is_break: brk });
const periods = [P("p1", 1, "08:00", "08:40"), P("p2", 2, "08:40", "09:20"), P("br", 3, "09:20", "09:40", true), P("p3", 4, "09:40", "10:20"), P("p4", 5, "10:20", "11:00")];
const L = (period_id: string, extra: Partial<LessonRow> = {}): LessonRow => ({ id: `e-${period_id}`, period_id, subject: "Maths", class_name: "JSS1A", teacher: "Mr A", room: null, ...extra });

describe("dayPlan", () => {
  it("reads times as minutes", () => { expect(minutesOf("08:30")).toBe(510); expect(minutesOf("08:30:00")).toBe(510); });
  it("marks lessons done, now, next and later", () => {
    const plan = dayPlan(periods, [L("p1"), L("p2"), L("p4")], minutesOf("08:50"));
    expect(plan.map(s => s.state)).toEqual(["done", "now", "later", "later", "later"]);
    const before = dayPlan(periods, [L("p3"), L("p4")], minutesOf("07:30"));
    expect(before.map(s => s.state)).toEqual(["later", "later", "later", "next", "later"]);
  });
  it("names the next lesson during a break and skips free periods", () => {
    const plan = dayPlan(periods, [L("p1"), L("p4")], minutesOf("09:25"));
    expect(plan.find(s => s.state === "next")?.period.id).toBe("p4");
    expect(plan[2].lesson).toBeNull();
  });
  it("never puts a lesson in a break", () => {
    expect(dayPlan(periods, [L("br")], 0)[2].lesson).toBeNull();
  });
});

describe("homeworkStatus", () => {
  const now = new Date("2026-10-16T10:00:00Z");
  const hw = [
    { id: "a", title: "Old", subject: "Maths", due_at: "2026-10-14T16:00:00Z" },
    { id: "b", title: "Today", subject: "English", due_at: "2026-10-16T20:00:00Z" },
    { id: "c", title: "Later", subject: "Science", due_at: "2026-10-20T16:00:00Z" },
    { id: "d", title: "Handed in", subject: null, due_at: "2026-10-18T16:00:00Z" },
    { id: "e", title: "Marked", subject: null, due_at: "2026-10-10T16:00:00Z" }
  ];
  const subs = [
    { homework_id: "d", submitted_at: "2026-10-15T10:00:00Z" },
    { homework_id: "e", submitted_at: "2026-10-09T10:00:00Z", score: 8, marked_at: "2026-10-11T10:00:00Z", feedback: "Good" }
  ];
  it("puts the most pressing first", () => {
    const out = homeworkStatus(hw, subs, now, "Africa/Lagos");
    expect(out.map(h => [h.id, h.state])).toEqual([["a", "overdue"], ["b", "due_today"], ["c", "due"], ["d", "submitted"], ["e", "marked"]]);
    expect(out[4]).toMatchObject({ score: 8, feedback: "Good" });
  });
  it("uses the school's time zone for 'today'", () => {
    // 23:30 UTC on the 16th is the 17th in Lagos.
    const late = [{ id: "x", title: "x", subject: null, due_at: "2026-10-16T23:30:00Z" }];
    expect(homeworkStatus(late, [], now, "Africa/Lagos")[0].state).toBe("due");
    expect(homeworkStatus(late, [], now, "UTC")[0].state).toBe("due_today");
  });
});

describe("feeSummary", () => {
  it("adds up billed, paid, owed and overdue, ignoring void invoices", () => {
    const s = feeSummary([
      { total: "100000", amount_paid: "40000", status: "part_paid", due_date: "2026-10-01" },
      { total: 50000, amount_paid: 0, status: "issued", due_date: "2026-11-01" },
      { total: 20000, amount_paid: 20000, status: "paid", due_date: "2026-09-01" },
      { total: 99999, amount_paid: 0, status: "void", due_date: "2026-09-01" }
    ], "2026-10-16");
    expect(s).toEqual({ billed: 170000, paid: 60000, owed: 110000, overdue: 60000, next_due: "2026-11-01", invoices: 3 });
  });
  it("does not count overpayment as negative debt", () => {
    expect(feeSummary([{ total: 100, amount_paid: 150, status: "paid", due_date: null }], "2026-10-16").owed).toBe(0);
  });
});

describe("numbers", () => {
  it("rates", () => { expect(rate(1, 3)).toBe(33.3); expect(rate(0, 0)).toBeNull(); });
  it("attendance counts late as attended", () => {
    expect(attendanceRate([{ status: "present" }, { status: "late" }, { status: "absent" }, { status: "excused" }])).toBe(50);
    expect(attendanceRate([])).toBeNull();
  });
  it("trend compares with about a week before", () => {
    const t = trend([{ day: "2026-10-01", value: 90 }, { day: "2026-10-08", value: 92 }, { day: "2026-10-12", value: null }, { day: "2026-10-15", value: 95 }]);
    expect(t).toEqual({ latest: 95, previous: 92, change: 3, direction: "up" });
    expect(trend([{ day: "2026-10-14", value: 80 }, { day: "2026-10-15", value: 80.2 }]).direction).toBe("flat");
    expect(trend([{ day: "2026-10-15", value: 80 }])).toMatchObject({ latest: 80, direction: null });
    expect(trend([]).latest).toBeNull();
  });
  it("sparkline draws a path with gaps", () => {
    expect(sparkline([1, 2, null, 4], 32, 12, 2)).toBe("M2 10 L11.3 7.3 M30 2");
    expect(sparkline([null, null])).toBe("");
    expect(sparkline([5, 5], 10, 10, 0)).toBe("M0 10 L10 10");
  });
  it("targets", () => {
    expect(targetTone(96, 95)).toBe("good");
    expect(targetTone(91, 95)).toBe("warn");
    expect(targetTone(80, 95)).toBe("bad");
    expect(targetTone(3, 5, false)).toBe("good");
    expect(targetTone(12, 5, false)).toBe("bad");
    expect(targetTone(null, 5)).toBeUndefined();
    expect(targetTone(5, undefined)).toBeUndefined();
  });
  it("cleans targets", () => {
    expect(cleanTargets({ attendance_rate: "95", collection_rate: -1, made_up: 4, incidents_week: "" })).toEqual({ attendance_rate: 95 });
  });
});

describe("kpis", () => {
  it("works out the head's figures", () => {
    const k = kpis({
      students: 400, staff: 40, staffOnLeave: 2, classes: 10, classesMarked: 12,
      marksToday: [{ status: "present" }, { status: "present" }, { status: "late" }, { status: "absent" }],
      billed: 1000000, paid: 750000, overdueInvoices: 3, overdueAmount: 120000.555,
      libraryOverdue: 4, lowStock: 1, incidentsWeek: 2, applicationsOpen: 7, admittedThisTerm: 5
    });
    expect(k).toMatchObject({ attendance_rate: 75, registers_taken: 100, absent_today: 1, outstanding: 250000, collection_rate: 75, overdue_amount: 120000.56 });
  });
  it("leaves rates empty when nothing is recorded", () => {
    const k = kpis({ students: 0, staff: 0, staffOnLeave: 0, classes: 0, classesMarked: 0, marksToday: [], billed: 0, paid: 0, overdueInvoices: 0, overdueAmount: 0, libraryOverdue: 0, lowStock: 0, incidentsWeek: 0, applicationsOpen: 0, admittedThisTerm: 0 });
    expect([k.attendance_rate, k.registers_taken, k.collection_rate]).toEqual([null, null, null]);
  });
});

describe("teacherTasks", () => {
  const slots = dayPlan(periods, [L("p1", { register_taken: true }), L("p2"), L("p4")], minutesOf("09:00"));
  it("lists registers due, urgent first", () => {
    const t = teacherTasks({ slots, toMark: 3, oldestUnmarkedDays: 2, sheets: [{ status: "draft" }, { status: "returned" }, { status: "approved" }], notesReturned: 1, unread: 2 });
    expect(t.map(x => [x.kind, x.count, x.urgent])).toEqual([
      ["register", 1, true], ["scores", 1, true], ["marking", 3, false], ["scores", 1, false], ["notes", 1, false], ["messages", 2, false]
    ]);
    expect(t[0].label).toBe("Take the register for a lesson");
  });
  it("marking becomes urgent after a week", () => {
    expect(teacherTasks({ slots: [], toMark: 1, oldestUnmarkedDays: 9, sheets: [], notesReturned: 0, unread: 0 })[0]).toMatchObject({ kind: "marking", urgent: true, label: "Mark 1 homework submission" });
  });
  it("is empty when all is done", () => {
    expect(teacherTasks({ slots: dayPlan(periods, [L("p1", { register_taken: true })], minutesOf("12:00")), toMark: 0, oldestUnmarkedDays: 0, sheets: [], notesReturned: 0, unread: 0 })).toEqual([]);
  });
});

describe("childGlance", () => {
  it("sums up a child for the family", () => {
    const now = new Date("2026-10-16T10:00:00Z");
    const homework = homeworkStatus([
      { id: "a", title: "a", subject: null, due_at: "2026-10-10T10:00:00Z" },
      { id: "b", title: "b", subject: null, due_at: "2026-10-18T10:00:00Z" },
      { id: "c", title: "c", subject: null, due_at: "2026-11-30T10:00:00Z" }
    ], [], now, "UTC");
    const g = childGlance({ marks: [{ status: "present" }, { status: "absent" }, { status: "late" }, { status: "present" }], homework, fees: feeSummary([{ total: 100, amount_paid: 0, status: "issued", due_date: "2026-10-01" }], "2026-10-16"), now });
    expect(g).toEqual({ attendance_rate: 75, absences: 1, late: 1, homework_overdue: 1, homework_due_week: 1, owed: 100, overdue: 100 });
    expect(childGlance({ marks: [], homework: [], fees: null, now }).owed).toBe(0);
  });
});
