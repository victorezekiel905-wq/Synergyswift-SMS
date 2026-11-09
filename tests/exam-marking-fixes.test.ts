import { describe, expect, it } from "vitest";
import { markQuestion, markAttempt, readNumber, normAnswer, toBool, describeAnswer, QUESTION_TYPES, type Question } from "@/lib/exams/engine";
import { analyseExam, type AnalysisAttempt } from "@/lib/exams/analysis";
import { studentResultView, type ExamRow } from "@/lib/exams/server";
import { markQuizStep, quizCanUse } from "@/lib/learning";

const q = (over: Partial<Question>): Question => ({ id: "q1", type: "short_answer", prompt: "?", points: 2, data: {}, answer: {}, ...over });

describe("numbers typed as fractions", () => {
  it("reads 1/2, -3/4 and 1 1/2 as their values", () => {
    expect(readNumber("1/2")!.value).toBe(0.5);
    expect(readNumber("-3/4")!.value).toBe(-0.75);
    expect(readNumber("1 1/2")!.value).toBe(1.5);
    expect(readNumber("2 / 5")!.value).toBe(0.4);
    expect(readNumber("1/0")).toBeNull();
  });
  it("marks 1/2 right for 0.5, and no longer right for 1", () => {
    expect(markQuestion(q({ type: "numeric", answer: { value: 0.5 } }), "1/2").points).toBe(2);
    expect(markQuestion(q({ type: "numeric", answer: { value: 1 } }), "1/2").points).toBe(0);
  });
  it("still reads decimals, thousands and powers of ten as before", () => {
    expect(readNumber("1,250")).toEqual({ value: 1250, sigFigs: 3 });
    expect(readNumber("6.02 × 10^23")!.value).toBeCloseTo(6.02e23);
  });
});

describe("true / false keys stored as words", () => {
  it("a key of \"false\" is false", () => {
    const tf = q({ type: "true_false", answer: { correct: "false" } });
    expect(markQuestion(tf, false).points).toBe(2);
    expect(markQuestion(tf, true).points).toBe(0);
    expect(markQuestion(tf, "false").points).toBe(2);
    expect(describeAnswer(tf)).toBe("False");
  });
  it("reads the usual ways of writing true", () => {
    for (const v of [true, "true", "True", "T", "yes", 1]) expect(toBool(v)).toBe(true);
    for (const v of [false, "false", "F", "no", 0, null, undefined]) expect(toBool(v)).toBe(false);
  });
});

describe("typed answers: punctuation and quotes don't count", () => {
  const sa = q({ answer: { accepted: ["Paris"] } });
  it("accepts Paris. ‘Paris’ and \"paris\"", () => {
    for (const r of ["Paris.", "‘Paris’", '"paris"', "  paris  ", "Paris!"]) expect(markQuestion(sa, r).points).toBe(2);
  });
  it("still marks a different word wrong", () => {
    expect(markQuestion(sa, "Pari").points).toBe(0);
    expect(markQuestion(sa, "Lagos.").points).toBe(0);
  });
  it("keeps apostrophes inside words and decimal points", () => {
    expect(normAnswer("Earth’s")).toBe("earth's");
    expect(normAnswer("3.5")).toBe("3.5");
    expect(markQuestion(q({ answer: { accepted: ["3.5"] } }), "3.5.").points).toBe(2);
  });
  it("fill-in-the-blanks forgive the same things, and an empty blank never matches", () => {
    const fb = q({ type: "fill_blanks", data: { text: "[[Abuja]] and [[Niger]]" }, answer: { blanks: [["Abuja"], ["Niger", "the Niger"]] } });
    expect(markQuestion(fb, ["Abuja.", "‘the Niger’"]).points).toBe(2);
    expect(markQuestion(fb, ["Abuja", ""]).points).toBe(1);
  });
});

describe("re-marking keeps teacher marks within the points", () => {
  it("a teacher mark above lowered points is capped", () => {
    const essay = q({ type: "essay", points: 5 });
    const r = markAttempt([essay], { q1: "an answer" }, { q1: { points: 8, max: 10, auto: false } });
    expect(r.marks.q1).toMatchObject({ points: 5, max: 5, auto: false });
    expect(r.total_score).toBe(5);
  });
  it("a corrected answer key changes the auto mark", () => {
    const mcq = q({ type: "mcq_single", data: { options: [{ id: "a", text: "A" }, { id: "b", text: "B" }] }, answer: { correct: "a" } });
    const before = markAttempt([mcq], { q1: "b" }, {});
    const after = markAttempt([{ ...mcq, answer: { correct: "b" } }], { q1: "b" }, before.marks);
    expect([before.total_score, after.total_score]).toEqual([0, 2]);
  });
});

describe("what the student sees", () => {
  const exam = { results_released: true, settings: { allow_review: true } } as unknown as ExamRow;
  const qs = [q({ id: "a", type: "mcq_single", points: 2 }), q({ id: "b", type: "essay", points: 8 }), q({ id: "p", type: "passage", points: 0 })];
  it("an answer still being marked shows as waiting, not 0, with the percentage so far", () => {
    const v = studentResultView(exam, { status: "submitted", total_score: 2, max_score: 10, marks: { a: { points: 2, max: 2, auto: true }, b: { points: null, max: 8, auto: false } } }, qs);
    expect(v).toMatchObject({ released: true, pending_manual: true, percent: 20 });
    expect(v.per_question).toEqual([
      { id: "a", prompt: "?", points: 2, max: 2, feedback: null },
      { id: "b", prompt: "?", points: null, max: 8, feedback: null }
    ]);
  });
});

describe("item analysis with a reading passage", () => {
  it("a passage no longer stops the reliability figure, and keeps the question numbers", () => {
    const qs: Question[] = [q({ id: "p", type: "passage", points: 0 }), ...["a", "b", "c"].map(id => q({ id, type: "mcq_single", points: 1, data: { options: [{ id: "x", text: "X" }, { id: "y", text: "Y" }] }, answer: { correct: "x" } }))];
    const pattern = [[1, 1, 1], [1, 1, 0], [1, 0, 0], [0, 0, 0], [1, 1, 1], [0, 1, 0]];
    const attempts: AnalysisAttempt[] = pattern.map((row, i) => ({
      id: `s${i}`, answers: {}, question_order: null,
      marks: { p: { points: 0, max: 0 }, a: { points: row[0], max: 1 }, b: { points: row[1], max: 1 }, c: { points: row[2], max: 1 } }
    }));
    const r = analyseExam(qs as any, attempts);
    expect(r.items.map(i => i.position)).toEqual([2, 3, 4]);
    expect(r.reliability).not.toBeNull();
    expect(r.reliability_note).toBeNull();
  });
});

describe("learning-path quizzes", () => {
  it("only types the computer marks can be used", () => {
    for (const t of QUESTION_TYPES) expect(quizCanUse(t.type)).toBe(t.auto);
  });
  it("a drawing in a quiz no longer makes it impossible to pass", () => {
    const qs = [q({ id: "m", type: "mcq_single", points: 1, data: { options: [{ id: "x", text: "X" }] }, answer: { correct: "x" } }), q({ id: "d", type: "drawing", points: 4 })];
    const r = markQuizStep(qs, { m: "x" }, 60);
    expect(r).toMatchObject({ pct: 100, passed: true, max: 1 });
  });
  it("a reading passage is neither right nor wrong", () => {
    const qs = [q({ id: "p", type: "passage", points: 0 }), q({ id: "m", type: "true_false", points: 1, answer: { correct: true } })];
    const r = markQuizStep(qs, { m: true }, 50);
    expect(r.right).toEqual({ m: true });
  });
});
