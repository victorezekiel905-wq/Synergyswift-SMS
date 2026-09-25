import { NextRequest, NextResponse } from "next/server";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { loadQuestions, autoSubmitIfExpired } from "@/lib/exams/server";
import { schemeFor } from "@/lib/school";

/**
 * Releases results to students and (optionally) pushes each score into the
 * result sheet: score / max × component max, for the exam's term, subject
 * and assessment component.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await requireCtx(ROLES.staff, "exams");
  if (ctx instanceof NextResponse) return ctx;
  const { push_to_results = false, release = true } = await readJson<{ push_to_results?: boolean; release?: boolean }>(req);
  const { data: exam } = await ctx.sb.from("exams").select("*").eq("tenant_id", ctx.tenant.id).eq("id", params.id).maybeSingle();
  if (!exam) return jsonError("not found", 404);
  const svc = createServiceClient();
  const questions = await loadQuestions(svc, exam.id);
  const { data: attempts } = await svc.from("exam_attempts").select("*").eq("exam_id", exam.id);
  const final = [];
  for (const a of attempts ?? []) final.push(await autoSubmitIfExpired(svc, a, questions));
  const pending = final.filter(a => a.status === "submitted").length;
  const running = final.filter(a => a.status === "in_progress" || a.status === "locked").length;

  let pushed = 0;
  const skipped: string[] = [];
  if (push_to_results) {
    if (!exam.term_id || !exam.subject_id || !exam.component_id || !exam.class_group_id) {
      return jsonError("set the exam's class, subject, term and result component (Settings tab) before pushing scores");
    }
    if (pending) return jsonError(`${pending} scripts still need manual marking`);
    const scheme = await schemeFor(ctx.sb, ctx.tenant.id, exam.class_group_id);
    const comp = scheme?.components.find(c => c.id === exam.component_id);
    if (!comp) return jsonError("the selected result component is not in this class's grading scheme");
    const { data: studs } = await svc.from("students").select("id,user_id").eq("tenant_id", ctx.tenant.id).in("user_id", final.map(a => a.student_user_id));
    const byUser = new Map((studs ?? []).map((s: any) => [s.user_id, s.id]));
    const rows = [];
    for (const a of final.filter(x => x.status === "graded")) {
      const sid = byUser.get(a.student_user_id);
      if (!sid || !Number(a.max_score)) { skipped.push(a.student_user_id); continue; }
      const scaled = Math.round((Number(a.total_score) / Number(a.max_score)) * comp.max_score * 100) / 100;
      rows.push({ tenant_id: ctx.tenant.id, term_id: exam.term_id, subject_id: exam.subject_id, component_id: comp.id,
        student_id: sid, score: scaled, source: `exam:${exam.id}`, entered_by: ctx.userId, updated_at: new Date().toISOString() });
    }
    if (rows.length) {
      // RLS: only the subject teacher / form teacher / admins may write these scores.
      const { error } = await ctx.sb.from("score_entries").upsert(rows, { onConflict: "term_id,student_id,subject_id,component_id" });
      if (error) return jsonError(error.message.includes("row-level security") ? "you can only push scores for subjects you teach" : error.message, 403);
    }
    pushed = rows.length;
  }
  if (release) await ctx.sb.from("exams").update({ results_released: true }).eq("id", exam.id);
  return NextResponse.json({ released: release, pushed, skipped: skipped.length, still_running: running, pending_manual: pending });
}
