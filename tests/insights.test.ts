import { describe, it, expect } from "vitest";
import {
  summariseBy, BY, crossTab, mean, median, sd, linearFit, valueAdded, monthOf, monthsBack, byMonth,
  admissionsBySource, collectionByClass, bandOf, type ResultRow, type VaPair
} from "@/lib/insights";
import { ageOn, ageBand, highestQualification, trcnRegistered, censusReturn, censusRows } from "@/lib/census";

const R = (o: Partial<ResultRow>): ResultRow => ({
  student_id: "s1", student: "Ada", gender: "female", class_group_id: "c1", class_name: "JSS1A", level: "JSS1",
  subject_id: "m", subject: "Maths", teacher_id: "t1", teacher: "Mr A", total: 50, passed: null, ...o
});

describe("basic statistics", () => {
  it("mean, median, sd", () => {
    expect(mean([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(sd([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 3);
    expect(sd([1])).toBeNull();
    expect(bandOf(70)).toBe("70–100");
    expect(bandOf(39.9)).toBe("0–39");
  });
});

describe("summariseBy", () => {
  const rows = [
    R({ total: 80 }), R({ student_id: "s2", total: 30, gender: "male" }), R({ student_id: "s3", total: null }),
    R({ subject_id: "e", subject: "English", teacher_id: "t2", teacher: "Ms B", total: 60 }),
    R({ class_group_id: "c2", class_name: "JSS1B", total: 45, teacher_id: null })
  ];
  it("groups scores by subject with pass rate and bands", () => {
    const s = summariseBy(rows, BY.subject);
    expect(s.map(x => x.label)).toEqual(["English", "Maths"]);
    const maths = s.find(x => x.key === "m")!;
    expect(maths).toMatchObject({ n: 3, students: 2, mean: 51.7, median: 45, pass_rate: 66.7 });
    expect(maths.bands).toMatchObject({ "70–100": 1, "40–49": 1, "0–39": 1 });
  });
  it("skips rows with no key and uses the recorded pass flag", () => {
    expect(summariseBy(rows, BY.teacher).reduce((a, g) => a + g.n, 0)).toBe(3);
    expect(summariseBy([R({ total: 45, passed: false })], BY.class)[0].pass_rate).toBe(0);
    expect(summariseBy(rows, BY.gender).map(g => g.key).sort()).toEqual(["female", "male"]);
  });
  it("cross-tabulates", () => {
    const x = crossTab(rows, "subject", "class");
    expect(x.rows.map(r => r.label)).toEqual(["English", "Maths"]);
    expect(x.cols.map(c => c.label)).toEqual(["JSS1A", "JSS1B"]);
    expect(x.cell["m|c1"]).toEqual({ n: 2, mean: 55 });
    expect(x.cell["e|c2"]).toBeUndefined();
  });
});

describe("value added", () => {
  it("fits a line", () => {
    const f = linearFit([1, 2, 3, 4], [3, 5, 7, 9])!;
    expect(f.slope).toBeCloseTo(2); expect(f.intercept).toBeCloseTo(1); expect(f.r2).toBeCloseTo(1);
    expect(linearFit([1, 1, 1], [2, 3, 4])).toBeNull();
    expect(linearFit([1, 2], [1, 2])).toBeNull();
  });
  it("credits teachers whose students beat the prediction, subject by subject", () => {
    const pairs: VaPair[] = [];
    // Maths: everyone would score prior + 0, but teacher A's students gain 8 and B's lose 8.
    for (let i = 0; i < 12; i++) {
      const prior = 40 + i * 3;
      pairs.push({ key: "A", label: "Mr A", student_id: `a${i}`, subject_id: "m", prior, current: prior + 8 + (i % 2 ? 1 : -1) });
      pairs.push({ key: "B", label: "Ms B", student_id: `b${i}`, subject_id: "m", prior, current: prior - 8 + (i % 2 ? 1 : -1) });
    }
    // A hard subject where everyone drops 20 points: teacher C is in line with it.
    for (let i = 0; i < 12; i++) pairs.push({ key: "C", label: "Mr C", student_id: `c${i}`, subject_id: "p", prior: 50 + i, current: 30 + i + (i % 3) - 1 });
    const { groups, fits } = valueAdded(pairs);
    expect(Object.keys(fits).sort()).toEqual(["m", "p"]);
    const by = Object.fromEntries(groups.map(g => [g.key, g]));
    expect(by.A.signal).toBe("above");
    expect(by.B.signal).toBe("below");
    expect(by.C.signal).toBe("in_line");
    expect(by.A.va).toBeCloseTo(8, 0);
    expect(groups[0].key).toBe("A");
  });
  it("does not judge small groups", () => {
    const pairs: VaPair[] = [1, 2, 3, 4].map(i => ({ key: "X", label: "X", student_id: `${i}`, subject_id: "m", prior: i * 10, current: i * 10 + (i % 2) }));
    expect(valueAdded(pairs).groups[0].signal).toBe("too_few");
  });
});

describe("months", () => {
  it("names months in the school's time zone", () => {
    expect(monthOf("2026-10-31T23:30:00Z", "Africa/Lagos")).toBe("2026-11");
    expect(monthOf("2026-10-31")).toBe("2026-10");
    expect(monthsBack("2026-02", 4)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });
  it("totals per month with zeros", () => {
    const rows = [{ at: "2026-01-05", v: 10 }, { at: "2026-01-20", v: 5 }, { at: "2025-06-01", v: 99 }, { at: null as string | null, v: 1 }];
    expect(byMonth(rows, r => r.at, r => r.v, ["2025-12", "2026-01"])).toEqual([{ month: "2025-12", value: 0 }, { month: "2026-01", value: 15 }]);
  });
});

describe("admissions and collection", () => {
  it("converts by source", () => {
    const s = admissionsBySource([
      { source: "online", status: "enrolled" }, { source: "online", status: "rejected" }, { source: "online", status: "new" },
      { source: "referral", status: "enrolled" }, { source: null, status: "new" }
    ]);
    expect(s[0]).toEqual({ source: "online", applications: 3, enrolled: 1, lost: 1, open: 1, conversion: 50 });
    expect(s.find(x => x.source === "unknown")!.conversion).toBeNull();
  });
  it("collection by class, worst first", () => {
    const c = collectionByClass([
      { class_name: "JSS1", total: 100, amount_paid: 100, status: "paid" },
      { class_name: "JSS2", total: 100, amount_paid: 25, status: "part_paid" },
      { class_name: "JSS2", total: 50, amount_paid: 0, status: "void" }
    ]);
    expect(c[0]).toEqual({ class_name: "JSS2", billed: 100, paid: 25, outstanding: 75, rate: 25 });
  });
});

describe("school census", () => {
  it("ages and bands", () => {
    expect(ageOn("2014-10-17", "2026-10-16")).toBe(11);
    expect(ageOn("2014-10-16", "2026-10-16")).toBe(12);
    expect(ageOn(null, "2026-10-16")).toBeNull();
    expect(ageBand(4)).toBe("under 6"); expect(ageBand(12)).toBe("12"); expect(ageBand(20)).toBe("over 18"); expect(ageBand(null)).toBe("not recorded");
  });
  it("finds the highest qualification and TRCN registration", () => {
    expect(highestQualification([{ kind: "degree", title: "B.Ed Mathematics", reference_no: null }, { kind: "certificate", title: "NCE", reference_no: null }])).toBe("B.Ed / degree in education");
    expect(highestQualification([{ kind: "degree", title: "M.Sc Physics", reference_no: null }])).toBe("Master's");
    expect(highestQualification([{ kind: "certificate", title: "NCE Biology/Chemistry", reference_no: null }])).toBe("NCE");
    expect(highestQualification([])).toBe("Not recorded");
    expect(trcnRegistered([{ kind: "professional", title: "TRCN registration", reference_no: "TRCN/123" }])).toBe(true);
    expect(trcnRegistered([{ kind: "professional", title: "TRCN registration", reference_no: null }])).toBe(false);
  });
  it("builds the return", () => {
    const r = censusReturn({
      period: "2026/2027", asOf: "2026-10-16", yearStarts: "2026-09-01", profile: { school_code: "LA/1", lga: "Ikeja" },
      students: [
        { id: "a", gender: "female", date_of_birth: "2015-01-01", level: "JSS1", admitted_on: "2026-09-08" },
        { id: "b", gender: "male", date_of_birth: "2014-03-01", level: "JSS1", admitted_on: "2025-09-08" },
        { id: "c", gender: null, date_of_birth: null, level: "JSS2", admitted_on: null }
      ],
      repeaters: new Set(["b"]),
      sen: [{ student_id: "a", needs: ["dyslexia"] }, { student_id: "zzz", needs: ["adhd"] }],
      staff: [
        { id: "t1", gender: "female", teaching: true, qualifications: [{ kind: "degree", title: "B.Ed English", reference_no: null }, { kind: "professional", title: "TRCN", reference_no: "TRCN/9" }] },
        { id: "t2", gender: "male", teaching: true, qualifications: [] },
        { id: "n1", gender: "male", teaching: false, qualifications: [] }
      ],
      classrooms: 2
    });
    expect(r.enrolment.total).toEqual({ male: 1, female: 1, other: 1, total: 3 });
    expect(r.enrolment.by_level.JSS1.total).toBe(2);
    expect(r.new_entrants.JSS1).toMatchObject({ female: 1, total: 1 });
    expect(r.repeaters.JSS1).toMatchObject({ male: 1, total: 1 });
    expect(r.ages.JSS1["11"].female).toBe(1);
    expect(r.ages.JSS2["not recorded"].total).toBe(1);
    expect(Object.keys(r.special_needs)).toEqual(["dyslexia"]);
    expect(r.staff.teaching.total).toBe(2);
    expect(r.staff.teachers_trcn_registered).toBe(1);
    expect(r.ratios).toEqual({ pupils_per_teacher: 1.5, pupils_per_classroom: 1.5 });
    const rows = censusRows(r);
    expect(rows[0]).toHaveLength(6);
    expect(rows).toContainEqual(["Enrolment", "All classes", 1, 1, 1, 3]);
    expect(rows).toContainEqual(["School", "school code", "", "", "", "LA/1"]);
  });
});
