import { NextRequest, NextResponse } from "next/server";
import { requireCtx } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { buildCalendar } from "@/lib/calendar-server";
import { localParts, addDays } from "@/lib/attendance";

export const dynamic = "force-dynamic";

/** This person's calendar between two dates (at most 100 days). */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx();
  if (ctx instanceof NextResponse) return ctx;
  const u = new URL(req.url).searchParams;
  const ok = (d: string | null) => d && /^\d{4}-\d{2}-\d{2}$/.test(d);
  const today = localParts(new Date(), ctx.tenant.timezone).date;
  const from = ok(u.get("from")) ? u.get("from")! : today.slice(0, 8) + "01";
  let to = ok(u.get("to")) ? u.get("to")! : addDays(from, 41);
  if (to < from) to = from;
  if (Date.parse(to) - Date.parse(from) > 100 * 86400_000) to = addDays(from, 100);
  const items = await buildCalendar(createServiceClient(), { tenantId: ctx.tenant.id, timezone: ctx.tenant.timezone, userId: ctx.userId, roles: ctx.roles }, from, to);
  return NextResponse.json({ from, to, timezone: ctx.tenant.timezone, items });
}
