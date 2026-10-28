/**
 * Server side of plans, modules and billing: rebuilds each school's effective
 * module map (tenants.modules), issues and settles platform invoices, and runs
 * the billing cycle from the dispatch cron. Uses the service client.
 */
import {
  resolveModules, planModules, quote, billingAction, nextPeriod, naira, moduleLabel, DEFAULT_GROUP_PRICES,
  type Override, type Cycle, type ModuleGroup, type PlanDef
} from "./saas";
import { sendEmail } from "./messaging/providers";
import { payLink } from "./invoice-link";

type Svc = any;

export type SubscriptionRow = {
  id: string; tenant_id: string; plan_id: string | null; status: "trial" | "active" | "past_due" | "suspended" | "cancelled"; cycle: Cycle;
  band: number | null; add_on_groups: string[]; custom_annual: number | null; discount_pct: number; period_start: string | null; period_end: string | null;
  grace_days: number; cancel_at_period_end: boolean; notes: string | null;
};
export type PlanRow = { id: string; code: string; name: string; groups: string[]; prices: number[] | null; blurb: string | null; active: boolean; sort: number };

export async function platformSetting<T>(svc: Svc, key: string, fallback: T): Promise<T> {
  const { data } = await svc.from("platform_settings").select("value").eq("key", key).maybeSingle();
  return (data?.value as T) ?? fallback;
}

export async function groupPrices(svc: Svc): Promise<Record<string, number[]>> {
  return platformSetting(svc, "group_prices", DEFAULT_GROUP_PRICES as Record<string, number[]>);
}

/** The school's subscription and plan (either may be missing for older schools). */
export async function loadSubscription(svc: Svc, tenantId: string): Promise<{ sub: SubscriptionRow | null; plan: PlanRow | null }> {
  const { data: sub } = await svc.from("subscriptions").select("*").eq("tenant_id", tenantId).maybeSingle();
  if (!sub?.plan_id) return { sub: sub ?? null, plan: null };
  const { data: plan } = await svc.from("plans").select("id,code,name,groups,prices,blurb,active,sort").eq("id", sub.plan_id).maybeSingle();
  return { sub, plan: plan ?? null };
}

export async function loadOverrides(svc: Svc, tenantId: string): Promise<Override[]> {
  const { data } = await svc.from("tenant_module_overrides").select("module,mode,expires_at,note").eq("tenant_id", tenantId);
  return (data ?? []) as Override[];
}

/** Plan modules for a school: null (everything) when it has no plan or its subscription was cancelled long ago is not our call; cancelled keeps the plan. */
export function subscriptionModules(sub: SubscriptionRow | null, plan: PlanRow | null) {
  if (!sub || !plan) return null;
  return planModules(plan.groups, sub.add_on_groups ?? []);
}

/** Works out the school's modules and writes them to tenants.modules. Returns the rows for display. */
export async function refreshTenantModules(svc: Svc, tenantId: string, now = new Date()) {
  const [{ sub, plan }, overrides] = await Promise.all([loadSubscription(svc, tenantId), loadOverrides(svc, tenantId)]);
  const res = resolveModules(subscriptionModules(sub, plan), overrides, now);
  await svc.from("tenants").update({ modules: res.effective }).eq("id", tenantId);
  return { ...res, sub, plan, overrides };
}

/** Lines and totals for a school's next bill. */
export async function priceFor(svc: Svc, sub: SubscriptionRow, plan: PlanRow) {
  const gp = await groupPrices(svc);
  return quote({
    plan: { name: plan.name, groups: plan.groups as ModuleGroup[], prices: plan.prices } as Pick<PlanDef, "name" | "groups" | "prices">,
    band: sub.band, addOns: (sub.add_on_groups ?? []) as ModuleGroup[], cycle: sub.cycle, groupPrices: gp,
    customAnnual: sub.custom_annual, discountPct: Number(sub.discount_pct ?? 0)
  });
}

/** Creates an open invoice for a period of the school's subscription. */
export async function issueInvoice(svc: Svc, sub: SubscriptionRow, plan: PlanRow, period: { start: string; end: string }, kind: "new" | "renewal", actor: string | null) {
  const q = await priceFor(svc, sub, plan);
  if (q.perInvoice === null) throw new Error("this school needs an agreed price before it can be billed");
  const { data: number } = await svc.rpc("next_platform_invoice_number");
  const lines = sub.cycle === "termly" ? [{ label: `${plan.name}: one term (a third of the year plus 10%)`, amount: q.perInvoice }] : q.lines;
  const due = new Date(Math.max(Date.now() + 7 * 86_400_000, new Date(period.start).getTime())).toISOString();
  const { data: inv, error } = await svc.from("invoices").insert({
    tenant_id: sub.tenant_id, number, kind, status: "open", currency: "NGN", amount_cents: Math.round(q.perInvoice * 100), lines,
    period_start: period.start, period_end: period.end, due_at: due, created_by: actor
  }).select("*").single();
  if (error) throw new Error(error.message);
  return inv;
}

/** Records a payment. Moves the subscription into the paid period and lifts a billing hold. */
export async function markInvoicePaid(svc: Svc, invoiceId: string, p: { method: string; reference?: string | null; paid_at?: string | null }, actor: string | null) {
  const { data: inv } = await svc.from("invoices").select("*").eq("id", invoiceId).maybeSingle();
  if (!inv) throw new Error("invoice not found");
  if (inv.status === "paid") return inv;
  if (inv.status === "void") throw new Error("this invoice was cancelled");
  const paidAt = p.paid_at ?? new Date().toISOString();
  await svc.from("invoices").update({ status: "paid", paid_at: paidAt, method: p.method, reference: p.reference ?? null }).eq("id", invoiceId);
  const { data: sub } = await svc.from("subscriptions").select("*").eq("tenant_id", inv.tenant_id).maybeSingle();
  if (sub && inv.period_start && inv.period_end && (inv.kind === "new" || inv.kind === "renewal")) {
    await svc.from("subscriptions").update({ status: "active", period_start: inv.period_start, period_end: inv.period_end, updated_at: new Date().toISOString() }).eq("id", sub.id);
  }
  const { data: t } = await svc.from("tenants").select("billing_hold").eq("id", inv.tenant_id).maybeSingle();
  if (t?.billing_hold) await svc.from("tenants").update({ status: "active", billing_hold: false, status_message: null }).eq("id", inv.tenant_id);
  await svc.from("platform_audit_logs").insert({ actor_id: actor, action: "invoice.paid", tenant_id: inv.tenant_id, meta: { number: inv.number, method: p.method, reference: p.reference ?? null } });
  return { ...inv, status: "paid", paid_at: paidAt };
}

/** "Pay online: <private link>" for billing emails, when online payment is set up (14q). */
function payLine(invoiceId: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL;
  if (!base || !process.env.PAYSTACK_SECRET_KEY) return "";
  try { return `\nPay online (card, transfer or USSD): ${payLink(base, invoiceId)}\n`; } catch { return ""; }
}

async function tellSchool(svc: Svc, tenantId: string, subject: string, text: string) {
  const { data: t } = await svc.from("tenants").select("name,contact_email").eq("id", tenantId).maybeSingle();
  if (!t?.contact_email) return;
  await sendEmail({ to: t.contact_email, toName: t.name, subject, text, fromName: "Synergy Swift" }).catch(() => null);
}

/**
 * The daily billing job: renewal invoices two weeks ahead, past due after the
 * period ends, a billing hold (school paused) after the grace period, and
 * cancellations at period end. Also expires module overrides.
 */
export async function runBilling(svc: Svc, now = new Date(), opts: { force?: boolean } = {}) {
  // The cron calls this every few minutes; the work is needed at most hourly.
  if (!opts.force) {
    const last = await platformSetting<{ at?: string }>(svc, "billing_last_run", {});
    if (last.at && now.getTime() - new Date(last.at).getTime() < 3_600_000) return null;
    await svc.from("platform_settings").upsert({ key: "billing_last_run", value: { at: now.toISOString() }, updated_at: now.toISOString() });
  }
  const out = { renewals: 0, past_due: 0, suspended: 0, cancelled: 0, modules_expired: 0 };
  const billing = await platformSetting(svc, "billing", { company: "Synergy Swift Technologies Limited", bank_details: "" } as { company: string; bank_details: string });

  // Module overrides that have run out: remove them (with a record) and rebuild those schools' modules.
  const { data: expired } = await svc.from("tenant_module_overrides").select("tenant_id,module,mode,expires_at").lte("expires_at", now.toISOString()).limit(500);
  const touched = new Set<string>();
  for (const o of expired ?? []) {
    await svc.from("tenant_module_overrides").delete().eq("tenant_id", o.tenant_id).eq("module", o.module);
    await svc.from("platform_audit_logs").insert({ actor_id: null, action: "module.expired", tenant_id: o.tenant_id, meta: { module: o.module, mode: o.mode, expires_at: o.expires_at } });
    touched.add(o.tenant_id);
    out.modules_expired++;
  }
  for (const t of touched) await refreshTenantModules(svc, t, now);

  const { data: subs } = await svc.from("subscriptions").select("*").in("status", ["trial", "active", "past_due", "suspended"]).not("period_end", "is", null).limit(2000);
  for (const sub of (subs ?? []) as SubscriptionRow[]) {
    const { data: renewal } = await svc.from("invoices").select("id,status,number,amount_cents").eq("tenant_id", sub.tenant_id)
      .in("kind", ["renewal", "new"]).eq("period_start", sub.period_end).neq("status", "void").maybeSingle();
    const action = billingAction(sub, { renewalOpen: renewal?.status === "open" || renewal?.status === "draft", renewalPaid: renewal?.status === "paid" }, now);
    if (action === "none") continue;
    const { data: plan } = sub.plan_id ? await svc.from("plans").select("*").eq("id", sub.plan_id).maybeSingle() : { data: null };
    if (action === "issue_renewal") {
      if (!plan) continue;
      try {
        const inv = await issueInvoice(svc, sub, plan, nextPeriod(sub.period_end!, sub.cycle), "renewal", null);
        out.renewals++;
        await tellSchool(svc, sub.tenant_id, `Synergy Swift renewal ${inv.number}`,
          `Your Synergy Swift subscription renews on ${new Date(sub.period_end!).toDateString()}.\n\nInvoice ${inv.number}: ${naira(inv.amount_cents / 100)}.\n${payLine(inv.id)}${billing.bank_details ? `\nPay by transfer to:\n${billing.bank_details}\nUse ${inv.number} as the reference.\n` : ""}\nThe invoice is under Settings → Subscription.\n\n${billing.company}`);
      } catch { /* needs an agreed price: shown on the platform's billing page */ }
    } else if (action === "mark_past_due") {
      await svc.from("subscriptions").update({ status: "past_due", updated_at: now.toISOString() }).eq("id", sub.id);
      out.past_due++;
      await tellSchool(svc, sub.tenant_id, "Synergy Swift: payment overdue",
        `Your Synergy Swift subscription ended on ${new Date(sub.period_end!).toDateString()} and invoice ${renewal?.number ?? ""} is unpaid. Please pay within ${sub.grace_days} days to keep your school's access.\n${renewal ? payLine(renewal.id) : ""}\n${billing.company}`);
    } else if (action === "suspend") {
      await svc.from("subscriptions").update({ status: "suspended", updated_at: now.toISOString() }).eq("id", sub.id);
      await svc.from("tenants").update({ status: "paused", billing_hold: true, status_message: "Synergy Swift is paused until the subscription is paid. Your data is safe." }).eq("id", sub.tenant_id).eq("status", "active");
      await svc.from("platform_audit_logs").insert({ actor_id: null, action: "tenant.billing_hold", tenant_id: sub.tenant_id, meta: { invoice: renewal?.number } });
      out.suspended++;
      await tellSchool(svc, sub.tenant_id, "Synergy Swift paused for an unpaid bill",
        `Access to Synergy Swift is paused because invoice ${renewal?.number ?? ""} is unpaid. Your data is safe and access returns as soon as payment is recorded.\n${renewal ? payLine(renewal.id) : ""}\n${billing.company}`);
    } else if (action === "cancel") {
      await svc.from("subscriptions").update({ status: "cancelled", updated_at: now.toISOString() }).eq("id", sub.id);
      await svc.from("tenants").update({ status: "suspended", status_message: "This school's Synergy Swift subscription has ended." }).eq("id", sub.tenant_id);
      await svc.from("platform_audit_logs").insert({ actor_id: null, action: "subscription.cancelled", tenant_id: sub.tenant_id, meta: {} });
      out.cancelled++;
    }
  }
  return out;
}

/** Readable list of modules for messages: "Library, Payroll". */
export const moduleList = (keys: string[]) => keys.map(moduleLabel).join(", ");

export type SubscriptionInput = {
  plan_code: string; band: number | null; cycle: Cycle; add_on_groups: string[]; custom_annual?: number | null; discount_pct: number;
  grace_days: number; status?: "trial" | "active"; period_start?: string | null; period_end?: string | null; cancel_at_period_end: boolean;
  notes?: string | null; issue_invoice: boolean;
};

/** Creates or changes a school's subscription, rebuilds its modules and can issue the invoice for the period. */
export async function saveSubscription(svc: Svc, tenantId: string, b: SubscriptionInput, actor: string | null) {
  const { data: plan } = await svc.from("plans").select("*").eq("code", b.plan_code).maybeSingle();
  if (!plan) throw new Error("unknown plan");
  if ((b.band === null || !plan.prices) && b.custom_annual == null) throw new Error("this plan or school size needs an agreed yearly price");
  const start = b.period_start ?? new Date().toISOString();
  let end = b.period_end ?? null;
  if (!end) {
    const e = new Date(start);
    if (b.status === "trial") e.setUTCDate(e.getUTCDate() + 30);
    else if (b.cycle === "annual") e.setUTCFullYear(e.getUTCFullYear() + 1);
    else e.setUTCMonth(e.getUTCMonth() + 4);
    end = e.toISOString();
  }
  if (new Date(end) <= new Date(start)) throw new Error("the period must end after it starts");
  const { sub: existing } = await loadSubscription(svc, tenantId);
  const row = {
    tenant_id: tenantId, plan_id: plan.id, plan: plan.name, cycle: b.cycle, band: b.band, add_on_groups: b.add_on_groups,
    custom_annual: b.custom_annual ?? null, discount_pct: b.discount_pct, grace_days: b.grace_days, cancel_at_period_end: b.cancel_at_period_end,
    notes: b.notes ?? null, period_start: start, period_end: end, renews_at: end, updated_at: new Date().toISOString(),
    status: b.status ?? (existing && existing.status !== "cancelled" ? existing.status : "active")
  };
  const { data: saved, error } = await svc.from("subscriptions").upsert(row, { onConflict: "tenant_id" }).select("*").single();
  if (error) throw new Error(error.message);
  await refreshTenantModules(svc, tenantId);
  let invoice = null;
  if (b.issue_invoice && saved.status !== "trial") invoice = await issueInvoice(svc, saved as SubscriptionRow, plan as PlanRow, { start, end }, existing ? "renewal" : "new", actor);
  await svc.from("platform_audit_logs").insert({ actor_id: actor, action: "subscription.saved", tenant_id: tenantId,
    meta: { plan: plan.code, band: b.band, cycle: b.cycle, add_ons: b.add_on_groups, discount_pct: b.discount_pct, custom_annual: b.custom_annual ?? null, invoice: invoice?.number ?? null } });
  return { subscription: saved as SubscriptionRow, invoice };
}
