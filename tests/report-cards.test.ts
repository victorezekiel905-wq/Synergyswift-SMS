import { describe, it, expect, beforeAll } from "vitest";
import { midtermScheme, projectScore, cumulativeResults, DEFAULT_SCHEME, type Scheme } from "@/lib/grading";
import { canonicalCard, signCard, verifyCard } from "@/lib/report-sign";

const scheme: Scheme = {
  pass_mark: 40, decimals: 1, show_position: true,
  bands: DEFAULT_SCHEME.bands,
  components: [
    { id: "ca1", name: "CA 1", max_score: 20, weight: 20, midterm: true },
    { id: "ca2", name: "CA 2", max_score: 20, weight: 20, midterm: true },
    { id: "ex", name: "Exam", max_score: 60, weight: 60 }
  ]
};

describe("mid-term scheme", () => {
  it("keeps only mid-term components and scales weights to 100", () => {
    const m = midtermScheme(scheme)!;
    expect(m.components.map(c => c.id)).toEqual(["ca1", "ca2"]);
    expect(m.components.reduce((a, c) => a + c.weight, 0)).toBeCloseTo(100);
  });
  it("is null when no component is marked", () => {
    expect(midtermScheme({ ...scheme, components: scheme.components.map(c => ({ ...c, midterm: false })) })).toBeNull();
  });
});

describe("projected score", () => {
  it("follows a damped trend and stays within 0–100", () => {
    expect(projectScore([60])).toBe(60);
    expect(projectScore([50, 60, 70])).toBeGreaterThan(70);
    expect(projectScore([50, 60, 70])).toBeLessThan(80);
    expect(projectScore([95, 98, 100])).toBeLessThanOrEqual(100);
    expect(projectScore([10, 5, 0])).toBeGreaterThanOrEqual(0);
    expect(projectScore([])).toBeNull();
  });
});

describe("cumulative results", () => {
  it("averages subject totals across the session and ranks students", () => {
    const terms = [{ id: "t1", label: "First" }, { id: "t2", label: "Second" }, { id: "t3", label: "Third" }];
    const totals = new Map([
      ["ada", new Map([["t1", new Map([["maths", 60], ["eng", 70]])], ["t2", new Map([["maths", 70], ["eng", 80]])], ["t3", new Map([["maths", 80], ["eng", null]])]])],
      ["bola", new Map([["t1", new Map([["maths", 90], ["eng", 90]])], ["t3", new Map([["maths", 90], ["eng", 90]])]])]
    ]) as any;
    const r = cumulativeResults({ terms, totals, studentIds: ["ada", "bola"], decimals: 1 });
    expect(r.get("ada")!.subjects.maths).toEqual({ totals: [60, 70, 80], average: 70 });
    expect(r.get("ada")!.subjects.eng.average).toBe(75);
    expect(r.get("ada")!.average).toBe(72.5);
    expect(r.get("bola")!.subjects.maths.totals).toEqual([90, null, 90]);
    expect(r.get("bola")!.position).toBe(1);
    expect(r.get("ada")!.position).toBe(2);
  });
});

describe("report card signatures", () => {
  beforeAll(() => { process.env.REPORT_SIGNING_KEY = "test-key"; });
  const card = {
    id: "c1", tenant_id: "t", student_id: "s", term_id: "term", kind: "term", total: "640", average: 71.1, position: 3, published_at: "2026-12-18T10:00:00Z",
    data: { subjects: [{ subject_id: "b", total: 70, grade: "B2" }, { subject_id: "a", total: 80.0, grade: "A1" }] }
  };
  it("normalises numbers and subject order", () => {
    const again = { ...card, total: 640, data: { subjects: [...card.data.subjects].reverse() } };
    expect(canonicalCard(card)).toBe(canonicalCard(again));
  });
  it("verifies an untouched card and catches a changed grade", () => {
    const signature = signCard(card);
    expect(verifyCard({ ...card, signature })).toBe("valid");
    const forged = { ...card, signature, data: { subjects: [{ subject_id: "b", total: 70, grade: "A1" }, card.data.subjects[1]] } };
    expect(verifyCard(forged)).toBe("changed");
    expect(verifyCard({ ...card, signature, average: 80 })).toBe("changed");
    expect(verifyCard({ ...card, signature: null })).toBe("unsigned");
  });
});
