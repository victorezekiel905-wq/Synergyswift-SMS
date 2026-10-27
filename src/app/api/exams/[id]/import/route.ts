import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, jsonError } from "@/lib/auth";
import { extractDocumentText } from "@/lib/lesson-import";
import { parsePaper } from "@/lib/exams/paper-import";
import { validateQuestion, type Question } from "@/lib/exams/engine";

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

  if ((req.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return jsonError("choose a file");
    if (file.size > MAX_BYTES) return jsonError("the file is larger than 15 MB");
    try {
      const text = await extractDocumentText(new Uint8Array(await file.arrayBuffer()), file.name);
      if (text.trim().length < 20) return jsonError("No text was found in that file. If it is a scanned paper, type or paste the questions instead.");
      return NextResponse.json({ ...parsePaper(text), text: text.slice(0, 60000) });
    } catch (e) {
      return jsonError((e as Error).message);
    }
  }
  const body = await req.json().catch(() => null);
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
