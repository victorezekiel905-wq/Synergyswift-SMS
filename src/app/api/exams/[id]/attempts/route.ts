import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { loadQuestions, autoSubmitIfExpired, finalizeAttempt, computeDeadline, type ExamRow } from "@/lib/exams/server";
import { markAttempt, type Mark } from "@/lib/exams/engine";
import { studentName, toCsv } from "@/lib/school";

async function loadExam(ctx: any, id: string): Promise<ExamRow | null> {
  const { data } = await ctx.sb.from("exams").select("*").eq("tenant_id", ctx.tenant.id).eq("id", id).maybeSingle();
  return data;
}

/** Live monitor: every attempt with progress, time left and integrity events. ?format=csv for marks. */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireCtx(ROLES.staff, "exams");
  if (ctx instanceof NextResponse) return ctx;
  const exam = await loadExam(ctx, params.id);
  if (!exam) return jsonError("not found", 404);
  const svc = createServiceClient();
  const questions = await loadQuestions(svc, exam.id);
  const { data: attempts } = await svc.from("exam_attempts").select("*").eq("tenant_id", ctx.tenant.id).eq("exam_id", exam.id).order("started_at");

  const fresh = [];
  for (const a of attempts ?? []) fresh.push(await autoSubmitIfExpired(svc, a, questions));
  const userIds = fresh.map(a => a.student_user_id);
  const { data: students } = userIds.length
    ? await svc.from("students").select("user_id,first_name,last_name,other_names,admission_no").eq("tenant_id", ctx.tenant.id).in("user_id", userIds)
    : { data: [] };
  const { data: users } = userIds.length ? await svc.from("users").select("id,full_name").in("id", userIds) : { data: [] };
  const sBy = new Map((students ?? []).map((s: any) => [s.user_id, s]));
  const uBy = new Map((users ?? []).map((u: any) => [u.id, u.full_name]));
  const { data: events } = fresh.length
    ? await svc.from("exam_events").select("attempt_id,kind,meta,at").in("attempt_id", fresh.map(a => a.id)).order("at", { ascending: false }).limit(2000)
    : { data: [] };

  const rows = fresh.map(a => {
    const s: any = sBy.get(a.student_user_id);
    return {
      id: a.id, student_user_id: a.student_user_id,
      name: s ? studentName(s) : uBy.get(a.student_user_id) ?? "Student", admission_no: s?.admission_no ?? null,
      status: a.status, started_at: a.started_at, deadline_at: a.deadline_at, submitted_at: a.submitted_at,
      last_seen_at: a.last_seen_at, violations: a.violations, seb_verified: a.seb_verified, extra_minutes: a.extra_minutes,
      answered: Object.values(a.answers ?? {}).filter(v => v !== null && v !== "" && !(Array.isArray(v) && !v.length)).length,
      total_questions: questions.length, auto_score: a.auto_score, total_score: a.total_score, max_score: a.max_score,
      pending_manual: Object.values((a.marks ?? {}) as Record<string, Mark>).filter(m => m.points === null).length,
      answers: a.answers, marks: a.marks,
      events: (events ?? []).filter((e: any) => e.attempt_id === a.id).slice(0, 30)
    };
  });

  if (new URL(req.url).searchParams.get("format") === "csv") {
    const csv = toCsv([["Admission no", "Student", "Status", "Score", "Max", "Violations", "Started", "Submitted"],
      ...rows.map(r => [r.admission_no, r.name, r.status, r.total_score, r.max_score, r.violations, r.started_at, r.submitted_at])]);
    return new NextResponse("﻿" + csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="exam-results.csv"` } });
  }
  return NextResponse.json({ exam, questions, attempts: rows });
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("unlock"), attempt_id: z.string().uuid() }),
  z.object({ action: z.literal("extend"), attempt_id: z.string().uuid(), minutes: z.number().int().min(1).max(240) }),
  z.object({ action: z.literal("force_submit"), attempt_id: z.string().uuid() }),
  z.object({ action: z.literal("reopen"), attempt_id: z.string().uuid(), minutes: z.number().int().min(1).max(240) }),
  z.object({ action: z.literal("grade"), attempt_id: z.string().uuid(),
    marks: z.record(z.object({ points: z.number().min(0), feedback: z.string().max(2000).optional() })) }),
  z.object({ action: z.literal("reset"), attempt_id: z.string().uuid() })
]);

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireCtx(ROLES.staff, "exams");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const exam = await loadExam(ctx, params.id);
  if (!exam) return jsonError("not found", 404);
  const svc = createServiceClient();
  const { data: a } = await svc.from("exam_attempts").select("*").eq("tenant_id", ctx.tenant.id).eq("exam_id", exam.id).eq("id", b.attempt_id).maybeSingle();
  if (!a) return jsonError("attempt not found", 404);
  const log = (kind: string, meta: Record<string, unknown> = {}) =>
    svc.from("exam_events").insert({ attempt_id: a.id, kind, meta: { ...meta, by: ctx.userId } });

  if (b.action === "unlock") {
    if (a.status !== "locked") return jsonError("attempt is not locked");
    await svc.from("exam_attempts").update({ status: "in_progress" }).eq("id", a.id);
    await log("unlocked");
    return NextResponse.json({ ok: true });
  }
  if (b.action === "extend" || b.action === "reopen") {
    if (b.action === "extend" && !["in_progress", "locked"].includes(a.status)) return jsonError("attempt already submitted; use reopen");
    const extra = a.extra_minutes + b.minutes;
    const base = b.action === "reopen" ? new Date() : new Date(a.started_at);
    const deadline = b.action === "reopen"
      ? new Date(base.getTime() + b.minutes * 60_000)
      : computeDeadline(exam, base, extra);
    await svc.from("exam_attempts").update({ extra_minutes: extra, deadline_at: deadline.toISOString(),
      ...(b.action === "reopen" ? { status: "in_progress", submitted_at: null } : {}) }).eq("id", a.id);
    await log(b.action === "reopen" ? "reopened" : "time_extended", { minutes: b.minutes });
    return NextResponse.json({ ok: true, deadline_at: deadline.toISOString() });
  }
  if (b.action === "force_submit") {
    const questions = await loadQuestions(svc, exam.id);
    await finalizeAttempt(svc, a, questions, "teacher");
    return NextResponse.json({ ok: true });
  }
  if (b.action === "reset") {
    await svc.from("exam_attempts").delete().eq("id", a.id);
    await ctx.sb.from("audit_logs").insert({ tenant_id: ctx.tenant.id, actor_id: ctx.userId, action: "exam.attempt_reset", target: a.id, meta: { exam_id: exam.id } });
    return NextResponse.json({ ok: true });
  }
  // grade: manual marks override auto marks for the given questions
  if (!["submitted", "graded"].includes(a.status)) return jsonError("grade after the student has submitted");
  const questions = await loadQuestions(svc, exam.id);
  const qMax = new Map(questions.map(q => [q.id, Number(q.points)]));
  const existing: Record<string, Mark> = { ...(a.marks ?? {}) };
  for (const [qid, m] of Object.entries(b.marks)) {
    const max = qMax.get(qid);
    if (max === undefined) return jsonError("unknown question");
    if (m.points > max) return jsonError(`points cannot exceed ${max}`);
    existing[qid] = { points: m.points, max, auto: false, feedback: m.feedback };
  }
  const r = markAttempt(questions, a.answers ?? {}, existing);
  await svc.from("exam_attempts").update({ marks: r.marks, auto_score: r.auto_score, total_score: r.total_score, max_score: r.max_score,
    status: r.pending === 0 ? "graded" : "submitted" }).eq("id", a.id);
  return NextResponse.json({ ok: true, total_score: r.total_score, pending: r.pending });
}
