import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { secureShuffle } from "@/lib/crypto";
import { POINTS } from "@/lib/lms";
import { buildAttemptLayout, toPublicQuestion, markQuestion, describeAnswer, type Question } from "@/lib/exams/engine";

export const dynamic = "force-dynamic";

// Practice only uses questions a computer can mark instantly.
const AUTO_TYPES = ["mcq_single", "mcq_multi", "true_false", "short_answer", "numeric", "fill_blanks", "matching", "ordering", "hotspot", "math", "drag_drop"];

/** What can be practised (subjects, exam bodies, years, topics) and the student's recent sessions. */
export async function GET() {
  const ctx = await requireCtx(["student"], "exams");
  if (ctx instanceof NextResponse) return ctx;
  const svc = createServiceClient();
  const { data: rows } = await svc.from("question_bank").select("subject_id,exam_body,exam_year,topic,subjects(name)")
    .eq("tenant_id", ctx.tenant.id).eq("practice", true).in("type", AUTO_TYPES).limit(20000);
  const subjects = new Map<string, { id: string; name: string; count: number; exam_bodies: Set<string>; years: Set<number>; topics: Set<string> }>();
  for (const r of rows ?? []) {
    if (!r.subject_id) continue;
    const s = subjects.get(r.subject_id) ?? { id: r.subject_id, name: (r as any).subjects?.name ?? "Subject", count: 0, exam_bodies: new Set(), years: new Set(), topics: new Set() };
    s.count++;
    if (r.exam_body) s.exam_bodies.add(r.exam_body);
    if (r.exam_year) s.years.add(r.exam_year);
    if (r.topic) s.topics.add(r.topic);
    subjects.set(r.subject_id, s);
  }
  const { data: history } = await svc.from("practice_sessions").select("id,filters,score,max_score,started_at,finished_at,question_ids")
    .eq("tenant_id", ctx.tenant.id).eq("student_user_id", ctx.userId).order("started_at", { ascending: false }).limit(20);
  return NextResponse.json({
    subjects: [...subjects.values()].map(s => ({ ...s, exam_bodies: [...s.exam_bodies].sort(), years: [...s.years].sort((a, b) => b - a), topics: [...s.topics].sort() }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    history: (history ?? []).map((h: any) => ({ ...h, questions: (h.question_ids ?? []).length, question_ids: undefined }))
  });
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), subject_id: z.string().uuid(), exam_body: z.string().max(40).nullish(), exam_year: z.number().int().nullish(),
    topic: z.string().max(120).nullish(), count: z.number().int().min(1).max(100).default(20) }),
  z.object({ action: z.literal("answer"), session_id: z.string().uuid(), question_id: z.string().uuid(), response: z.any() }),
  z.object({ action: z.literal("finish"), session_id: z.string().uuid() })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(["student"], "exams");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError("invalid request");
  const b = parsed.data;
  const svc = createServiceClient();
  const tid = ctx.tenant.id;

  if (b.action === "start") {
    let q = svc.from("question_bank").select("id,type,prompt,points,media_url,data,answer")
      .eq("tenant_id", tid).eq("practice", true).eq("subject_id", b.subject_id).in("type", AUTO_TYPES);
    if (b.exam_body) q = q.eq("exam_body", b.exam_body);
    if (b.exam_year) q = q.eq("exam_year", b.exam_year);
    if (b.topic) q = q.eq("topic", b.topic);
    const { data } = await q.limit(5000);
    const picked = secureShuffle((data ?? []) as Question[]).slice(0, b.count).map(x => ({ ...x, points: Number(x.points) }));
    if (!picked.length) return jsonError("no practice questions match; try fewer filters");
    const layout = buildAttemptLayout(picked, { shuffleOptions: true });
    const { data: s, error } = await svc.from("practice_sessions").insert({
      tenant_id: tid, student_user_id: ctx.userId, filters: { subject_id: b.subject_id, exam_body: b.exam_body ?? null, exam_year: b.exam_year ?? null, topic: b.topic ?? null },
      question_ids: picked.map(p => p.id), option_orders: layout.option_orders, max_score: picked.reduce((a, p) => a + p.points, 0)
    }).select("id").single();
    if (error) return jsonError(error.message);
    return NextResponse.json({ session_id: s.id, questions: picked.map(p => toPublicQuestion(p, layout.option_orders[p.id])) }, { status: 201 });
  }

  const { data: session } = await svc.from("practice_sessions").select("*").eq("tenant_id", tid).eq("id", b.session_id).eq("student_user_id", ctx.userId).maybeSingle();
  if (!session) return jsonError("practice session not found", 404);

  if (b.action === "finish") {
    await svc.from("practice_sessions").update({ finished_at: new Date().toISOString() }).eq("id", session.id);
    // Finished practice counts towards points, streaks and badges.
    const { data: st } = await svc.from("students").select("id").eq("tenant_id", tid).eq("user_id", ctx.userId).maybeSingle();
    if (st && Object.keys(session.marks ?? {}).length > 0) await svc.from("learning_activity").upsert({ tenant_id: tid, student_id: st.id, kind: "practice", points: POINTS.practice, ref_id: session.id }, { onConflict: "student_id,kind,ref_id", ignoreDuplicates: true });
    return NextResponse.json({ score: Number(session.score), max_score: Number(session.max_score) });
  }

  if (!(session.question_ids ?? []).includes(b.question_id)) return jsonError("that question is not in this session");
  if (session.marks?.[b.question_id]) return jsonError("already answered", 409);
  const { data: q } = await svc.from("question_bank").select("id,type,prompt,points,data,answer,explanation").eq("id", b.question_id).maybeSingle();
  if (!q) return jsonError("question no longer exists", 404);
  const mark = markQuestion({ ...q, points: Number(q.points) } as Question, b.response);
  const marks = { ...(session.marks ?? {}), [q.id]: mark };
  const score = Object.values(marks).reduce((a: number, m: any) => a + Number(m.points ?? 0), 0);
  await svc.from("practice_sessions").update({ answers: { ...(session.answers ?? {}), [q.id]: b.response }, marks, score }).eq("id", session.id);
  return NextResponse.json({
    points: mark.points, max: mark.max, correct: mark.points === mark.max,
    answer: describeAnswer(q as Question), explanation: q.explanation ?? null, score, max_score: Number(session.max_score)
  });
}
