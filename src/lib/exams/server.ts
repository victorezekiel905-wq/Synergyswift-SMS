/**
 * Server-side exam state machine. All attempt writes go through here with the
 * service client, after the caller has been authenticated and scoped.
 */
import { markAttempt, questionsForAttempt, type Question, type Mark } from "./engine";
import { canRun, gradeCode } from "./code-runner";

export const VIOLATION_KINDS = new Set(["blur", "visibility_hidden", "fullscreen_exit", "copy", "paste", "context_menu", "print", "devtools", "multiple_screens", "camera_off"]);
export const GRACE_MS = 30_000; // network latency allowance after the deadline

export type ExamRow = {
  id: string; tenant_id: string; title: string; instructions: string | null; status: string;
  duration_minutes: number; opens_at: string | null; closes_at: string | null; access_code: string;
  class_group_id: string | null; subject_id: string | null; term_id: string | null; component_id: string | null;
  settings: Record<string, any>; results_released: boolean;
};

export async function loadQuestions(svc: any, examId: string): Promise<Question[]> {
  const { data } = await svc.from("exam_questions").select("id,type,prompt,points,media_url,section,position,data,answer")
    .eq("exam_id", examId).order("position");
  return (data ?? []).map((q: any) => ({ ...q, points: Number(q.points) }));
}

export function computeDeadline(exam: ExamRow, startedAt: Date, extraMinutes = 0): Date {
  let d = new Date(startedAt.getTime() + (exam.duration_minutes + extraMinutes) * 60_000);
  if (exam.closes_at) {
    const c = new Date(exam.closes_at);
    // Extra time granted by a teacher may run past the window.
    if (d > c && extraMinutes === 0) d = c;
  }
  return d;
}

export function windowState(exam: ExamRow, now = new Date()): "not_open" | "open" | "closed" {
  if (exam.status === "closed") return "closed";
  if (exam.status !== "published") return "not_open";
  if (exam.opens_at && now < new Date(exam.opens_at)) return "not_open";
  if (exam.closes_at && now > new Date(exam.closes_at)) return "closed";
  return "open";
}

/** Marks and submits an attempt. Safe to call repeatedly. */
export async function finalizeAttempt(svc: any, attempt: any, questions: Question[], reason: "student" | "timeout" | "teacher") {
  if (attempt.status === "submitted" || attempt.status === "graded") return attempt;
  const r = markAttempt(questionsForAttempt(questions, attempt), attempt.answers ?? {}, (attempt.marks ?? {}) as Record<string, Mark>);
  const status = r.pending === 0 ? "graded" : "submitted";
  const { data } = await svc.from("exam_attempts").update({
    status, submitted_at: new Date().toISOString(), marks: r.marks, auto_score: r.auto_score,
    total_score: r.total_score, max_score: r.max_score
  }).eq("id", attempt.id).in("status", ["in_progress", "locked"]).select("*").maybeSingle();
  await svc.from("exam_events").insert({ attempt_id: attempt.id, kind: "submitted", meta: { reason } });
  return markCodeQuestions(svc, data ?? attempt, questions);
}

/**
 * Marks code answers by running the question's test cases (JavaScript in the
 * sandbox, other languages on Judge0 when configured). Answers already marked
 * by a teacher are left alone; anything that cannot run stays with the teacher.
 */
export async function markCodeQuestions(svc: any, attempt: any, questions: Question[]) {
  const given = questionsForAttempt(questions, attempt);
  const todo = given.filter(q => q.type === "code" && (q.answer?.tests ?? []).length && canRun(String(q.data?.language ?? "")));
  if (!todo.length) return attempt;
  const marks: Record<string, Mark> = { ...(attempt.marks ?? {}) };
  let changed = false;
  for (const q of todo) {
    const prev = marks[q.id];
    // A teacher mark has points; a pending placeholder (points null) is not a teacher mark.
    if (prev && prev.points !== null && prev.points !== undefined && (prev.auto === false || prev.runner)) continue;
    const code = String(attempt.answers?.[q.id] ?? "");
    if (!code.trim()) continue;
    try {
      const g = await gradeCode(String(q.data.language), code, q.answer.tests, Number(q.points));
      if (g.outcomes.some(o => /no runner|runner unavailable/.test(o.error ?? ""))) continue;
      marks[q.id] = { points: g.points, max: Number(q.points), auto: true, runner: true, feedback: g.feedback };
      changed = true;
    } catch { /* leave for the teacher */ }
  }
  if (!changed) return attempt;
  const r = markAttempt(given, attempt.answers ?? {}, marks);
  const { data } = await svc.from("exam_attempts").update({
    marks: r.marks, auto_score: r.auto_score, total_score: r.total_score, max_score: r.max_score, status: r.pending === 0 ? "graded" : "submitted"
  }).eq("id", attempt.id).in("status", ["submitted", "graded"]).select("*").maybeSingle();
  return data ?? attempt;
}

/** If the deadline has passed, submit automatically. Returns the fresh attempt. */
export async function autoSubmitIfExpired(svc: any, attempt: any, questions: Question[]) {
  if ((attempt.status === "in_progress" || attempt.status === "locked") && Date.now() > new Date(attempt.deadline_at).getTime() + GRACE_MS) {
    return finalizeAttempt(svc, attempt, questions, "timeout");
  }
  return attempt;
}

/** Student's view of their result, respecting the release setting. */
export function studentResultView(exam: ExamRow, attempt: any, questions: Question[]) {
  const released = exam.results_released || Boolean(exam.settings?.show_score_after_submit);
  if (!released || (attempt.status !== "graded" && !exam.results_released)) {
    return { released: false, pending_manual: attempt.status === "submitted" };
  }
  const review = Boolean(exam.settings?.allow_review) && exam.results_released;
  return {
    released: true,
    total_score: attempt.total_score, max_score: attempt.max_score,
    per_question: review ? questionsForAttempt(questions, attempt).map(q => ({ id: q.id, prompt: q.prompt, points: attempt.marks?.[q.id]?.points ?? 0, max: Number(q.points), feedback: attempt.marks?.[q.id]?.feedback ?? null })) : null
  };
}
