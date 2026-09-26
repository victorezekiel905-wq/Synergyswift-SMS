import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError, hasAny } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { studentName } from "@/lib/school";

/**
 * Staff: homework they set (or all, for admins) with submission counts; ?id= for one with submissions.
 * Students: homework for their class with their own submission.
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
    const { data: hw } = await svc.from("homework").select("id,title,instructions,attachment_url,due_at,max_score,allow_late,subjects(name)")
      .eq("tenant_id", tid).eq("class_group_id", me.class_group_id).order("due_at", { ascending: false }).limit(100);
    const { data: subs } = await svc.from("homework_submissions").select("homework_id,submitted_at,late,score,feedback").eq("student_id", me.id);
    const by = new Map((subs ?? []).map((s: any) => [s.homework_id, s]));
    return NextResponse.json((hw ?? []).map((h: any) => ({ ...h, submission: by.get(h.id) ?? null })));
  }
  if (!hasAny(ctx, ROLES.staff)) return jsonError("forbidden", 403);

  if (id) {
    const { data: hw } = await ctx.sb.from("homework").select("*,class_groups(name),subjects(name)").eq("tenant_id", tid).eq("id", id).maybeSingle();
    if (!hw) return jsonError("not found", 404);
    const [{ data: students }, { data: subs }] = await Promise.all([
      ctx.sb.from("students").select("id,admission_no,first_name,last_name,other_names").eq("tenant_id", tid).eq("class_group_id", hw.class_group_id).eq("status", "active").order("last_name"),
      ctx.sb.from("homework_submissions").select("*").eq("homework_id", hw.id)
    ]);
    const by = new Map((subs ?? []).map((s: any) => [s.student_id, s]));
    return NextResponse.json({ homework: hw, students: (students ?? []).map((s: any) => ({ id: s.id, name: studentName(s), admission_no: s.admission_no, submission: by.get(s.id) ?? null })) });
  }
  let q = ctx.sb.from("homework").select("id,title,due_at,max_score,created_at,set_by,class_groups(name),subjects(name),homework_submissions(count)")
    .eq("tenant_id", tid).order("due_at", { ascending: false }).limit(200);
  if (!hasAny(ctx, ROLES.admin)) q = q.eq("set_by", ctx.userId);
  const { data } = await q;
  return NextResponse.json(data ?? []);
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), class_group_id: z.string().uuid(), subject_id: z.string().uuid().nullish(), title: z.string().trim().min(2).max(160),
    instructions: z.string().trim().max(10000).nullish(), attachment_url: z.string().trim().url().nullish().or(z.literal("")), due_at: z.string().datetime({ offset: true }),
    max_score: z.number().min(0).max(1000).nullish(), allow_late: z.boolean().default(true) }),
  z.object({ action: z.literal("delete"), id: z.string().uuid() }),
  z.object({ action: z.literal("submit"), homework_id: z.string().uuid(), body: z.string().max(50000) }),
  z.object({ action: z.literal("mark"), submission_id: z.string().uuid(), score: z.number().min(0).max(1000).nullish(), feedback: z.string().trim().max(3000).nullish() })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(undefined, "homework");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;

  if (b.action === "submit") {
    if (!ctx.roles.has("student")) return jsonError("only students submit homework", 403);
    const svc = createServiceClient();
    const { data: me } = await svc.from("students").select("id,class_group_id").eq("tenant_id", tid).eq("user_id", ctx.userId).maybeSingle();
    const { data: hw } = await svc.from("homework").select("id,class_group_id,due_at,allow_late").eq("tenant_id", tid).eq("id", b.homework_id).maybeSingle();
    if (!me || !hw || hw.class_group_id !== me.class_group_id) return jsonError("homework not found", 404);
    const late = Date.now() > new Date(hw.due_at).getTime();
    if (late && !hw.allow_late) return jsonError("the deadline has passed", 409);
    const { data: existing } = await svc.from("homework_submissions").select("id,marked_at").eq("homework_id", hw.id).eq("student_id", me.id).maybeSingle();
    if (existing?.marked_at) return jsonError("this homework has already been marked", 409);
    const { error } = await svc.from("homework_submissions").upsert({ homework_id: hw.id, tenant_id: tid, student_id: me.id, body: b.body, late, submitted_at: new Date().toISOString() },
      { onConflict: "homework_id,student_id" });
    return error ? jsonError(error.message) : NextResponse.json({ ok: true, late });
  }
  if (!hasAny(ctx, ROLES.staff)) return jsonError("forbidden", 403);
  if (b.action === "create") {
    const { action: _a, ...row } = b;
    const { data, error } = await ctx.sb.from("homework").insert({ ...row, attachment_url: row.attachment_url || null, tenant_id: tid, set_by: ctx.userId }).select("id").single();
    return error ? jsonError(error.message) : NextResponse.json(data, { status: 201 });
  }
  if (b.action === "delete") {
    const { error } = await ctx.sb.from("homework").delete().eq("tenant_id", tid).eq("id", b.id);
    return error ? jsonError(error.message) : NextResponse.json({ ok: true });
  }
  const { error } = await ctx.sb.from("homework_submissions").update({ score: b.score ?? null, feedback: b.feedback ?? null, marked_by: ctx.userId, marked_at: new Date().toISOString() })
    .eq("tenant_id", tid).eq("id", b.submission_id);
  return error ? jsonError(error.message) : NextResponse.json({ ok: true });
}
