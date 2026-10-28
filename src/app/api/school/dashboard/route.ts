import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { normalizeLayout, SECTIONS } from "@/lib/dashboard-layout";

export const dynamic = "force-dynamic";

/** The school overview's arrangement (migration 8400). Staff read it; admins change it for the school. */
export async function GET() {
  const ctx = await requireCtx(ROLES.staff);
  if (ctx instanceof NextResponse) return ctx;
  const { data: st } = await ctx.sb.from("tenant_settings").select("*").eq("tenant_id", ctx.tenant.id).maybeSingle();
  return NextResponse.json({ layout: normalizeLayout((st as any)?.dashboard_layout), can_edit: ROLES.admin.some(r => ctx.roles.has(r)) });
}

const Body = z.object({ layout: z.object({
  sections: z.array(z.enum(SECTIONS.map(s => s.id) as [string, ...string[]])).max(10),
  hidden_stats: z.array(z.string().max(40)).max(30), hidden_links: z.array(z.string().max(80)).max(50)
}) });

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.admin);
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError("That layout isn't right.");
  const layout = normalizeLayout(parsed.data.layout);
  const { error } = await createServiceClient().from("tenant_settings").update({ dashboard_layout: layout }).eq("tenant_id", ctx.tenant.id);
  if (error) return jsonError(error.message.includes("dashboard_layout") ? "This needs the database update (migration 20260101008400)." : error.message);
  await ctx.sb.from("audit_logs").insert({ tenant_id: ctx.tenant.id, actor_id: ctx.userId, action: "settings.dashboard_layout", meta: layout });
  return NextResponse.json({ ok: true, layout });
}
