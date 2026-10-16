import { NextResponse } from "next/server";
import { requireCtx } from "@/lib/auth";
import { studentToday } from "@/lib/portal-server";

export const dynamic = "force-dynamic";

/** A student's day: lessons, homework, library books, fees (when the school allows) and attendance this term. */
export async function GET() {
  const ctx = await requireCtx(["student"]);
  if (ctx instanceof NextResponse) return ctx;
  const { data: me } = await ctx.sb.from("students").select("id,class_group_id").eq("tenant_id", ctx.tenant.id).eq("user_id", ctx.userId).maybeSingle();
  if (!me) return NextResponse.json({ linked: false });
  const data = await studentToday(ctx.sb, ctx.tenant.id, ctx.tenant.timezone, me);
  return NextResponse.json({ linked: true, ...data });
}
