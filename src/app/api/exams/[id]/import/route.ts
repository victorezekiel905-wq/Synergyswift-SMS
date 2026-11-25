import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, jsonError } from "@/lib/auth";
import { extractDocumentText } from "@/lib/lesson-import";
import { parsePaper } from "@/lib/exams/paper-import";
import { validateQuestion, type Question } from "@/lib/exams/engine";
import { parseAnswerSheet, matchAnswers, type SheetQuestion } from "@/lib/exams/answer-attach";
import { remarkFinishedAttempts } from "@/lib/exams/server";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
const MAX_BYTES = 15 * 1024 * 1024;

const Draft = z.object({
  type: z.enum(["mcq_single", "true_false", "short_answer", "essay"]),
  prompt: z.string().trim().min(1).max(20000),
  points: z.number().min(0).max(1000),
  section: z.string().trim().max(80).nullish(),
  data: z.record(z.any()).default({}),
  answer: z.record(z.any()).default({})
});
const Save = z.object({ action: z.literal("save"), questions: z.array(Draft).min(1).max(300) });

/**
 * Import an existing exam paper (phase 14j).
 *  - multipart with `file` (PDF, Word or text), or JSON { action: "preview", text }: returns draft questions to check;
 *  - JSON { action: "save", questions }: adds them to the exam, after its current questions.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const ctx = await requireCtx(ROLES.staff, "exams");
  if (ctx instanceof NextResponse) return ctx;
  const { data: exam } = await ctx.sb.from("exams").select("id,status").eq("tenant_id", ctx.tenant.id).eq("id", params.id).maybeSingle();
  if (!exam) return jsonError("exam not found", 404);

  // The exam's questions in paper order, for attaching an answer sheet to them.
  const examQuestions = async (): Promise<SheetQuestion[]> => {
    const { data } = await ctx.sb.from("exam_questions").select("id,type,prompt,position,data,answer").eq("exam_id", exam.id).order("position");
    return (data ?? []) as SheetQuestion[];
  };
  const answersPreview = async (text: string) => {
    const qs = await examQuestions();
    if (!qs.length) return jsonError("add the questions first, then attach their answers");
    return NextResponse.json({ ...matchAnswers(qs, parseAnswerSheet(text)), text: text.slice(0, 60000) });
  };

  if ((req.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return jsonError("choose a file");
    if (file.size > MAX_BYTES) return jsonError("the file is larger than 15 MB");
    try {
      const text = await extractDocumentText(new Uint8Array(await file.arrayBuffer()), file.name);
      if (text.trim().length < 20) return jsonError("No text was found in that file. If it is a scanned paper, type or paste the questions instead.");
      // An answer sheet or marking guide for the questions already in the exam.
      if (form?.get("purpose") === "answers") return answersPreview(text);
      return NextResponse.json({ ...parsePaper(text), text: text.slice(0, 60000) });
    } catch (e) {
      return jsonError((e as Error).message);
    }
  }
  const body = await req.json().catch(() => null);
  if (body?.action === "answers_preview") {
    const text = String(body.text ?? "").slice(0, 200000);
    if (text.trim().length < 3) return jsonError("paste the answers first");
    return answersPreview(text);
  }
  if (body?.action === "answers_apply") {
    // Worked out again here from the same text, so only answers that really match a question are saved.
    const text = String(body.text ?? "").slice(0, 200000);
    const skip = new Set<string>(Array.isArray(body.skip) ? body.skip.map(String) : []);
    const qs = await examQuestions();
    const { items } = matchAnswers(qs, parseAnswerSheet(text));
    const chosen = items.filter(i => !skip.has(i.question_id));
    if (!chosen.length) return jsonError("no answers to attach");
    for (let i = 0; i < chosen.length; i += 20) {
      const results = await Promise.all(chosen.slice(i, i + 20).map(it =>
        ctx.sb.from("exam_questions").update({ answer: it.answer }).eq("exam_id", exam.id).eq("id", it.question_id)));
      const failed = results.find(r => r.error);
      if (failed?.error) return jsonError(failed.error.message);
    }
    // Scripts already handed in are marked again with the new key (marks a teacher gave are kept).
    const svc = createServiceClient();
    const { count } = await svc.from("exam_attempts").select("id", { count: "exact", head: true }).eq("exam_id", exam.id).in("status", ["submitted", "graded"]);
    const remark = count ? await remarkFinishedAttempts(svc, exam.id) : null;
    await ctx.sb.from("audit_logs").insert({ tenant_id: ctx.tenant.id, actor_id: ctx.userId, action: "exam.answers_attached", target: exam.id, meta: { answers: chosen.length } });
    return NextResponse.json({ attached: chosen.length, remarked: remark?.remarked ?? 0, changed: remark?.changed ?? 0 });
  }
  if (body?.action === "preview") {
    const text = String(body.text ?? "").slice(0, 200000);
    if (text.trim().length < 5) return jsonError("paste the questions first");
    return NextResponse.json(parsePaper(text));
  }
  const parsed = Save.safeParse(body);
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  if (exam.status !== "draft") return jsonError("questions can only be added while the exam is a draft");
  const { data: last } = await ctx.sb.from("exam_questions").select("position").eq("exam_id", exam.id).order("position", { ascending: false }).limit(1);
  const start = (last?.[0]?.position ?? 0) + 1;
  const rows = parsed.data.questions.map((q, i) => ({ exam_id: exam.id, position: start + i, type: q.type, prompt: q.prompt, points: q.points, section: q.section ?? null, data: q.data, answer: q.answer }));
  const { error } = await ctx.sb.from("exam_questions").insert(rows);
  if (error) return jsonError(error.message);
  // Questions still missing an answer are saved; the exam cannot be published until they are fixed.
  const unfinished = parsed.data.questions.filter(q => validateQuestion(q as unknown as Question).length).length;
  return NextResponse.json({ added: rows.length, unfinished });
}
