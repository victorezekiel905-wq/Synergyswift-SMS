import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError, hasAny } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { localParts, addDays } from "@/lib/attendance";
import { schoolKpis } from "@/lib/portal-server";
import { cleanTargets } from "@/lib/portal";

export const dynamic = "force-dynamic";

const LEADERS = [...new Set([...ROLES.admin, ...ROLES.finance])];

/** The head's key numbers now, the last 60 days of daily figures, and the school's targets. */
export async function GET() {
  const ctx = await requireCtx(LEADERS);
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  const since = addDays(localParts(new Date(), ctx.tenant.timezone).date, -60);
  const [today, { data: series }, { data: settings }] = await Promise.all([
    schoolKpis(createServiceClient(), tid, ctx.tenant.timezone),
    ctx.sb.from("kpi_snapshots").select("day,metrics").eq("tenant_id", tid).gte("day", since).order("day"),
    ctx.sb.from("tenant_settings").select("kpi_targets,student_sees_fees").eq("tenant_id", tid).maybeSingle()
  ]);
  return NextResponse.json({
    today, series: series ?? [], targets: settings?.kpi_targets ?? {},
    student_sees_fees: settings?.student_sees_fees ?? true, can_edit: hasAny(ctx, ROLES.admin)
  });
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("set_targets"), targets: z.record(z.union([z.number(), z.string(), z.null()])) }),
  z.object({ action: z.literal("set_student_fees"), on: z.boolean() })
]);

/** Admins set targets and whether students see their own fees. */
export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.admin);
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const patch = b.action === "set_targets" ? { kpi_targets: cleanTargets(b.targets) } : { student_sees_fees: b.on };
  const { error } = await ctx.sb.from("tenant_settings")
    .upsert({ tenant_id: ctx.tenant.id, ...patch, updated_at: new Date().toISOString() }, { onConflict: "tenant_id" });
  if (error) return jsonError(error.message);
  return NextResponse.json({ ok: true, ...patch });
}
