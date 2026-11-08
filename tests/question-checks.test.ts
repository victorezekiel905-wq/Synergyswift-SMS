import { describe, expect, it } from "vitest";
import { validateQuestion, markQuestion, type Question } from "@/lib/exams/engine";
import { cleanQuestion, validateQuestion as validateLive, blankQuestion, type EditableQuestion } from "@/live/components/activities/QuestionEditor";

const q = (over: Partial<Question>): Question => ({ id: "q", type: "mcq_single", prompt: "Q?", points: 2, data: {}, answer: {}, ...over });

describe("exam questions: an answer key students can actually match", () => {
  it("multiple choice (several answers) refuses a ticked answer whose option was removed", () => {
    const bad = q({ type: "mcq_multi", data: { options: [{ id: "a", text: "A" }, { id: "b", text: "B" }] }, answer: { correct: ["a", "gone"] } });
    expect(validateQuestion(bad).join(" ")).toMatch(/removed/);
    // Without the check nobody could ever get full marks:
    expect(markQuestion(bad, ["a"]).points).toBeLessThan(2);
  });

  it("matching needs both sides of every pair", () => {
    const bad = q({ type: "matching", data: { left: [{ id: "l1", text: "Cat" }, { id: "l2", text: "Dog" }], right: [{ id: "r1", text: "Kitten" }, { id: "r2", text: "" }] }, answer: { pairs: { l1: "r1", l2: "r2" } } });
    expect(validateQuestion(bad).join(" ")).toMatch(/both sides/);
    const ok = q({ type: "matching", data: { left: [{ id: "l1", text: "Cat" }, { id: "l2", text: "Dog" }], right: [{ id: "r1", text: "Kitten" }, { id: "r2", text: "Puppy" }] }, answer: { pairs: { l1: "r1", l2: "r2" } } });
    expect(validateQuestion(ok)).toEqual([]);
  });

  it("put in order needs every item in the correct order", () => {
    const bad = q({ type: "ordering", data: { items: [{ id: "a", text: "1" }, { id: "b", text: "2" }] }, answer: { order: ["a"] } });
    expect(validateQuestion(bad).join(" ")).toMatch(/missing an item/);
  });

  it("fill in the blanks refuses an empty blank", () => {
    const bad = q({ type: "fill_blanks", data: { text: "Water boils at [[ ]] degrees." }, answer: { blanks: [[]] } });
    expect(validateQuestion(bad).join(" ")).toMatch(/A blank is empty/);
  });

  it("a numeric question with no correct value is refused, not marked as 0", () => {
    expect(validateQuestion(q({ type: "numeric", answer: { value: null } })).join(" ")).toMatch(/numeric value/);
    expect(validateQuestion(q({ type: "numeric", answer: { value: 0 } }))).toEqual([]);
  });
});

describe("lesson questions: what students see has no blanks", () => {
  const mcq = (): EditableQuestion => ({ ...blankQuestion("mcq"), prompt: "2 + 2?" });

  it("blank options are dropped before saving", () => {
    const x = mcq();
    x.options = [{ label: "4", is_correct: true }, { label: "5", is_correct: false }, { label: "  ", is_correct: false }];
    expect(cleanQuestion(x).options.map((o) => o.label)).toEqual(["4", "5"]);
    expect(validateLive(x)).toBeNull();
  });

  it("an empty option marked correct is caught", () => {
    const x = mcq();
    x.options = [{ label: "", is_correct: true }, { label: "4", is_correct: false }, { label: "5", is_correct: false }];
    expect(validateLive(x)).toMatch(/marked correct is empty/);
  });

  it("every blank needs an accepted answer, and extra answer lists are dropped", () => {
    const x: EditableQuestion = { ...blankQuestion("fill_blank"), prompt: "The capital of Nigeria is ___ and of Ghana is ___.", answer_key: { blanks: [["Abuja"]] } };
    expect(validateLive(x)).toMatch(/blank 2/);
    x.prompt = "The capital of Nigeria is ___.";
    x.answer_key = { blanks: [["Abuja"], ["Accra"]] };
    expect(cleanQuestion(x).answer_key.blanks).toEqual([["Abuja"]]);
    expect(validateLive(x)).toBeNull();
  });

  it("matching drops empty rows and needs both sides of the rest", () => {
    const x = blankQuestion("matching");
    x.prompt = "Match";
    x.config = { left: [{ id: "l1", label: "Cat" }, { id: "l2", label: "Dog" }, { id: "l3", label: "" }], right: [{ id: "r1", label: "Kitten" }, { id: "r2", label: "Puppy" }, { id: "r3", label: "" }] };
    const c = cleanQuestion(x);
    expect((c.config.left as unknown[]).length).toBe(2);
    expect(c.answer_key.pairs).toEqual({ l1: "r1", l2: "r2" });
    expect(validateLive(x)).toBeNull();
    (x.config.right as { label: string }[])[1]!.label = "";
    expect(validateLive(x)).toMatch(/both sides/);
  });

  it("sorting into groups drops empty items and placements to removed groups", () => {
    const x = blankQuestion("categorize");
    x.prompt = "Sort";
    x.config = { categories: [{ id: "c1", label: "Solid" }, { id: "c2", label: "Liquid" }, { id: "c3", label: "" }], items: [{ id: "i1", label: "Ice" }, { id: "i2", label: "" }, { id: "i3", label: "Steam" }] };
    x.answer_key = { placements: { i1: "c1", i3: "c3" } };
    const c = cleanQuestion(x);
    expect((c.config.items as unknown[]).length).toBe(2);
    expect(c.answer_key.placements).toEqual({ i1: "c1" });
    expect(validateLive(x)).toMatch(/choose the group/);
  });

  it("put in order drops empty items", () => {
    const x = blankQuestion("ordering");
    x.prompt = "Order";
    x.config = { items: [{ id: "a", label: "First" }, { id: "b", label: "" }, { id: "c", label: "Second" }] };
    expect((cleanQuestion(x).config.items as { id: string }[]).map((i) => i.id)).toEqual(["a", "c"]);
  });
});
