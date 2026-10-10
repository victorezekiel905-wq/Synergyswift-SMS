import { describe, it, expect } from "vitest";
import { equivalent, parseExpression, evaluate, isValidExpression } from "@/lib/exams/math";
import {
  markQuestion, markAttempt, toPublicQuestion, buildAttemptLayout, validateQuestion, drawQuestions,
  questionsForAttempt, describeAnswer, type Question
} from "@/lib/exams/engine";
import { EXAM_FORMATS, formatById } from "@/lib/exams/formats";

const q = (id: string, type: Question["type"], data: any, answer: any, points = 2, section: string | null = null): Question =>
  ({ id, type, prompt: "Q", points, data, answer, section });

describe("maths input", () => {
  it("accepts equivalent forms", () => {
    expect(equivalent("2(x+1)", "2x+2")).toBe(true);
    expect(equivalent("(x-2)(x+2)", "x^2-4")).toBe(true);
    expect(equivalent("x^2 - 4", "x²-4".replace("²", "^2"))).toBe(true);
    expect(equivalent("sqrt(2)/2", "1/sqrt(2)")).toBe(true);
    expect(equivalent("3×4÷2", "6")).toBe(true);
    expect(equivalent("2xy", "2*x*y")).toBe(true);
    expect(equivalent("sin(x)^2 + cos(x)^2", "1")).toBe(true);
    expect(equivalent("pi r^2", "π*r^2")).toBe(true);
  });
  it("rejects different answers and junk", () => {
    expect(equivalent("2x+1", "2x+2")).toBe(false);
    expect(equivalent("x^2+4", "x^2-4")).toBe(false);
    expect(equivalent("", "1")).toBe(false);
    expect(equivalent("2x+", "2x")).toBe(false);
    expect(equivalent("alert(1)", "1")).toBe(false);
    expect(equivalent("x", "y")).toBe(false);
  });
  it("respects precedence and unary minus", () => {
    expect(evaluate(parseExpression("-x^2"), { x: 3 })).toBe(-9);
    expect(evaluate(parseExpression("2^3^2"), {})).toBe(512);
    expect(evaluate(parseExpression("6/2(1+2)"), {})).toBe(9);
    expect(isValidExpression("(1+2")).toBe(false);
  });
  it("skips points where the key is undefined", () => {
    expect(equivalent("(x^2-1)/(x-1)", "x+1")).toBe(true);
  });
  it("marks a math question", () => {
    const m = q("m", "math", { hint: null }, { expression: "x^2-4", alternatives: ["0"] });
    expect(markQuestion(m, "(x+2)(x-2)").points).toBe(2);
    expect(markQuestion(m, "0").points).toBe(2);
    expect(markQuestion(m, "x^2").points).toBe(0);
    expect(validateQuestion(m)).toEqual([]);
    expect(validateQuestion({ ...m, answer: { expression: "x^" } }).length).toBe(1);
  });
});

describe("drag and drop", () => {
  const dd = q("d", "drag_drop",
    { zones: [{ id: "z1", text: "Mammals" }, { id: "z2", text: "Birds" }], items: [{ id: "i1", text: "Goat" }, { id: "i2", text: "Eagle" }, { id: "i3", text: "Bat" }, { id: "i4", text: "Hen" }] },
    { placement: { i1: "z1", i2: "z2", i3: "z1", i4: "z2" }, partial: true }, 4);
  it("gives partial credit per item", () => {
    expect(markQuestion(dd, { i1: "z1", i2: "z2", i3: "z1", i4: "z2" }).points).toBe(4);
    expect(markQuestion(dd, { i1: "z1", i2: "z1" }).points).toBe(1);
    expect(markQuestion({ ...dd, answer: { ...dd.answer, partial: false } }, { i1: "z1", i2: "z2", i3: "z1" }).points).toBe(0);
  });
  it("never reveals the placement and shuffles items", () => {
    const pub = toPublicQuestion(dd, ["i4", "i3", "i2", "i1"]) as any;
    expect(JSON.stringify(pub)).not.toContain("placement");
    expect(pub.data.items.map((i: any) => i.id)).toEqual(["i4", "i3", "i2", "i1"]);
    expect(buildAttemptLayout([dd], {}).option_orders.d.sort()).toEqual(["i1", "i2", "i3", "i4"]);
  });
  it("validates every item has a group", () => {
    expect(validateQuestion(dd)).toEqual([]);
    expect(validateQuestion({ ...dd, answer: { placement: { i1: "z1" } } })).toContain("Put every item in its correct group.");
  });
  it("describes the answer for practice feedback", () => {
    expect(describeAnswer(dd)).toBe("Mammals: Goat, Bat; Birds: Eagle, Hen");
  });
});

describe("question pools", () => {
  const pool = Array.from({ length: 10 }, (_, i) => q(`p${i}`, "true_false", {}, { correct: true }, 1, "A"));
  const fixed = [q("f1", "true_false", {}, { correct: true }, 1, "B"), q("f2", "true_false", {}, { correct: true }, 1, null)];
  it("draws N per section and keeps everything else", () => {
    const got = drawQuestions([...pool, ...fixed], { A: 4 });
    expect(got.filter(x => x.section === "A")).toHaveLength(4);
    expect(got.map(x => x.id)).toEqual(expect.arrayContaining(["f1", "f2"]));
    expect(drawQuestions([...pool, ...fixed]).length).toBe(12);
  });
  it("marks only the questions the student was given", () => {
    const layout = buildAttemptLayout([...pool, ...fixed], { draw: { A: 3 } });
    expect(layout.question_order).toHaveLength(5);
    const given = questionsForAttempt([...pool, ...fixed], layout);
    const r = markAttempt(given, Object.fromEntries(given.map(g => [g.id, true])));
    expect(r.max_score).toBe(5);
    expect(r.total_score).toBe(5);
  });
  it("gives different students different papers", () => {
    const papers = new Set(Array.from({ length: 20 }, () => buildAttemptLayout(pool, { draw: { A: 3 } }).question_order.slice().sort().join()));
    expect(papers.size).toBeGreaterThan(1);
  });
});

describe("exam formats", () => {
  it("JAMB UTME totals 400 marks over 180 questions in 2 hours", () => {
    const j = formatById("jamb_utme")!;
    expect(j.sections.reduce((a, s) => a + s.count, 0)).toBe(180);
    expect(Math.round(j.sections.reduce((a, s) => a + s.count * s.points, 0))).toBe(400);
    expect(j.duration_minutes).toBe(120);
  });
  it("every format is well formed", () => {
    for (const f of EXAM_FORMATS) {
      expect(f.sections.length).toBeGreaterThan(0);
      for (const s of f.sections) {
        expect(s.count).toBeGreaterThan(0);
        expect((s.subjectSlot ?? 0)).toBeLessThan(f.subjects);
      }
    }
  });
});

import { STARTER_QUESTIONS, starterSubjectFor } from "@/lib/exams/starter-pack";

describe("starter practice pack", () => {
  it("every question is valid and auto-markable, with an explanation", () => {
    expect(STARTER_QUESTIONS.length).toBe(99);
    for (const s of STARTER_QUESTIONS) {
      const q = { id: "x", type: s.type as Question["type"], prompt: s.prompt, points: s.points, data: s.data, answer: s.answer };
      expect(validateQuestion(q), s.prompt).toEqual([]);
      expect(s.explanation.length).toBeGreaterThan(5);
    }
  });
  it("marks its own key as correct", () => {
    for (const s of STARTER_QUESTIONS) {
      const q = { id: "x", type: s.type as Question["type"], prompt: s.prompt, points: 1, data: s.data, answer: s.answer };
      const key = s.type === "mcq_single" ? s.answer.correct : s.type === "numeric" ? String(s.answer.value) : String(s.answer.expression);
      expect(markQuestion(q, key).points, s.prompt).toBe(1);
    }
  });
  it("matches common subject names", () => {
    expect(starterSubjectFor("Maths")).toBe("Mathematics");
    expect(starterSubjectFor("English Language")).toBe("English");
    expect(starterSubjectFor("Further Mathematics")).toBeNull();
    expect(starterSubjectFor("Physical and Health Education")).toBeNull();
    expect(starterSubjectFor("Civic Education")).toBeNull();
  });
});
