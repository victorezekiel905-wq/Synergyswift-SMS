import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, readJson, jsonError, type Ctx } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { buildAttemptLayout, toPublicQuestion, questionsForAttempt, type Question } from "@/lib/exams/engine";
import { canRun, gradeCode, runCode } from "@/lib/exams/code-runner";
import { verifySeb, absoluteRequestUrl, sebLaunchUrl } from "@/lib/exams/seb";
import {
  loadQuestions, computeDeadline, windowState, finalizeAttempt, autoSubmitIfExpired, studentResultView,
  VIOLATION_KINDS, GRACE_MS, type ExamRow
} from "@/lib/exams/server";
import { appUrl } from "@/lib/school";
import { clientIp, ipAllowed } from "@/lib/net";
import { extraMinutes } from "@/lib/sis";
import { examTools } from "@/lib/exams/tools";

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
    violation_limit: s.violation_limit ?? 3, allow_spellcheck: Boolean(s.allow_spellcheck), tools: examTools(s),
    reference_text: examTools(s).includes("reference_sheet") ? (s.reference_text ?? null) : null,
    webcam_snapshots: Boolean(s.webcam_snapshots), snapshot_interval_sec: Math.min(600, Math.max(15, Number(s.snapshot_interval_sec ?? 60))),
    network_restricted: Boolean((s.allowed_ips ?? []).length)
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
  z.object({ action: z.literal("submit"), answers: z.record(z.any()).optional() }),
  z.object({ action: z.literal("run_code"), question_id: z.string().uuid(), code: z.string().max(50_000) })
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
  const ip = clientIp(req.headers);
  if (b.action !== "event" && !ipAllowed(ip, settings.allowed_ips)) {
    return jsonError("This exam can only be taken on the school network. Connect to the exam room Wi-Fi or use a school computer.", 403);
  }

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
    const layout = buildAttemptLayout(questions, { shuffleQuestions: Boolean(settings.shuffle_questions), shuffleOptions: settings.shuffle_options !== false, draw: settings.draw });
    const now = new Date();
    // Access arrangements: a student on the SEN register with extra time gets it automatically.
    const { data: me } = await svc.from("students").select("id,sen_profiles(extra_time_pct,status)").eq("tenant_id", ctx.tenant.id).eq("user_id", ctx.userId).maybeSingle();
    // Hall check-in (phase 14i): an exam period can require the candidate to be checked in at the hall first.
    const { data: papers } = await svc.from("exam_papers").select("id,exam_series(require_checkin)").eq("tenant_id", ctx.tenant.id).eq("exam_id", exam.id);
    const gated = (papers ?? []).filter((p: any) => p.exam_series?.require_checkin === true).map((p: any) => p.id);
    if (gated.length && me) {
      const { data: inHall } = await svc.from("exam_checkins").select("id").eq("student_id", me.id).in("paper_id", gated).limit(1);
      if (!inHall?.length) return jsonError("Check in at your exam hall first: show your ID card to the invigilator, then start.", 403);
    }
    const sen = (me as any)?.sen_profiles;
    const extra = sen && sen.status !== "closed" ? extraMinutes(exam.duration_minutes, sen.extra_time_pct) : 0;
    const { data: attempt, error } = await svc.from("exam_attempts").insert({
      tenant_id: ctx.tenant.id, exam_id: exam.id, student_user_id: ctx.userId, started_at: now.toISOString(),
      deadline_at: computeDeadline(exam, now, extra).toISOString(), question_order: layout.question_order, option_orders: layout.option_orders,
      seb_verified: seb.ok && seb.level !== "none", client_ip: ip,
      user_agent: req.headers.get("user-agent")?.slice(0, 300) ?? null
    }).select("*").single();
    if (error) return jsonError(error.message.includes("duplicate") ? "exam already started on another device" : error.message, 409);
    await svc.from("exam_events").insert({ attempt_id: attempt.id, kind: "started", meta: { seb: seb.level } });
    return NextResponse.json({ attempt: attemptPayload(exam, attempt, questions) }, { status: 201 });
  }

  if (!existing) return jsonError("start the exam first", 400);
  let attempt = await autoSubmitIfExpired(svc, existing, questions);

  if (b.action === "run_code") {
    // Students may try their code on the visible example tests only; hidden tests are used for marking.
    if (!["in_progress"].includes(attempt.status)) return jsonError("the exam is not in progress", 409);
    const q = questionsForAttempt(questions, attempt).find(x => x.id === b.question_id);
    if (!q || q.type !== "code") return jsonError("not a code question");
    const language = String(q.data?.language ?? "");
    if (!canRun(language)) return jsonError("running code is not available for this language", 400);
    const { data: last } = await svc.from("exam_events").select("at").eq("attempt_id", attempt.id).eq("kind", "code_run").order("at", { ascending: false }).limit(1);
    if (last?.[0] && Date.now() - new Date(last[0].at).getTime() < 3000) return jsonError("wait a moment before running again", 429);
    await svc.from("exam_events").insert({ attempt_id: attempt.id, kind: "code_run", meta: { question_id: q.id } });
    const visible = (q.answer?.tests ?? []).filter((t: { hidden?: boolean }) => !t.hidden).slice(0, 5);
    if (!visible.length) {
      const run = await runCode(language, b.code, "");
      return NextResponse.json({ results: [{ passed: null, output: run.output.slice(0, 2000), expected: null, error: run.error }] });
    }
    const g = await gradeCode(language, b.code, visible, 1);
    return NextResponse.json({ results: g.outcomes.map(o => ({ passed: o.passed, output: o.output, expected: o.expected, error: o.error })) });
  }

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
  const valid = new Set(questionsForAttempt(questions, attempt).map(q => q.id));
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
