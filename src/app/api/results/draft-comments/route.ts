import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError, hasAny } from "@/lib/auth";
import { generateReportComments, assistErrorMessage, type CommentInput, type CommentStyle } from "@/lib/assist";
import { commentInputFor, type CardForComment } from "@/lib/comment-input";

export const maxDuration = 180;

const Body = z.object({
  term_id: z.string().uuid(),
  class_group_id: z.string().uuid(),
  role: z.enum(["form_teacher", "principal"]),
  kind: z.enum(["term", "midterm"]).default("term"),
  overwrite: z.boolean().default(false),
  tone: z.enum(["warm", "formal", "encouraging", "firm"]).optional(),
  length: z.enum(["short", "medium"]).optional(),
  /** One student only (the "Write for me" button on a card). */
  student_id: z.string().uuid().optional(),
  /** Return the drafts without saving them. */
  preview: z.boolean().default(false)
});

/**
 * Drafts personal comments for the class's report cards from each student's
 * actual results: subjects, change since last term, attendance, character
 * ratings and effort. Existing comments are kept unless overwrite=true.
 * Staff review before publishing.
 */
export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "results");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError("term_id, class_group_id and role are required");
  const b = parsed.data;
  const tid = ctx.tenant.id;
  if (b.role === "principal" && !hasAny(ctx, ROLES.admin)) return jsonError("only admins can draft the principal's comments", 403);
  if (b.role === "form_teacher" && !hasAny(ctx, ROLES.admin)) {
    const { data: g } = await ctx.sb.from("class_groups").select("form_teacher_id").eq("tenant_id", tid).eq("id", b.class_group_id).maybeSingle();
    if (g?.form_teacher_id !== ctx.userId) return jsonError("only the form teacher or an admin can draft these comments", 403);
  }
  let cardsQ = ctx.sb.from("report_cards").select("id,student_id,average,position,class_size,teacher_comment,principal_comment,status,data")
    .eq("tenant_id", tid).eq("term_id", b.term_id).eq("class_group_id", b.class_group_id).eq("kind", b.kind);
  if (b.student_id) cardsQ = cardsQ.eq("student_id", b.student_id);
  const { data: cards } = await cardsQ;
  const field = b.role === "principal" ? "principal_comment" : "teacher_comment";
  const todo = (cards ?? []).filter((c: any) => c.status !== "published" && (b.preview || b.student_id || b.overwrite || !c[field])) as CardForComment[];
  if (!todo.length) return NextResponse.json({ drafted: 0, comments: {}, note: "every card already has a comment (or is published)" });

  const ids = todo.map(c => c.student_id);
  const [{ data: prev }, { data: kids }, { data: st }] = await Promise.all([
    // Last term's card for the trend and the subjects that moved most.
    ctx.sb.from("report_cards").select("student_id,average,computed_at,data").eq("tenant_id", tid).eq("kind", "term").neq("term_id", b.term_id)
      .in("student_id", ids).order("computed_at", { ascending: false }),
    ctx.sb.from("students").select("id,gender").eq("tenant_id", tid).in("id", ids),
    ctx.sb.from("tenant_settings").select("*").eq("tenant_id", tid).maybeSingle()
  ]);
  const prevCard = new Map<string, any>();
  for (const p of prev ?? []) if (!prevCard.has(p.student_id)) prevCard.set(p.student_id, p);
  const gender = new Map<string, string | null>((kids ?? []).map((k: any) => [k.id, k.gender ?? null]));
  const saved = ((st as any)?.ai_settings?.comments ?? {}) as CommentStyle;
  const style: CommentStyle = { tone: b.tone ?? saved.tone ?? "warm", length: b.length ?? saved.length ?? "short" };

  const input: CommentInput[] = todo.map(c => commentInputFor(c, prevCard.get(c.student_id) ?? null, gender.get(c.student_id) ?? null, b.role));

  try {
    const { data: term } = await ctx.sb.from("terms").select("name,academic_sessions(name)").eq("id", b.term_id).maybeSingle();
    const passMark = Number((todo[0] as any)?.data?.scheme?.pass_mark ?? 40);
    const termLabel = `${term?.name ?? ""} ${term?.academic_sessions?.name ?? ""}`.trim();
    const drafts: Record<string, string> = {};
    let drafted = 0;
    // Batches keep each request small and let one failure not lose the rest.
    for (let i = 0; i < input.length; i += 20) {
      const map = await generateReportComments({ role: b.role, termLabel, passMark, students: input.slice(i, i + 20), style });
      for (const [studentId, comment] of map) {
        drafts[studentId] = comment;
        if (b.preview) continue;
        const card = todo.find(c => c.student_id === studentId);
        if (!card) continue;
        const { error } = await ctx.sb.from("report_cards").update({ [field]: comment }).eq("id", card.id);
        if (!error) drafted++;
      }
    }
    if (!b.preview) await ctx.sb.from("audit_logs").insert({ tenant_id: tid, actor_id: ctx.userId, action: "report_comments.drafted", meta: { class_group_id: b.class_group_id, role: b.role, drafted, style } });
    return NextResponse.json({ drafted: b.preview ? Object.keys(drafts).length : drafted, comments: drafts });
  } catch (e) {
    const { message, status } = assistErrorMessage(e);
    return jsonError(message, status);
  }
}
