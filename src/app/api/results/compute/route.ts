import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError, hasAny } from "@/lib/auth";
import { compileClassResults } from "@/lib/results";

const Body = z.object({ term_id: z.string().uuid(), class_group_id: z.string().uuid(), force: z.boolean().default(false) });

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
  try {
    const r = await compileClassResults(ctx.sb, ctx.tenant.id, b.term_id, b.class_group_id, { force: b.force });
    return NextResponse.json(r);
  } catch (e) {
    return jsonError((e as Error).message);
  }
}
