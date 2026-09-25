import { NextRequest, NextResponse } from "next/server";
import { requireCtx, ROLES, jsonError } from "@/lib/auth";

export async function DELETE(_req: NextRequest, { params }: { params: { id: string; qid: string } }) {
  const ctx = await requireCtx(ROLES.staff, "exams");
  if (ctx instanceof NextResponse) return ctx;
  const { data: exam } = await ctx.sb.from("exams").select("id,status").eq("tenant_id", ctx.tenant.id).eq("id", params.id).maybeSingle();
  if (!exam) return jsonError("exam not found", 404);
  const { count } = await ctx.sb.from("exam_attempts").select("id", { count: "exact", head: true }).eq("exam_id", params.id);
  if ((count ?? 0) > 0) return jsonError("students have started this exam; questions can no longer be removed");
  const { error } = await ctx.sb.from("exam_questions").delete().eq("exam_id", params.id).eq("id", params.qid);
  return error ? jsonError(error.message) : NextResponse.json({ ok: true });
}
