import { describe, it, expect } from "vitest";
import { buildSlots, scheduleExams, allocateSeats, sameNeighbours, assignInvigilators, seatLabel, type PaperIn, type Candidate } from "@/lib/exams/schedule";

describe("exam slots", () => {
  it("skips weekends and listed holidays", () => {
    // 2026-10-12 is a Monday.
    const s = buildSlots("2026-10-12", "2026-10-18", [{ minutes: 120 }, { minutes: 90 }], { skipDates: ["2026-10-14"] });
    expect(new Set(s.map(x => x.date))).toEqual(new Set(["2026-10-12", "2026-10-13", "2026-10-15", "2026-10-16"]));
    expect(s).toHaveLength(8);
  });
});

describe("exam timetable", () => {
  const slots = buildSlots("2026-10-12", "2026-10-23", [{ minutes: 150 }, { minutes: 120 }]);
  const subjects = ["Maths", "English", "Biology", "Chemistry", "Physics", "Economics", "Civic", "Igbo"];
  const papers: PaperIn[] = [];
  for (const cls of ["SS1", "SS2", "SS3"]) for (const s of subjects) papers.push({ id: `${cls}-${s}`, classGroupIds: [cls], duration: s === "Maths" ? 150 : 120 });
  papers.push({ id: "ALL-Assembly", classGroupIds: ["SS1", "SS2", "SS3"], duration: 60 });
  const { assignments, unscheduled } = scheduleExams(papers, slots, { maxPerDay: 2 });
  const slotOf = new Map(slots.map(s => [s.key, s]));

  it("schedules every paper", () => {
    expect(unscheduled).toEqual([]);
    expect(assignments.size).toBe(papers.length);
  });
  it("never puts a class in two papers at once", () => {
    const seen = new Set<string>();
    for (const p of papers) for (const c of p.classGroupIds) {
      const k = `${c}@${assignments.get(p.id)}`;
      expect(seen.has(k)).toBe(false);
      seen.add(k);
    }
  });
  it("respects the daily cap and session length", () => {
    const perDay = new Map<string, number>();
    for (const p of papers) {
      const s = slotOf.get(assignments.get(p.id)!)!;
      expect(s.minutes).toBeGreaterThanOrEqual(p.duration);
      for (const c of p.classGroupIds) perDay.set(`${c}|${s.date}`, (perDay.get(`${c}|${s.date}`) ?? 0) + 1);
    }
    expect(Math.max(...perDay.values())).toBeLessThanOrEqual(2);
  });
  it("spreads a class's papers over the fortnight", () => {
    const days = new Set(papers.filter(p => p.classGroupIds.includes("SS1")).map(p => slotOf.get(assignments.get(p.id)!)!.date));
    expect(days.size).toBeGreaterThanOrEqual(5);
  });
  it("keeps fixed slots and reports what cannot fit", () => {
    const r = scheduleExams([{ id: "a", classGroupIds: ["X"], duration: 60, fixedSlot: slots[3].key }, { id: "b", classGroupIds: ["X"], duration: 999 }], slots);
    expect(r.assignments.get("a")).toBe(slots[3].key);
    expect(r.unscheduled).toEqual(["b"]);
  });
});

describe("seating", () => {
  const cands: Candidate[] = [];
  for (let i = 0; i < 20; i++) cands.push({ studentId: `a${i}`, paperId: "maths-ss1", classGroupId: "SS1", name: `A ${String(i).padStart(2, "0")}` });
  for (let i = 0; i < 20; i++) cands.push({ studentId: `b${i}`, paperId: "bio-ss2", classGroupId: "SS2", name: `B ${String(i).padStart(2, "0")}` });
  it("seats everyone and mixes papers so neighbours differ", () => {
    const { seats, unseated } = allocateSeats(cands, [{ id: "h1", name: "Hall", capacity: 40, rows: 5, cols: 8 }]);
    expect(unseated).toEqual([]);
    expect(new Set(seats.map(s => `${s.row}-${s.col}`)).size).toBe(40);
    expect(sameNeighbours(seats)).toBe(0);
  });
  it("leaves alternate seats empty when there is room", () => {
    const { seats, spaced } = allocateSeats(cands.slice(0, 20), [{ id: "h1", name: "Hall", capacity: 40, rows: 5, cols: 8 }], { spacing: "alternate" });
    expect(spaced).toBe(true);
    expect(seats.every(s => (s.row + s.col) % 2 === 0)).toBe(true);
    expect(sameNeighbours(seats)).toBe(0);
  });
  it("reports students who do not fit", () => {
    const { unseated } = allocateSeats(cands, [{ id: "h1", name: "Small", capacity: 30, rows: 5, cols: 6 }]);
    expect(unseated).toHaveLength(10);
  });
  it("labels seats by row letter and number", () => {
    expect(seatLabel(0, 0)).toBe("A1");
    expect(seatLabel(2, 9)).toBe("C10");
  });
});

describe("invigilation roster", () => {
  const sessions = [
    { slotKey: "d1#0", hallId: "h1", candidates: 75, subjectIds: ["maths"] },
    { slotKey: "d1#0", hallId: "h2", candidates: 20, subjectIds: ["bio"] },
    { slotKey: "d1#1", hallId: "h1", candidates: 40, subjectIds: ["eng"] }
  ];
  const staff = [{ id: "t-maths", subjectIds: ["maths"] }, { id: "t-bio", subjectIds: ["bio"] }, { id: "t-eng", subjectIds: ["eng"] }, { id: "t-art", subjectIds: ["art"] }, { id: "t-busy", busySlots: ["d1#0", "d1#1"] }];
  const { duties, short, load } = assignInvigilators(sessions, staff, { ratio: 30 });
  it("staffs every hall by the ratio", () => {
    expect(duties.filter(d => d.slotKey === "d1#0" && d.hallId === "h1")).toHaveLength(3);
    expect(duties.filter(d => d.slotKey === "d1#0" && d.hallId === "h2")).toHaveLength(1);
    expect(short).toEqual([]);
  });
  it("never double-books and respects unavailability", () => {
    const seen = new Set<string>();
    for (const d of duties) { const k = `${d.staffId}@${d.slotKey}`; expect(seen.has(k)).toBe(false); seen.add(k); }
    expect(duties.some(d => d.staffId === "t-busy")).toBe(false);
  });
  it("keeps subject teachers out of their own paper when possible", () => {
    expect(duties.find(d => d.slotKey === "d1#1")!.staffId).not.toBe("t-eng");
    expect(duties.filter(d => d.chief)).toHaveLength(3);
    expect(Math.max(...[...load.values()])).toBeLessThanOrEqual(2);
  });
  it("reports shortages", () => {
    expect(assignInvigilators([{ slotKey: "x", hallId: "h", candidates: 90, subjectIds: [] }], [{ id: "only" }]).short).toEqual([{ slotKey: "x", hallId: "h", missing: 2 }]);
  });
});
