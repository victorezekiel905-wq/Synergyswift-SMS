import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError, hasAny } from "@/lib/auth";

export const dynamic = "force-dynamic";

const Body = z.object({ term_id: z.string().uuid(), kind: z.enum(["midterm", "term"]), locked: z.boolean() });

/**
 * The school admin locks or unlocks the mid-term or the end of term scores of a term, for every class
 * and subject (migration 10900). The database keeps the lock: teachers cannot change a locked score from
 * any page, upload or exam push; school admins can still correct one.
 */
export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.admin, "results");
  if (ctx instanceof NextResponse) return ctx;
  if (!hasAny(ctx, ROLES.admin)) return jsonError("only a school admin can lock or unlock scores", 403);
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError("choose the term and the mid-term or end of term scores");
  const b = parsed.data;
  const { data, error } = await ctx.sb.rpc("set_scores_lock", { p_term: b.term_id, p_kind: b.kind, p_locked: b.locked });
  if (error) {
    if (/set_scores_lock|function .* does not exist|schema cache/i.test(error.message)) return jsonError("Locking scores needs the latest database update (migration 20260101010900).", 400);
    return jsonError(error.message, /admin/.test(error.message) ? 403 : 400);
  }
  const t = Array.isArray(data) ? data[0] : data;
  return NextResponse.json({ midterm: Boolean(t?.midterm_scores_locked_at), term: Boolean(t?.term_scores_locked_at) });
}
