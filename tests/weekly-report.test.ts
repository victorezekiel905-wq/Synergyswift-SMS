import { describe, it, expect } from "vitest";
import { weekKey, dueWeek, hasNews, childLines, praise, renderWeekly, weekLabel, type ChildWeek } from "@/lib/weekly-report";

const child = (o: Partial<ChildWeek> = {}): ChildWeek => ({ name: "Ada Okonkwo", className: "JSS2 Blue", points: 0, skills: [], present: 0, late: 0, absent: 0, excused: 0,
  homeworkSet: 0, homeworkDone: 0, storyPosts: 0, ...o });

describe("when the weekly report goes out", () => {
  it("numbers weeks the ISO way, across the new year too", () => {
    expect(weekKey("2026-10-26")).toBe("2026-W44");
    expect(weekKey("2026-10-30")).toBe("2026-W44");
    expect(weekKey("2027-01-01")).toBe("2026-W53");
    expect(weekKey("2025-12-29")).toBe("2026-W01");
  });
  it("is due from Friday 3pm to Saturday noon, school time, and covers Monday to Friday", () => {
    // Friday 30 Oct 2026, 15:10 in Lagos (UTC+1) = 14:10 UTC.
    expect(dueWeek(new Date("2026-10-30T14:10:00Z"), "Africa/Lagos")).toEqual({ key: "2026-W44", from: "2026-10-26", to: "2026-10-30" });
    expect(dueWeek(new Date("2026-10-30T13:50:00Z"), "Africa/Lagos")).toBeNull();          // 14:50 Friday: too early
    expect(dueWeek(new Date("2026-10-31T10:30:00Z"), "Africa/Lagos")?.key).toBe("2026-W44"); // Saturday morning: catch-up
    expect(dueWeek(new Date("2026-10-31T11:30:00Z"), "Africa/Lagos")).toBeNull();          // Saturday 12:30: too late
    expect(dueWeek(new Date("2026-10-28T15:00:00Z"), "Africa/Lagos")).toBeNull();          // Wednesday
    // The school's own time zone decides: Friday 3pm in London is 15:00 UTC in winter.
    expect(dueWeek(new Date("2026-11-06T14:30:00Z"), "Europe/London")).toBeNull();
    expect(dueWeek(new Date("2026-11-06T15:05:00Z"), "Europe/London")?.key).toBe("2026-W45");
  });
});

describe("what the family reads", () => {
  it("says only what happened, in plain words", () => {
    expect(hasNews(child())).toBe(false);
    const c = child({ points: 14, skills: ["Teamwork", "Effort"], present: 4, late: 1, homeworkSet: 4, homeworkDone: 3, storyPosts: 2 });
    expect(childLines(c)).toEqual([
      "14 points this week (Teamwork, Effort)",
      "Attendance: 5 of 5 days in school, 1 late",
      "Homework: 3 of 4 handed in",
      "2 new posts on the class story"
    ]);
    expect(childLines(child({ absent: 1, present: 3, excused: 1 }))).toEqual(["Attendance: 3 of 5 days in school, 1 absent, 1 excused"]);
  });
  it("finds something to praise at home when the week gives one", () => {
    expect(praise(child({ points: 5, skills: ["Teamwork"] }))).toBe("Ada earned points for teamwork.");
    expect(praise(child({ homeworkSet: 3, homeworkDone: 3 }))).toBe("Ada handed in every piece of homework.");
    expect(praise(child({ present: 5 }))).toBe("Ada was in school on time every day.");
    expect(praise(child({ present: 4, absent: 1 }))).toBeNull();
  });
  it("puts each child in one family message, with the parent app link", () => {
    const r = renderWeekly({ schoolName: "Greenfield College" }, { guardianName: "Mrs Okonkwo", weekLabel: weekLabel("2026-10-26", "2026-10-30"),
      children: [child({ points: 3, skills: ["Kindness"] }), child({ name: "Tobi Okonkwo", className: "JSS1 Gold", homeworkSet: 2, homeworkDone: 2 })], link: "https://app.example/parent" });
    expect(r.subject).toBe("Your children's week at school: 26 Oct to 30 Oct");
    expect(r.text).toContain("Ada Okonkwo (JSS2 Blue)");
    expect(r.text).toContain("Tobi Okonkwo (JSS1 Gold)");
    expect(r.text).toContain("To praise at home: Tobi handed in every piece of homework.");
    expect(r.html).toContain("Open the parent app");
    expect(r.wa.text).toContain("https://app.example/parent");
    expect(r.wa.params[1].length).toBeLessThanOrEqual(900);
  });
});
