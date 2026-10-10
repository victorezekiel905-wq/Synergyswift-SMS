import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";
import { secureShuffle } from "@/lib/crypto";
import { createServiceClient } from "@/lib/supabase/service";

const Filters = z.object({
  subject_id: z.string().uuid().nullish(), topic: z.string().max(120).nullish(), difficulty: z.string().max(10).nullish(),
  bloom: z.string().max(12).nullish(), exam_body: z.string().max(40).nullish(), exam_year: z.number().int().nullish(),
  level: z.string().max(40).nullish(), types: z.array(z.string().max(20)).max(14).nullish()
});
const Body = z.discriminatedUnion("action", [
  // Copy chosen bank questions into the exam.
  z.object({ action: z.literal("add"), question_ids: z.array(z.string().uuid()).min(1).max(500), section: z.string().trim().max(80).nullish() }),
  // Copy N random bank questions matching the filters. With per_student, the
  // section becomes a pool: each student gets per_student of them.
  z.object({ action: z.literal("random"), filters: Filters, count: z.number().int().min(1).max(500), section: z.string().trim().max(80).nullish(),
    per_student: z.number().int().min(1).max(500).nullish() }),
  // Save exam questions into the bank for reuse.
  z.object({ action: z.literal("to_bank"), question_ids: z.array(z.string().uuid()).min(1).max(500),
    meta: z.object({ topic: z.string().max(120).nullish(), difficulty: z.string().max(10).nullish(), exam_body: z.string().max(40).nullish(),
      exam_year: z.number().int().nullish(), level: z.string().max(40).nullish(), practice: z.boolean().optional() }).default({}) })
]);

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const ctx = await requireCtx(ROLES.staff, "exams");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  const { data: exam } = await ctx.sb.from("exams").select("id,status,subject_id,settings").eq("tenant_id", tid).eq("id", params.id).maybeSingle();
  if (!exam) return jsonError("exam not found", 404);

  if (b.action === "to_bank") {
    const { data: qs } = await ctx.sb.from("exam_questions").select("*").eq("exam_id", exam.id).in("id", b.question_ids);
    const rows = (qs ?? []).map((q: any) => ({
      tenant_id: tid, created_by: ctx.userId, subject_id: exam.subject_id, type: q.type, prompt: q.prompt, media_url: q.media_url,
      points: q.points, data: q.data, answer: q.answer, topic: b.meta.topic ?? q.topic, difficulty: b.meta.difficulty ?? q.difficulty,
      bloom: q.bloom, exam_body: b.meta.exam_body ?? null, exam_year: b.meta.exam_year ?? null, level: b.meta.level ?? null, practice: Boolean(b.meta.practice)
    }));
    if (!rows.length) return jsonError("no questions found");
    const { error } = await ctx.sb.from("question_bank").insert(rows);
    return error ? jsonError(error.message) : NextResponse.json({ saved: rows.length });
  }

  if (exam.status !== "draft") return jsonError("move the exam back to draft before adding questions");
  let bankRows: any[] = [];
  if (b.action === "add") {
    const { data } = await ctx.sb.from("question_bank").select("*").eq("tenant_id", tid).in("id", b.question_ids);
    const byId = new Map((data ?? []).map((r: any) => [r.id, r]));
    bankRows = b.question_ids.map(id => byId.get(id)).filter(Boolean);
  } else {
    const f = b.filters;
    let q = ctx.sb.from("question_bank").select("*").eq("tenant_id", tid);
    for (const k of ["subject_id", "difficulty", "bloom", "exam_body", "level"] as const) if (f[k]) q = q.eq(k, f[k]);
    if (f.topic) q = q.ilike("topic", f.topic);
    if (f.exam_year) q = q.eq("exam_year", f.exam_year);
    if (f.types?.length) q = q.in("type", f.types);
    const { data } = await q.limit(5000);
    // Skip questions already in this exam.
    const { data: have } = await ctx.sb.from("exam_questions").select("bank_question_id").eq("exam_id", exam.id).not("bank_question_id", "is", null);
    const used = new Set((have ?? []).map((r: any) => r.bank_question_id));
    bankRows = secureShuffle((data ?? []).filter((r: any) => !used.has(r.id))).slice(0, b.count);
  }
  if (!bankRows.length) return jsonError("no bank questions match");

  const { data: last } = await ctx.sb.from("exam_questions").select("position").eq("exam_id", exam.id).order("position", { ascending: false }).limit(1);
  let pos = last?.[0]?.position ?? 0;
  const rows = bankRows.map(r => ({
    exam_id: exam.id, position: ++pos, section: b.section || null, type: r.type, prompt: r.prompt, media_url: r.media_url,
    points: r.points, data: r.data, answer: r.answer, bank_question_id: r.id, topic: r.topic, difficulty: r.difficulty, bloom: r.bloom
  }));
  const { error } = await ctx.sb.from("exam_questions").insert(rows);
  if (error) return jsonError(error.message);
  // Usage counts are informational (service client: teachers may use colleagues' questions).
  const svc = createServiceClient();
  for (const r of bankRows) await svc.from("question_bank").update({ times_used: (r.times_used ?? 0) + 1 }).eq("id", r.id);

  if (b.action === "random" && b.per_student && b.section) {
    const draw = { ...(exam.settings?.draw ?? {}), [b.section]: b.per_student };
    await ctx.sb.from("exams").update({ settings: { ...exam.settings, draw } }).eq("id", exam.id);
  }
  return NextResponse.json({ added: rows.length, requested: b.action === "random" ? b.count : b.question_ids.length });
}
