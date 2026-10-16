import { describe, it, expect } from "vitest";
import { escalateAfterHours, escalationDue, needsFollowUp, moodSummary, moodTrend, medicationRound, immunisationsDue, type Plan } from "@/lib/welfare";

describe("safeguarding escalation", () => {
  it("escalates critical concerns within the hour and high ones in half the time", () => {
    expect(escalateAfterHours("critical", 4)).toBe(1);
    expect(escalateAfterHours("high", 4)).toBe(2);
    expect(escalateAfterHours("high", 1)).toBe(1);
    expect(escalateAfterHours("medium", 4)).toBe(4);
  });
  it("only escalates new concerns once", () => {
    const now = new Date("2026-10-16T12:00:00Z");
    const c = { status: "new", severity: "critical" as const, created_at: "2026-10-16T10:30:00Z", escalated_at: null };
    expect(escalationDue(c, 4, now)).toBe(true);
    expect(escalationDue({ ...c, escalated_at: "2026-10-16T11:30:00Z" }, 4, now)).toBe(false);
    expect(escalationDue({ ...c, status: "acknowledged" }, 4, now)).toBe(false);
    expect(escalationDue({ ...c, severity: "medium" }, 4, now)).toBe(false);
  });
});

describe("wellbeing", () => {
  const sid = "s1";
  it("flags check-ins that need a person", () => {
    expect(needsFollowUp({ mood: 4, feelings: [], wants_to_talk: true, student_id: sid })).toBe("asked to talk");
    expect(needsFollowUp({ mood: 3, feelings: ["unsafe"], wants_to_talk: false, student_id: sid })).toBe("feels unsafe or scared");
    expect(needsFollowUp({ mood: 1, feelings: [], wants_to_talk: false, student_id: sid })).toBe("very low mood");
    expect(needsFollowUp({ mood: 2, feelings: ["lonely"], wants_to_talk: false, student_id: sid })).toBe("low mood");
    expect(needsFollowUp({ mood: 2, feelings: ["tired"], wants_to_talk: false, student_id: sid })).toBeNull();
    expect(needsFollowUp({ mood: 1, feelings: ["unsafe"], wants_to_talk: false, student_id: null })).toBeNull();
  });
  it("summarises a class", () => {
    const s = moodSummary([
      { mood: 5, feelings: ["happy"], wants_to_talk: false, student_id: "a" }, { mood: 4, feelings: ["happy", "tired"], wants_to_talk: false, student_id: "b" },
      { mood: 1, feelings: ["sad"], wants_to_talk: false, student_id: "c" }, { mood: 2, feelings: ["lonely"], wants_to_talk: true, student_id: "d", followed_up_at: "x" }
    ]);
    expect(s).toMatchObject({ count: 4, average: 3, spread: [1, 1, 0, 1, 1], to_follow_up: 1 });
    expect(s.feelings[0]).toEqual({ feeling: "happy", count: 2 });
    expect(moodSummary([]).average).toBeNull();
  });
  it("draws a daily trend", () => {
    expect(moodTrend([{ mood: 4, created_at: "2026-10-15T08:00:00Z" }, { mood: 2, created_at: "2026-10-15T09:00:00Z" }], ["2026-10-14", "2026-10-15"]))
      .toEqual([{ date: "2026-10-14", average: null, count: 0 }, { date: "2026-10-15", average: 3, count: 2 }]);
  });
});

describe("medication and immunisations", () => {
  const plan: Plan = { id: "p1", student_id: "s1", medicine: "Inhaler", dose: "2 puffs", times: ["13:00", "08:00"], as_needed: false, starts_on: "2026-10-01", ends_on: null, active: true };
  it("works out today's round", () => {
    const round = medicationRound([plan, { ...plan, id: "p2", as_needed: true }, { ...plan, id: "p3", ends_on: "2026-10-10" }],
      [{ plan_id: "p1", given_at: "x", status: "given", local_minutes: 8 * 60 + 10 }], "2026-10-16", 12 * 60 + 45);
    expect(round.map(r => [r.plan.id, r.time, r.state])).toEqual([["p1", "08:00", "given"], ["p1", "13:00", "due"]]);
    expect(medicationRound([plan], [], "2026-10-16", 9 * 60)[0].state).toBe("overdue");
    expect(medicationRound([plan], [], "2026-10-16", 6 * 60)[0].state).toBe("later");
  });
  it("lists immunisations falling due, using the latest dose", () => {
    const due = immunisationsDue([
      { student_id: "s1", vaccine: "HPV", given_on: "2026-01-10", next_due_on: "2026-07-10" },
      { student_id: "s1", vaccine: "hpv", given_on: "2026-07-12", next_due_on: null },
      { student_id: "s2", vaccine: "Td", given_on: "2025-10-01", next_due_on: "2026-10-01" },
      { student_id: "s3", vaccine: "Typhoid", given_on: "2024-11-01", next_due_on: "2026-11-01" },
      { student_id: "s4", vaccine: "Typhoid", given_on: "2024-12-01", next_due_on: "2027-01-01" }
    ], "2026-10-16");
    expect(due.map(d => [d.student_id, d.overdue])).toEqual([["s2", true], ["s3", false]]);
  });
});
