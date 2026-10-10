import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { secureShuffle } from "@/lib/crypto";
import { EXAM_FORMATS, formatById } from "@/lib/exams/formats";

export async function GET() {
  const ctx = await requireCtx(ROLES.staff, "exams");
  if (ctx instanceof NextResponse) return ctx;
  return NextResponse.json(EXAM_FORMATS);
}

const Body = z.object({
  format: z.string().max(40),
  title: z.string().trim().min(2).max(160),
  class_group_id: z.string().uuid().nullish().or(z.literal("")),
  term_id: z.string().uuid().nullish().or(z.literal("")),
  subject_ids: z.array(z.string().uuid()).min(1).max(6),
  past_questions_only: z.boolean().default(false),   // only bank questions tagged with this exam body
  pool_factor: z.number().min(1).max(5).default(1)    // >1: each section holds more questions than a student gets
});

/**
 * Builds a mock exam in the shape of a national paper: one section per paper
 * part, each filled from the question bank. With a pool factor above 1 every
 * student gets a different random selection from each section.
 */
export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "exams");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const fmt = formatById(b.format);
  if (!fmt) return jsonError("unknown exam format");
  if (b.subject_ids.length !== fmt.subjects) return jsonError(`choose ${fmt.subjects} subject${fmt.subjects > 1 ? "s" : ""}`);
  const tid = ctx.tenant.id;

  const { data: subjects } = await ctx.sb.from("subjects").select("id,name").eq("tenant_id", tid).in("id", b.subject_ids);
  const nameOf = new Map((subjects ?? []).map((s: any) => [s.id, s.name]));
  if (nameOf.size !== new Set(b.subject_ids).size) return jsonError("subject not found");

  const { data: exam, error } = await ctx.sb.from("exams").insert({
    tenant_id: tid, created_by: ctx.userId, title: b.title, instructions: fmt.instructions, duration_minutes: fmt.duration_minutes,
    class_group_id: b.class_group_id || null, term_id: b.term_id || null, subject_id: fmt.subjects === 1 ? b.subject_ids[0] : null,
    settings: { ...fmt.settings, format: fmt.id }
  }).select("id").single();
  if (error) return jsonError(error.message);

  const draw: Record<string, number> = {};
  const rows: Record<string, unknown>[] = [];
  const shortfalls: string[] = [];
  let pos = 0;
  for (const s of fmt.sections) {
    const subjectId = b.subject_ids[s.subjectSlot ?? 0];
    const sectionName = fmt.subjects > 1 && s.subjectSlot !== undefined ? String(nameOf.get(subjectId)) : s.name;
    let q = ctx.sb.from("question_bank").select("*").eq("tenant_id", tid).eq("subject_id", subjectId).in("type", s.types);
    if (b.past_questions_only) q = q.eq("exam_body", fmt.exam_body);
    const { data: bank } = await q.limit(5000);
    const want = Math.ceil(s.count * b.pool_factor);
    const picked = secureShuffle(bank ?? []).slice(0, want);
    if (picked.length < s.count) shortfalls.push(`${sectionName}: ${picked.length} of ${s.count} questions found`);
    if (picked.length > s.count) draw[sectionName] = s.count;
    for (const r of picked as any[]) rows.push({
      exam_id: exam.id, position: ++pos, section: sectionName, type: r.type, prompt: r.prompt, media_url: r.media_url,
      points: Math.round(s.points * 10000) / 10000, data: r.data, answer: r.answer, bank_question_id: r.id, topic: r.topic, difficulty: r.difficulty, bloom: r.bloom
    });
  }
  for (let i = 0; i < rows.length; i += 500) {
    const { error: e } = await ctx.sb.from("exam_questions").insert(rows.slice(i, i + 500));
    if (e) return jsonError(e.message);
  }
  if (Object.keys(draw).length) {
    await ctx.sb.from("exams").update({ settings: { ...fmt.settings, format: fmt.id, draw } }).eq("id", exam.id);
  }
  const svc = createServiceClient();
  const used = rows.map(r => r.bank_question_id as string);
  for (let i = 0; i < used.length; i += 200) {
    const { data: cur } = await svc.from("question_bank").select("id,times_used").in("id", used.slice(i, i + 200));
    for (const c of cur ?? []) await svc.from("question_bank").update({ times_used: (c.times_used ?? 0) + 1 }).eq("id", c.id);
  }
  return NextResponse.json({ id: exam.id, questions: rows.length, shortfalls }, { status: 201 });
}
