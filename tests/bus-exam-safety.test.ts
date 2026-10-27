import { describe, it, expect } from "vitest";
import { busExceptions, settled, type BusEvent, type Presence } from "@/lib/bus-checks";
import { slotTimes, currentSession, hallBoard, coverCandidates, dutyState } from "@/lib/exam-hall";

const TZ = "Africa/Lagos";   // UTC+1
const R = "route-1";
const ev = (student_id: string, kind: "boarded" | "alighted", at: string): BusEvent => ({ student_id, route_id: R, kind, at });
const presence = (p: Partial<Presence> = {}): Presence => ({ inSchool: new Set(), marked: new Set(), gateUsed: false, ...p });

describe("bus checks", () => {
  const morning = [ev("ada", "boarded", "2026-11-02T06:10:00Z"), ev("bola", "boarded", "2026-11-02T06:15:00Z"), ev("chi", "boarded", "2026-11-02T06:20:00Z")];
  it("flags a child who boarded in the morning and is not in school an hour later", () => {
    const now = new Date("2026-11-02T07:30:00Z");
    const out = busExceptions({ events: morning, presence: presence({ inSchool: new Set(["bola"]), gateUsed: true }), tripEnded: new Map(), timeZone: TZ, now });
    expect(out.map(o => [o.student_id, o.kind])).toEqual([["ada", "boarded_not_in_school"], ["chi", "boarded_not_in_school"]]);
  });
  it("waits an hour, and only when the school has evidence for today", () => {
    expect(busExceptions({ events: morning, presence: presence({ gateUsed: true }), tripEnded: new Map(), timeZone: TZ, now: new Date("2026-11-02T06:50:00Z") })).toEqual([]);
    // No gate in use and no register taken yet: we cannot tell, so nothing is raised.
    expect(busExceptions({ events: morning, presence: presence(), tripEnded: new Map(), timeZone: TZ, now: new Date("2026-11-02T09:00:00Z") })).toEqual([]);
    // The register was taken and marked Ada absent.
    expect(busExceptions({ events: morning, presence: presence({ marked: new Set(["ada"]) }), tripEnded: new Map(), timeZone: TZ, now: new Date("2026-11-02T09:00:00Z") }).map(o => o.student_id)).toEqual(["ada"]);
  });
  it("flags a child not scanned off after the afternoon trip ends, or after three hours", () => {
    const pm = [ev("ada", "boarded", "2026-11-02T14:05:00Z"), ev("bola", "boarded", "2026-11-02T14:06:00Z"), ev("bola", "alighted", "2026-11-02T14:40:00Z")];
    const p = presence({ inSchool: new Set(["ada", "bola"]) });
    expect(busExceptions({ events: pm, presence: p, tripEnded: new Map(), timeZone: TZ, now: new Date("2026-11-02T15:00:00Z") })).toEqual([]);
    expect(busExceptions({ events: pm, presence: p, tripEnded: new Map([[R, "2026-11-02T15:10:00Z"]]), timeZone: TZ, now: new Date("2026-11-02T15:15:00Z") }))
      .toEqual([{ student_id: "ada", route_id: R, kind: "not_dropped_off", boarded_at: "2026-11-02T14:05:00Z" }]);
    expect(busExceptions({ events: pm, presence: p, tripEnded: new Map(), timeZone: TZ, now: new Date("2026-11-02T17:10:00Z") }).map(o => o.student_id)).toEqual(["ada"]);
  });
  it("ignores yesterday's events", () => {
    expect(busExceptions({ events: [ev("ada", "boarded", "2026-11-01T14:00:00Z")], presence: presence(), tripEnded: new Map(), timeZone: TZ, now: new Date("2026-11-02T10:00:00Z") })).toEqual([]);
  });
  it("settles when the child turns up or is scanned off", () => {
    expect(settled({ student_id: "ada", kind: "boarded_not_in_school", boarded_at: null }, [], presence({ inSchool: new Set(["ada"]) }))).toMatch(/In school/);
    expect(settled({ student_id: "ada", kind: "boarded_not_in_school", boarded_at: null }, [], presence())).toBeNull();
    const evs = [ev("ada", "alighted", "2026-11-02T15:20:00Z")];
    expect(settled({ student_id: "ada", kind: "not_dropped_off", boarded_at: "2026-11-02T14:05:00Z" }, evs, presence())).toMatch(/Scanned off/);
    expect(settled({ student_id: "ada", kind: "not_dropped_off", boarded_at: "2026-11-02T15:30:00Z" }, evs, presence())).toBeNull();
  });
});

describe("exam hall", () => {
  const sessions = [{ label: "Morning", start: "09:00", minutes: 150 }, { label: "Afternoon", start: "12:30", minutes: 120 }];
  it("knows when a session runs and which one is current", () => {
    const t = slotTimes(sessions, "2026-11-02", 1, TZ)!;
    expect(t.start.toISOString()).toBe("2026-11-02T11:30:00.000Z");
    expect(t.end.toISOString()).toBe("2026-11-02T13:30:00.000Z");
    expect(slotTimes(sessions, "2026-11-02", 5, TZ)).toBeNull();
    expect(currentSession(sessions, "2026-11-02", TZ, new Date("2026-11-02T07:00:00Z"))).toBe(0);
    expect(currentSession(sessions, "2026-11-02", TZ, new Date("2026-11-02T10:50:00Z"))).toBe(1);   // 45 min before the afternoon
  });
  it("builds the board: checked in, started, submitted, missing, invigilators", () => {
    const start = new Date("2026-11-02T08:00:00Z");
    const seat = (student_id: string, hall_id: string, label: string, user_id: string | null = null) => ({ student_id, paper_id: "p1", hall_id, label, name: student_id.toUpperCase(), user_id });
    const board = hallBoard({
      halls: [{ id: "h1", name: "Hall 1" }, { id: "h2", name: "Hall 2" }, { id: "h3", name: "Empty" }],
      papers: [{ id: "p1", title: "Maths", exam_id: "e1" }],
      seats: [seat("a", "h1", "A2", "ua"), seat("b", "h1", "A10", "ub"), seat("c", "h1", "A1"), seat("d", "h2", "B1")],
      checkins: [{ student_id: "a", paper_id: "p1", checked_in_at: "x" }, { student_id: "b", paper_id: "p1", checked_in_at: "x" }],
      attempts: [{ student_user_id: "ua", exam_id: "e1", status: "submitted" }, { student_user_id: "ub", exam_id: "e1", status: "in_progress" }],
      duties: [{ id: "d1", hall_id: "h1", staff_user_id: "t1", name: "T1", chief: true, checked_in_at: "x", cover_for: null }, { id: "d2", hall_id: "h2", staff_user_id: "t2", name: "T2", chief: false, checked_in_at: null, cover_for: null }],
      away: new Set(["t2"]), start, now: new Date("2026-11-02T08:10:00Z")
    });
    expect(board.map(h => h.name)).toEqual(["Hall 1", "Hall 2"]);
    expect(board[0]).toMatchObject({ expected: 3, checked_in: 2, started: 2, submitted: 1, missing_after_start: 1, needs_cover: false });
    expect(board[0]!.missing.map(m => m.seat)).toEqual(["A1"]);
    expect(board[1]).toMatchObject({ expected: 1, checked_in: 0, needs_cover: true });
    expect(board[1]!.duties[0]!.state).toBe("away");
  });
  it("tells when an invigilator is late", () => {
    const d = { id: "d", hall_id: "h", staff_user_id: "t", name: "T", chief: false, checked_in_at: null, cover_for: null };
    const start = new Date("2026-11-02T08:00:00Z");
    expect(dutyState(d, new Set(), start, new Date("2026-11-02T07:30:00Z"))).toBe("expected");
    expect(dutyState(d, new Set(), start, new Date("2026-11-02T07:55:00Z"))).toBe("late");
  });
  it("suggests free staff for cover, those at school first", () => {
    const staff = [{ id: "a", name: "Zainab" }, { id: "b", name: "Bayo" }, { id: "c", name: "Chi" }, { id: "d", name: "Dayo" }];
    expect(coverCandidates(staff, new Set(["a"]), new Set(["d"]), new Set(["c"])).map(s => s.name)).toEqual(["Chi", "Bayo"]);
  });
});
