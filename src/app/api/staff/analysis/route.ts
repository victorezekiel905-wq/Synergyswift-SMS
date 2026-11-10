import { NextResponse } from "next/server";
import { requireCtx, ROLES } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { financeSettings } from "@/lib/fees";
import { MODULE_KEYS, moduleBlockedForUser } from "@/lib/saas";
import { staffAnalysis } from "@/lib/analysis-staff-server";

export const dynamic = "force-dynamic";

/**
 * A member of staff's own analysis, by their privileges: their classes and subjects if they
 * teach, a part for each role they hold, and their own leave and sign-ins. Modules the school
 * has switched off, or that the person's custom role leaves out, are not shown.
 */
export async function GET() {
  const ctx = await requireCtx(ROLES.staff);
  if (ctx instanceof NextResponse) return ctx;
  const modules: Record<string, boolean> = {};
  for (const k of MODULE_KEYS) modules[k] = ctx.tenant.modules?.[k] !== false && !moduleBlockedForUser(ctx.customRole, k);
  const svc = createServiceClient();
  const [{ currency }, analysis] = await Promise.all([
    financeSettings(svc, ctx.tenant.id),
    staffAnalysis(svc, { tenantId: ctx.tenant.id, userId: ctx.userId, roles: ctx.roles, timezone: ctx.tenant.timezone || "Africa/Lagos", modules })
  ]);
  return NextResponse.json({ currency, name: ctx.profile.full_name, roles: [...ctx.roles], analysis }, { headers: { "Cache-Control": "no-store" } });
}
