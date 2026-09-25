import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, readJson, jsonError, type Ctx } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { buildAttemptLayout, toPublicQuestion, type Question } from "@/lib/exams/engine";
import { verifySeb, absoluteRequestUrl, sebLaunchUrl } from "@/lib/exams/seb";
import {
  loadQuestions, computeDeadline, windowState, finalizeAttempt, autoSubmitIfExpired, studentResultView,
  VIOLATION_KINDS, GRACE_MS, type ExamRow
} from "@/lib/exams/server";
import { appUrl } from "@/lib/school";

export const dynamic = "force-dynamic";

async function context(req: NextRequest, examId: string) {
  const ctx = await requireCtx(["student"], "exams");
  if (ctx instanceof NextResponse) return { error: ctx };
  const svc = createServiceClient();
  const { data: me } = await svc.from("students").select("id,class_group_id").eq("tenant_id", ctx.tenant.id).eq("user_id", ctx.userId).maybeSingle();
  if (!me) return { error: jsonError("your login is not linked to a student record", 404) };
  const { data: exam } = await svc.from("exams").select("*").eq("tenant_id", ctx.tenant.id).eq("id", examId).in("status", ["published", "closed"]).maybeSingle();
  if (!exam || (exam.class_group_id && exam.class_group_id !== me.class_group_id)) return { error: jsonError("exam not found", 404) };
  return { ctx: ctx as Ctx, svc, exam: exam as ExamRow, student: me };
}

function publicExam(exam: ExamRow, req: NextRequest) {
  const s = exam.settings ?? {};
  const cfg = `${appUrl(req)}/api/exams/${exam.id}/seb`;
  return {
    id: exam.id, title: exam.title, instructions: exam.instructions, duration_minutes: exam.duration_minutes,
    opens_at: exam.opens_at, closes_at: exam.closes_at, window: windowState(exam),
    require_seb: Boolean(s.require_seb), seb_config_url: cfg, seb_launch_url: sebLaunchUrl(cfg),
    require_fullscreen: s.require_fullscreen !== false, block_copy_paste: s.block_copy_paste !== false,
    violation_limit: s.violation_limit ?? 3, allow_spellcheck: Boolean(s.allow_spellcheck), allow_calculator: Boolean(s.allow_calculator)
  };
}

function attemptPayload(exam: ExamRow, attempt: any, questions: Question[]) {
  const byId = new Map(questions.map(q => [q.id, q]));
  const order: string[] = attempt.question_order?.length ? attempt.question_order : questions.map(q => q.id);
  return {
    id: attempt.id, status: attempt.status, started_at: attempt.started_at, deadline_at: attempt.deadline_at,
    violations: attempt.violations, server_now: new Date().toISOString(),
    answers: attempt.answers ?? {},
    questions: order.map(id => byId.get(id)).filter(Boolean).map(q => toPublicQuestion(q as Question, attempt.option_orders?.[(q as Question).id]))
  };
}

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const c = await context(req, params.id);
  if ("error" in c) return c.error;
  const { svc, exam, ctx } = c;
  const { data: raw } = await svc.from("exam_attempts").select("*").eq("exam_id", exam.id).eq("student_user_id", ctx.userId).maybeSingle();
  const pub = publicExam(exam, req);
  if (!raw) return NextResponse.json({ exam: pub, attempt: null });
  const questions = await loadQuestions(svc, exam.id);
  const attempt = await autoSubmitIfExpired(svc, raw, questions);
  if (attempt.status === "in_progress" || attempt.status === "locked") {
    const seb = verifySeb(absoluteRequestUrl(req), req.headers, exam.settings ?? {});
    if (!seb.ok) return NextResponse.json({ exam: pub, attempt: { id: attempt.id, status: attempt.status }, seb_error: seb.reason }, { status: 403 });
    return NextResponse.json({ exam: pub, attempt: attemptPayload(exam, attempt, questions) });
  }
  return NextResponse.json({ exam: pub, attempt: { id: attempt.id, status: attempt.status, submitted_at: attempt.submitted_at }, result: studentResultView(exam, attempt, questions) });
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), access_code: z.string().trim().max(20) }),
  z.object({ action: z.literal("save"), answers: z.record(z.any()) }),
  z.object({ action: z.literal("event"), kind: z.string().max(40), meta: z.record(z.any()).optional() }),
  z.object({ action: z.literal("submit"), answers: z.record(z.any()).optional() })
]);

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const c = await context(req, params.id);
  if ("error" in c) return c.error;
  const { svc, exam, ctx } = c;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError("invalid request");
  const b = parsed.data;
  const settings = exam.settings ?? {};
  const seb = verifySeb(absoluteRequestUrl(req), req.headers, settings);
  if (!seb.ok && b.action !== "event") return jsonError(seb.reason ?? "Safe Exam Browser required", 403);

  const questions = await loadQuestions(svc, exam.id);
  const { data: existing } = await svc.from("exam_attempts").select("*").eq("exam_id", exam.id).eq("student_user_id", ctx.userId).maybeSingle();

  if (b.action === "start") {
    if (existing) {
      const fresh = await autoSubmitIfExpired(svc, existing, questions);
      if (fresh.status === "submitted" || fresh.status === "graded") return jsonError("you have already submitted this exam", 409);
      await svc.from("exam_events").insert({ attempt_id: fresh.id, kind: "resumed", meta: { ua: req.headers.get("user-agent")?.slice(0, 200) } });
      return NextResponse.json({ attempt: attemptPayload(exam, fresh, questions) });
    }
    if (windowState(exam) !== "open") return jsonError("this exam is not open right now", 403);
    if (b.access_code.toUpperCase() !== String(exam.access_code).toUpperCase()) return jsonError("wrong exam code", 403);
    const layout = buildAttemptLayout(questions, { shuffleQuestions: Boolean(settings.shuffle_questions), shuffleOptions: settings.shuffle_options !== false });
    const now = new Date();
    const { data: attempt, error } = await svc.from("exam_attempts").insert({
      tenant_id: ctx.tenant.id, exam_id: exam.id, student_user_id: ctx.userId, started_at: now.toISOString(),
      deadline_at: computeDeadline(exam, now).toISOString(), question_order: layout.question_order, option_orders: layout.option_orders,
      seb_verified: seb.ok && seb.level !== "none", client_ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      user_agent: req.headers.get("user-agent")?.slice(0, 300) ?? null
    }).select("*").single();
    if (error) return jsonError(error.message.includes("duplicate") ? "exam already started on another device" : error.message, 409);
    await svc.from("exam_events").insert({ attempt_id: attempt.id, kind: "started", meta: { seb: seb.level } });
    return NextResponse.json({ attempt: attemptPayload(exam, attempt, questions) }, { status: 201 });
  }

  if (!existing) return jsonError("start the exam first", 400);
  let attempt = await autoSubmitIfExpired(svc, existing, questions);

  if (b.action === "event") {
    if (!["in_progress", "locked"].includes(attempt.status)) return NextResponse.json({ status: attempt.status });
    const kind = b.kind.replace(/[^a-z_]/g, "").slice(0, 40);
    await svc.from("exam_events").insert({ attempt_id: attempt.id, kind, meta: b.meta ?? {} });
    if (!VIOLATION_KINDS.has(kind)) return NextResponse.json({ status: attempt.status, violations: attempt.violations });
    const violations = attempt.violations + 1;
    const limit = Number(settings.violation_limit ?? 3);
    const lock = attempt.status === "in_progress" && violations >= limit;
    await svc.from("exam_attempts").update({ violations, last_seen_at: new Date().toISOString(), ...(lock ? { status: "locked" } : {}) }).eq("id", attempt.id);
    if (lock) await svc.from("exam_events").insert({ attempt_id: attempt.id, kind: "locked", meta: { violations } });
    return NextResponse.json({ status: lock ? "locked" : attempt.status, violations, limit });
  }

  if (attempt.status === "submitted" || attempt.status === "graded") return jsonError("this exam has been submitted", 409);
  if (attempt.status === "locked" && b.action === "save") return NextResponse.json({ status: "locked" }, { status: 423 });
  if (Date.now() > new Date(attempt.deadline_at).getTime() + GRACE_MS) return jsonError("time is up", 409);

  const incoming = (b.action === "save" ? b.answers : b.answers) ?? {};
  const valid = new Set(questions.map(q => q.id));
  const merged: Record<string, unknown> = { ...(attempt.answers ?? {}) };
  for (const [k, v] of Object.entries(incoming)) if (valid.has(k)) merged[k] = v;
  if (JSON.stringify(merged).length > 500_000) return jsonError("answers are too large", 413);

  const { data: saved } = await svc.from("exam_attempts").update({ answers: merged, last_seen_at: new Date().toISOString() })
    .eq("id", attempt.id).in("status", ["in_progress", "locked"]).select("*").maybeSingle();
  attempt = saved ?? attempt;

  if (b.action === "submit") {
    const done = await finalizeAttempt(svc, attempt, questions, "student");
    return NextResponse.json({ status: done.status, result: studentResultView(exam, done, questions) });
  }
  return NextResponse.json({ saved_at: new Date().toISOString(), status: attempt.status, deadline_at: attempt.deadline_at });
}
