import { describe, it, expect } from "vitest";
import { zonedInstant, localDate, isoWeekday, shiftsOn, dayRecord, clockFlags, summarise, attendanceDeductions, datesBetween, type Shift, type Assignment } from "@/lib/staff-time";

const TZ = "Africa/Lagos";   // UTC+1, no daylight saving
const day: Shift = { id: "s1", name: "School day", starts_at: "07:30", ends_at: "16:00", days: [1, 2, 3, 4, 5], grace_minutes: 10, early_leave_minutes: 15, campus: "Main" };
const night: Shift = { id: "s2", name: "Night security", starts_at: "19:00", ends_at: "07:00", days: [1, 2, 3, 4, 5, 6, 7], grace_minutes: 5, early_leave_minutes: 10, campus: null };
const at = (iso: string) => new Date(iso).toISOString();
const LATER = new Date("2026-11-30T12:00:00Z");

describe("time zones", () => {
  it("finds the instant of a Lagos wall-clock time", () => {
    expect(zonedInstant("2026-11-02", "07:30", TZ).toISOString()).toBe("2026-11-02T06:30:00.000Z");
    expect(zonedInstant("2026-11-02", "07:00", TZ, 1).toISOString()).toBe("2026-11-03T06:00:00.000Z");
  });
  it("handles a zone with daylight saving", () => {
    expect(zonedInstant("2026-07-01", "09:00", "Europe/London").toISOString()).toBe("2026-07-01T08:00:00.000Z");
    expect(zonedInstant("2026-12-01", "09:00", "Europe/London").toISOString()).toBe("2026-12-01T09:00:00.000Z");
  });
  it("gives local dates and weekdays", () => {
    expect(localDate(new Date("2026-11-02T23:30:00Z"), TZ)).toBe("2026-11-03");
    expect(isoWeekday("2026-11-02")).toBe(1);
    expect(isoWeekday("2026-11-08")).toBe(7);
    expect(datesBetween("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
  });
});

describe("shifts", () => {
  const shifts = new Map([[day.id, day], [night.id, night]]);
  const asg: Assignment[] = [{ staff_id: "a", shift_id: "s1", starts_on: "2026-11-01", ends_on: null }, { staff_id: "a", shift_id: "s2", starts_on: "2026-11-01", ends_on: "2026-11-04" }];
  it("lists the shifts worked on a date, by weekday and period", () => {
    expect(shiftsOn("a", "2026-11-02", asg, shifts).map(s => s.name)).toEqual(["School day", "Night security"]);
    expect(shiftsOn("a", "2026-11-07", asg, shifts)).toEqual([]);           // Saturday, night shift period over
    expect(shiftsOn("a", "2026-10-30", asg, shifts)).toEqual([]);           // before the assignment
    expect(shiftsOn("b", "2026-11-02", asg, shifts)).toEqual([]);
  });
  it("flags late sign-ins and early sign-outs at the gate", () => {
    expect(clockFlags(day, "2026-11-02", TZ, new Date("2026-11-02T06:39:00Z"), "in").late).toBe(false);   // 07:39, inside grace
    expect(clockFlags(day, "2026-11-02", TZ, new Date("2026-11-02T06:41:00Z"), "in").late).toBe(true);    // 07:41
    expect(clockFlags(day, "2026-11-02", TZ, new Date("2026-11-02T14:30:00Z"), "out").early).toBe(true);  // 15:30
    expect(clockFlags(day, "2026-11-02", TZ, new Date("2026-11-02T14:50:00Z"), "out").early).toBe(false); // 15:50
  });
});

describe("a day on a shift", () => {
  const base = { shift: day, date: "2026-11-02", timeZone: TZ, requests: [], onLeave: false, holiday: false, now: LATER };
  it("is on time, late, early, absent", () => {
    expect(dayRecord({ ...base, events: [{ direction: "in", at: at("2026-11-02T06:35:00Z") }, { direction: "out", at: at("2026-11-02T15:05:00Z") }] }).status).toBe("present");
    const late = dayRecord({ ...base, events: [{ direction: "in", at: at("2026-11-02T07:02:00Z") }] });
    expect(late.status).toBe("late");
    expect(late.late_minutes).toBe(32);
    const early = dayRecord({ ...base, events: [{ direction: "in", at: at("2026-11-02T06:20:00Z") }, { direction: "out", at: at("2026-11-02T13:00:00Z") }] });
    expect(early.early_minutes).toBe(120);
    expect(dayRecord({ ...base, events: [] }).status).toBe("absent");
  });
  it("knows today's shift has not started or the person is not in yet", () => {
    expect(dayRecord({ ...base, events: [], now: new Date("2026-11-02T06:00:00Z") }).status).toBe("upcoming");
    expect(dayRecord({ ...base, events: [], now: new Date("2026-11-02T09:00:00Z") }).status).toBe("not_in_yet");
  });
  it("excuses approved requests, leave and holidays", () => {
    const r = dayRecord({ ...base, events: [{ direction: "in", at: at("2026-11-02T08:00:00Z") }], requests: [{ kind: "late_arrival", on_date: "2026-11-02", status: "approved" }] });
    expect(r.late_excused).toBe(true);
    expect(dayRecord({ ...base, events: [{ direction: "in", at: at("2026-11-02T08:00:00Z") }], requests: [{ kind: "late_arrival", on_date: "2026-11-02", status: "pending" }] }).late_excused).toBe(false);
    expect(dayRecord({ ...base, events: [], onLeave: true }).status).toBe("leave");
    expect(dayRecord({ ...base, events: [], holiday: true }).status).toBe("holiday");
  });
  it("follows an overnight shift past midnight", () => {
    const r = dayRecord({ ...base, shift: night, events: [{ direction: "in", at: at("2026-11-02T18:02:00Z") }, { direction: "out", at: at("2026-11-03T05:30:00Z") }] });
    expect(r.status).toBe("present");          // 19:02 within 5 min grace
    expect(r.early_minutes).toBe(30);          // left 06:30, shift ends 07:00
  });
  it("ignores sign-ins far from the shift", () => {
    expect(dayRecord({ ...base, events: [{ direction: "in", at: at("2026-11-01T06:30:00Z") }] }).status).toBe("absent");
  });
});

describe("the month and payroll", () => {
  const rec = (date: string, status: any, late = 0, early = 0, excused = false) => ({ date, shift: "x", campus: null, status, in: null, out: null, late_minutes: late, early_minutes: early, late_excused: excused, early_excused: false });
  const month = [rec("2026-11-02", "late", 20), rec("2026-11-03", "late", 5), rec("2026-11-04", "late", 40, 0, true), rec("2026-11-05", "present", 0, 30),
    rec("2026-11-06", "late", 15), rec("2026-11-09", "absent"), rec("2026-11-10", "leave"), rec("2026-11-11", "holiday"), rec("2026-11-12", "late", 12), rec("2026-11-13", "upcoming")];
  it("counts the month", () => {
    const s = summarise(month);
    expect(s).toMatchObject({ scheduled: 8, present: 6, late: 4, late_excused: 1, late_minutes: 52, early: 1, absent: 1, leave: 1, holiday: 1 });
    expect(s.chargeable).toEqual([20, 5, 30, 15, 12]);
    expect(summarise(month, { early_counts_as_late: false }).chargeable).toEqual([20, 5, 15, 12]);
  });
  it("charges only after the free lates, and only when the school turns it on", () => {
    const s = summarise(month);
    expect(attendanceDeductions(s, { late_deduction_mode: "off", late_deduction_amount: 500, late_free_per_month: 3, early_counts_as_late: true, absence_deduction: false })).toEqual({ lines: [], absentDays: 0 });
    expect(attendanceDeductions(s, { late_deduction_mode: "per_late", late_deduction_amount: 500, late_free_per_month: 3, early_counts_as_late: true, absence_deduction: true }))
      .toEqual({ lines: [{ name: "Lateness (2 after 3 free)", amount: 1000 }], absentDays: 1 });
    expect(attendanceDeductions(s, { late_deduction_mode: "per_minute", late_deduction_amount: 20, late_free_per_month: 3, early_counts_as_late: true, absence_deduction: false }).lines)
      .toEqual([{ name: "Lateness (27 min after 3 free)", amount: 540 }]);
  });
});
