import { NextResponse } from "next/server";
import { requireCtx, ROLES } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { canvaConfigured } from "@/lib/canva";

export const dynamic = "force-dynamic";

/** Whether "Open in Canva" is set up on this site, and whether this teacher has connected their Canva account. */
export async function GET() {
  const ctx = await requireCtx(ROLES.staff);
  if (ctx instanceof NextResponse) return ctx;
  if (!canvaConfigured()) return NextResponse.json({ configured: false, connected: false });
  const { data } = await createServiceClient().from("canva_connections").select("user_id").eq("user_id", ctx.userId).maybeSingle();
  return NextResponse.json({ configured: true, connected: Boolean(data) });
}

/** Disconnects this teacher's Canva account. */
export async function DELETE() {
  const ctx = await requireCtx(ROLES.staff);
  if (ctx instanceof NextResponse) return ctx;
  await createServiceClient().from("canva_connections").delete().eq("user_id", ctx.userId);
  return NextResponse.json({ ok: true });
}
