/**
 * Server-side exam state machine. All attempt writes go through here with the
 * service client, after the caller has been authenticated and scoped.
 */
import { markAttempt, type Question, type Mark } from "./engine";

export const VIOLATION_KINDS = new Set(["blur", "visibility_hidden", "fullscreen_exit", "copy", "paste", "context_menu", "print", "devtools", "multiple_screens"]);
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
  const r = markAttempt(questions, attempt.answers ?? {}, (attempt.marks ?? {}) as Record<string, Mark>);
  const status = r.pending === 0 ? "graded" : "submitted";
  const { data } = await svc.from("exam_attempts").update({
    status, submitted_at: new Date().toISOString(), marks: r.marks, auto_score: r.auto_score,
    total_score: r.total_score, max_score: r.max_score
  }).eq("id", attempt.id).in("status", ["in_progress", "locked"]).select("*").maybeSingle();
  await svc.from("exam_events").insert({ attempt_id: attempt.id, kind: "submitted", meta: { reason } });
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
    per_question: review ? questions.map(q => ({ id: q.id, prompt: q.prompt, points: attempt.marks?.[q.id]?.points ?? 0, max: Number(q.points), feedback: attempt.marks?.[q.id]?.feedback ?? null })) : null
  };
}
