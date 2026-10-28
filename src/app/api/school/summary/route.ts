import { NextResponse } from "next/server";
import { requireCtx, ROLES, jsonError } from "@/lib/auth";
import { aiErrorMessage } from "@/lib/ai";
import { headSummary } from "@/lib/ai-drafts";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** The head's week in plain words, written from the daily school figures (phase 14q). Admins only; nothing is saved. */
export async function POST() {
  const ctx = await requireCtx(ROLES.admin, "ai");
  if (ctx instanceof NextResponse) return ctx;
  try {
    const out = await headSummary(ctx);
    if (!out) return jsonError("There are no daily figures yet. They are recorded each afternoon; try again tomorrow.", 404);
    return NextResponse.json(out);
  } catch (e) {
    const { message, status } = aiErrorMessage(e);
    return jsonError(message, status);
  }
}
