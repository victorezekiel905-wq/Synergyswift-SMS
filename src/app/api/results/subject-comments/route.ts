import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";

/** Per-subject comments, effort, target and predicted grades for one class, subject and term. */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "results");
  if (ctx instanceof NextResponse) return ctx;
  const u = new URL(req.url);
  const termId = u.searchParams.get("term_id"), cg = u.searchParams.get("class_group_id"), subj = u.searchParams.get("subject_id");
  if (!termId || !cg || !subj) return jsonError("term_id, class_group_id and subject_id are required");
  const { data: students } = await ctx.sb.from("students").select("id").eq("tenant_id", ctx.tenant.id).eq("class_group_id", cg).eq("status", "active");
  const ids = (students ?? []).map((s: { id: string }) => s.id);
  if (!ids.length) return NextResponse.json({ notes: {} });
  const { data } = await ctx.sb.from("report_subject_comments").select("student_id,comment,effort,target_grade,predicted_grade")
    .eq("term_id", termId).eq("subject_id", subj).in("student_id", ids);
  return NextResponse.json({ notes: Object.fromEntries((data ?? []).map((n: any) => [n.student_id, n])) });
}

const Body = z.object({
  term_id: z.string().uuid(), subject_id: z.string().uuid(),
  notes: z.array(z.object({
    student_id: z.string().uuid(),
    comment: z.string().trim().max(600).nullish(), effort: z.string().trim().max(20).nullish(),
    target_grade: z.string().trim().max(10).nullish(), predicted_grade: z.string().trim().max(10).nullish()
  })).max(500)
});

/** Saves notes; RLS lets only the subject teacher, the form teacher or an admin write them. */
export async function PUT(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "results");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const blank = (v: string | null | undefined) => (v ? v : null);
  const rows = b.notes.map(n => ({
    tenant_id: ctx.tenant.id, term_id: b.term_id, subject_id: b.subject_id, student_id: n.student_id,
    comment: blank(n.comment), effort: blank(n.effort), target_grade: blank(n.target_grade), predicted_grade: blank(n.predicted_grade),
    updated_by: ctx.userId, updated_at: new Date().toISOString()
  }));
  if (!rows.length) return NextResponse.json({ saved: 0 });
  const { error } = await ctx.sb.from("report_subject_comments").upsert(rows, { onConflict: "term_id,student_id,subject_id" });
  if (error) return jsonError(error.message.includes("row-level security") ? "only the subject teacher, form teacher or an admin can write these" : error.message, 403);
  return NextResponse.json({ saved: rows.length });
}
