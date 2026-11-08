/**
 * Tidies multiple-choice questions pasted from anywhere (Word, a PDF, WhatsApp, a
 * website) into one plain layout that the exam and live-lesson importers both read:
 *
 *   1. What is the capital of Nigeria?
 *   A. Lagos
 *   B. Abuja
 *   Answer: B
 *
 * It splits options written on one line ("A. 3  B. 4", "(a) H2O (b) CO2"), turns
 * "Ans B", "Correct answer is (b)" and "Key: B" into "Answer: B", turns a single
 * starred or ticked option into "Answer: …", moves an answer key at the end onto
 * each question, and (for papers) numbers questions that have no numbers. Text it
 * doesn't recognise is left exactly as it was. Pure, unit tested.
 */

const WORD_MARK = ""; // formatting marks from a Word file (see src/live/lib/question-import.ts)
const QSTART = /^\s*(?:q(?:uestion|n|s)?\.?\s*)?(\d{1,3})\s*[.):\]](?:\s+|$|(?=[A-Za-z("“'‘]))/i;
const OPTION_LINE = /^(\s*)\(?\s*([a-hA-H])\s*[.)\]:]\s+(.*)$/;
const NOT_OPTION = /^\s*(e\.g\.|i\.e\.|a\.m\.|b\.sc|b\.a\.)/i;
const META = /^\s*(answers?|ans|correct\s+answers?|correct|key|solution|type|question\s+type|kind|topic|points?|marks?|score|explanation|reason|why|feedback)\s*[:=\-–]/i;
// "Ans B", "Ans. (b)", "Answer is B", "Correct answer - C", "Key: D", "Right option = A", "Answer: B."
const LETTER_ANSWER = /^\s*(?:the\s+)?(?:(?:(?:correct|right)\s+)?(?:ans(?:wer)?s?|key)|(?:correct|right)\s+option)\s*(?:is\b|[:=\-–.])?\s*\(?\s*([a-hA-H])\s*\)?\s*\.?\s*$/i;
const ANSWER_LINE = /^\s*(?:the\s+)?(?:correct\s+|right\s+)?ans(?:wer)?s?\s*(?:is\b|[:=\-–])/i;
const KEY_HEAD = /^\s*(?:answers?|answer\s*key|keys?|marking\s+(?:scheme|guide)|solutions?|correct\s+answers?)\s*[:\-–]?\s*$/i;
const KEY_INLINE = /^\s*(?:answers?|answer\s*key|keys?)\s*[:\-–]\s*(\d.*)$/i;
const KEY_ENTRIES = /(\d{1,3})\s*[.):\-–=]?\s*\(?([a-hA-H]|true|false)\)?(?=[\s,;.]|$)/gi;
const STAR = /^\s*\*\s*|\s*(?:\*+|✓|✔|\((?:correct|answer|right)\)|\[(?:correct|answer|right)\])\s*$/i;
const THEORY = /^\s*(section\s+(b|c|ii|2)|part\s+(b|ii|2)|theory|essay|structured|long\s+answers?)\b/i;
const STARRED = /^\s*\*|(?:\*+|✓|✔|\((?:correct|answer|right)\)|\[(?:correct|answer|right)\])\s*$/i;

const isOption = (l: string) => !NOT_OPTION.test(l) && OPTION_LINE.test(l);
const isAnswer = (l: string) => LETTER_ANSWER.test(l) || ANSWER_LINE.test(l);

/** "2 + 2 = ?  A. 3  B. 4  C. 5" → ["2 + 2 = ?", "A. 3", "B. 4", "C. 5"]; null when the line isn't a run of options. */
export function splitInlineOptions(line: string): string[] | null {
  if (line.includes(WORD_MARK)) return null;
  const re = /(^|\s)\(?([a-hA-H])[.)]\s+/g;
  const hits: { at: number; end: number; letter: string; style: string }[] = [];
  for (let m = re.exec(line); m; m = re.exec(line)) {
    const at = m.index + m[1]!.length;
    hits.push({ at, end: m.index + m[0].length, letter: m[2]!, style: `${line[at] === "(" ? "(" : ""}${m[0].trim().slice(-1)}${m[2] === m[2]!.toUpperCase() ? "U" : "l"}` });
  }
  // A run starts at a/A, goes on in order and keeps one style, so "Vitamin A. B is…" is left alone.
  const start = hits.findIndex(h => h.letter.toLowerCase() === "a");
  if (start < 0) return null;
  const run = [hits[start]!];
  for (const h of hits.slice(start + 1)) {
    if (h.letter.toLowerCase() === String.fromCharCode(97 + run.length) && h.style === run[0]!.style) run.push(h);
  }
  if (run.length < 2) return null;
  const options = run.map((h, i) => line.slice(h.end, run[i + 1]?.at ?? line.length).trim());
  if (options.some(o => !o)) return null;
  const stem = line.slice(0, run[0]!.at).trim();
  // "1. Define (a) osmosis (b) diffusion" is a question in parts, not a choice of answers.
  if (run[0]!.style.startsWith("(") && /^\s*(?:\d{1,3}[.)]\s*)?(define|explain|describe|state|list|outline|discuss|differentiate|distinguish|compare|mention|write\s+(?:short\s+)?notes?)\b/i.test(stem) && !/\?\s*$/.test(stem)) return null;
  return [...(stem ? [stem] : []), ...options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`)];
}

/** "1. B 2. C 3-A", "1) b, 2) true" → { 1: "B", 2: "true" }. */
export function readKey(text: string): Record<number, string> {
  const out: Record<number, string> = {};
  for (const m of text.matchAll(KEY_ENTRIES)) out[Number(m[1])] = m[2]!.length === 1 ? m[2]!.toUpperCase() : m[2]!.toLowerCase();
  return out;
}

/** An answer key at the end ("ANSWERS" then "1. B 2. C…"): the key, and the lines without it. */
function takeKey(lines: string[]): { key: Record<number, string>; lines: string[] } {
  for (let i = lines.length - 1; i >= 0; i--) {
    const t = lines[i]!.trim();
    const inline = KEY_INLINE.exec(t);
    if (inline && Object.keys(readKey(inline[1]!)).length >= 2) return { key: readKey(inline[1]!), lines: [...lines.slice(0, i), ...lines.slice(i + 1)] };
    if (!KEY_HEAD.test(t)) continue;
    const rest = lines.slice(i + 1).map(l => l.trim()).filter(Boolean);
    const key: Record<number, string> = {};
    for (const r of rest) {
      // "5. Abuja" is a written answer; "1. B 2. C" a run of letters.
      const whole = /^(\d{1,3})\s*[.):\-–]\s*(.{2,})$/.exec(r);
      if (whole && !/^\(?[a-h]\)?([\s,;.]|$)/i.test(whole[2]!) && !/^(true|false)\b/i.test(whole[2]!)) key[Number(whole[1])] = whole[2]!.trim();
      else if (/^\d/.test(r) && Object.keys(readKey(r)).length) Object.assign(key, readKey(r));
      else return { key: {}, lines };   // not a key after all
    }
    return Object.keys(key).length ? { key, lines: lines.slice(0, i) } : { key: {}, lines };
  }
  return { key: {}, lines };
}

export function tidyPastedQuestions(raw: string, opts: { numberUnnumbered?: boolean } = {}): string {
  const clean = raw.replace(/\r\n?/g, "\n").replace(/[   ]/g, " ").replace(/[​⁠﻿]/g, "").replace(/\t/g, "  ").split("\n");
  const { key, lines: all } = takeKey(clean);
  // A theory / Section B part has sub-questions like "(a) Define… (b) Explain…": it is left exactly as written.
  const theoryAt = all.findIndex(l => THEORY.test(l) && !QSTART.test(l));
  const body = theoryAt < 0 ? all : all.slice(0, theoryAt), theory = theoryAt < 0 ? [] : all.slice(theoryAt);
  // One option per line.
  const lines = body.flatMap(l => splitInlineOptions(l) ?? [l]);

  // Answers, question by question: short forms, a single starred option, the key.
  const out: string[] = [];
  type Q = { number: number | null; answered: boolean; starred: { letter: string; at: number }[]; options: number; gap: boolean };
  const fresh = (number: number | null): Q => ({ number, answered: false, starred: [], options: 0, gap: false });
  let q = fresh(null);
  const close = () => {
    if (q.answered) return;
    const keyed = q.number !== null ? key[q.number] : undefined;
    if (q.options && q.starred.length === 1) {
      // Strip the mark from the option's own text: a leading star ("b) *Mercury") sits after the letter,
      // where a pattern applied to the whole line can't see it.
      const ln = out[q.starred[0]!.at]!, om = OPTION_LINE.exec(ln);
      out[q.starred[0]!.at] = om ? ln.slice(0, ln.lastIndexOf(om[3]!)) + om[3]!.replace(STAR, "") : ln.replace(STAR, "");
      out.push(`Answer: ${q.starred[0]!.letter}`);
    } else if (q.options && !q.starred.length && keyed) out.push(`Answer: ${keyed}`);
    else if (!q.options && keyed && !/^[A-H]$/.test(keyed)) out.push(`Answer: ${keyed}`);   // a written answer
  };
  for (const line of lines) {
    const t = line.trim();
    if (!t) { q.gap = true; out.push(line); continue; }
    if (QSTART.test(line)) { close(); q = fresh(Number(QSTART.exec(line)![1])); out.push(line); continue; }
    const letter = LETTER_ANSWER.exec(t);
    if (letter && q.options) { out.push(`Answer: ${letter[1]!.toUpperCase()}`); q.answered = true; continue; }
    if (isAnswer(t)) { q.answered = true; out.push(line); continue; }
    if (isOption(line)) {
      const m = OPTION_LINE.exec(line)!;
      if (STARRED.test(m[3]!)) q.starred.push({ letter: m[2]!.toUpperCase(), at: out.length });
      q.options++; q.gap = false;
      out.push(line);
      continue;
    }
    // After the options, a line starts the next (unnumbered) question when it comes after a gap,
    // after the answer, or reads as a question; otherwise it continues the last option.
    if (q.options && !META.test(t) && (q.gap || q.answered || /[?=:]\s*$|_{3,}/.test(t))) { close(); q = fresh(null); }
    out.push(line);
  }
  close();
  out.push(...theory);

  if (!opts.numberUnnumbered || out.some(l => QSTART.test(l)) || !out.some(isOption)) return out.join("\n");

  // Papers need numbers: number the questions when none are numbered.
  // Does the text starting at line i run straight into options (a question, maybe over several lines)?
  const opensQuestion = (i: number) => {
    for (let j = i + 1; j < out.length; j++) {
      const l = out[j]!;
      if (!l.trim() || isAnswer(l.trim()) || META.test(l)) return false;
      if (isOption(l)) return true;
    }
    return false;
  };
  const numbered: string[] = [];
  let n = 0, prev: "start" | "text" | "option" | "answer" | "blank" = "start", seenOptions = false;
  out.forEach((line, i) => {
    const t = line.trim();
    if (!t) { numbered.push(line); if (prev !== "start") prev = "blank"; return; }
    if (isOption(line)) { numbered.push(line); prev = "option"; seenOptions = true; return; }
    if (isAnswer(t) || META.test(t)) { numbered.push(line); prev = "answer"; return; }
    // Text right after an option continues it, unless it reads as a question; text after text continues the question.
    const canStart = prev === "start" || prev === "blank" || prev === "answer" || (prev === "option" && /[?=:]\s*$|_{3,}/.test(t));
    const startsQuestion = canStart && (opensQuestion(i) || prev === "answer" || (prev === "blank" && seenOptions) || prev === "option");
    numbered.push(startsQuestion ? `${++n}. ${t}` : line);
    prev = "text";
  });
  return numbered.join("\n");
}
