import { NextResponse } from "next/server";
import { requireCtx, ROLES } from "@/lib/auth";
import { teacherToday } from "@/lib/portal-server";

export const dynamic = "force-dynamic";

/** A teacher's day: lessons with register status, what to do next, and the classes they teach. */
export async function GET() {
  const ctx = await requireCtx(ROLES.staff);
  if (ctx instanceof NextResponse) return ctx;
  const data = await teacherToday(ctx.sb, ctx.tenant.id, ctx.tenant.timezone, ctx.userId);
  return NextResponse.json(data);
}
