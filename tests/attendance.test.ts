import { describe, it, expect } from "vitest";
import {
  summarize, addDays, weekday, schoolDays, closedDates, localParts, zonedToUtc, chronicAbsence, frequentLateness, dailyTrend, weekdayPattern, trendDirection,
  missedLessons, staffDay, requestDays, parseAttlog, type MarkRow
} from "@/lib/attendance";

// 2026-03-02 is a Monday.
describe("dates and school days", () => {
  it("counts weekdays and skips holidays", () => {
    expect(weekday("2026-03-02")).toBe(1);
    expect(weekday("2026-03-08")).toBe(7);
    expect(addDays("2026-02-27", 2)).toBe("2026-03-01");
    expect(schoolDays("2026-03-02", "2026-03-08")).toHaveLength(5);
    expect(schoolDays("2026-03-02", "2026-03-08", { closed: ["2026-03-04"] })).toEqual(["2026-03-02", "2026-03-03", "2026-03-05", "2026-03-06"]);
    expect(schoolDays("2026-03-02", "2026-03-08", { weekdays: [1, 2, 3, 4, 5, 6] })).toHaveLength(6);
    expect(closedDates([{ starts_on: "2026-04-03", ends_on: "2026-04-06" }, { starts_on: "2026-05-01", ends_on: null }])).toEqual(["2026-04-03", "2026-04-04", "2026-04-05", "2026-04-06", "2026-05-01"]);
  });
  it("converts school times to and from UTC", () => {
    expect(localParts(new Date("2026-03-02T06:50:00Z"), "Africa/Lagos")).toEqual({ date: "2026-03-02", minutes: 470 });
    expect(localParts(new Date("2026-03-02T23:30:00Z"), "Africa/Lagos").date).toBe("2026-03-03");
    expect(zonedToUtc("2026-03-02 07:45:10", "Africa/Lagos")?.toISOString()).toBe("2026-03-02T06:45:10.000Z");
    expect(zonedToUtc("2026-07-01 09:00", "Europe/London")?.toISOString()).toBe("2026-07-01T08:00:00.000Z");
    expect(zonedToUtc("not a time", "Africa/Lagos")).toBeNull();
  });
});

describe("registers and analytics", () => {
  const rows: MarkRow[] = [];
  const days = schoolDays("2026-03-02", "2026-03-27");   // 20 days
  days.forEach((d, i) => {
    rows.push({ student_id: "good", date: d, status: i === 3 ? "late" : "present" });
    rows.push({ student_id: "poor", date: d, status: i % 4 === 0 ? "absent" : i % 5 === 0 ? "excused" : "present" });   // 5 absent + 3 excused of 20
    rows.push({ student_id: "late", date: d, status: i % 3 === 0 ? "late" : "present" });
  });
  rows.push({ student_id: "new", date: "2026-03-27", status: "absent" });
  it("summarises a register", () => {
    expect(summarize([{ status: "present" }, { status: "late" }, { status: "absent" }, { status: "excused" }])).toEqual({ present: 1, late: 1, absent: 1, excused: 1, days: 4, rate: 50 });
    expect(summarize([]).rate).toBeNull();
  });
  it("finds persistent absence, but not from one day's data", () => {
    const c = chronicAbsence(rows);
    expect(c.map(x => x.student_id)).toEqual(["poor"]);
    expect(c[0]).toMatchObject({ rate: 60, absent: 8, severe: true });
    expect(chronicAbsence(rows, { thresholdPct: 50 })).toEqual([]);
  });
  it("finds frequent lateness", () => {
    expect(frequentLateness(rows)).toEqual([{ student_id: "late", late: 7 }]);
  });
  it("shows the trend and the weekday pattern", () => {
    const t = dailyTrend(rows);
    expect(t[0].date).toBe("2026-03-02");
    expect(t).toHaveLength(20);
    expect(weekdayPattern(rows).map(w => w.day)).toEqual([1, 2, 3, 4, 5]);
    expect(trendDirection([{ rate: 90 }, { rate: 90 }, { rate: 80 }, { rate: 80 }])).toBe(-10);
    expect(trendDirection([{ rate: 90 }])).toBeNull();
  });
  it("flags children who were in school but missed a lesson", () => {
    const m = missedLessons(new Set(["a", "b"]), [{ student_id: "a", status: "absent", period_id: "p1" }, { student_id: "c", status: "absent", period_id: "p1" }, { student_id: "b", status: "present", period_id: "p1" }]);
    expect([...m]).toEqual([["a", ["p1"]]]);
  });
});

describe("staff days", () => {
  it("adds up time in, and spots late arrival and people still in", () => {
    const d = staffDay([{ direction: "out", at: "2026-03-02T15:00:00Z" }, { direction: "in", at: "2026-03-02T07:10:00Z" }, { direction: "out", at: "2026-03-02T11:00:00Z" }, { direction: "in", at: "2026-03-02T12:00:00Z" }], "08:00", "Africa/Lagos");
    expect(d).toMatchObject({ first_in: "2026-03-02T07:10:00Z", last_out: "2026-03-02T15:00:00Z", minutes: 410, late: true, open: false });
    expect(staffDay([{ direction: "in", at: "2026-03-02T06:55:00Z" }], "08:00", "Africa/Lagos")).toMatchObject({ late: false, open: true, minutes: 0 });
    expect(staffDay([], "08:00", "Africa/Lagos")).toMatchObject({ first_in: null, late: false });
  });
});

describe("parents' absence requests", () => {
  it("accepts reasonable requests and counts school days", () => {
    expect(requestDays("2026-03-05", "2026-03-10", "2026-03-04")).toEqual({ ok: true, days: ["2026-03-05", "2026-03-06", "2026-03-09", "2026-03-10"] });
    expect(requestDays("2026-03-02", "2026-03-02", "2026-03-04").ok).toBe(true);   // a few days back is fine
  });
  it("refuses the rest", () => {
    expect(requestDays("2026-03-10", "2026-03-05", "2026-03-04")).toMatchObject({ ok: false, reason: expect.stringMatching(/before/) });
    expect(requestDays("2026-02-01", "2026-02-02", "2026-03-04")).toMatchObject({ ok: false, reason: expect.stringMatching(/week ago/) });
    expect(requestDays("2026-03-07", "2026-03-08", "2026-03-04")).toMatchObject({ ok: false, reason: expect.stringMatching(/no school days/) });
    expect(requestDays("2026-03-05", "2026-03-05", "2026-03-04", ["2026-03-05"]).ok).toBe(false);
    expect(requestDays("2026-03-05", "2026-12-05", "2026-03-04").ok).toBe(false);
  });
});

describe("clocking machine logs", () => {
  it("reads ZKTeco attendance lines", () => {
    const p = parseAttlog("1014\t2026-03-02 07:45:10\t0\t1\t0\t0\n2001\t2026-03-02 15:02:00\t1\t15\t0\t0\r\nbad line\n3001\t2026-03-02 08:00\t5\t2\n\t2026-03-02 08:00:00\t0\t1");
    expect(p).toEqual([
      { pin: "1014", local: "2026-03-02 07:45:10", direction: "in", verify: "fingerprint" },
      { pin: "2001", local: "2026-03-02 15:02:00", direction: "out", verify: "face" },
      { pin: "3001", local: "2026-03-02 08:00", direction: "auto", verify: "card" }
    ]);
  });
});
