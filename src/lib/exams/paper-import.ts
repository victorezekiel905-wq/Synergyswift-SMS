/**
 * Turns an exam paper typed as text (from a PDF, Word file or paste) into
 * draft questions (phase 14j). Pure, unit tested. It understands the usual
 * school and WAEC/NECO/JAMB layout:
 *   - numbered questions: "1.", "1)", "Q1.", "Question 1:"
 *   - options on their own lines or inline: "A. 4", "(b) 5", "C) 6"
 *   - answers after a question ("Answer: B", "Ans - C") or an answer key at
 *     the end ("ANSWERS 1. B 2. C 3-A" or "1 B, 2 C")
 *   - "SECTION B", "THEORY", "ESSAY", "PART II" start long-answer questions
 *   - marks in brackets: "(5 marks)", "[10]"
 * Everything is a draft: the teacher checks it before saving.
 */

export type DraftQuestion = {
  number: number;
  type: "mcq_single" | "true_false" | "short_answer" | "essay";
  prompt: string;
  points: number;
  section: string | null;
  data: Record<string, unknown>;
  answer: Record<string, unknown>;
  /** What the teacher should look at. */
  notes: string[];
};

const LETTERS = ["A", "B", "C", "D", "E", "F"];
const QSTART = /^\s*(?:q(?:uestion)?\.?\s*)?(\d{1,3})\s*[.):\]]\s*(.*)$/i;
const OPT = /^\s*\(?([a-fA-F])[.)\]]\s+(.+)$/;
const INLINE_OPT = /(?:^|\s)\(?([A-F])[.)]\s+/g;
const ANSWER = /^\s*(?:correct\s+)?ans(?:wer)?s?\s*[:\-–=]\s*\(?([a-fA-F]|true|false|.+?)\)?\s*$/i;
const KEY_HEAD = /^\s*(answers?|answer\s+key|key|marking\s+scheme|solutions?)\s*:?\s*$/i;
const THEORY = /^\s*(section\s+(b|c|ii|2)|part\s+(b|ii|2)|theory|essay|structured|long\s+answers?)\b/i;
const OBJECTIVE = /^\s*(section\s+(a|i|1)|part\s+(a|i|1)|objectives?|multiple\s+choice)\b/i;
const MARKS = /[([]\s*(\d{1,3})\s*(?:marks?|mks?|pts?|points?)?\s*[)\]]\s*$/i;
const PICTURE = /\b(diagram|figure|fig\.|graph above|table above|picture|shown below|shown above)\b/i;

/** Splits "What is 2+2? A. 3 B. 4 C. 5 D. 6" into the stem and its options. */
function splitInline(text: string): { stem: string; options: string[] } | null {
  const hits = [...text.matchAll(INLINE_OPT)];
  if (hits.length < 2) return null;
  const letters = hits.map(h => h[1]!);
  if (letters[0] !== "A" || letters.some((l, i) => l !== LETTERS[i])) return null;
  const stem = text.slice(0, hits[0]!.index).trim();
  const options = hits.map((h, i) => text.slice(h.index! + h[0].length, i + 1 < hits.length ? hits[i + 1]!.index : undefined).trim());
  return stem && options.every(Boolean) ? { stem, options } : null;
}

/** "1. B 2. C 3-A", "1 B, 2 C", "1) b" → { 1: "B", 2: "C", 3: "A" }. */
export function parseKey(text: string): Record<number, string> {
  const out: Record<number, string> = {};
  for (const m of text.matchAll(/(\d{1,3})\s*[.):\-–]?\s*\(?([a-fA-F]|true|false)\)?(?=[\s,;]|$)/gi)) out[Number(m[1])] = m[2]!.length === 1 ? m[2]!.toUpperCase() : m[2]!.toLowerCase();
  return out;
}

export function parsePaper(raw: string, opts: { defaultPoints?: number; theoryPoints?: number } = {}): { questions: DraftQuestion[]; warnings: string[] } {
  const lines = raw.replace(/\r/g, "").replace(/ /g, " ").split("\n").map(l => l.replace(/\s+$/, ""));
  const warnings: string[] = [];
  type Block = { number: number; lines: string[]; section: string | null; theory: boolean };
  const blocks: Block[] = [];
  let section: string | null = null, theory = false, key: Record<number, string> = {}, inKey = false;
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (KEY_HEAD.test(t)) { inKey = true; continue; }
    if (inKey) {
      // "5. Abuja" is a written answer; "1. B 2. C" is a run of letters.
      const whole = t.match(/^(\d{1,3})\s*[.):\-–]\s*(.{2,})$/);
      if (whole && !/^\(?[a-f]\)?(\s|$)/i.test(whole[2]!) && !/^(true|false)$/i.test(whole[2]!)) key[Number(whole[1])] = whole[2]!.trim(); else Object.assign(key, parseKey(t));
      continue;
    }
    if (THEORY.test(t) && !QSTART.test(t)) { theory = true; section = t.replace(/[:.]\s*$/, ""); continue; }
    if (OBJECTIVE.test(t) && !QSTART.test(t)) { theory = false; section = t.replace(/[:.]\s*$/, ""); continue; }
    const q = t.match(QSTART);
    // A new question when the number follows on (or a new section restarts at 1).
    const last = blocks[blocks.length - 1];
    if (q && (!last || (Number(q[1]) > last.number && Number(q[1]) <= last.number + 3) || Number(q[1]) === 1 || (last.section !== section))) {
      blocks.push({ number: Number(q[1]), lines: [q[2] ?? ""], section, theory });
      continue;
    }
    if (!last) continue;   // the paper heading and instructions
    last.lines.push(t);
  }
  const questions: DraftQuestion[] = [];
  for (const b of blocks) {
    const notes: string[] = [];
    const stemLines: string[] = [], options: string[] = [];
    let answer: string | null = null;
    for (const l of b.lines) {
      const a = l.match(ANSWER);
      if (a) { answer = a[1]!.trim(); continue; }
      const o = l.match(OPT);
      if (o && !b.theory && o[1]!.toUpperCase() === LETTERS[options.length]) { options.push(o[2]!.trim()); continue; }
      if (options.length && !b.theory) { options[options.length - 1] += ` ${l}`; continue; }
      stemLines.push(l);
    }
    let prompt = stemLines.join("\n").trim();
    if (!options.length && !b.theory) {
      const inline = splitInline(prompt.replace(/\n/g, " "));
      if (inline) { prompt = inline.stem; options.push(...inline.options); }
    }
    let points = b.theory ? opts.theoryPoints ?? 10 : opts.defaultPoints ?? 1;
    const mk = prompt.match(MARKS);
    if (mk) { points = Number(mk[1]); prompt = prompt.replace(MARKS, "").trim(); }
    if (PICTURE.test(prompt)) notes.push("Mentions a picture or diagram: add it after importing.");
    // The answer key belongs to the objective questions; theory answers come only from the question itself.
    const keyed = answer ?? (b.theory ? null : key[b.number] ?? null);
    const base = { number: b.number, prompt, points, section: b.section, notes };
    if (!prompt) { warnings.push(`Question ${b.number} has no text and was left out.`); continue; }
    const tf = options.length === 2 && /^true$/i.test(options[0]!) && /^false$/i.test(options[1]!);
    if (tf || (!options.length && !b.theory && keyed && /^(true|false)$/i.test(keyed))) {
      const correct = keyed ? (/^(a|true)$/i.test(keyed) ? true : /^(b|false)$/i.test(keyed) ? false : null) : null;
      if (correct === null) notes.push("Choose True or False as the answer.");
      questions.push({ ...base, type: "true_false", data: {}, answer: correct === null ? {} : { correct } });
    } else if (options.length >= 2) {
      const opt = options.map((text, i) => ({ id: `o${i + 1}`, text }));
      const idx = keyed && keyed.length === 1 ? LETTERS.indexOf(keyed.toUpperCase()) : -1;
      if (idx < 0 || idx >= opt.length) notes.push("No answer found: mark the correct option.");
      questions.push({ ...base, type: "mcq_single", data: { options: opt }, answer: idx >= 0 && idx < opt.length ? { correct: opt[idx]!.id } : {} });
    } else if (b.theory || prompt.length > 160 || /\b(explain|discuss|describe|write|essay|compare|why)\b/i.test(prompt)) {
      questions.push({ ...base, type: "essay", data: {}, answer: keyed ? { guide: keyed } : {} });
    } else {
      if (!keyed) notes.push("Add the accepted answer.");
      questions.push({ ...base, type: "short_answer", data: { max_length: 200 }, answer: keyed ? { accepted: [keyed] } : { accepted: [] } });
    }
  }
  const numbers = questions.map(q => q.number);
  for (let i = 1; i < numbers.length; i++) if (numbers[i]! !== numbers[i - 1]! + 1 && numbers[i] !== 1) warnings.push(`Question numbers jump from ${numbers[i - 1]} to ${numbers[i]}: check nothing is missing.`);
  if (!questions.length) warnings.push("No numbered questions were found. Questions should start with a number, like \"1.\" or \"1)\".");
  return { questions, warnings };
}
