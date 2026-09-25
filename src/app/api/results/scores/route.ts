import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError, hasAny } from "@/lib/auth";
import { schemeFor } from "@/lib/school";

/** Score sheet for one term × class group × subject. */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "results");
  if (ctx instanceof NextResponse) return ctx;
  const u = new URL(req.url);
  const termId = u.searchParams.get("term_id"), cg = u.searchParams.get("class_group_id"), subj = u.searchParams.get("subject_id");
  if (!termId || !cg || !subj) return jsonError("term_id, class_group_id and subject_id are required");
  const tid = ctx.tenant.id;

  const scheme = await schemeFor(ctx.sb, tid, cg);
  if (!scheme) return jsonError("no grading scheme configured; set one up under School setup → Grading");
  const [{ data: students }, { data: offering }, { data: group }] = await Promise.all([
    ctx.sb.from("students").select("id,admission_no,first_name,last_name,other_names")
      .eq("tenant_id", tid).eq("class_group_id", cg).eq("status", "active").order("last_name").order("first_name"),
    ctx.sb.from("subject_offerings").select("teacher_id").eq("tenant_id", tid).eq("class_group_id", cg).eq("subject_id", subj).maybeSingle(),
    ctx.sb.from("class_groups").select("form_teacher_id").eq("tenant_id", tid).eq("id", cg).maybeSingle()
  ]);
  const ids = (students ?? []).map((s: { id: string }) => s.id);
  const { data: scores } = ids.length
    ? await ctx.sb.from("score_entries").select("student_id,component_id,score,source,updated_at")
        .eq("tenant_id", tid).eq("term_id", termId).eq("subject_id", subj).in("student_id", ids)
    : { data: [] };
  const grid: Record<string, Record<string, number | null>> = {};
  for (const s of scores ?? []) (grid[s.student_id] ??= {})[s.component_id] = s.score === null ? null : Number(s.score);

  const canEdit = hasAny(ctx, ROLES.admin) || offering?.teacher_id === ctx.userId || group?.form_teacher_id === ctx.userId;
  return NextResponse.json({ scheme, students: students ?? [], scores: grid, can_edit: canEdit });
}

const Put = z.object({
  term_id: z.string().uuid(),
  subject_id: z.string().uuid(),
  class_group_id: z.string().uuid(),
  entries: z.array(z.object({
    student_id: z.string().uuid(),
    component_id: z.string().uuid(),
    score: z.number().nullable()
  })).max(5000)
});

/** Bulk save. RLS (can_enter_scores) restricts teachers to subjects they teach. */
export async function PUT(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "results");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Put.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;

  const scheme = await schemeFor(ctx.sb, tid, b.class_group_id);
  if (!scheme) return jsonError("no grading scheme configured");
  const maxBy = new Map(scheme.components.map(c => [c.id, c.max_score]));
  const { data: students } = await ctx.sb.from("students").select("id").eq("tenant_id", tid).eq("class_group_id", b.class_group_id);
  const inClass = new Set((students ?? []).map((s: { id: string }) => s.id));

  const upserts: Record<string, unknown>[] = [];
  const deletes: { student_id: string; component_id: string }[] = [];
  const problems: string[] = [];
  for (const e of b.entries) {
    if (!inClass.has(e.student_id)) { problems.push("a student is not in this class"); continue; }
    const max = maxBy.get(e.component_id);
    if (max === undefined) { problems.push("unknown assessment component"); continue; }
    if (e.score === null) { deletes.push(e); continue; }
    if (e.score < 0 || e.score > max) { problems.push(`score ${e.score} is outside 0–${max}`); continue; }
    upserts.push({ tenant_id: tid, term_id: b.term_id, subject_id: b.subject_id, student_id: e.student_id, component_id: e.component_id,
      score: e.score, source: "manual", entered_by: ctx.userId, updated_at: new Date().toISOString() });
  }
  if (problems.length) return jsonError([...new Set(problems)].join("; "));

  if (upserts.length) {
    const { error } = await ctx.sb.from("score_entries").upsert(upserts, { onConflict: "term_id,student_id,subject_id,component_id" });
    if (error) return jsonError(error.message.includes("row-level security") ? "you can only enter scores for subjects you teach" : error.message, 403);
  }
  for (const d of deletes) {
    await ctx.sb.from("score_entries").delete().eq("tenant_id", tid).eq("term_id", b.term_id).eq("subject_id", b.subject_id)
      .eq("student_id", d.student_id).eq("component_id", d.component_id);
  }
  return NextResponse.json({ saved: upserts.length, cleared: deletes.length });
}
