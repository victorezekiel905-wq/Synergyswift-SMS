import { describe, expect, it } from "vitest";
import { entranceAnalytics, failedSections, normalizePin, ordinal, proposeDecisions, sectionScores, weightedScore, weightsValid, PIN_ALPHABET, type Candidate, type EntrancePlan } from "@/lib/entrance";

const plan = (p: Partial<EntrancePlan> = {}): EntrancePlan => ({
  test_weight: 100, interview_weight: 0, report_weight: 0, pass_mark: 50, section_pass_marks: {},
  borderline_band: 5, interview_for: "none", waitlist_size: 2, ...p
});
let n = 0;
const cand = (test: number | null, c: Partial<Candidate> = {}): Candidate => ({
  id: `c${++n}`, status: "assessment", test, sections: {}, interview: null, report: null, created_at: `2026-10-${String(10 + (n % 15)).padStart(2, "0")}T08:00:00Z`, ...c
});
const byId = (ps: ReturnType<typeof proposeDecisions>) => Object.fromEntries(ps.map(p => [p.id, p]));

describe("weighted score", () => {
  it("is the test score when only the test counts", () => {
    expect(weightedScore(plan(), { test: 64, interview: null, report: null })).toEqual({ score: 64, complete: true });
  });
  it("weights the test, interview and report", () => {
    const p = plan({ test_weight: 60, interview_weight: 20, report_weight: 20 });
    expect(weightedScore(p, { test: 70, interview: 50, report: 80 })).toEqual({ score: 68, complete: true });
  });
  it("scales up the parts that are in while one is missing", () => {
    const p = plan({ test_weight: 60, interview_weight: 40, report_weight: 0 });
    expect(weightedScore(p, { test: 70, interview: null, report: null })).toEqual({ score: 70, complete: false });
  });
  it("has no score until the test is in", () => {
    expect(weightedScore(plan(), { test: null, interview: 90, report: 90 }).score).toBeNull();
  });
  it("checks the weights add up to 100 with the test counting", () => {
    expect(weightsValid({ test_weight: 60, interview_weight: 20, report_weight: 20 })).toBe(true);
    expect(weightsValid({ test_weight: 0, interview_weight: 50, report_weight: 50 })).toBe(false);
    expect(weightsValid({ test_weight: 60, interview_weight: 30, report_weight: 20 })).toBe(false);
  });
});

describe("section pass marks", () => {
  it("lists sections under their own pass mark", () => {
    expect(failedSections({ section_pass_marks: { Mathematics: 40, English: 40 } }, { Mathematics: 35, English: 70 })).toEqual(["Mathematics"]);
  });
  it("ignores sections the candidate was not tested on", () => {
    expect(failedSections({ section_pass_marks: { Science: 40 } }, { Mathematics: 35 })).toEqual([]);
  });
  it("works out percent per section from the marks", () => {
    const qs = [{ id: "a", section: "Maths" }, { id: "b", section: "Maths" }, { id: "c", section: "English" }, { id: "d", section: null }];
    expect(sectionScores(qs, { a: { points: 2, max: 2 }, b: { points: 0, max: 2 }, c: { points: 3, max: 4 }, d: { points: 1, max: 1 } })).toEqual({ Maths: 50, English: 75 });
  });
});

describe("decisions", () => {
  it("offers the best candidates up to the seats left, then the waiting list, then regret", () => {
    const cs = [cand(90), cand(80), cand(70), cand(60), cand(55)];
    const d = byId(proposeDecisions(plan({ waitlist_size: 2 }), cs, 2));
    expect([d.c1!.decision, d.c2!.decision, d.c3!.decision, d.c4!.decision, d.c5!.decision]).toEqual(["offer", "offer", "waitlist", "waitlist", "regret"]);
    expect(d.c3!.waitlist_position).toBe(1);
    expect(d.c4!.waitlist_position).toBe(2);
    expect(d.c1!.rank).toBe(1);
  });
  it("regrets candidates below the pass mark", () => {
    const [p] = proposeDecisions(plan(), [cand(30)], 10);
    expect(p!.decision).toBe("regret");
    expect(p!.reason).toMatch(/pass mark/);
  });
  it("regrets a candidate who fails a section even with a high total", () => {
    const [p] = proposeDecisions(plan({ section_pass_marks: { Mathematics: 40 } }), [cand(80, { sections: { Mathematics: 30, English: 100 } })], 10);
    expect(p!.decision).toBe("regret");
    expect(p!.reason).toMatch(/Mathematics/);
  });
  it("invites borderline candidates to an interview, then decides on the full score", () => {
    const p = plan({ interview_for: "borderline", test_weight: 70, interview_weight: 30 });
    const c = cand(47);
    expect(proposeDecisions(p, [c], 10)[0]!.decision).toBe("interview");
    expect(proposeDecisions(p, [{ ...c, interview: 80 }], 10)[0]!.decision).toBe("offer");
    expect(proposeDecisions(p, [{ ...c, interview: 20 }], 10)[0]!.decision).toBe("regret");
  });
  it("does not interview candidates far below the pass mark", () => {
    expect(proposeDecisions(plan({ interview_for: "borderline" }), [cand(20)], 10)[0]!.decision).toBe("regret");
  });
  it("interviews everyone when asked", () => {
    expect(proposeDecisions(plan({ interview_for: "everyone" }), [cand(20)], 10)[0]!.decision).toBe("interview");
  });
  it("waits for the test before deciding", () => {
    expect(proposeDecisions(plan(), [cand(null)], 10)[0]!.decision).toBeNull();
  });
  it("leaves settled applications alone", () => {
    expect(proposeDecisions(plan(), [cand(90, { status: "offered" }), cand(90, { status: "enrolled" })], 10)).toEqual([]);
  });
  it("gives a freed seat to the best candidate still waiting", () => {
    const cs = [cand(90, { status: "offered" }), cand(85, { status: "waitlisted" }), cand(75, { status: "waitlisted" })];
    const d = byId(proposeDecisions(plan(), cs, 1));
    expect(d[cs[1]!.id]!.decision).toBe("offer");
    expect(d[cs[2]!.id]!.decision).toBe("waitlist");
    expect(d[cs[2]!.id]!.waitlist_position).toBe(1);
  });
  it("puts every passer on the waiting list when it has no limit", () => {
    const d = proposeDecisions(plan({ waitlist_size: 0 }), [cand(90), cand(80), cand(70)], 0);
    expect(d.map(x => x.decision)).toEqual(["waitlist", "waitlist", "waitlist"]);
  });
  it("breaks ties by test score, then by who applied first", () => {
    const p = plan({ test_weight: 50, interview_weight: 0, report_weight: 50 });
    const a = cand(80, { report: 60, created_at: "2026-10-02T00:00:00Z" }); // 70
    const b = cand(60, { report: 80, created_at: "2026-10-01T00:00:00Z" }); // 70
    const d = byId(proposeDecisions(p, [b, a], 1));
    expect(d[a.id]!.decision).toBe("offer");
  });
});

describe("entrance analytics", () => {
  const apps = [
    { status: "enrolled", source: "website", previous_school: "Bright Stars", test: 82, absent: false, proposed: null },
    { status: "rejected", source: "website", previous_school: "bright stars ", test: 38, absent: false, proposed: "regret" as const },
    { status: "assessment", source: "walk_in", previous_school: null, test: null, absent: true, proposed: null }
  ];
  const a = entranceAnalytics(apps, [{ q1: { points: 1, max: 1 }, q2: { points: 0, max: 2 } }, { q1: { points: 1, max: 1 }, q2: { points: 1, max: 2 } }],
    [{ id: "q1", prompt: "Easy one" }, { id: "q2", prompt: "Hard one" }, { id: "q3", prompt: "Unused" }], 50);
  it("counts the funnel", () => {
    expect([a.applicants, a.tested, a.absent, a.passed, a.offered, a.joined]).toEqual([3, 2, 1, 1, 1, 1]);
    expect(a.average).toBe(60);
  });
  it("groups feeder schools however they were typed", () => {
    expect(a.feeder_schools[0]).toEqual({ label: "Bright Stars", applicants: 2, average: 60, offered: 1, joined: 1 });
    expect(a.feeder_schools[1]!.label).toBe("Not given");
  });
  it("finds the hardest questions", () => {
    expect(a.hardest.map(q => [q.id, q.percent])).toEqual([["q2", 25], ["q1", 100]]);
  });
  it("spreads scores in tens", () => {
    expect(a.spread[8]!.count).toBe(1);
    expect(a.spread[3]!.count).toBe(1);
  });
});

describe("PINs and wording", () => {
  it("has no look-alike characters", () => {
    for (const ch of "01ILO") expect(PIN_ALPHABET.includes(ch)).toBe(false);
  });
  it("accepts a PIN typed with a dash, spaces or lower case", () => {
    expect(normalizePin(" ab3k-7mx9 ")).toBe("AB3K7MX9");
  });
  it("writes ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "101st"]);
  });
});
