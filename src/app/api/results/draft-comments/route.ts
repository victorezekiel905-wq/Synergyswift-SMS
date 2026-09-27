import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError, hasAny } from "@/lib/auth";
import { generateReportComments, assistErrorMessage, type CommentInput } from "@/lib/assist";

export const maxDuration = 180;

const Body = z.object({
  term_id: z.string().uuid(),
  class_group_id: z.string().uuid(),
  role: z.enum(["form_teacher", "principal"]),
  overwrite: z.boolean().default(false)
});

/**
 * Drafts comments for every report card in the class from its actual results.
 * Existing comments are kept unless overwrite=true. Staff review before publishing.
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
  const { data: cards } = await ctx.sb.from("report_cards").select("id,student_id,average,position,class_size,teacher_comment,principal_comment,status,data")
    .eq("tenant_id", tid).eq("term_id", b.term_id).eq("class_group_id", b.class_group_id);
  const field = b.role === "principal" ? "principal_comment" : "teacher_comment";
  const todo = (cards ?? []).filter((c: any) => c.status !== "published" && (b.overwrite || !c[field]));
  if (!todo.length) return NextResponse.json({ drafted: 0, note: "every card already has a comment (or is published)" });

  // Previous term average for the trend, and attendance rate from the card data.
  const { data: prev } = await ctx.sb.from("report_cards").select("student_id,average,computed_at").eq("tenant_id", tid).neq("term_id", b.term_id)
    .in("student_id", todo.map((c: any) => c.student_id)).order("computed_at", { ascending: false });
  const prevAvg = new Map<string, number>();
  for (const p of prev ?? []) if (!prevAvg.has(p.student_id) && p.average !== null) prevAvg.set(p.student_id, Number(p.average));

  const input: CommentInput[] = todo.map((c: any) => {
    const subs = (c.data?.subjects ?? []).filter((s: any) => s.total !== null).sort((a: any, b2: any) => b2.total - a.total);
    const avg = c.average === null ? null : Number(c.average);
    const before = prevAvg.get(c.student_id);
    return {
      student_id: c.student_id,
      first_name: String(c.data?.student_name ?? "The student").split(" ")[0],
      average: avg, position: c.data?.scheme?.show_position ? c.position : null, class_size: c.class_size ?? 0,
      strongest: subs.slice(0, 2).map((s: any) => `${s.subject} (${s.total})`),
      weakest: subs.slice(-2).reverse().filter((s: any) => s.total < (c.data?.scheme?.pass_mark ?? 40) + 15).map((s: any) => `${s.subject} (${s.total})`),
      attendance_rate: null,
      trend: before === undefined || avg === null ? "new" : avg - before >= 3 ? "up" : before - avg >= 3 ? "down" : "steady"
    };
  });

  try {
    const { data: term } = await ctx.sb.from("terms").select("name,academic_sessions(name)").eq("id", b.term_id).maybeSingle();
    const passMark = Number((todo[0] as any)?.data?.scheme?.pass_mark ?? 40);
    let drafted = 0;
    // Batches keep each request small and let one failure not lose the rest.
    for (let i = 0; i < input.length; i += 25) {
      const map = await generateReportComments({ role: b.role, termLabel: `${term?.name ?? ""} ${term?.academic_sessions?.name ?? ""}`.trim(), passMark, students: input.slice(i, i + 25) });
      for (const [studentId, comment] of map) {
        const card = todo.find((c: any) => c.student_id === studentId);
        if (!card) continue;
        const { error } = await ctx.sb.from("report_cards").update({ [field]: comment }).eq("id", card.id);
        if (!error) drafted++;
      }
    }
    await ctx.sb.from("audit_logs").insert({ tenant_id: tid, actor_id: ctx.userId, action: "report_comments.drafted", meta: { class_group_id: b.class_group_id, role: b.role, drafted } });
    return NextResponse.json({ drafted });
  } catch (e) {
    const { message, status } = assistErrorMessage(e);
    return jsonError(message, status);
  }
}
