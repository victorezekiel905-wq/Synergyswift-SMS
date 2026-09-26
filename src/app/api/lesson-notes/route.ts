import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError, hasAny } from "@/lib/auth";
import { generateLessonNote, lessonNoteToText, aiConfigured, aiErrorMessage } from "@/lib/ai";

export const maxDuration = 120;

/** Mine (teachers) or the review queue (?queue=1 for principal / QA). */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "lesson_notes");
  if (ctx instanceof NextResponse) return ctx;
  const u = new URL(req.url);
  const reviewer = hasAny(ctx, ROLES.reviewer);
  let q = ctx.sb.from("lesson_notes").select("id,author_id,subject_id,class_group_id,term_id,week,topic,status,ai_generated,review_comment,submitted_at,reviewed_at,updated_at,subjects(name),class_groups(name),author:users!lesson_notes_author_id_fkey(full_name)")
    .eq("tenant_id", ctx.tenant.id).order("updated_at", { ascending: false }).limit(300);
  if (u.searchParams.get("queue") === "1" && reviewer) q = q.eq("status", "submitted");
  else if (!reviewer || u.searchParams.get("mine") === "1") q = q.eq("author_id", ctx.userId);
  const id = u.searchParams.get("id");
  if (id) {
    const { data } = await ctx.sb.from("lesson_notes").select("*,subjects(name),class_groups(name),author:users!lesson_notes_author_id_fkey(full_name)").eq("tenant_id", ctx.tenant.id).eq("id", id).maybeSingle();
    return data ? NextResponse.json(data) : jsonError("not found", 404);
  }
  const { data, error } = await q;
  if (error) return jsonError(error.message);
  return NextResponse.json({ items: data ?? [], reviewer, ai: aiConfigured(), me: ctx.userId });
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), id: z.string().uuid().optional(), subject_id: z.string().uuid().nullish(), class_group_id: z.string().uuid().nullish(),
    term_id: z.string().uuid().nullish(), week: z.number().int().min(1).max(20).nullish(), topic: z.string().trim().min(2).max(200), content: z.string().max(60000),
    ai_generated: z.boolean().optional(), submit: z.boolean().default(false) }),
  z.object({ action: z.literal("review"), id: z.string().uuid(), decision: z.enum(["approved", "returned"]), comment: z.string().trim().max(2000).nullish() }),
  z.object({ action: z.literal("delete"), id: z.string().uuid() }),
  z.object({ action: z.literal("generate"), subject: z.string().trim().min(1).max(80), level: z.string().trim().min(1).max(60), topic: z.string().trim().min(2).max(200),
    week: z.number().int().min(1).max(20).nullish(), duration_minutes: z.number().int().min(10).max(240).nullish(),
    curriculum: z.string().trim().max(120).nullish(), notes: z.string().trim().max(2000).nullish() })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "lesson_notes");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;

  if (b.action === "generate") {
    try {
      const { data: t } = await ctx.sb.from("tenants").select("country").eq("id", tid).maybeSingle();
      const note = await generateLessonNote({ subject: b.subject, level: b.level, topic: b.topic, week: b.week, durationMinutes: b.duration_minutes,
        curriculum: b.curriculum, notes: b.notes, country: t?.country ?? null });
      await ctx.sb.from("audit_logs").insert({ tenant_id: tid, actor_id: ctx.userId, action: "ai.lesson_note_generated", meta: { subject: b.subject, topic: b.topic } });
      return NextResponse.json({ note, text: lessonNoteToText(note) });
    } catch (e) {
      const { message, status } = aiErrorMessage(e);
      return jsonError(message, status);
    }
  }
  if (b.action === "save") {
    const { action: _a, id, submit, ...row } = b;
    const fields = { ...row, updated_at: new Date().toISOString(), ...(submit ? { status: "submitted", submitted_at: new Date().toISOString() } : {}) };
    if (id) {
      const { data: cur } = await ctx.sb.from("lesson_notes").select("status,author_id").eq("tenant_id", tid).eq("id", id).maybeSingle();
      if (!cur || cur.author_id !== ctx.userId) return jsonError("not found", 404);
      if (cur.status === "approved") return jsonError("approved notes are locked");
      const { error } = await ctx.sb.from("lesson_notes").update({ ...fields, status: submit ? "submitted" : cur.status === "returned" ? "draft" : cur.status }).eq("id", id);
      return error ? jsonError(error.message) : NextResponse.json({ id });
    }
    const { data, error } = await ctx.sb.from("lesson_notes").insert({ ...fields, tenant_id: tid, author_id: ctx.userId, status: submit ? "submitted" : "draft" }).select("id").single();
    return error ? jsonError(error.message) : NextResponse.json(data, { status: 201 });
  }
  if (b.action === "review") {
    const { error } = await ctx.sb.from("lesson_notes").update({ status: b.decision, review_comment: b.comment ?? null, reviewer_id: ctx.userId, reviewed_at: new Date().toISOString() })
      .eq("tenant_id", tid).eq("id", b.id);
    return error ? jsonError(error.message.replace(/^.*?: /, ""), 403) : NextResponse.json({ ok: true });
  }
  const { error } = await ctx.sb.from("lesson_notes").delete().eq("tenant_id", tid).eq("id", b.id);
  return error ? jsonError(error.message) : NextResponse.json({ ok: true });
}
