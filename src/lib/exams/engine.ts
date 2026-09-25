/**
 * Exam engine: question types, answer-key stripping, shuffling and
 * auto-marking. Pure functions (no I/O) — unit tested.
 *
 * Every type stores what students may see in `data` and the private key in
 * `answer`. Students only ever receive the output of `toPublicQuestion`.
 */
import { secureShuffle } from "../crypto";

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
  { type: "essay", label: "Essay / long answer", auto: false },
  { type: "code", label: "Code answer", auto: false },
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

export type Mark = { points: number | null; max: number; auto: boolean; feedback?: string };

const norm = (s: unknown, caseSensitive = false) => {
  const t = String(s ?? "").trim().replace(/\s+/g, " ");
  return caseSensitive ? t : t.toLowerCase();
};

export function isAutoMarked(type: QuestionType): boolean {
  return QUESTION_TYPES.find(q => q.type === type)?.auto ?? false;
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
export function buildAttemptLayout(questions: Question[], opts: { shuffleQuestions?: boolean; shuffleOptions?: boolean }) {
  const ids = questions.map(q => q.id);
  const question_order = opts.shuffleQuestions ? secureShuffle(ids) : ids;
  const option_orders: Record<string, string[]> = {};
  for (const q of questions) {
    if ((q.type === "mcq_single" || q.type === "mcq_multi") && opts.shuffleOptions) {
      option_orders[q.id] = secureShuffle((q.data.options ?? []).map((o: Option) => o.id));
    }
    if (q.type === "matching") {
      option_orders[q.id] = secureShuffle((q.data.right ?? []).map((o: Option) => o.id));
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
    case "essay":
      return { ...base, data: { min_words: d.min_words ?? null, max_words: d.max_words ?? null, rich: true } };
    case "code":
      return { ...base, data: { language: d.language ?? "python", starter: d.starter ?? "" } };
    case "file_upload":
      return { ...base, data: { accept: d.accept ?? ".pdf,.jpg,.jpeg,.png,.docx", max_mb: d.max_mb ?? 10 } };
  }
}

function clampPoints(p: number, max: number) {
  return Math.round(Math.max(0, Math.min(max, p)) * 100) / 100;
}

/** Marks one question. `points: null` means it needs a teacher. */
export function markQuestion(q: Question, response: unknown): Mark {
  const max = Number(q.points);
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
      const r = Number(String(response).replace(/,/g, "").trim());
      if (!Number.isFinite(r)) return { points: 0, max, auto: true };
      const tol = Math.abs(Number(a.tolerance ?? 0));
      return { points: Math.abs(r - Number(a.value)) <= tol + 1e-9 ? max : 0, max, auto: true };
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
    if (prev && prev.auto === false && prev.points !== null && prev.points !== undefined) {
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
