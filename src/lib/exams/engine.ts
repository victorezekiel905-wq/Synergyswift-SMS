/**
 * Exam engine: question types, answer-key stripping, shuffling and
 * auto-marking. Pure functions (no I/O) — unit tested.
 *
 * Every type stores what students may see in `data` and the private key in
 * `answer`. Students only ever receive the output of `toPublicQuestion`.
 */
import { secureShuffle } from "../crypto";
import { equivalent, isValidExpression } from "./math";
import { compareEquations, parseEquation, isBalanced } from "./chem";
import { passageWords } from "./words";
export { passageWords };

export const QUESTION_TYPES = [
  { type: "mcq_single", label: "Multiple choice (one answer)", auto: true },
  { type: "mcq_multi", label: "Multiple choice (several answers)", auto: true },
  { type: "true_false", label: "True / False", auto: true },
  { type: "short_answer", label: "Short answer", auto: true },
  { type: "numeric", label: "Numeric (with tolerance)", auto: true },
  { type: "fill_blanks", label: "Fill in the blanks", auto: true },
  { type: "matching", label: "Matching pairs", auto: true },
  { type: "ordering", label: "Put in order", auto: true },
  { type: "hotspot", label: "Hotspot (click on image)", auto: true },
  { type: "math", label: "Maths input (equivalent answers accepted)", auto: true },
  { type: "drag_drop", label: "Drag and drop into groups", auto: true },
  { type: "matrix", label: "Grid (several statements, same choices)", auto: true },
  { type: "highlight", label: "Select words in a passage", auto: true },
  { type: "label_image", label: "Label the diagram", auto: true },
  { type: "graph_plot", label: "Plot points on a graph", auto: true },
  { type: "chem_equation", label: "Chemical equation", auto: true },
  { type: "rating", label: "Rating scale", auto: true },
  { type: "passage", label: "Reading passage or case study (no answer)", auto: true },
  { type: "essay", label: "Essay / long answer", auto: false },
  { type: "code", label: "Code answer", auto: false },
  { type: "drawing", label: "Drawing or geometric construction", auto: false },
  { type: "audio_response", label: "Spoken answer (recording)", auto: false },
  { type: "file_upload", label: "File upload", auto: false }
] as const;

export type QuestionType = (typeof QUESTION_TYPES)[number]["type"];

export type Option = { id: string; text: string };

export type Question = {
  id: string;
  type: QuestionType;
  prompt: string;
  points: number;
  media_url?: string | null;
  section?: string | null;
  position?: number;
  data: Record<string, any>;
  answer: Record<string, any>;
};

export type Mark = { points: number | null; max: number; auto: boolean; feedback?: string; runner?: boolean };

const norm = (s: unknown, caseSensitive = false) => {
  const t = String(s ?? "").trim().replace(/\s+/g, " ");
  return caseSensitive ? t : t.toLowerCase();
};

export function isAutoMarked(type: QuestionType): boolean {
  return QUESTION_TYPES.find(q => q.type === type)?.auto ?? false;
}


/**
 * Reads a typed number: "1,250", "9.8 m/s", "6.02e23", "6.02 × 10^23", "6.02x10^-3".
 * Returns the value and its significant figures (trailing zeros of a whole number do not count).
 */
export function readNumber(input: unknown): { value: number; sigFigs: number } | null {
  const s = String(input ?? "").trim().replace(/,/g, "").replace(/−/g, "-").replace(/\s+/g, " ");
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+))(?:\s*(?:[eE]|[x×*]\s*10\s*\^?\s*)([+-]?\d+))?/.exec(s);
  if (!m) return null;
  const mant = m[1].replace(/^[+-]/, "");
  const value = Number(`${m[1]}e${m[2] ?? 0}`);
  if (!Number.isFinite(value)) return null;
  let digits = mant.replace(".", "").replace(/^0+/, "");
  if (!mant.includes(".")) digits = digits.replace(/0+$/, "");
  return { value, sigFigs: Math.max(1, digits.length) };
}

/** Number of blanks in a fill-in-the-blanks passage, written as [[1]], [[2]] … or [[ ]] */
export function countBlanks(text: string): number {
  return (String(text ?? "").match(/\[\[[^\]]*\]\]/g) ?? []).length;
}

/**
 * Builds the per-attempt shuffle state. Ordering items are ALWAYS shuffled
 * (otherwise the question shows its own answer) and never left in the
 * correct order when there is more than one item.
 */
export function buildAttemptLayout(questions: Question[], opts: { shuffleQuestions?: boolean; shuffleOptions?: boolean; draw?: Record<string, number> }) {
  const ids = drawQuestions(questions, opts.draw).map(q => q.id);
  const question_order = opts.shuffleQuestions ? secureShuffle(ids) : ids;
  const option_orders: Record<string, string[]> = {};
  for (const q of questions) {
    if ((q.type === "mcq_single" || q.type === "mcq_multi") && opts.shuffleOptions) {
      option_orders[q.id] = secureShuffle((q.data.options ?? []).map((o: Option) => o.id));
    }
    if (q.type === "matching") {
      option_orders[q.id] = secureShuffle((q.data.right ?? []).map((o: Option) => o.id));
    }
    if (q.type === "drag_drop") {
      option_orders[q.id] = secureShuffle((q.data.items ?? []).map((o: Option) => o.id));
    }
    if (q.type === "label_image") {
      option_orders[q.id] = secureShuffle((q.data.labels ?? []).map((o: Option) => o.id));
    }
    if (q.type === "ordering") {
      const items: string[] = (q.data.items ?? []).map((o: Option) => o.id);
      let order = secureShuffle(items);
      for (let i = 0; i < 5 && items.length > 1 && order.join() === items.join(); i++) order = secureShuffle(items);
      if (items.length > 1 && order.join() === items.join()) order = [...items.slice(1), items[0]];
      option_orders[q.id] = order;
    }
  }
  return { question_order, option_orders };
}

/**
 * Question pools: `draw` maps a section name to how many of its questions each
 * student gets (chosen at random per student). Sections not listed, and
 * questions without a section, are always included. Exam order is kept.
 */
export function drawQuestions(questions: Question[], draw?: Record<string, number>): Question[] {
  if (!draw || !Object.keys(draw).length) return questions;
  const keep = new Set<string>();
  const bySection = new Map<string, Question[]>();
  for (const q of questions) {
    const n = q.section ? draw[q.section] : undefined;
    if (!q.section || n === undefined || n === null) { keep.add(q.id); continue; }
    bySection.set(q.section, [...(bySection.get(q.section) ?? []), q]);
  }
  bySection.forEach((pool, section) => {
    const n = Math.max(0, Math.floor(Number(draw[section])));
    for (const q of secureShuffle(pool).slice(0, n)) keep.add(q.id);
  });
  return questions.filter(q => keep.has(q.id));
}

/** The questions a given attempt was actually given (all of them when no layout was stored). */
export function questionsForAttempt(questions: Question[], attempt: { question_order?: string[] | null }): Question[] {
  const order = attempt.question_order ?? [];
  if (!order.length) return questions;
  const ids = new Set(order);
  return questions.filter(q => ids.has(q.id));
}

function reorder<T extends { id: string }>(list: T[], order?: string[]): T[] {
  if (!order?.length) return list;
  const byId = new Map(list.map(x => [x.id, x]));
  const out = order.map(id => byId.get(id)).filter(Boolean) as T[];
  for (const x of list) if (!order.includes(x.id)) out.push(x);
  return out;
}

/** What a student is allowed to see. Never includes `answer`. */
export function toPublicQuestion(q: Question, optionOrder?: string[]) {
  const d = q.data ?? {};
  const base = { id: q.id, type: q.type, prompt: q.prompt, points: Number(q.points), media_url: q.media_url ?? null, section: q.section ?? null };
  switch (q.type) {
    case "mcq_single":
    case "mcq_multi":
      return { ...base, data: { options: reorder(d.options ?? [], optionOrder) } };
    case "true_false":
      return { ...base, data: {} };
    case "short_answer":
      return { ...base, data: { max_length: d.max_length ?? 200 } };
    case "numeric":
      return { ...base, data: { unit: d.unit ?? null } };
    case "fill_blanks": {
      // Replace blank markers with numbered placeholders; accepted answers stay server-side.
      let i = 0;
      const text = String(d.text ?? "").replace(/\[\[[^\]]*\]\]/g, () => `[[${++i}]]`);
      return { ...base, data: { text, blanks: i, options: d.options ?? null } };
    }
    case "matching":
      return { ...base, data: { left: d.left ?? [], right: reorder(d.right ?? [], optionOrder) } };
    case "ordering":
      return { ...base, data: { items: reorder(d.items ?? [], optionOrder) } };
    case "hotspot":
      return { ...base, data: { image_url: d.image_url ?? q.media_url ?? null } };
    case "math":
      return { ...base, data: { hint: d.hint ?? null } };
    case "drag_drop":
      return { ...base, data: { items: reorder(d.items ?? [], optionOrder), zones: d.zones ?? [] } };
    case "essay":
      return { ...base, data: { min_words: d.min_words ?? null, max_words: d.max_words ?? null, rich: true } };
    case "code": {
      // Visible test cases are examples the student may see and run; hidden ones stay private.
      const tests: { input: string; expected: string; hidden?: boolean }[] = q.answer?.tests ?? [];
      return { ...base, data: { language: d.language ?? "python", starter: d.starter ?? "", has_tests: tests.length > 0,
        examples: tests.filter(t => !t.hidden).slice(0, 5).map(t => ({ input: t.input, expected: t.expected })) } };
    }
    case "file_upload":
      return { ...base, data: { accept: d.accept ?? ".pdf,.jpg,.jpeg,.png,.docx", max_mb: d.max_mb ?? 10 } };
    case "matrix":
      return { ...base, data: { rows: d.rows ?? [], cols: d.cols ?? [] } };
    case "highlight":
      return { ...base, data: { text: d.text ?? "", instruction: d.instruction ?? null } };
    case "label_image":
      return { ...base, data: { image_url: d.image_url ?? q.media_url ?? null, pins: d.pins ?? [], labels: reorder(d.labels ?? [], optionOrder) } };
    case "graph_plot":
      return { ...base, data: { x_min: d.x_min ?? -10, x_max: d.x_max ?? 10, y_min: d.y_min ?? -10, y_max: d.y_max ?? 10, step: d.step ?? 1, snap: d.snap !== false, join: Boolean(d.join), x_label: d.x_label ?? "x", y_label: d.y_label ?? "y", count: (q.answer?.points ?? []).length } };
    case "chem_equation":
      return { ...base, data: { hint: d.hint ?? null } };
    case "rating":
      return { ...base, data: { min: d.min ?? 1, max: d.max ?? 5, min_label: d.min_label ?? null, max_label: d.max_label ?? null } };
    case "passage":
      return { ...base, points: 0, data: {} };
    case "drawing":
      return { ...base, data: { grid: d.grid ?? "square", background_url: d.background_url ?? null } };
    case "audio_response":
      return { ...base, data: { max_seconds: Math.min(600, Math.max(10, Number(d.max_seconds ?? 120))) } };
  }
}

function clampPoints(p: number, max: number) {
  return Math.round(Math.max(0, Math.min(max, p)) * 100) / 100;
}

/** Marks one question. `points: null` means it needs a teacher. */
export function markQuestion(q: Question, response: unknown): Mark {
  const max = q.type === "passage" ? 0 : Number(q.points);
  const a = q.answer ?? {};
  const empty = response === undefined || response === null || response === "" ||
    (Array.isArray(response) && response.length === 0);

  if (!isAutoMarked(q.type)) {
    return { points: empty ? 0 : null, max, auto: empty };
  }
  if (empty) return { points: 0, max, auto: true };

  switch (q.type) {
    case "mcq_single":
      return { points: response === a.correct ? max : 0, max, auto: true };

    case "true_false": {
      const r = response === true || response === "true";
      return { points: r === Boolean(a.correct) ? max : 0, max, auto: true };
    }

    case "mcq_multi": {
      const correct = new Set<string>(a.correct ?? []);
      const chosen = new Set<string>(Array.isArray(response) ? (response as string[]) : []);
      if (!correct.size) return { points: 0, max, auto: true };
      let right = 0, wrong = 0;
      chosen.forEach(c => (correct.has(c) ? right++ : wrong++));
      if (a.partial) return { points: clampPoints(((right - wrong) / correct.size) * max, max), max, auto: true };
      const exact = right === correct.size && wrong === 0;
      return { points: exact ? max : 0, max, auto: true };
    }

    case "short_answer": {
      const cs = Boolean(a.case_sensitive);
      const accepted: string[] = (a.accepted ?? []).map((x: string) => norm(x, cs));
      return { points: accepted.includes(norm(response, cs)) ? max : 0, max, auto: true };
    }

    case "numeric": {
      const r = readNumber(response);
      if (!r) return { points: 0, max, auto: true };
      const target = Number(a.value);
      // Tolerance is ± an amount, or ± a percentage of the correct value (whichever the teacher set; the larger wins).
      const tol = Math.max(Math.abs(Number(a.tolerance ?? 0)), Math.abs(target) * Math.abs(Number(a.tolerance_pct ?? 0)) / 100);
      const scale = Math.max(1, Math.abs(target));
      if (Math.abs(r.value - target) > tol + 1e-9 * scale) return { points: 0, max, auto: true };
      // Right value but the wrong number of significant figures earns half marks.
      const sf = Number(a.sig_figs ?? 0);
      if (sf > 0 && r.sigFigs !== sf) return { points: clampPoints(max / 2, max), max, auto: true, feedback: `Give the answer to ${sf} significant figures.` };
      return { points: max, max, auto: true };
    }

    case "fill_blanks": {
      const blanks: string[][] = a.blanks ?? [];
      if (!blanks.length) return { points: 0, max, auto: true };
      const cs = Boolean(a.case_sensitive);
      const resp = Array.isArray(response) ? response : [];
      let ok = 0;
      blanks.forEach((acc, i) => { if (acc.map(x => norm(x, cs)).includes(norm(resp[i], cs))) ok++; });
      return { points: clampPoints((ok / blanks.length) * max, max), max, auto: true };
    }

    case "matching": {
      const pairs: Record<string, string> = a.pairs ?? {};
      const keys = Object.keys(pairs);
      if (!keys.length) return { points: 0, max, auto: true };
      const r = (response ?? {}) as Record<string, string>;
      const ok = keys.filter(k => r[k] === pairs[k]).length;
      return { points: clampPoints((ok / keys.length) * max, max), max, auto: true };
    }

    case "ordering": {
      const order: string[] = a.order ?? [];
      const r = Array.isArray(response) ? (response as string[]) : [];
      if (!order.length) return { points: 0, max, auto: true };
      if (a.partial === false) return { points: order.join() === r.join() ? max : 0, max, auto: true };
      const ok = order.filter((id, i) => r[i] === id).length;
      return { points: clampPoints((ok / order.length) * max, max), max, auto: true };
    }

    case "hotspot": {
      const p = (response ?? {}) as { x?: number; y?: number };
      const x = Number(p.x), y = Number(p.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return { points: 0, max, auto: true };
      const regions: { x: number; y: number; w: number; h: number }[] = a.regions ?? [];
      const hit = regions.some(g => x >= g.x && x <= g.x + g.w && y >= g.y && y <= g.y + g.h);
      return { points: hit ? max : 0, max, auto: true };
    }

    case "math": {
      const keys: string[] = [a.expression, ...(a.alternatives ?? [])].filter(Boolean);
      const tol = Number(a.tolerance ?? 1e-6);
      return { points: keys.some(k => equivalent(String(response), k, tol)) ? max : 0, max, auto: true };
    }

    case "drag_drop": {
      const placement: Record<string, string> = a.placement ?? {};
      const items = Object.keys(placement);
      if (!items.length) return { points: 0, max, auto: true };
      const r = (response ?? {}) as Record<string, string>;
      const ok = items.filter(i => r[i] === placement[i]).length;
      if (a.partial === false) return { points: ok === items.length ? max : 0, max, auto: true };
      return { points: clampPoints((ok / items.length) * max, max), max, auto: true };
    }

    case "matrix":
    case "label_image": {
      const key: Record<string, string> = (q.type === "matrix" ? a.correct : a.placement) ?? {};
      const rows = Object.keys(key);
      if (!rows.length) return { points: 0, max, auto: true };
      const r = (response ?? {}) as Record<string, string>;
      const ok = rows.filter(k => r[k] === key[k]).length;
      if (a.partial === false) return { points: ok === rows.length ? max : 0, max, auto: true };
      return { points: clampPoints((ok / rows.length) * max, max), max, auto: true };
    }

    case "highlight": {
      const correct = new Set<number>((a.correct ?? []).map(Number));
      if (!correct.size) return { points: 0, max, auto: true };
      const chosen = new Set<number>((Array.isArray(response) ? response : []).map(Number));
      let right = 0, wrong = 0;
      chosen.forEach(c => (correct.has(c) ? right++ : wrong++));
      if (a.partial === false) return { points: right === correct.size && !wrong ? max : 0, max, auto: true };
      return { points: clampPoints(((right - wrong) / correct.size) * max, max), max, auto: true };
    }

    case "graph_plot": {
      const expected: { x: number; y: number }[] = a.points ?? [];
      if (!expected.length) return { points: 0, max, auto: true };
      const given = (Array.isArray(response) ? response : []).map((p: any) => ({ x: Number(p?.x), y: Number(p?.y) })).filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
      const tol = Math.abs(Number(a.tolerance ?? 0));
      // Each expected point can be matched by one plotted point; extra points cancel matched ones.
      const used = new Set<number>();
      let matched = 0;
      for (const e of expected) {
        const k = given.findIndex((g, i) => !used.has(i) && Math.abs(g.x - e.x) <= tol + 1e-9 && Math.abs(g.y - e.y) <= tol + 1e-9);
        if (k >= 0) { used.add(k); matched++; }
      }
      const extra = given.length - used.size;
      if (a.partial === false) return { points: matched === expected.length && !extra ? max : 0, max, auto: true };
      return { points: clampPoints(((matched - extra) / expected.length) * max, max), max, auto: true };
    }

    case "chem_equation": {
      const keys: string[] = [a.equation, ...(a.alternatives ?? [])].filter(Boolean);
      let best = 0;
      let feedback: string | undefined;
      for (const k of keys) {
        let c;
        try { c = compareEquations(String(response), k, { states: Boolean(a.states), acceptMultiples: Boolean(a.accept_multiples) }); } catch { continue; }
        if (c.species && c.coefficients) { best = max; feedback = undefined; break; }
        // Right substances, wrong numbers: the teacher's share of the marks (half by default).
        if (c.species) {
          const share = a.species_credit === undefined ? 0.5 : Math.max(0, Math.min(1, Number(a.species_credit)));
          if (share * max > best) { best = share * max; feedback = "Correct substances, but the equation is not balanced as required."; }
        }
      }
      return { points: clampPoints(best, max), max, auto: true, ...(feedback ? { feedback } : {}) };
    }

    case "rating": {
      const v = Number(response);
      if (!Number.isFinite(v)) return { points: 0, max, auto: true };
      // No correct value: any answer earns the marks (an opinion or self-rating).
      if (a.correct === undefined || a.correct === null || a.correct === "") return { points: max, max, auto: true };
      return { points: v === Number(a.correct) ? max : 0, max, auto: true };
    }

    case "passage":
      return { points: 0, max: 0, auto: true };
  }
  return { points: null, max, auto: false };
}

/**
 * Marks a whole attempt. Teacher overrides in `existing` (auto: false with a
 * numeric value) are preserved so re-marking never wipes manual grading.
 */
export function markAttempt(questions: Question[], answers: Record<string, unknown>, existing: Record<string, Mark> = {}) {
  const marks: Record<string, Mark> = {};
  let auto_score = 0, total = 0, max = 0, pending = 0;
  for (const q of questions) {
    const prev = existing[q.id];
    let m = markQuestion(q, answers[q.id]);
    // Teacher marks and code-runner results are kept; everything else is re-marked.
    if (prev && (prev.auto === false || prev.runner) && prev.points !== null && prev.points !== undefined) {
      m = { ...prev, max: Number(q.points) };
    }
    marks[q.id] = m;
    max += m.max;
    if (m.points === null) pending++;
    else {
      total += m.points;
      if (m.auto) auto_score += m.points;
    }
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return { marks, auto_score: r2(auto_score), total_score: r2(total), max_score: r2(max), pending };
}

/** Validates a question authored by a teacher. Returns problems (empty = ok). */
export function validateQuestion(q: Pick<Question, "type" | "prompt" | "points" | "data" | "answer">): string[] {
  const p: string[] = [];
  const d = q.data ?? {}, a = q.answer ?? {};
  if (!String(q.prompt ?? "").trim()) p.push("Question text is required.");
  if (!(Number(q.points) >= 0)) p.push("Points must be zero or more.");
  switch (q.type) {
    case "mcq_single":
      if ((d.options ?? []).length < 2) p.push("Add at least two options.");
      if (!(d.options ?? []).some((o: Option) => o.id === a.correct)) p.push("Mark the correct option.");
      break;
    case "mcq_multi":
      if ((d.options ?? []).length < 2) p.push("Add at least two options.");
      if (!(a.correct ?? []).length) p.push("Mark at least one correct option.");
      break;
    case "true_false":
      if (typeof a.correct !== "boolean") p.push("Choose True or False as the answer.");
      break;
    case "short_answer":
      if (!(a.accepted ?? []).filter((x: string) => x.trim()).length) p.push("Add at least one accepted answer.");
      break;
    case "numeric":
      if (!Number.isFinite(Number(a.value))) p.push("Enter the correct numeric value.");
      break;
    case "fill_blanks": {
      const n = countBlanks(d.text ?? "");
      if (!n) p.push("Mark blanks in the text with [[answer]].");
      if ((a.blanks ?? []).length !== n) p.push("Every blank needs accepted answers.");
      break;
    }
    case "matching":
      if ((d.left ?? []).length < 2) p.push("Add at least two pairs.");
      break;
    case "ordering":
      if ((d.items ?? []).length < 2) p.push("Add at least two items.");
      break;
    case "hotspot":
      if (!d.image_url) p.push("Add an image URL.");
      if (!(a.regions ?? []).length) p.push("Draw at least one correct region.");
      break;
    case "math":
      if (!String(a.expression ?? "").trim()) p.push("Enter the correct expression.");
      else if (!isValidExpression(a.expression)) p.push("The correct expression could not be read. Use + - * / ^ and brackets.");
      for (const alt of a.alternatives ?? []) if (alt && !isValidExpression(alt)) p.push(`Alternative "${alt}" could not be read.`);
      break;
    case "code":
      if ((a.tests ?? []).some((t: { expected?: string }) => !String(t.expected ?? "").trim())) p.push("Every test case needs the expected output.");
      if ((a.tests ?? []).length > 20) p.push("Use at most 20 test cases.");
      break;
    case "drag_drop": {
      const zones: Option[] = d.zones ?? [], items: Option[] = d.items ?? [];
      if (zones.length < 2) p.push("Add at least two groups.");
      if (items.length < 2) p.push("Add at least two items.");
      if (items.some(i => !zones.some(z => z.id === a.placement?.[i.id]))) p.push("Put every item in its correct group.");
      break;
    }
    case "matrix": {
      const rows: Option[] = d.rows ?? [], cols: Option[] = d.cols ?? [];
      if (rows.length < 1) p.push("Add at least one statement.");
      if (cols.length < 2) p.push("Add at least two choices.");
      if (rows.some(r => !cols.some(c => c.id === a.correct?.[r.id]))) p.push("Choose the correct answer for every statement.");
      break;
    }
    case "highlight": {
      const n = passageWords(d.text ?? "").length;
      if (!n) p.push("Enter the passage.");
      if (!(a.correct ?? []).length) p.push("Click the words students should select.");
      if ((a.correct ?? []).some((i: number) => i < 0 || i >= n)) p.push("The passage changed; select the correct words again.");
      break;
    }
    case "label_image": {
      const pins: Option[] = d.pins ?? [], labels: Option[] = d.labels ?? [];
      if (!d.image_url) p.push("Add the diagram's image URL.");
      if (pins.length < 1) p.push("Click on the diagram to add at least one numbered point.");
      if (labels.length < pins.length) p.push("Add a label for every point (extra labels make it harder).");
      if (pins.some(pin => !labels.some(l => l.id === a.placement?.[pin.id]))) p.push("Choose the correct label for every point.");
      break;
    }
    case "graph_plot": {
      const [x0, x1, y0, y1] = [d.x_min, d.x_max, d.y_min, d.y_max].map(Number);
      if (![x0, x1, y0, y1].every(Number.isFinite) || x0 >= x1 || y0 >= y1) p.push("Set the axes so each minimum is below its maximum.");
      if (!(Number(d.step) > 0)) p.push("The grid step must be more than zero.");
      if (!(a.points ?? []).length) p.push("Add the points students must plot.");
      if ((a.points ?? []).some((pt: { x: number; y: number }) => pt.x < x0 || pt.x > x1 || pt.y < y0 || pt.y > y1)) p.push("Every correct point must be inside the axes.");
      break;
    }
    case "chem_equation":
      try {
        const eq = parseEquation(a.equation ?? "");
        if (!isBalanced(eq)) p.push("The correct equation is not balanced (atoms or charge differ). Check it.");
      } catch (e) { p.push(`The correct equation could not be read: ${(e as Error).message}.`); }
      break;
    case "rating":
      if (!(Number(d.max) > Number(d.min))) p.push("The top of the scale must be above the bottom.");
      if (Number(d.max) - Number(d.min) > 10) p.push("Use a scale of at most 11 points.");
      break;
    case "passage":
      if (Number(q.points) !== 0) p.push("A reading passage carries no marks; set points to 0.");
      break;
    case "audio_response":
      if (!(Number(d.max_seconds) >= 10 && Number(d.max_seconds) <= 600)) p.push("Recording length must be between 10 and 600 seconds.");
      break;
  }
  if (q.type === "numeric") {
    if (Number(a.tolerance_pct ?? 0) < 0 || Number(a.tolerance_pct ?? 0) > 50) p.push("Percentage tolerance must be between 0 and 50.");
    if (a.sig_figs !== undefined && a.sig_figs !== null && !(Number.isInteger(Number(a.sig_figs)) && Number(a.sig_figs) >= 0 && Number(a.sig_figs) <= 10)) p.push("Significant figures must be a whole number up to 10.");
  }
  return p;
}

/**
 * Helper for the builder: turn "Paris|paris city" style blanks in text like
 * "The capital of France is [[Paris|Paris city]]" into data + answer.
 */
export function parseFillBlanks(text: string) {
  const blanks: string[][] = [];
  String(text ?? "").replace(/\[\[([^\]]*)\]\]/g, (_m, inner: string) => {
    blanks.push(inner.split("|").map(s => s.trim()).filter(Boolean));
    return "";
  });
  return { data: { text }, answer: { blanks } };
}

/** Word count used for essay limits. */
export function wordCount(s: string): number {
  return String(s ?? "").replace(/<[^>]+>/g, " ").trim().split(/\s+/).filter(Boolean).length;
}

/** The correct answer in words, for practice feedback (never sent during a real exam). */
export function describeAnswer(q: Pick<Question, "type" | "data" | "answer">): string {
  const d = q.data ?? {}, a = q.answer ?? {};
  const text = (list: Option[] | undefined, id: string) => (list ?? []).find(o => o.id === id)?.text ?? "";
  switch (q.type) {
    case "mcq_single": return text(d.options, a.correct);
    case "mcq_multi": return (a.correct ?? []).map((id: string) => text(d.options, id)).join("; ");
    case "true_false": return a.correct ? "True" : "False";
    case "short_answer": return (a.accepted ?? []).join(" or ");
    case "numeric": return `${a.value}${a.tolerance ? ` (± ${a.tolerance})` : a.tolerance_pct ? ` (± ${a.tolerance_pct}%)` : ""}${d.unit ? ` ${d.unit}` : ""}${a.sig_figs ? `, ${a.sig_figs} s.f.` : ""}`;
    case "matrix": return (d.rows ?? []).map((r: Option) => `${r.text}: ${text(d.cols, a.correct?.[r.id])}`).join("; ");
    case "label_image": return (d.pins ?? []).map((p: Option, i: number) => `${i + 1}. ${text(d.labels, a.placement?.[p.id])}`).join("; ");
    case "highlight": { const w = passageWords(d.text ?? ""); return (a.correct ?? []).map((i: number) => w[i]).filter(Boolean).join(", "); }
    case "graph_plot": return (a.points ?? []).map((p: { x: number; y: number }) => `(${p.x}, ${p.y})`).join(" ");
    case "chem_equation": return String(a.equation ?? "");
    case "rating": return a.correct === undefined || a.correct === null ? "Any answer" : String(a.correct);
    case "passage": return "";
    case "fill_blanks": return (a.blanks ?? []).map((b: string[], i: number) => `${i + 1}. ${b.join(" / ")}`).join("  ");
    case "matching": return Object.entries(a.pairs ?? {}).map(([l, r]) => `${text(d.left, l)} → ${text(d.right, r as string)}`).join("; ");
    case "ordering": return (a.order ?? []).map((id: string) => text(d.items, id)).join(" → ");
    case "drag_drop": return (d.zones ?? []).map((z: Option) => `${z.text}: ${(d.items ?? []).filter((i: Option) => a.placement?.[i.id] === z.id).map((i: Option) => i.text).join(", ")}`).join("; ");
    case "math": return String(a.expression ?? "");
    case "hotspot": return "The highlighted area on the image.";
    default: return String(a.reference ?? a.rubric ?? "");
  }
}
