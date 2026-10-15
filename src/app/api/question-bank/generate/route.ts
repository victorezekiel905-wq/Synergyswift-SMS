import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";
import { assistConfigured, generateQuiz, assistErrorMessage } from "@/lib/assist";
import { toBankQuestion } from "@/lib/learning";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

const TYPES = ["mcq_single", "true_false", "short_answer", "numeric"] as const;
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("generate"), subject_id: z.string().uuid(), level: z.string().trim().min(1).max(40), topic: z.string().trim().min(2).max(200),
    count: z.number().int().min(1).max(20).default(10), types: z.array(z.enum(TYPES)).min(1).default(["mcq_single"]), difficulty: z.enum(["mixed", "easy", "medium", "hard"]).default("mixed"),
    objective_ids: z.array(z.string().uuid()).max(20).default([]), lesson_note_id: z.string().uuid().nullish(), source: z.string().max(30000).nullish() }),
  z.object({ action: z.literal("save"), subject_id: z.string().uuid().nullish(), level: z.string().trim().max(40).nullish(), topic: z.string().trim().max(120).nullish(), practice: z.boolean().default(false),
    questions: z.array(z.object({ type: z.enum(TYPES), prompt: z.string().min(3).max(4000), points: z.number().min(0).max(100).default(1), data: z.record(z.string(), z.unknown()),
      answer: z.record(z.string(), z.unknown()), explanation: z.string().max(2000).nullish(), difficulty: z.enum(["easy", "medium", "hard"]).nullish(), bloom: z.string().max(20).nullish() })).min(1).max(50) })
]);

/** Drafts quiz questions for review ("generate"), then adds the chosen ones to the question bank ("save"). */
export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "exams");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  if (b.action === "save") {
    const BLOOM = ["remember", "understand", "apply", "analyse", "evaluate", "create"];
    const rows = b.questions.map(q => ({ tenant_id: tid, created_by: ctx.userId, subject_id: b.subject_id ?? null, level: b.level ?? null, topic: b.topic ?? null,
      type: q.type, prompt: q.prompt, points: q.points, data: q.data, answer: q.answer, explanation: q.explanation ?? null, difficulty: q.difficulty ?? null,
      bloom: q.bloom && BLOOM.includes(q.bloom) ? q.bloom : null, practice: b.practice }));
    const { data, error } = await ctx.sb.from("question_bank").insert(rows).select("id");
    return error ? jsonError(error.message) : NextResponse.json({ ok: true, ids: (data ?? []).map((r: any) => r.id) }, { status: 201 });
  }
  if (!assistConfigured()) return jsonError("Question drafting is not set up on this server.", 503);
  const [{ data: subject }, { data: objectives }, { data: note }, { data: t }] = await Promise.all([
    ctx.sb.from("subjects").select("name").eq("tenant_id", tid).eq("id", b.subject_id).maybeSingle(),
    b.objective_ids.length ? ctx.sb.from("curriculum_objectives").select("code,statement").eq("tenant_id", tid).in("id", b.objective_ids) : { data: [] },
    b.lesson_note_id ? ctx.sb.from("lesson_notes").select("topic,content").eq("tenant_id", tid).eq("id", b.lesson_note_id).maybeSingle() : { data: null },
    ctx.sb.from("tenants").select("country").eq("id", tid).maybeSingle()
  ]);
  if (!subject) return jsonError("choose a subject");
  try {
    const drafts = await generateQuiz({ subject: subject.name, level: b.level, topic: b.topic, count: b.count, types: [...b.types], difficulty: b.difficulty,
      objectives: (objectives ?? []).map((o: any) => `${o.code ? `${o.code} ` : ""}${o.statement}`), source: note ? `${note.topic}\n\n${note.content}` : b.source ?? null, country: t?.country ?? null });
    const questions = drafts.map(toBankQuestion).filter(Boolean);
    await ctx.sb.from("audit_logs").insert({ tenant_id: tid, actor_id: ctx.userId, action: "quiz.drafted", meta: { subject: subject.name, topic: b.topic, count: questions.length } });
    return NextResponse.json({ questions, dropped: drafts.length - questions.length });
  } catch (e) {
    const { message, status } = assistErrorMessage(e);
    return jsonError(message, status);
  }
}

export async function GET() {
  const ctx = await requireCtx(ROLES.staff, "exams");
  if (ctx instanceof NextResponse) return ctx;
  return NextResponse.json({ available: assistConfigured() });
}
