import { NextResponse } from "next/server";
import { requireCtx, ROLES } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Synergy Swift support visits to this school (phase 14k), for its admins. */
export async function GET() {
  const ctx = await requireCtx(ROLES.admin);
  if (ctx instanceof NextResponse) return ctx;
  const { data } = await ctx.sb.rpc("my_support_sessions");
  return NextResponse.json({ sessions: data ?? [] });
}
