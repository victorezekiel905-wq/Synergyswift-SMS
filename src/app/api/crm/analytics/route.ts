import { NextRequest, NextResponse } from "next/server";
import { requireCtx, ROLES } from "@/lib/auth";
import { fetchAll } from "@/lib/results";
import { funnel, bySource, staffPerformance, monthlyTrend, lostReasons, type LeadRow } from "@/lib/crm";

/** Admissions analytics: funnel, sources with cost per enrolment, staff performance, monthly trend and lost reasons. ?from=YYYY-MM-DD&to=… */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.admissions, "admissions");
  if (ctx instanceof NextResponse) return ctx;
  const u = new URL(req.url);
  const from = u.searchParams.get("from") ?? new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
  const to = u.searchParams.get("to") ?? new Date().toISOString().slice(0, 10);
  const tid = ctx.tenant.id;
  const leads = await fetchAll<LeadRow & { utm: Record<string, string> | null }>(() => ctx.sb.from("admission_leads")
    .select("id,stage,source,owner_id,created_at,first_response_at,utm,lost_reason").eq("tenant_id", tid)
    .gte("created_at", `${from}T00:00:00Z`).lte("created_at", `${to}T23:59:59Z`).order("id"));
  const [{ data: costs }, { data: staff }] = await Promise.all([
    ctx.sb.from("admission_costs").select("source,campaign,amount,month").eq("tenant_id", tid).gte("month", from.slice(0, 7) + "-01").lte("month", to),
    ctx.sb.from("users").select("id,full_name").eq("tenant_id", tid)
  ]);
  // Campaign view from UTM tags.
  const campaigns = new Map<string, { campaign: string; leads: number; enrolled: number; spend: number }>();
  for (const l of leads) {
    const c = l.utm?.utm_campaign;
    if (!c) continue;
    const row = campaigns.get(c) ?? { campaign: c, leads: 0, enrolled: 0, spend: 0 };
    row.leads++; if (l.stage === "enrolled") row.enrolled++;
    campaigns.set(c, row);
  }
  for (const c of costs ?? []) if (c.campaign) { const row = campaigns.get(c.campaign) ?? { campaign: c.campaign, leads: 0, enrolled: 0, spend: 0 }; row.spend += Number(c.amount); campaigns.set(c.campaign, row); }
  const spend = (costs ?? []).reduce((a: number, c: any) => a + Number(c.amount), 0);
  const enrolled = leads.filter(l => l.stage === "enrolled").length;
  return NextResponse.json({
    range: { from, to }, totals: { leads: leads.length, enrolled, conversion: leads.length ? Math.round((enrolled / leads.length) * 1000) / 10 : null, spend, cost_per_enrolment: enrolled && spend ? Math.round(spend / enrolled) : null },
    funnel: funnel(leads), sources: bySource(leads, (costs ?? []).map((c: any) => ({ source: c.source, amount: Number(c.amount) }))),
    staff: staffPerformance(leads, new Map((staff ?? []).map((s: any) => [s.id, s.full_name]))), monthly: monthlyTrend(leads), lost: lostReasons(leads),
    campaigns: [...campaigns.values()].map(c => ({ ...c, cost_per_enrolment: c.enrolled && c.spend ? Math.round(c.spend / c.enrolled) : null })).sort((a, b) => b.leads - a.leads)
  });
}
