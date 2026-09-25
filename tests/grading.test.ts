import { describe, it, expect } from "vitest";
import {
  subjectTotal, gradeFor, rank, ordinal, computeClassResults, validateScheme,
  cumulativeAverage, DEFAULT_SCHEME, type Scheme
} from "@/lib/grading";

const comps = [
  { id: "ca1", name: "CA1", max_score: 20, weight: 20, position: 1 },
  { id: "ca2", name: "CA2", max_score: 20, weight: 20, position: 2 },
  { id: "ex", name: "Exam", max_score: 60, weight: 60, position: 3 }
];
const bands = DEFAULT_SCHEME.bands;
const scheme: Scheme = { pass_mark: 40, decimals: 1, show_position: true, bands, components: comps };

describe("subjectTotal", () => {
  it("sums weighted components", () => {
    expect(subjectTotal({ ca1: 15, ca2: 18, ex: 45 }, comps)).toEqual({ total: 78, complete: true });
  });
  it("scales components whose max differs from weight", () => {
    const c = [{ id: "a", name: "Test", max_score: 50, weight: 30 }, { id: "b", name: "Exam", max_score: 100, weight: 70 }];
    expect(subjectTotal({ a: 25, b: 80 }, c).total).toBe(71);
  });
  it("returns null when nothing is scored and flags partial entry", () => {
    expect(subjectTotal({}, comps)).toEqual({ total: null, complete: false });
    expect(subjectTotal({ ca1: 10 }, comps)).toEqual({ total: 10, complete: false });
  });
  it("clamps out-of-range scores", () => {
    expect(subjectTotal({ ca1: 30, ca2: -5, ex: 60 }, comps).total).toBe(80);
  });
});

describe("gradeFor", () => {
  it("maps totals to the school's bands", () => {
    expect(gradeFor(78, bands)?.grade).toBe("A1");
    expect(gradeFor(75, bands)?.grade).toBe("A1");
    expect(gradeFor(74.99, bands)?.grade).toBe("B2");
    expect(gradeFor(39.9, bands)?.grade).toBe("F9");
    expect(gradeFor(null, bands)).toBeNull();
  });
  it("handles decimals that fall in gaps between integer bands", () => {
    const b = [{ grade: "A", min_score: 70, max_score: 100 }, { grade: "B", min_score: 60, max_score: 69 }];
    expect(gradeFor(69.5, b)?.grade).toBe("B");
  });
});

describe("rank", () => {
  it("uses competition ranking for ties", () => {
    const r = rank([{ id: "a", value: 90 }, { id: "b", value: 80 }, { id: "c", value: 80 }, { id: "d", value: 70 }, { id: "e", value: null }]);
    expect([r.get("a"), r.get("b"), r.get("c"), r.get("d"), r.get("e")]).toEqual([1, 2, 2, 4, undefined]);
  });
  it("formats ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map(ordinal)).toEqual(
      ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "101st", "111th"]);
  });
});

describe("computeClassResults", () => {
  const subjects = [{ id: "m", name: "Maths" }, { id: "e", name: "English" }];
  const scores = [
    { student_id: "s1", subject_id: "m", component_id: "ca1", score: 20 },
    { student_id: "s1", subject_id: "m", component_id: "ca2", score: 20 },
    { student_id: "s1", subject_id: "m", component_id: "ex", score: 50 },
    { student_id: "s1", subject_id: "e", component_id: "ex", score: 30 },
    { student_id: "s2", subject_id: "m", component_id: "ca1", score: 10 },
    { student_id: "s2", subject_id: "m", component_id: "ex", score: 20 },
    { student_id: "s2", subject_id: "e", component_id: "ca1", score: 20 },
    { student_id: "s2", subject_id: "e", component_id: "ca2", score: 20 },
    { student_id: "s2", subject_id: "e", component_id: "ex", score: 60 },
    // s3 takes only English
    { student_id: "s3", subject_id: "e", component_id: "ca1", score: 5 }
  ];
  const res = computeClassResults({ studentIds: ["s1", "s2", "s3"], subjects, scores, scheme });
  const by = Object.fromEntries(res.map(r => [r.student_id, r]));

  it("computes totals, grades and pass/fail per subject", () => {
    const m1 = by.s1.subjects.find(s => s.subject_id === "m")!;
    expect(m1.total).toBe(90);
    expect(m1.grade).toBe("A1");
    const e1 = by.s1.subjects.find(s => s.subject_id === "e")!;
    expect(e1.total).toBe(30);
    expect(e1.passed).toBe(false);
    expect(e1.complete).toBe(false);
  });
  it("averages only subjects actually taken", () => {
    expect(by.s1.average).toBe(60);           // (90 + 30) / 2
    expect(by.s2.average).toBe(65);           // (30 + 100) / 2
    expect(by.s3.average).toBe(5);
    expect(by.s3.subjects_taken).toBe(1);
  });
  it("ranks students by average and subjects by total", () => {
    expect([by.s2.position, by.s1.position, by.s3.position]).toEqual([1, 2, 3]);
    const eng = (id: string) => by[id].subjects.find(s => s.subject_id === "e")!;
    expect([eng("s2").position, eng("s1").position, eng("s3").position]).toEqual([1, 2, 3]);
    expect(by.s3.subjects.find(s => s.subject_id === "m")!.position).toBeNull();
  });
  it("reports class statistics per subject", () => {
    const m = by.s1.subjects.find(s => s.subject_id === "m")!;
    expect(m.class_average).toBe(60); // (90 + 30) / 2
    expect(m.highest).toBe(90);
    expect(m.lowest).toBe(30);
  });
  it("hides positions when the school turns them off", () => {
    const r = computeClassResults({ studentIds: ["s1", "s2"], subjects, scores, scheme: { ...scheme, show_position: false } });
    expect(r.every(x => x.position === null && x.subjects.every(s => s.position === null))).toBe(true);
  });
});

describe("validateScheme", () => {
  it("accepts the default scheme", () => {
    expect(validateScheme({ bands, components: comps })).toEqual([]);
  });
  it("rejects weights that do not add to 100 and overlapping bands", () => {
    const p = validateScheme({
      components: [{ id: "a", name: "A", max_score: 10, weight: 50 }],
      bands: [{ grade: "A", min_score: 50, max_score: 100 }, { grade: "B", min_score: 40, max_score: 60 }]
    });
    expect(p.some(x => x.includes("add up to 100"))).toBe(true);
    expect(p.some(x => x.includes("overlap"))).toBe(true);
  });
});

describe("cumulativeAverage", () => {
  it("ignores missing terms", () => {
    expect(cumulativeAverage([60, null, 70])).toBe(65);
    expect(cumulativeAverage([null])).toBeNull();
  });
});
