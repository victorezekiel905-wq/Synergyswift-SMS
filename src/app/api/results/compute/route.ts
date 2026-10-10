import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError, hasAny } from "@/lib/auth";
import { compileClassResults } from "@/lib/results";

const Body = z.object({ term_id: z.string().uuid(), class_group_id: z.string().uuid(), force: z.boolean().default(false), kind: z.enum(["term", "midterm"]).default("term") });

/** Compile report cards for a class (admins or the form teacher). Published cards are kept unless force=true. */
export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "results");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError("term_id and class_group_id are required");
  const b = parsed.data;
  if (!hasAny(ctx, ROLES.admin)) {
    const { data: g } = await ctx.sb.from("class_groups").select("form_teacher_id").eq("tenant_id", ctx.tenant.id).eq("id", b.class_group_id).maybeSingle();
    if (g?.form_teacher_id !== ctx.userId) return jsonError("only admins or the form teacher can compile results", 403);
    if (b.force) return jsonError("only admins can recompute published results", 403);
  }
  // With moderation on, only approved score sheets may go onto report cards.
  const { data: settings } = await ctx.sb.from("tenant_settings").select("require_moderation").eq("tenant_id", ctx.tenant.id).maybeSingle();
  if (settings?.require_moderation && b.kind === "term") {
    const [{ data: offered }, { data: sheets }] = await Promise.all([
      ctx.sb.from("subject_offerings").select("subject_id,subjects(name)").eq("tenant_id", ctx.tenant.id).eq("class_group_id", b.class_group_id),
      ctx.sb.from("score_sheets").select("subject_id,status").eq("tenant_id", ctx.tenant.id).eq("term_id", b.term_id).eq("class_group_id", b.class_group_id)
    ]);
    const approved = new Set((sheets ?? []).filter((s: any) => s.status === "approved").map((s: any) => s.subject_id));
    const pending = (offered ?? []).filter((o: any) => !approved.has(o.subject_id)).map((o: any) => o.subjects?.name ?? "a subject");
    if (pending.length) return jsonError(`Scores still awaiting approval: ${pending.join(", ")}. Approve them under Results → Approvals first.`, 409);
  }
  try {
    const r = await compileClassResults(ctx.sb, ctx.tenant.id, b.term_id, b.class_group_id, { force: b.force, kind: b.kind });
    return NextResponse.json(r);
  } catch (e) {
    return jsonError((e as Error).message);
  }
}
