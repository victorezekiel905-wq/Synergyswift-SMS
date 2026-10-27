import { describe, it, expect } from "vitest";
import { parsePaper, parseKey } from "@/lib/exams/paper-import";

const PAPER = `GREENFIELD COLLEGE
FIRST TERM EXAMINATION 2026/2027
Subject: Mathematics   Class: JSS2
Time allowed: 2 hours
Instructions: Answer all questions in Section A.

SECTION A: OBJECTIVES
1. What is 2 + 2?
A. 3
B. 4
C. 5
D. 6
2. Which of these is a prime number? A. 4 B. 6 C. 7 D. 9
3. Simplify 6 x 2.
(a) 12
(b) 14
Answer: A
4. The sum of angles in a triangle is 180 degrees.
A. True
B. False
5. The capital of Nigeria is ______.

SECTION B: THEORY
1. Explain three uses of fractions in everyday life. (10 marks)
2. Using the diagram above, find the area of the shaded part.
(a) state the formula
(b) calculate it [15]

ANSWER KEY
1. B 2. C 3-B 4 A
5. Abuja`;

describe("exam paper import", () => {
  const { questions, warnings } = parsePaper(PAPER);
  it("finds every question, objective and theory", () => {
    expect(questions.map(q => `${q.section?.split(":")[0]} ${q.number} ${q.type}`)).toEqual([
      "SECTION A 1 mcq_single", "SECTION A 2 mcq_single", "SECTION A 3 mcq_single", "SECTION A 4 true_false", "SECTION A 5 short_answer",
      "SECTION B 1 essay", "SECTION B 2 essay"]);
    expect(warnings).toEqual([]);
    expect(questions[2]!.answer).toEqual({ correct: "o1" });
  });
  it("reads options on their own lines and inline, with the answer key", () => {
    const [q1, q2] = questions;
    expect(q1!.data.options).toEqual([{ id: "o1", text: "3" }, { id: "o2", text: "4" }, { id: "o3", text: "5" }, { id: "o4", text: "6" }]);
    expect(q1!.answer).toEqual({ correct: "o2" });
    expect(q2!.prompt).toBe("Which of these is a prime number?");
    expect((q2!.data.options as unknown[]).length).toBe(4);
    expect(q2!.answer).toEqual({ correct: "o3" });
  });
  it("turns True/False options into a true/false question", () => {
    expect(questions[3]!.answer).toEqual({ correct: true });
  });
  it("keeps short answers from the key and flags what needs a look", () => {
    expect(questions[4]!.answer).toEqual({ accepted: ["Abuja"] });
    expect(questions[6]!.notes.join(" ")).toMatch(/picture or diagram/);
  });
  it("reads marks and keeps sub-parts inside the theory question", () => {
    expect(questions[5]!.points).toBe(10);
    expect(questions[5]!.prompt).toBe("Explain three uses of fractions in everyday life.");
    expect(questions[6]!.points).toBe(15);
    expect(questions[6]!.prompt).toContain("(b) calculate it");
    expect(questions[0]!.points).toBe(1);
  });
  it("reads answer keys in several layouts", () => {
    expect(parseKey("1. B 2. c 3-A 4) d")).toEqual({ 1: "B", 2: "C", 3: "A", 4: "D" });
    expect(parseKey("1 B, 2 C; 3 true")).toEqual({ 1: "B", 2: "C", 3: "true" });
  });
  it("warns when nothing is numbered or numbers jump", () => {
    expect(parsePaper("Just some notes").warnings.join(" ")).toMatch(/No numbered questions/);
    expect(parsePaper("1. What is x?\nA. 1\nB. 2\n3. What is y?\nA. 1\nB. 2").warnings.join(" ")).toMatch(/jump from 1 to 3/);
  });
});
