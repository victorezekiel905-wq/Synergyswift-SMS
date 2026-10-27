import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { groupPrices } from "@/lib/saas-server";
import { MODULE_CATALOGUE } from "@/lib/saas";
import { revenueSummary, healthState, type SubRow, type PlanRow } from "@/lib/platform-centre";

export const dynamic = "force-dynamic";
const DAY = 86_400_000;

/** The super admin centre (phase 14k): revenue, module adoption, system health and school activity. */
export async function GET() {
  const pa = await requirePlatformAdmin("support");
  if (pa instanceof NextResponse) return pa;
  const svc = createServiceClient();
  const now = new Date();
  const since24 = new Date(now.getTime() - DAY).toISOString();
  const [{ data: subs }, { data: plans }, prices, { data: tenants }, { data: paid }, activity, metrics, dbSize,
    { count: queued }, { data: oldest }, { count: failed24 }, { count: hooksFailed }, { data: cron }, { count: authUsers }] = await Promise.all([
    svc.from("subscriptions").select("tenant_id,status,plan_id,band,add_on_groups,custom_annual,discount_pct,created_at,updated_at,period_end").limit(20000),
    svc.from("plans").select("id,name,groups,prices"),
    groupPrices(svc),
    svc.from("tenants").select("id,status,modules,created_at").limit(20000),
    svc.from("invoices").select("amount_cents,paid_at").eq("status", "paid").gte("paid_at", new Date(now.getTime() - 365 * DAY).toISOString()).limit(20000),
    svc.rpc("platform_module_activity", { p_days: 30 }),
    svc.rpc("platform_customer_metrics"),
    svc.rpc("platform_db_size"),
    svc.from("message_outbox").select("id", { count: "exact", head: true }).eq("status", "queued"),
    svc.from("message_outbox").select("created_at").eq("status", "queued").order("created_at").limit(1),
    svc.from("message_outbox").select("id", { count: "exact", head: true }).eq("status", "failed").gte("created_at", since24),
    svc.from("webhook_deliveries").select("id", { count: "exact", head: true }).eq("status", "failed").gte("created_at", since24),
    svc.from("platform_settings").select("value").eq("key", "cron.dispatch").maybeSingle(),
    svc.from("users").select("id", { count: "exact", head: true })
  ]);
  const revenue = revenueSummary((subs ?? []) as SubRow[], (plans ?? []) as PlanRow[], prices, now);
  const cash = (days: number) => Math.round((paid ?? []).filter((i: any) => i.paid_at && now.getTime() - Date.parse(i.paid_at) <= days * DAY).reduce((t: number, i: any) => t + Number(i.amount_cents ?? 0), 0) / 100);
  const active = (tenants ?? []).filter((t: any) => t.status === "active");
  const used = new Map<string, number>(((activity.data ?? []) as { module: string; tenants: number }[]).map(a => [a.module, a.tenants]));
  const adoption = MODULE_CATALOGUE.map(m => ({ key: m.key, label: m.label, group: m.group,
    enabled: active.filter((t: any) => t.modules?.[m.key] !== false).length, used: used.has(m.key) ? used.get(m.key)! : null }))
    .sort((a, b) => b.enabled - a.enabled);
  const cronAt = (cron?.value as any)?.at as string | undefined;
  const cronMinutesAgo = cronAt ? Math.round((now.getTime() - Date.parse(cronAt)) / 60_000) : null;
  const outboxOldestMin = oldest?.[0] ? Math.round((now.getTime() - Date.parse(oldest[0].created_at)) / 60_000) : null;
  const m = ((metrics.data ?? []) as any[]).filter(x => x.status === "active");
  const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) : 0);
  return NextResponse.json({
    revenue, cash: { last_30: cash(30), last_365: cash(365) },
    schools: { total: (tenants ?? []).length, active: active.length, suspended: (tenants ?? []).filter((t: any) => t.status === "suspended").length,
      paused: (tenants ?? []).filter((t: any) => t.status === "paused").length, new_30: (tenants ?? []).filter((t: any) => now.getTime() - Date.parse(t.created_at) <= 30 * DAY).length },
    adoption,
    health: { ...healthState({ outboxOldestMin, outboxFailed24: failed24 ?? 0, webhookFailed24: hooksFailed ?? 0, cronMinutesAgo }),
      outbox_queued: queued ?? 0, outbox_oldest_min: outboxOldestMin, outbox_failed_24: failed24 ?? 0, webhooks_failed_24: hooksFailed ?? 0,
      cron_minutes_ago: cronMinutesAgo, db_bytes: Number(dbSize.data ?? 0), accounts: authUsers ?? 0 },
    activity: {
      students: m.reduce((t, x) => t + (x.students ?? 0), 0), staff: m.reduce((t, x) => t + (x.staff ?? 0), 0),
      staff_active_pct: pct(m.reduce((t, x) => t + (x.staff_signed_in_30 ?? 0), 0), m.reduce((t, x) => t + (x.staff ?? 0), 0)),
      most: [...m].sort((a, b) => b.actions_30 - a.actions_30).slice(0, 6).map(x => ({ id: x.tenant_id, name: x.name, actions_30: x.actions_30, users_30: x.users_signed_in_30, students: x.students })),
      quiet: [...m].filter(x => x.students > 0).sort((a, b) => a.actions_30 - b.actions_30).slice(0, 6)
        .map(x => ({ id: x.tenant_id, name: x.name, actions_30: x.actions_30, actions_prev_30: x.actions_prev_30, last_action_at: x.last_action_at, students: x.students }))
    }
  });
}
