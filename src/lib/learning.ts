/**
 * Learning paths, breakout rooms and online lessons. Pure, unit tested.
 */
import { markAttempt, validateQuestion, type Question } from "./exams/engine";
import { secureShuffle } from "./crypto";

// ---------------- learning paths ----------------

export type PathStep = { id: string; position: number; kind: string; requires: string[]; pass_pct: number };
export type StepProgress = { step_id: string; status: "done" | "passed" | "failed"; score: number | null };

export const finished = (p: StepProgress | undefined) => p?.status === "done" || p?.status === "passed";

/** Each step with whether it is finished, open, or locked (and by which steps). */
export function stepStates<T extends PathStep>(steps: T[], progress: StepProgress[]) {
  const byStep = new Map(progress.map(p => [p.step_id, p]));
  const ids = new Set(steps.map(s => s.id));
  return [...steps].sort((a, b) => a.position - b.position).map(s => {
    const p = byStep.get(s.id);
    // Prerequisites that were deleted no longer hold anyone back.
    const waiting = s.requires.filter(r => ids.has(r) && !finished(byStep.get(r)));
    return { ...s, progress: p ?? null, state: finished(p) ? "done" as const : waiting.length ? "locked" as const : "open" as const, waiting };
  });
}

export function pathSummary(steps: PathStep[], progress: StepProgress[]) {
  const ids = new Set(steps.map(s => s.id));
  const done = progress.filter(p => ids.has(p.step_id) && finished(p)).length;
  return { done, total: steps.length, pct: steps.length ? Math.round((done / steps.length) * 100) : 0, complete: steps.length > 0 && done === steps.length };
}

/** The first prerequisite loop, as step ids, or null when there is none. */
export function prerequisiteCycle(steps: { id: string; requires: string[] }[]): string[] | null {
  const next = new Map(steps.map(s => [s.id, s.requires]));
  const state = new Map<string, 1 | 2>();
  const stack: string[] = [];
  const visit = (id: string): string[] | null => {
    if (state.get(id) === 2) return null;
    if (state.get(id) === 1) return stack.slice(stack.indexOf(id)).concat(id);
    state.set(id, 1); stack.push(id);
    for (const r of next.get(id) ?? []) { if (!next.has(r)) continue; const c = visit(r); if (c) return c; }
    stack.pop(); state.set(id, 2);
    return null;
  };
  for (const s of steps) { const c = visit(s.id); if (c) return c; }
  return null;
}

/** Marks a quiz step. Only auto-marked questions count. */
export function markQuizStep(questions: Question[], answers: Record<string, unknown>, passPct: number) {
  const auto = questions.filter(q => !["essay", "code", "file_upload"].includes(q.type));
  const r = markAttempt(auto, answers);
  const pct = r.max_score > 0 ? Math.round((r.total_score / r.max_score) * 1000) / 10 : 0;
  const right = Object.fromEntries(Object.entries(r.marks).map(([id, m]) => [id, m.points !== null && m.points >= m.max]));
  return { pct, passed: pct >= passPct, right, total: r.total_score, max: r.max_score };
}

// ---------------- breakout rooms ----------------

/** Splits people into `count` rooms as evenly as possible, at random unless `shuffle` is false. */
export function splitIntoRooms<T>(people: readonly T[], count: number, shuffle = true): T[][] {
  const n = Math.max(1, Math.min(Math.floor(count), Math.max(1, people.length)));
  const order = shuffle ? secureShuffle(people) : people.slice();
  const rooms: T[][] = Array.from({ length: n }, () => []);
  order.forEach((p, i) => rooms[i % n].push(p));
  return rooms;
}

// ---------------- online lessons ----------------

export type MeetingProvider = "zoom" | "meet" | "teams" | "other";

/** Which service a meeting link belongs to; null if it is not a safe https link. */
export function meetingProvider(link: string): MeetingProvider | null {
  let u: URL;
  try { u = new URL(link.trim()); } catch { return null; }
  if (u.protocol !== "https:" || u.username || u.password) return null;
  const h = u.hostname.toLowerCase();
  const is = (d: string) => h === d || h.endsWith(`.${d}`);
  if (is("zoom.us") || is("zoomgov.com")) return "zoom";
  if (h === "meet.google.com") return "meet";
  if (is("teams.microsoft.com") || is("teams.live.com")) return "teams";
  return "other";
}

/** Whether an online lesson can be joined now: from 15 minutes before until it ends. */
export function lessonWindow(startsAt: string, durationMin: number, now = new Date()): "upcoming" | "open" | "ended" {
  const start = Date.parse(startsAt), end = start + durationMin * 60_000;
  const t = now.getTime();
  if (t > end) return "ended";
  return t >= start - 15 * 60_000 ? "open" : "upcoming";
}

/** The body Zoom expects to create a scheduled meeting. */
export function zoomMeetingBody(p: { title: string; startsAt: string; durationMin: number; timezone: string }) {
  return {
    topic: p.title.slice(0, 200), type: 2, start_time: new Date(p.startsAt).toISOString().replace(/\.\d{3}Z$/, "Z"), duration: p.durationMin, timezone: p.timezone,
    settings: { join_before_host: false, waiting_room: true, mute_upon_entry: true, participant_video: false, host_video: true, approval_type: 2, auto_recording: "none" }
  };
}

// ---------------- generated questions ----------------

export type DraftQuestion = {
  type: "mcq_single" | "true_false" | "short_answer" | "numeric"; prompt: string; options: string[]; correct_option: number | null; correct_true: boolean | null;
  accepted_answers: string[]; numeric_answer: number | null; tolerance: number | null; unit: string | null; explanation: string;
  difficulty: "easy" | "medium" | "hard"; bloom: string; objective: string | null;
};
export type BankQuestion = { type: string; prompt: string; points: number; data: Record<string, unknown>; answer: Record<string, unknown>; explanation: string; difficulty: string; bloom: string; objective: string | null };

/** A drafted question in the question bank's format, or null if it is not usable. */
export function toBankQuestion(g: DraftQuestion): BankQuestion | null {
  const prompt = g.prompt.trim().slice(0, 4000);
  const base = { prompt, points: 1, explanation: g.explanation.trim().slice(0, 2000), difficulty: g.difficulty, bloom: g.bloom, objective: g.objective };
  let q: BankQuestion | null = null;
  switch (g.type) {
    case "mcq_single": {
      const opts = g.options.map(o => o.trim()).filter(Boolean).slice(0, 6);
      if (opts.length < 2 || g.correct_option === null || !opts[g.correct_option] || new Set(opts.map(o => o.toLowerCase())).size !== opts.length) return null;
      const ids = ["a", "b", "c", "d", "e", "f"];
      q = { ...base, type: g.type, data: { options: opts.map((text, i) => ({ id: ids[i], text })) }, answer: { correct: ids[g.correct_option] } };
      break;
    }
    case "true_false":
      if (typeof g.correct_true !== "boolean") return null;
      q = { ...base, type: g.type, data: {}, answer: { correct: g.correct_true } };
      break;
    case "short_answer": {
      const acc = [...new Set(g.accepted_answers.map(a => a.trim()).filter(Boolean))].slice(0, 10);
      if (!acc.length) return null;
      q = { ...base, type: g.type, data: { max_length: 200 }, answer: { accepted: acc, case_sensitive: false } };
      break;
    }
    case "numeric":
      if (g.numeric_answer === null || !Number.isFinite(g.numeric_answer)) return null;
      q = { ...base, type: g.type, data: { unit: g.unit?.trim() || null }, answer: { value: g.numeric_answer, tolerance: Math.abs(g.tolerance ?? 0) } };
      break;
  }
  return q && prompt.length >= 3 && !validateQuestion(q as Parameters<typeof validateQuestion>[0]).length ? q : null;
}
