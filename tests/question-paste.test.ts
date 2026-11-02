import { describe, it, expect } from "vitest";
import { tidyPastedQuestions, splitInlineOptions, readKey } from "@/lib/question-paste";
import { parsePaper } from "@/lib/exams/paper-import";
import { parseQuestions } from "@/live/lib/question-import";
import type { QuestionKind } from "@/live/lib/types";

const LIVE: QuestionKind[] = ["mcq", "multi_select", "true_false", "short", "open"];
/** What each importer makes of a paste: [question, options, right option] per question. */
const exam = (t: string) => parsePaper(t).questions.map(q => {
  const opts = ((q.data as any).options ?? []) as { id: string; text: string }[];
  return [q.prompt, opts.map(o => o.text).join(" / "), opts.find(o => o.id === (q.answer as any).correct)?.text ?? null];
});
const live = (t: string) => parseQuestions(t, LIVE).map(q => [q.prompt, q.options.map(o => o.label).join(" / "), q.options.find(o => o.is_correct)?.label ?? null]);

const PASTES: Record<string, { text: string; want: (string | null)[][] }> = {
  "options under the question, Ans: B": { text: "1. What is the capital of Nigeria?\nA. Lagos\nB. Abuja\nC. Kano\nD. Ibadan\nAns: B\n\n2. Which is a prime number?\nA. 4\nB. 6\nC. 7\nD. 9\nAnswer: C",
    want: [["What is the capital of Nigeria?", "Lagos / Abuja / Kano / Ibadan", "Abuja"], ["Which is a prime number?", "4 / 6 / 7 / 9", "7"]] },
  "options on the question's line, two styles": { text: "1. 2 + 2 = ?  A. 3  B. 4  C. 5  D. 6\nAns B\n2. The chemical symbol for water is (a) H2O (b) CO2 (c) O2 (d) NaCl\nCorrect answer is (a)",
    want: [["2 + 2 = ?", "3 / 4 / 5 / 6", "4"], ["The chemical symbol for water is", "H2O / CO2 / O2 / NaCl", "H2O"]] },
  "(a) options and an answer key at the end": { text: "1) Who wrote Things Fall Apart?\n(a) Wole Soyinka\n(b) Chinua Achebe\n(c) Chimamanda Adichie\n(d) Ben Okri\n2) The plural of child is\n(a) childs\n(b) children\n(c) childrens\n(d) childes\n\nANSWERS\n1. B\n2. B",
    want: [["Who wrote Things Fall Apart?", "Wole Soyinka / Chinua Achebe / Chimamanda Adichie / Ben Okri", "Chinua Achebe"], ["The plural of child is", "childs / children / childrens / childes", "children"]] },
  "the right option starred or ticked": { text: "Q1. Which planet is closest to the sun?\na) Venus\nb) Mercury*\nc) Earth\nd) Mars\n\nQ2. 9 x 7 =\na) 56\nb) 72\nc) 63 ✓\nd) 49",
    want: [["Which planet is closest to the sun?", "Venus / Mercury / Earth / Mars", "Mercury"], ["9 x 7 =", "56 / 72 / 63 / 49", "63"]] },
  "copied from Word: tabs, no numbers, 'Correct answer'": { text: "Which gas do plants take in?\nA.\tOxygen\nB.\tCarbon dioxide\nC.\tNitrogen\nD.\tHydrogen\nCorrect answer: B\n\nWhat is the largest ocean?\nA.\tAtlantic\nB.\tIndian\nC.\tPacific\nD.\tArctic\nCorrect answer: C",
    want: [["Which gas do plants take in?", "Oxygen / Carbon dioxide / Nitrogen / Hydrogen", "Carbon dioxide"], ["What is the largest ocean?", "Atlantic / Indian / Pacific / Arctic", "Pacific"]] },
  "a one-line key: 'Answers: 1.B 2.C'": { text: "1. Red + yellow makes\nA. Green\nB. Orange\nC. Purple\n2. How many legs has a spider?\nA. 6\nB. 10\nC. 8\n\nAnswers: 1.B 2.C",
    want: [["Red + yellow makes", "Green / Orange / Purple", "Orange"], ["How many legs has a spider?", "6 / 10 / 8", "8"]] }
};

describe("pasting multiple-choice questions", () => {
  for (const [name, { text, want }] of Object.entries(PASTES)) {
    it(`exams: ${name}`, () => expect(exam(text)).toEqual(want));
    it(`live lessons: ${name}`, () => expect(live(text)).toEqual(want));
  }

  it("keeps questions without answers, for the teacher to mark", () => {
    const text = "1. The sun rises in the\nA. North\nB. South\nC. East\nD. West\n2. Days in a leap year?\nA. 365\nB. 366";
    expect(exam(text)).toEqual([["The sun rises in the", "North / South / East / West", null], ["Days in a leap year?", "365 / 366", null]]);
    expect(parseQuestions(text, LIVE).map(q => q.problem && /right/.test(q.problem))).toEqual([true, true]);
  });

  it("leaves ordinary text alone", () => {
    expect(splitInlineOptions("Vitamin A. B vitamins help the body")).toBeNull();
    expect(splitInlineOptions("Answer all questions in section A. Time: 1 hour")).toBeNull();
    expect(splitInlineOptions("A. Lagos")).toBeNull();
    expect(tidyPastedQuestions("Answer all questions.\n\n1. 2 + 2\nA. 3\nB. 4\nAnswer: B")).toBe("Answer all questions.\n\n1. 2 + 2\nA. 3\nB. 4\nAnswer: B");
    // Two starred options are left for the teacher (it may be "select all that apply").
    expect(tidyPastedQuestions("1. Pick the even numbers\nA. 2*\nB. 3\nC. 4*")).toBe("1. Pick the even numbers\nA. 2*\nB. 3\nC. 4*");
  });

  it("splits a run of options, and reads keys", () => {
    expect(splitInlineOptions("2 + 2 = ?  A. 3  B. 4  C. 5")).toEqual(["2 + 2 = ?", "A. 3", "B. 4", "C. 5"]);
    expect(splitInlineOptions("(a) H2O (b) CO2")).toEqual(["A. H2O", "B. CO2"]);
    expect(splitInlineOptions("a) yes b) no")).toEqual(["A. yes", "B. no"]);
    expect(readKey("1. B 2-c, 3) a 4 true")).toEqual({ 1: "B", 2: "C", 3: "A", 4: "true" });
  });

  it("numbers unnumbered questions for exam papers, a question over two lines included", () => {
    const text = "Read carefully.\n\nIn the passage, the word\n'brave' means\nA. scared\nB. bold\n\nWhich is a mammal?\nA. Shark\nB. Whale";
    expect(tidyPastedQuestions(text, { numberUnnumbered: true }))
      .toBe("Read carefully.\n\n1. In the passage, the word\n'brave' means\nA. scared\nB. bold\n\n2. Which is a mammal?\nA. Shark\nB. Whale");
  });

  it("a written answer in the key goes to its short-answer question", () => {
    const p = parsePaper("1. The capital of Nigeria is ____\n2. 3 x 3 =\nA. 6\nB. 9\n\nANSWER KEY\n1. Abuja\n2. B");
    expect(p.questions.map(q => [q.type, q.answer])).toEqual([["short_answer", { accepted: ["Abuja"] }], ["mcq_single", { correct: "o2" }]]);
  });
});
