/**
 * Attach answers to questions already in an exam: the teacher pastes (or uploads) the whole answer
 * sheet or marking guide, and each answer goes to its question.
 *
 *  - Objective answers by number: "1. B 2. C 3-A", "1) b", one per line or many on a line;
 *    a written answer "5. Abuja" for a short-answer question; "True" / "False".
 *  - Theory after a heading ("THEORY", "SECTION B", "PART II", "ESSAY"), or any numbered answer
 *    longer than a few words: "1. …", "1a. …", "1(a) …", "1. (a) …", "(b) …"; the lines below a
 *    label belong to it. Each theory answer becomes that question's marking guide.
 *  - Theory numbered from 1 again, or carrying on after the objectives (61, 62…), both work.
 *
 * Pure and unit tested; the route applies what the teacher confirms.
 */
import { parseKey } from "./paper-import";

export type SheetQuestion = { id: string; type: string; prompt: string; position: number; data: Record<string, any>; answer: Record<string, any> };
export type TheoryBlock = { num: number; part: string | null; text: string };
export type ParsedSheet = { objective: Record<number, string>; theory: TheoryBlock[] };
export type AttachItem = { question_id: string; label: string; type: string; prompt: string; display: string; answer: Record<string, unknown>; replaces: boolean };

/** Question types answered by a marking guide (theory). */
export const GUIDE_TYPES = new Set(["essay", "drawing", "audio_response", "file_upload"]);
/** Question types that are not numbered with the objectives (they have no key to attach). */
const UNNUMBERED = new Set(["passage", "essay", "drawing", "audio_response", "file_upload", "code", "math"]);

const THEORY_HEAD = /^\s*(section\s*(b|c|ii|2)|part\s*(b|ii|2)|theory|essay|structured|long\s+answers?)\b/i;
const OBJ_HEAD = /^\s*(section\s*(a|i|1)|part\s*(a|i|1)|objectives?|multiple\s+choice)\b/i;
const KEY_HEAD = /^\s*(answers?|answer\s+key|key|marking\s+(scheme|guide)|solutions?)\b\s*:?\s*$/i;
const KEY_ITEM = /(\d{1,3})\s*[.):\-–]?\s*\(?([a-fA-F]|true|false)\)?(?=[\s,;.]|$)/gi;
// "1. text", "1a. text", "1(a) text", "Q1 text", "1. (a) text"
const LABEL = /^\s*(?:q(?:uestion)?\.?\s*)?(\d{1,3})\s*(?:\(?([a-h])\)?)?\s*[.):\-–]\s*(?:\(([a-h])\)\s*)?(.*)$/i;
// "1(a) text", "1a) text", "1 (b): text"
const LABEL_NOPUNCT = /^\s*(?:q(?:uestion)?\.?\s*)?(\d{1,3})\s*\(?([a-h])\)\s*[.:\-–]?\s*(.*)$/i;
const PART_ONLY = /^\s*\(?([a-h])[.)]\s+(.*)$/i;

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/** Reads an answer sheet into objective answers by number and theory blocks. */
export function parseAnswerSheet(raw: string): ParsedSheet {
  const objective: Record<number, string> = {};
  const theory: TheoryBlock[] = [];
  let mode: "auto" | "obj" | "theory" = "auto";
  let cur: TheoryBlock | null = null;
  const push = (num: number, part: string | null, text: string) => { cur = { num, part: part ? part.toLowerCase() : null, text: text.trim() }; theory.push(cur); };

  for (const line of raw.replace(/\r/g, "").replace(/ /g, " ").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    if (t.length < 60 && THEORY_HEAD.test(t)) { mode = "theory"; cur = null; continue; }
    if (t.length < 60 && OBJ_HEAD.test(t)) { mode = "obj"; cur = null; continue; }
    if (t.length < 40 && KEY_HEAD.test(t)) continue;

    if (mode !== "theory") {
      // A run of keys and nothing else: "1. B 2. C 3-A" or "11 a, 12 c".
      const keys = parseKey(t);
      if (Object.keys(keys).length && t.replace(KEY_ITEM, "").replace(/[\s,;.]/g, "") === "") { Object.assign(objective, keys); cur = null; continue; }
      const m = t.match(/^(\d{1,3})\s*[.):\-–]\s*(.+)$/);
      if (m && !/^\(?[a-h]\)/i.test(m[2]!) && (mode === "obj" || words(m[2]!) <= 6)) { objective[Number(m[1])] = m[2]!.trim(); cur = null; continue; }
      if (mode === "obj") continue;
    }
    const lab = t.match(LABEL_NOPUNCT) ?? t.match(LABEL);
    if (lab) {
      const nopunct = lab.length === 4;
      const num = Number(lab[1]);
      const part = nopunct ? lab[2]! : (lab[2] ?? lab[3] ?? null);
      push(num, part, nopunct ? lab[3]! : lab[4]!);
      continue;
    }
    const sub = t.match(PART_ONLY);
    if (sub && cur) { push((cur as TheoryBlock).num, sub[1]!, sub[2]!); continue; }
    if (cur) (cur as TheoryBlock).text = `${(cur as TheoryBlock).text}\n${t}`.trim();
  }
  return { objective, theory: theory.filter(b => b.text) };
}

const LETTERS = ["A", "B", "C", "D", "E", "F"];
const clip = (s: string, n = 110) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The new answer for one objective question, or why it could not be used. */
function objectiveAnswer(q: SheetQuestion, given: string): { answer: Record<string, unknown>; display: string } | { problem: string } {
  const g = given.trim();
  const opts: { id: string; text: string }[] = q.data?.options ?? [];
  const letter = (s: string) => { const i = LETTERS.indexOf(s.toUpperCase()); return i >= 0 && i < opts.length ? i : -1; };
  switch (q.type) {
    case "mcq_single": {
      let i = g.length === 1 ? letter(g) : -1;
      if (i < 0) i = opts.findIndex(o => o.text.trim().toLowerCase() === g.toLowerCase());
      if (i < 0) return { problem: `"${clip(g, 30)}" is not one of its options` };
      return { answer: { ...q.answer, correct: opts[i]!.id }, display: `${LETTERS[i]}. ${opts[i]!.text}` };
    }
    case "mcq_multi": {
      const ls = g.toUpperCase().replace(/[^A-F]/g, "").split("");
      const idx = [...new Set(ls.map(letter))];
      if (!idx.length || idx.some(i => i < 0)) return { problem: `"${clip(g, 30)}" does not match its options` };
      return { answer: { ...q.answer, correct: idx.map(i => opts[i]!.id) }, display: idx.map(i => LETTERS[i]).join(", ") };
    }
    case "true_false": {
      const v = /^(a|t|true)$/i.test(g) ? true : /^(b|f|false)$/i.test(g) ? false : null;
      if (v === null) return { problem: "use True or False" };
      return { answer: { ...q.answer, correct: v }, display: v ? "True" : "False" };
    }
    case "short_answer": {
      if (/^[a-f]$/i.test(g) && !opts.length) return { problem: "a letter was given for a written answer" };
      const accepted = g.split(/\s+\/\s+|\s+or\s+|;\s*/i).map(s => s.trim()).filter(Boolean);
      return { answer: { ...q.answer, accepted }, display: accepted.join(" or ") };
    }
    case "numeric": {
      const n = Number(g.replace(/,/g, "").match(/-?\d+(\.\d+)?(e-?\d+)?/i)?.[0]);
      if (!Number.isFinite(n)) return { problem: "not a number" };
      return { answer: { ...q.answer, value: n }, display: String(n) };
    }
    default:
      return { problem: "answers for this kind of question are set in the question itself" };
  }
}

/** Matches a parsed sheet to the exam's questions (in paper order). */
export function matchAnswers(questions: SheetQuestion[], sheet: ParsedSheet): { items: AttachItem[]; warnings: string[] } {
  const ordered = [...questions].sort((a, b) => a.position - b.position);
  const objs = ordered.filter(q => !UNNUMBERED.has(q.type));
  const theoryQs = ordered.filter(q => GUIDE_TYPES.has(q.type));
  const items: AttachItem[] = [];
  const warnings: string[] = [];

  for (const [k, given] of Object.entries(sheet.objective).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    const n = Number(k);
    const q = objs[n - 1];
    if (!q) { warnings.push(`Objective ${n}: there is no objective question ${n} in this exam.`); continue; }
    const r = objectiveAnswer(q, given);
    if ("problem" in r) { warnings.push(`Objective ${n}: ${r.problem}.`); continue; }
    items.push({ question_id: q.id, label: `Objective ${n}`, type: q.type, prompt: clip(q.prompt), display: r.display, answer: r.answer, replaces: Object.keys(q.answer ?? {}).length > 0 });
  }

  let blocks = sheet.theory;
  if (blocks.length && theoryQs.length) {
    // Theory numbered on from the objectives (61, 62…) is counted from 1.
    const min = Math.min(...blocks.map(b => b.num));
    if (objs.length && min > objs.length && min - objs.length <= 3) blocks = blocks.map(b => ({ ...b, num: b.num - objs.length }));
    const guideFor = (q: SheetQuestion, label: string, text: string) =>
      items.push({ question_id: q.id, label, type: q.type, prompt: clip(q.prompt), display: clip(text.replace(/\n/g, " "), 220), answer: { ...q.answer, rubric: text }, replaces: Boolean(String(q.answer?.rubric ?? "").trim()) });
    const hasParts = blocks.some(b => b.part);
    if (hasParts && blocks.length === theoryQs.length) {
      // Each part (1a, 1b, …) is its own question in the exam.
      blocks.forEach((b, i) => guideFor(theoryQs[i]!, `Theory ${b.num}${b.part ?? ""}`, b.text));
    } else {
      // One question per number: its parts are joined into one marking guide.
      const byNum = new Map<number, TheoryBlock[]>();
      for (const b of blocks) byNum.set(b.num, [...(byNum.get(b.num) ?? []), b]);
      for (const [num, bs] of [...byNum.entries()].sort((a, b) => a[0] - b[0])) {
        const q = theoryQs[num - 1];
        if (!q) { warnings.push(`Theory ${num}: there is no theory question ${num} in this exam.`); continue; }
        guideFor(q, `Theory ${num}`, bs.map(b => (b.part ? `(${b.part}) ${b.text}` : b.text)).join("\n"));
      }
    }
  } else if (blocks.length) {
    warnings.push("Theory answers were found, but this exam has no theory (essay) questions to attach them to.");
  }
  const missing = objs.filter(q => !items.some(i => i.question_id === q.id) && !Object.keys(q.answer ?? {}).length).length;
  if (missing) warnings.push(`${missing} objective question${missing === 1 ? " still has" : "s still have"} no answer.`);
  return { items, warnings };
}
