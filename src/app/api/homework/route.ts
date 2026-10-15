import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError, hasAny } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { studentName } from "@/lib/school";
import { penalisedScore } from "@/lib/lms";
import { homeworkForStudent } from "@/lib/homework";

/**
 * Staff: homework they set (or all, for admins) with submission counts; ?id= for one with submissions.
 * Students: homework for their class (and groups) with their own submission.
 */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(undefined, "homework");
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  const u = new URL(req.url);
  const id = u.searchParams.get("id");

  if (ctx.roles.has("student")) {
    const svc = createServiceClient();
    const { data: me } = await svc.from("students").select("id,class_group_id").eq("tenant_id", tid).eq("user_id", ctx.userId).maybeSingle();
    if (!me?.class_group_id) return NextResponse.json([]);
    const hw = await homeworkForStudent(svc, tid, me);
    const { data: subs } = await svc.from("homework_submissions").select("id,homework_id,body,files,submitted_at,late,attempt,status,score,raw_score,penalty_pct,feedback,returned_note,feedback_media,marked_at").eq("student_id", me.id);
    const by = new Map((subs ?? []).map((s: any) => [s.homework_id, s]));
    const subIds = (subs ?? []).filter((s: any) => s.status !== "submitted").map((s: any) => s.id);
    const { data: notes } = subIds.length ? await svc.from("submission_annotations").select("id,submission_id,kind,start_offset,end_offset,quote,file_index,x,y,comment").in("submission_id", subIds) : { data: [] };
    return NextResponse.json(hw.map((h: any) => {
      const s: any = by.get(h.id) ?? null;
      // Scores and feedback stay hidden until marked or returned.
      const visible = s && s.status !== "submitted";
      return { ...h, group_ids: undefined, submission: s ? { ...s, files: (s.files ?? []).map((f: any, i: number) => ({ name: f.name, type: f.type, size: f.size, index: i })),
        score: visible ? s.score : null, raw_score: visible ? s.raw_score : null, feedback: visible ? s.feedback : null, feedback_media: visible ? (s.feedback_media ?? []).map((m: any, i: number) => ({ type: m.type, seconds: m.seconds, index: i })) : [],
        annotations: visible ? (notes ?? []).filter((n: any) => n.submission_id === s.id) : [] } : null };
    }));
  }
  if (!hasAny(ctx, ROLES.staff)) return jsonError("forbidden", 403);

  if (id) {
    const { data: hw } = await ctx.sb.from("homework").select("*,class_groups(name,level),subjects(name)").eq("tenant_id", tid).eq("id", id).maybeSingle();
    if (!hw) return jsonError("not found", 404);
    const [{ data: students }, { data: subs }, { data: members }, { data: groups }] = await Promise.all([
      ctx.sb.from("students").select("id,admission_no,first_name,last_name,other_names").eq("tenant_id", tid).eq("class_group_id", hw.class_group_id).eq("status", "active").order("last_name"),
      ctx.sb.from("homework_submissions").select("*,homework_submission_versions(attempt,submitted_at,late,score)").eq("homework_id", hw.id),
      hw.group_ids?.length ? ctx.sb.from("learning_group_members").select("student_id").in("group_id", hw.group_ids) : { data: null },
      ctx.sb.from("learning_groups").select("id,name").eq("class_group_id", hw.class_group_id)
    ]);
    const inGroup = members ? new Set((members as any[]).map(m => m.student_id)) : null;
    const by = new Map((subs ?? []).map((s: any) => [s.student_id, s]));
    return NextResponse.json({
      homework: hw, groups: groups ?? [],
      students: (students ?? []).filter((s: any) => !inGroup || inGroup.has(s.id))
        .map((s: any) => ({ id: s.id, name: studentName(s), admission_no: s.admission_no, submission: by.get(s.id) ?? null }))
    });
  }
  let q = ctx.sb.from("homework").select("id,title,due_at,max_score,created_at,set_by,group_ids,class_group_id,class_groups(name),subjects(name),homework_submissions(count)")
    .eq("tenant_id", tid).order("due_at", { ascending: false }).limit(200);
  if (!hasAny(ctx, ROLES.admin)) q = q.eq("set_by", ctx.userId);
  const { data } = await q;
  return NextResponse.json(data ?? []);
}

const Rules = {
  late_penalty_pct: z.number().min(0).max(100).default(0), late_penalty_max: z.number().min(0).max(100).default(100),
  allow_resubmit: z.boolean().default(false), max_attempts: z.number().int().min(1).max(10).default(1), accept_files: z.boolean().default(true),
  group_ids: z.array(z.string().uuid()).max(20).default([]), objective_ids: z.array(z.string().uuid()).max(50).default([]), check_originality: z.boolean().default(true)
};
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), class_group_id: z.string().uuid(), subject_id: z.string().uuid().nullish(), title: z.string().trim().min(2).max(160),
    instructions: z.string().trim().max(20000).nullish(), attachment_url: z.string().trim().url().nullish().or(z.literal("")), due_at: z.string().datetime({ offset: true }),
    max_score: z.number().min(0).max(1000).nullish(), allow_late: z.boolean().default(true), ...Rules }),
  z.object({ action: z.literal("delete"), id: z.string().uuid() }),
  z.object({ action: z.literal("mark"), submission_id: z.string().uuid(), score: z.number().min(0).max(1000).nullish(), feedback: z.string().trim().max(5000).nullish() }),
  z.object({ action: z.literal("return"), submission_id: z.string().uuid(), note: z.string().trim().min(2).max(2000) })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "homework");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;

  if (b.action === "create") {
    const { action: _a, ...row } = b;
    if (row.group_ids.length) {
      const { data: gs } = await ctx.sb.from("learning_groups").select("id").eq("tenant_id", tid).eq("class_group_id", row.class_group_id).in("id", row.group_ids);
      if ((gs ?? []).length !== row.group_ids.length) return jsonError("those groups are not in this class");
    }
    const { data, error } = await ctx.sb.from("homework").insert({ ...row, max_attempts: row.allow_resubmit ? Math.max(2, row.max_attempts) : row.max_attempts,
      attachment_url: row.attachment_url || null, tenant_id: tid, set_by: ctx.userId }).select("id").single();
    return error ? jsonError(error.message) : NextResponse.json(data, { status: 201 });
  }
  if (b.action === "delete") {
    const { error } = await ctx.sb.from("homework").delete().eq("tenant_id", tid).eq("id", b.id);
    return error ? jsonError(error.message) : NextResponse.json({ ok: true });
  }
  const { data: sub } = await ctx.sb.from("homework_submissions").select("id,penalty_pct,homework(max_score)").eq("tenant_id", tid).eq("id", b.submission_id).maybeSingle();
  if (!sub) return jsonError("submission not found", 404);
  if (b.action === "return") {
    // Sent back for another try: the student sees the note and can hand in again.
    const { error } = await ctx.sb.from("homework_submissions").update({ status: "returned", returned_note: b.note, marked_by: ctx.userId, marked_at: new Date().toISOString() }).eq("id", sub.id);
    return error ? jsonError(error.message) : NextResponse.json({ ok: true });
  }
  const max = (sub as any).homework?.max_score;
  if (b.score != null && max != null && b.score > Number(max)) return jsonError(`the score cannot be more than ${max}`);
  const final = b.score == null ? null : penalisedScore(b.score, Number(sub.penalty_pct ?? 0));
  const { error } = await ctx.sb.from("homework_submissions").update({ raw_score: b.score ?? null, score: final, feedback: b.feedback ?? null, status: "marked",
    marked_by: ctx.userId, marked_at: new Date().toISOString() }).eq("id", sub.id);
  return error ? jsonError(error.message) : NextResponse.json({ ok: true, score: final });
}
