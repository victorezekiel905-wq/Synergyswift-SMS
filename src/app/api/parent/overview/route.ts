import { NextResponse } from "next/server";
import { requireCtx, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { guardianOverview } from "@/lib/guardian";

/** Logged-in parent: same view as the token portal, resolved from the session. */
export async function GET() {
  const ctx = await requireCtx();
  if (ctx instanceof NextResponse) return ctx;
  const { data: g } = await ctx.sb.from("guardians").select("id").eq("tenant_id", ctx.tenant.id).eq("user_id", ctx.userId).maybeSingle();
  if (!g) return jsonError("no guardian record is linked to this account", 404);
  const data = await guardianOverview(createServiceClient(), ctx.tenant.id, g.id, ctx.tenant.timezone);
  return NextResponse.json(data);
}
