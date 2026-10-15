import { describe, it, expect } from "vitest";
import { generateTimetable, adjacentPeriods, findClashes, type Placed } from "@/lib/timetable";
import { toIcs, fold, expandTimetable, onDay, subscribeLinks, overlaps, type CalItem } from "@/lib/calendar";

const days = [1, 2, 3, 4, 5];
const periods = ["p1", "p2", "p3", "p4", "p5", "p6"];

describe("timetable generator constraints", () => {
  it("keeps teachers out of periods they cannot teach", () => {
    const unavailable = days.flatMap(d => ["p1", "p2", "p3"].map(p => ({ teacherId: "t1", day: d, periodId: p })));
    const r = generateTimetable({ days, periodIds: periods, requirements: [{ classId: "A", subjectId: "maths", teacherId: "t1", perWeek: 5 }], fixed: [], unavailable, seed: 3, attempts: 10 });
    expect(r.unplaced).toEqual([]);
    expect(r.placed.every(p => ["p4", "p5", "p6"].includes(p.periodId))).toBe(true);
    const impossible = generateTimetable({ days: [1], periodIds: ["p1"], requirements: [{ classId: "A", subjectId: "x", teacherId: "t1", perWeek: 1 }], fixed: [],
      unavailable: [{ teacherId: "t1", day: 1, periodId: "p1" }], seed: 1, attempts: 2 });
    expect(impossible.unplaced[0]).toMatchObject({ perWeek: 1, reason: "no free period for the class and teacher" });
  });
  it("places double periods side by side, never across a break", () => {
    const adjacent = adjacentPeriods([
      { id: "p1", is_break: false, position: 1 }, { id: "p2", is_break: false, position: 2 }, { id: "b", is_break: true, position: 3 },
      { id: "p3", is_break: false, position: 4 }, { id: "p4", is_break: false, position: 5 }
    ]);
    expect(adjacent).toEqual([["p1", "p2"], ["p3", "p4"]]);
    const r = generateTimetable({ days, periodIds: ["p1", "p2", "p3", "p4"], adjacent, requirements: [{ classId: "A", subjectId: "chem", teacherId: "t", perWeek: 5, doubles: 2 }], fixed: [], seed: 9, attempts: 20 });
    expect(r.unplaced).toEqual([]);
    expect(r.placed).toHaveLength(5);
    const byDay = new Map<number, string[]>();
    for (const p of r.placed) byDay.set(p.day, [...(byDay.get(p.day) ?? []), p.periodId].sort());
    const doubleDays = [...byDay.values()].filter(v => v.length === 2);
    expect(doubleDays).toHaveLength(2);
    for (const v of doubleDays) expect(adjacent.some(([a, b]) => a === v[0] && b === v[1])).toBe(true);
  });
  it("puts lab subjects in a lab and never two classes in one room", () => {
    const rooms = [{ id: "lab1", kind: "lab" }, { id: "r1", kind: "classroom" }, { id: "r2", kind: "classroom" }];
    const r = generateTimetable({ days: [1, 2], periodIds: ["p1", "p2", "p3"], rooms, homeRooms: { A: "r1", B: "r2" }, seed: 5, attempts: 20, fixed: [], requirements: [
      { classId: "A", subjectId: "bio", teacherId: "t1", perWeek: 2, roomKind: "lab" }, { classId: "B", subjectId: "bio", teacherId: "t2", perWeek: 2, roomKind: "lab" },
      { classId: "A", subjectId: "eng", teacherId: "t3", perWeek: 3 }, { classId: "B", subjectId: "eng", teacherId: "t4", perWeek: 3 }
    ] });
    expect(r.unplaced).toEqual([]);
    expect(r.placed.filter(p => p.subjectId === "bio").every(p => p.roomId === "lab1")).toBe(true);
    expect(r.placed.filter(p => p.classId === "A" && p.subjectId === "eng").every(p => p.roomId === "r1")).toBe(true);
    expect(findClashes(r.placed)).toEqual([]);
  });
  it("says why a lesson could not be placed", () => {
    const r = generateTimetable({ days: [1], periodIds: ["p1", "p2"], rooms: [], fixed: [], seed: 1, attempts: 2, requirements: [{ classId: "A", subjectId: "ict", teacherId: "t", perWeek: 1, roomKind: "ict" }] });
    expect(r.unplaced[0].reason).toBe("no ict room is set up");
  });
  it("spots rooms used twice at once", () => {
    const e: Placed[] = [{ classId: "A", day: 1, periodId: "p1", subjectId: "x", teacherId: "t1", roomId: "lab" }, { classId: "B", day: 1, periodId: "p1", subjectId: "y", teacherId: "t2", roomId: "lab" }];
    expect(findClashes(e)).toEqual(["Room double-booked on day 1 (p1)"]);
  });
});

describe("calendar", () => {
  it("lays weekly lessons on school days in term, skipping holidays", () => {
    // 2026-03-02 is a Monday.
    const items = expandTimetable([{ id: "e1", day: 1, title: "JSS1 Maths", starts_at: "08:00:00", ends_at: "08:40:00", location: "Room 4" }], "2026-03-01", "2026-03-31", "Africa/Lagos",
      { closed: ["2026-03-16"], terms: [{ starts_on: "2026-01-05", ends_on: "2026-03-27" }] });
    expect(items.map(i => i.start)).toEqual(["2026-03-02T07:00:00.000Z", "2026-03-09T07:00:00.000Z", "2026-03-23T07:00:00.000Z"]);
    expect(items[0]).toMatchObject({ kind: "lesson", end: "2026-03-02T07:40:00.000Z", location: "Room 4" });
  });
  it("finds the items on a day, including multi-day all-day items", () => {
    const items: CalItem[] = [
      { id: "h", kind: "holiday", title: "Mid-term", start: "2026-03-05", end: "2026-03-06", allDay: true },
      { id: "x", kind: "exam", title: "Maths", start: "2026-03-06T08:00:00Z", end: "2026-03-06T10:00:00Z" },
      { id: "y", kind: "event", title: "Late", start: "2026-03-06T23:30:00Z" }
    ];
    expect(onDay(items, "2026-03-06", "Africa/Lagos").map(i => i.id)).toEqual(["h", "x"]);
    expect(onDay(items, "2026-03-07", "Africa/Lagos").map(i => i.id)).toEqual(["y"]);
  });
  it("writes a valid iCalendar feed", () => {
    const ics = toIcs([
      { id: "ev-1", kind: "pta", title: "PTA meeting; all parents, welcome", start: "2026-03-10T15:00:00Z", end: "2026-03-10T17:00:00Z", location: "Hall", description: "Line one\nLine two" },
      { id: "h-1", kind: "holiday", title: "Easter break", start: "2026-04-03", end: "2026-04-06", allDay: true }
    ], { name: "Alpha School", uidDomain: "school.example", now: new Date("2026-03-01T00:00:00Z") });
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(ics).toContain("SUMMARY:PTA meeting\\; all parents\\, welcome");
    expect(ics).toContain("DESCRIPTION:Line one\\nLine two");
    expect(ics).toContain("DTSTART:20260310T150000Z");
    expect(ics).toContain("DTSTART;VALUE=DATE:20260403\r\nDTEND;VALUE=DATE:20260407");
    expect(ics).toContain("UID:ev-1@school.example");
    expect(ics.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
    for (const line of ics.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });
  it("folds long lines without breaking characters", () => {
    const long = "SUMMARY:" + "Ọ̀rọ̀ ".repeat(30);
    const f = fold(long);
    expect(f.split("\r\n ").join("")).toBe(long);
    for (const l of f.split("\r\n")) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75);
  });
  it("builds Google and Outlook subscribe links", () => {
    const l = subscribeLinks("https://app.example/api/calendar/ics/abc", "Alpha calendar");
    expect(l.webcal).toBe("webcal://app.example/api/calendar/ics/abc");
    expect(l.google).toContain(encodeURIComponent("webcal://app.example/api/calendar/ics/abc"));
    expect(l.outlook).toContain("addfromweb?url=https%3A%2F%2Fapp.example");
  });
  it("detects overlapping bookings", () => {
    expect(overlaps({ start: "2026-03-02T09:00:00Z", end: "2026-03-02T10:00:00Z" }, { start: "2026-03-02T09:30:00Z", end: "2026-03-02T11:00:00Z" })).toBe(true);
    expect(overlaps({ start: "2026-03-02T09:00:00Z", end: "2026-03-02T10:00:00Z" }, { start: "2026-03-02T10:00:00Z", end: "2026-03-02T11:00:00Z" })).toBe(false);
  });
});
