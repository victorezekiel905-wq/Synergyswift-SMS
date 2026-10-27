/**
 * The super admin centre's revenue numbers (phase 14k). Pure, unit tested.
 * MRR counts schools that are paying (active or past due); trials are shown on
 * their own as the pipeline. Each school's yearly price comes from its plan,
 * size band, add-on groups, agreed price and discount (the same quote() the
 * invoices use).
 */
import { quote, type ModuleGroup } from "./saas";

export type SubRow = {
  tenant_id: string; status: string; plan_id: string | null; band: number | null; add_on_groups: string[] | null;
  custom_annual: number | null; discount_pct: number | null; created_at: string; updated_at: string | null; period_end: string | null;
};
export type PlanRow = { id: string; name: string; groups: string[]; prices: number[] | null };

const DAY = 86_400_000;

export function annualPrice(sub: SubRow, plan: PlanRow | undefined, groupPrices: Record<string, number[]>): number {
  if (!plan && sub.custom_annual == null) return 0;
  const q = quote({ plan: (plan ?? { name: "Custom", groups: [], prices: null }) as { name: string; groups: ModuleGroup[]; prices: number[] | null }, band: sub.band, addOns: (sub.add_on_groups ?? []) as ModuleGroup[],
    groupPrices, customAnnual: sub.custom_annual, discountPct: Number(sub.discount_pct ?? 0) });
  return q.annual ?? 0;
}

export function revenueSummary(subs: SubRow[], plans: PlanRow[], groupPrices: Record<string, number[]>, now = new Date()) {
  const byPlanId = new Map(plans.map(p => [p.id, p]));
  // The latest subscription per school.
  const latest = new Map<string, SubRow>();
  for (const s of [...subs].sort((a, b) => a.created_at.localeCompare(b.created_at))) latest.set(s.tenant_id, s);
  const t = now.getTime();
  let mrr = 0, pastDueMrr = 0, trialMrr = 0, newMrr = 0, churnedMrr = 0, renewingSoon = 0;
  const byPlan = new Map<string, { plan: string; schools: number; mrr: number }>();
  const counts = { paying: 0, trial: 0, past_due: 0, suspended: 0, cancelled: 0 };
  for (const s of latest.values()) {
    const plan = s.plan_id ? byPlanId.get(s.plan_id) : undefined;
    const monthly = annualPrice(s, plan, groupPrices) / 12;
    if (s.status === "active" || s.status === "past_due") {
      mrr += monthly; counts.paying++;
      if (s.status === "past_due") { pastDueMrr += monthly; counts.past_due++; }
      if (t - Date.parse(s.created_at) <= 30 * DAY) newMrr += monthly;
      if (s.period_end && Date.parse(s.period_end) - t <= 60 * DAY && Date.parse(s.period_end) >= t) renewingSoon += monthly;
      const name = plan?.name ?? "Custom";
      const row = byPlan.get(name) ?? { plan: name, schools: 0, mrr: 0 };
      row.schools++; row.mrr += monthly; byPlan.set(name, row);
    } else if (s.status === "trial") { counts.trial++; trialMrr += monthly; }
    else if (s.status === "suspended") counts.suspended++;
    else if (s.status === "cancelled") {
      counts.cancelled++;
      if (s.updated_at && t - Date.parse(s.updated_at) <= 30 * DAY) churnedMrr += monthly;
    }
  }
  const r = (n: number) => Math.round(n);
  return {
    mrr: r(mrr), arr: r(mrr * 12), past_due_mrr: r(pastDueMrr), trial_mrr: r(trialMrr), new_mrr_30: r(newMrr), churned_mrr_30: r(churnedMrr),
    renewing_60_mrr: r(renewingSoon), counts,
    by_plan: [...byPlan.values()].map(p => ({ ...p, mrr: r(p.mrr) })).sort((a, b) => b.mrr - a.mrr)
  };
}

/** Plain words for how loaded the system is. */
export function healthState(p: { outboxOldestMin: number | null; outboxFailed24: number; webhookFailed24: number; cronMinutesAgo: number | null }) {
  const issues: string[] = [];
  if (p.cronMinutesAgo === null || p.cronMinutesAgo > 10) issues.push(p.cronMinutesAgo === null ? "The scheduler has not run yet." : `The scheduler last ran ${p.cronMinutesAgo} minutes ago.`);
  if (p.outboxOldestMin !== null && p.outboxOldestMin > 15) issues.push(`Messages are waiting: the oldest for ${p.outboxOldestMin} minutes.`);
  if (p.outboxFailed24 > 20) issues.push(`${p.outboxFailed24} messages failed in the last 24 hours.`);
  if (p.webhookFailed24 > 0) issues.push(`${p.webhookFailed24} webhook deliveries failed in the last 24 hours.`);
  return { ok: issues.length === 0, issues };
}
