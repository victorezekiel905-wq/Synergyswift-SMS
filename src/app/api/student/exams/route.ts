import { NextResponse } from "next/server";
import { requireCtx, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { windowState } from "@/lib/exams/server";

/** Exams available to the signed-in student (their class group, or school-wide). */
export async function GET() {
  const ctx = await requireCtx(["student"], "exams");
  if (ctx instanceof NextResponse) return ctx;
  const svc = createServiceClient();
  const { data: me } = await svc.from("students").select("id,class_group_id").eq("tenant_id", ctx.tenant.id).eq("user_id", ctx.userId).maybeSingle();
  if (!me) return jsonError("your login is not linked to a student record; ask the school office", 404);
  let q = svc.from("exams").select("id,title,duration_minutes,opens_at,closes_at,status,results_released,settings,subjects(name)")
    .eq("tenant_id", ctx.tenant.id).in("status", ["published", "closed"]).order("opens_at", { ascending: false, nullsFirst: false }).limit(100);
  q = me.class_group_id ? q.or(`class_group_id.is.null,class_group_id.eq.${me.class_group_id}`) : q.is("class_group_id", null);
  const { data: exams, error } = await q;
  if (error) return jsonError(error.message);
  const { data: attempts } = await svc.from("exam_attempts").select("exam_id,status,total_score,max_score")
    .eq("tenant_id", ctx.tenant.id).eq("student_user_id", ctx.userId);
  const byExam = new Map((attempts ?? []).map((a: any) => [a.exam_id, a]));
  return NextResponse.json((exams ?? []).map((e: any) => {
    const a: any = byExam.get(e.id);
    const showScore = a && (e.results_released || (e.settings?.show_score_after_submit && a.status === "graded"));
    return {
      id: e.id, title: e.title, subject: e.subjects?.name ?? null, duration_minutes: e.duration_minutes,
      opens_at: e.opens_at, closes_at: e.closes_at, window: windowState(e), require_seb: Boolean(e.settings?.require_seb),
      attempt_status: a?.status ?? null, score: showScore ? { total: a.total_score, max: a.max_score } : null
    };
  }));
}
