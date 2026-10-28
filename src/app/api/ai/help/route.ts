import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { aiErrorMessage, PARENT_HELP_PER_DAY } from "@/lib/ai";
import { parentHelp } from "@/lib/ai-drafts";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({ turns: z.array(z.object({ role: z.enum(["user", "model"]), text: z.string().trim().min(1).max(600) })).min(1).max(12) });

/** "Ask the school": parents' help chat (phase 14q). Answers only from what the school has published and the parent's own fees. */
export async function GET() {
  const ctx = await requireCtx(["parent"], "ai");
  if (ctx instanceof NextResponse) return ctx;
  const { data: st } = await ctx.sb.from("tenant_settings").select("*").eq("tenant_id", ctx.tenant.id).maybeSingle();
  return NextResponse.json({ enabled: (st as any)?.ai_settings?.parent_help !== false, per_day: PARENT_HELP_PER_DAY, phone: st?.phone ?? null, email: st?.email ?? null });
}

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(["parent"], "ai");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError("Type a question (up to 600 characters).");
  const turns = parsed.data.turns;
  if (turns[turns.length - 1].role !== "user") return jsonError("Type a question.");
  const { data: st } = await ctx.sb.from("tenant_settings").select("*").eq("tenant_id", ctx.tenant.id).maybeSingle();
  if ((st as any)?.ai_settings?.parent_help === false) return jsonError("The help assistant is switched off at your school. Please contact the school office.", 403);
  try {
    return NextResponse.json(await parentHelp(ctx, createServiceClient(), turns));
  } catch (e) {
    const { message, status } = aiErrorMessage(e);
    return jsonError(message, status);
  }
}
