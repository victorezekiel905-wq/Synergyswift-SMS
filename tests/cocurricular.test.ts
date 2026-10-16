import { describe, it, expect } from "vitest";
import { joinCheck, attendanceRate, achievementFor, ordinal, rosterFromResponses, tripLate, rosterSummary } from "@/lib/cocurricular";

describe("clubs", () => {
  const g = { active: true, joining: "approval", capacity: 20, open_to_class_ids: ["jss1"] };
  it("decides who can join", () => {
    expect(joinCheck(g, { classId: "jss1", activeMembers: 5, status: null })).toEqual({ ok: true, status: "requested" });
    expect(joinCheck({ ...g, joining: "open" }, { classId: "jss1", activeMembers: 5, status: null })).toEqual({ ok: true, status: "active" });
    expect(joinCheck(g, { classId: "ss2", activeMembers: 5, status: null }).ok).toBe(false);
    expect(joinCheck(g, { classId: "jss1", activeMembers: 20, status: null })).toMatchObject({ reason: "this group is full" });
    expect(joinCheck(g, { classId: "jss1", activeMembers: 1, status: "requested" })).toMatchObject({ reason: "you have already asked to join" });
    expect(joinCheck({ ...g, joining: "closed" }, { classId: "jss1", activeMembers: 1, status: null }).ok).toBe(false);
    expect(joinCheck({ ...g, open_to_class_ids: [] }, { classId: null, activeMembers: 1, status: "left" }).ok).toBe(true);
  });
  it("works out attendance", () => {
    expect(attendanceRate([{ status: "present" }, { status: "late" }, { status: "absent" }, { status: "excused" }])).toBe(67);
    expect(attendanceRate([{ status: "excused" }])).toBeNull();
  });
});

describe("competitions", () => {
  it("turns podium places and awards into achievements", () => {
    expect(achievementFor({ position: 1, award: null })).toBe("1st place");
    expect(achievementFor({ position: 3, award: null })).toBe("3rd place");
    expect(achievementFor({ position: 4, award: null })).toBeNull();
    expect(achievementFor({ position: 7, award: "Best speaker" })).toBe("Best speaker");
    expect([ordinal(2), ordinal(11), ordinal(22), ordinal(113)]).toEqual(["2nd", "11th", "22nd", "113th"]);
  });
});

describe("trips", () => {
  it("builds the roster from consents and payments", () => {
    expect(rosterFromResponses([{ student_id: "a", consent: true, invoice_status: "paid" }, { student_id: "b", consent: true, invoice_status: "issued" }, { student_id: "c", consent: false, invoice_status: null }], 5000))
      .toEqual([{ student_id: "a", paid: true, part_paid: false }, { student_id: "b", paid: false, part_paid: false }]);
    expect(rosterFromResponses([{ student_id: "a", consent: true, invoice_status: null }], 0)[0].paid).toBe(true);
  });
  it("raises the alarm when children are not back", () => {
    const now = new Date("2026-10-16T18:00:00Z");
    const roster = [{ status: "returned" }, { status: "departed" }, { status: "departed" }];
    expect(tripLate({ returns_at: "2026-10-16T17:00:00Z", late_alerted_at: null }, roster, now)).toBe(2);
    expect(tripLate({ returns_at: "2026-10-16T17:45:00Z", late_alerted_at: null }, roster, now)).toBe(0);
    expect(tripLate({ returns_at: "2026-10-16T17:00:00Z", late_alerted_at: "x" }, roster, now)).toBe(0);
    expect(rosterSummary([...roster, { status: "absent" }])).toEqual({ total: 4, going: 0, departed: 2, returned: 1, absent: 1 });
  });
});
