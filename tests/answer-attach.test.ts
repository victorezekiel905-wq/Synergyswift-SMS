import { describe, it, expect } from "vitest";
import { parseAnswerSheet, matchAnswers, type SheetQuestion } from "@/lib/exams/answer-attach";

const opts = (...t: string[]) => ({ options: t.map((text, i) => ({ id: `o${i}`, text })) });
let pos = 0;
const q = (type: string, data: Record<string, any> = {}, answer: Record<string, any> = {}): SheetQuestion =>
  ({ id: `q${++pos}`, type, prompt: `Question ${pos}`, position: pos, data, answer });

describe("reading a pasted answer sheet", () => {
  it("reads keys on one line, one per line, and in different styles", () => {
    const s = parseAnswerSheet("ANSWERS\n1. B 2. C 3-A\n4) d\n5 B, 6 a\n7. True");
    expect(s.objective).toEqual({ 1: "B", 2: "C", 3: "A", 4: "D", 5: "B", 6: "A", 7: "true" });
    expect(s.theory).toEqual([]);
  });
  it("reads short written answers and a theory marking guide with parts and following lines", () => {
    const s = parseAnswerSheet([
      "SECTION A", "1. B", "2. Abuja",
      "SECTION B: THEORY",
      "1a. A computer is an electronic machine that processes data. (2 marks)",
      "Accept any correct definition.",
      "1b. Any THREE: speed; accuracy; storage (1 mark each)",
      "2. (a) Input, processing, output",
      "(b) Keyboard and mouse",
      "3(a) RAM is volatile",
      "3b) ROM is not"
    ].join("\n"));
    expect(s.objective).toEqual({ 1: "B", 2: "Abuja" });
    expect(s.theory).toEqual([
      { num: 1, part: "a", text: "A computer is an electronic machine that processes data. (2 marks)\nAccept any correct definition." },
      { num: 1, part: "b", text: "Any THREE: speed; accuracy; storage (1 mark each)" },
      { num: 2, part: "a", text: "Input, processing, output" },
      { num: 2, part: "b", text: "Keyboard and mouse" },
      { num: 3, part: "a", text: "RAM is volatile" },
      { num: 3, part: "b", text: "ROM is not" }
    ]);
  });
  it("without headings, long numbered answers are theory and short ones are objective", () => {
    const s = parseAnswerSheet("1. B\n2. C\n1. Explain that the CPU fetches, decodes and executes instructions in a cycle");
    expect(s.objective).toEqual({ 1: "B", 2: "C" });
    expect(s.theory).toHaveLength(1);
  });
});

describe("attaching the answers to the exam's questions", () => {
  it("objectives by number, theory guides by number, with parts joined for one question each", () => {
    pos = 0;
    const qs = [q("mcq_single", opts("CPU", "RAM", "ROM", "SSD")), q("true_false"), q("short_answer"), q("essay"), q("essay")];
    const { items, warnings } = matchAnswers(qs, parseAnswerSheet("1. B\n2. False\n3. Abuja / FCT\nTHEORY\n1a. First part\n1b. Second part\n2. Whole answer"));
    const by = Object.fromEntries(items.map(i => [i.question_id, i.answer]));
    expect(by.q1).toEqual({ correct: "o1" });
    expect(by.q2).toEqual({ correct: false });
    expect(by.q3).toEqual({ accepted: ["Abuja", "FCT"] });
    expect(by.q4).toEqual({ rubric: "(a) First part\n(b) Second part" });
    expect(by.q5).toEqual({ rubric: "Whole answer" });
    expect(warnings).toEqual([]);
  });
  it("when each part is its own question, parts go to them in order", () => {
    pos = 0;
    const qs = [q("essay"), q("essay"), q("essay")];
    const { items } = matchAnswers(qs, parseAnswerSheet("THEORY\n1a. A\n1b. B\n2a. C"));
    expect(items.map(i => [i.label, (i.answer as any).rubric])).toEqual([["Theory 1a", "A"], ["Theory 1b", "B"], ["Theory 2a", "C"]]);
  });
  it("theory numbered on from the objectives (61, 62) is counted from 1", () => {
    pos = 0;
    const qs = [...Array.from({ length: 60 }, () => q("mcq_single", opts("w", "x", "y", "z"))), q("essay"), q("essay")];
    const { items } = matchAnswers(qs, parseAnswerSheet("THEORY\n61. First theory answer\n62. Second theory answer"));
    expect(items.map(i => i.label)).toEqual(["Theory 1", "Theory 2"]);
  });
  it("a passage between questions does not shift the numbering, and a wrong letter is reported", () => {
    pos = 0;
    const qs = [q("passage"), q("mcq_single", opts("a", "b")), q("mcq_single", opts("a", "b"))];
    const { items, warnings } = matchAnswers(qs, parseAnswerSheet("1. A\n2. D"));
    expect(items.map(i => i.question_id)).toEqual(["q2"]);
    expect(warnings[0]).toMatch(/Objective 2/);
  });
  it("says when an answer has no question, and keeps other answer settings", () => {
    pos = 0;
    const qs = [q("numeric", {}, { value: 1, tolerance: 0.5 }), q("essay", {}, { rubric: "old", keywords: ["x"] })];
    const { items, warnings } = matchAnswers(qs, parseAnswerSheet("1. 9.81\n5. C\nTHEORY\n1. New guide"));
    expect(items[0]!.answer).toEqual({ value: 9.81, tolerance: 0.5 });
    expect(items[1]!.answer).toEqual({ rubric: "New guide", keywords: ["x"] });
    expect(items[1]!.replaces).toBe(true);
    expect(warnings.some(w => /Objective 5/.test(w))).toBe(true);
  });
});

describe("wiring", () => {
  const read = (f: string) => require("node:fs").readFileSync(f, "utf8") as string;
  it("imported marking guides are saved where the editor, the marking view and the AI read them", () => {
    expect(read("src/lib/exams/paper-import.ts")).toMatch(/answer: keyed \? \{ rubric: keyed \}/);
    expect(read("src/lib/ai-drafts.ts")).toMatch(/q\.answer\?\.rubric \|\| q\.answer\?\.reference \|\| q\.answer\?\.guide/);
  });
  it("AI marking of whole scripts only fills answers still waiting for a mark", () => {
    const page = read("src/app/exams/[id]/page.tsx");
    expect(page).toMatch(/a\.marks\?\.\[q\.id\]\?\.points === null/);
    expect(page).toMatch(/Mark all theory with AI/);
    expect(page).toMatch(/Paste or upload the answers/);
  });
});