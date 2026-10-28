import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { appUrl } from "@/lib/school";
import { loadBrand } from "@/lib/messaging/outbox";
import { gatherWeek } from "@/lib/weekly-report-server";
import { hasNews, renderWeekly, weekLabel } from "@/lib/weekly-report";
import { localParts } from "@/lib/attendance";

export const dynamic = "force-dynamic";

/** The weekly report to parents (14q): on or off, the last weeks sent, and a preview. Admins only. */
export async function GET() {
  const ctx = await requireCtx(ROLES.admin);
  if (ctx instanceof NextResponse) return ctx;
  const svc = createServiceClient();
  const [{ data: st }, { data: runs }] = await Promise.all([
    ctx.sb.from("tenant_settings").select("*").eq("tenant_id", ctx.tenant.id).maybeSingle(),
    svc.from("weekly_report_runs").select("week_key,finished_at,families,messages").eq("tenant_id", ctx.tenant.id).order("week_key", { ascending: false }).limit(6)
  ]);
  return NextResponse.json({ on: (st as any)?.weekly_parent_report !== false, ready: (st as any)?.weekly_parent_report !== undefined, runs: runs ?? [] });
}

const Body = z.discriminatedUnion("action", [z.object({ action: z.literal("set"), on: z.boolean() }), z.object({ action: z.literal("preview") })]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.admin);
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError("bad request");
  const svc = createServiceClient();
  if (parsed.data.action === "set") {
    const { error } = await svc.from("tenant_settings").update({ weekly_parent_report: parsed.data.on }).eq("tenant_id", ctx.tenant.id);
    if (error) return jsonError(error.message.includes("weekly_parent_report") ? "The weekly report needs the database update (migration 20260101008100)." : error.message);
    await ctx.sb.from("audit_logs").insert({ tenant_id: ctx.tenant.id, actor_id: ctx.userId, action: "settings.weekly_parent_report", meta: { on: parsed.data.on } });
    return NextResponse.json({ ok: true });
  }
  // Preview: this week so far (Monday to today), for the first family with news.
  const { data: t } = await svc.from("tenants").select("timezone").eq("id", ctx.tenant.id).maybeSingle();
  const today = localParts(new Date(), t?.timezone ?? "Africa/Lagos").date;
  const dow = ((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
  const monday = new Date(Date.parse(`${today}T12:00:00Z`) - (dow - 1) * 86_400_000).toISOString().slice(0, 10);
  const to = new Date(Date.parse(`${monday}T12:00:00Z`) + 4 * 86_400_000).toISOString().slice(0, 10);
  const kids = await gatherWeek(svc, ctx.tenant.id, monday, to);
  const first = [...kids.values()].find(hasNews);
  if (!first) return jsonError("Nothing has happened yet this week (no points, registers, homework or class story). Try again later in the week.", 404);
  const brand = await loadBrand(svc, ctx.tenant.id);
  const r = renderWeekly(brand, { guardianName: "Mrs Example", weekLabel: weekLabel(monday, to), children: [first], link: `${appUrl(req)}/parent` });
  return NextResponse.json({ subject: r.subject, text: r.text });
}
