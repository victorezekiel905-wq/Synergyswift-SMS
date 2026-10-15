import { NextRequest, NextResponse } from "next/server";
import { requireCtx } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { createFeed } from "@/lib/calendar-server";
import { subscribeLinks } from "@/lib/calendar";
import { appUrl } from "@/lib/school";

export const dynamic = "force-dynamic";

/** Whether this person has a calendar link (the link itself is only shown when made). */
export async function GET() {
  const ctx = await requireCtx();
  if (ctx instanceof NextResponse) return ctx;
  const { data } = await createServiceClient().from("calendar_feeds").select("created_at,last_used_at").eq("user_id", ctx.userId).maybeSingle();
  return NextResponse.json({ feed: data ?? null });
}

/** Makes a new private link (any earlier one stops working). */
export async function POST(req: NextRequest) {
  const ctx = await requireCtx();
  if (ctx instanceof NextResponse) return ctx;
  const token = await createFeed(createServiceClient(), ctx.tenant.id, ctx.userId);
  const url = `${appUrl(req)}/api/calendar/ics/${token}`;
  await ctx.sb.from("audit_logs").insert({ tenant_id: ctx.tenant.id, actor_id: ctx.userId, action: "calendar.feed_created", meta: {} });
  return NextResponse.json({ url, ...subscribeLinks(url, `${ctx.tenant.name} calendar`) });
}

export async function DELETE() {
  const ctx = await requireCtx();
  if (ctx instanceof NextResponse) return ctx;
  await createServiceClient().from("calendar_feeds").delete().eq("user_id", ctx.userId);
  return NextResponse.json({ ok: true });
}
