import { NextRequest, NextResponse } from "next/server";
import { requireCtx, jsonError } from "@/lib/auth";
import { appUrl } from "@/lib/school";
import { clockKey, clockToken, CLOCK_WINDOW_S } from "@/lib/clock-qr";

export const dynamic = "force-dynamic";
const SHOW = ["gate_officer", "hr_manager", "school_admin", "principal", "platform_admin"];

/** The current clock-in code for the screen at the entrance (phase 14i). ?campus= picks the campus. */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(SHOW, "gate");
  if (ctx instanceof NextResponse) return ctx;
  const { data: s } = await ctx.sb.from("tenant_settings").select("*").eq("tenant_id", ctx.tenant.id).maybeSingle();
  const campuses: string[] = s?.campuses ?? [];
  const campus = new URL(req.url).searchParams.get("campus") || null;
  if (campus && !campuses.includes(campus)) return jsonError("unknown campus", 404);
  const token = clockToken(ctx.tenant.id, campus, clockKey());
  return NextResponse.json({ url: `${appUrl(req)}/clock?t=${encodeURIComponent(token)}`, refresh_s: Math.floor(CLOCK_WINDOW_S / 2), campuses, campus,
    school: ctx.tenant.name });
}
