import { NextRequest, NextResponse } from "next/server";
import { requireCtx, ROLES, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { analyseExam } from "@/lib/exams/analysis";

/** Item analysis over submitted attempts: difficulty, discrimination, distractors, reliability. */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const ctx = await requireCtx(ROLES.staff, "exams");
  if (ctx instanceof NextResponse) return ctx;
  const { data: exam } = await ctx.sb.from("exams").select("id").eq("tenant_id", ctx.tenant.id).eq("id", params.id).maybeSingle();
  if (!exam) return jsonError("not found", 404);
  const svc = createServiceClient();
  const { data: questions } = await svc.from("exam_questions").select("id,type,prompt,points,data,answer,section,position,topic,bloom,difficulty").eq("exam_id", exam.id).order("position");
  const { data: attempts } = await svc.from("exam_attempts").select("id,marks,answers,question_order")
    .eq("tenant_id", ctx.tenant.id).eq("exam_id", exam.id).in("status", ["submitted", "graded"]);
  const qs = (questions ?? []).map((q: any) => ({ ...q, points: Number(q.points) }));
  const analysis = analyseExam(qs, attempts ?? []);
  return NextResponse.json({ ...analysis, questions: qs.map((q: any) => ({ id: q.id, prompt: q.prompt, type: q.type, points: q.points })) });
}
