import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, readJson, jsonError, ROLES } from "@/lib/auth";
import { payToken, onlineInvoicePayments } from "@/lib/platform-pay";
import { createServiceClient } from "@/lib/supabase/service";
import { resolveModules, MODULE_KEYS, MODULE_GROUPS, moduleLabel, bandLabel } from "@/lib/saas";
import { loadSubscription, loadOverrides, subscriptionModules, priceFor, platformSetting } from "@/lib/saas-server";
import { sendEmail } from "@/lib/messaging/providers";

/** The school's own plan, modules, invoices and requests. Admins only; nothing about other schools. */
export async function GET() {
  const ctx = await requireCtx(ROLES.admin);
  if (ctx instanceof NextResponse) return ctx;
  const svc = createServiceClient();
  const tid = ctx.tenant.id;
  const [{ sub, plan }, overrides, invoices, requests, billing] = await Promise.all([
    loadSubscription(svc, tid), loadOverrides(svc, tid),
    svc.from("invoices").select("id,number,status,kind,amount_cents,currency,lines,period_start,period_end,due_at,paid_at,created_at").eq("tenant_id", tid).neq("status", "draft").order("created_at", { ascending: false }).limit(30),
    svc.from("module_requests").select("id,module,action,note,status,reply,created_at,handled_at").eq("tenant_id", tid).order("created_at", { ascending: false }).limit(30),
    platformSetting(svc, "billing", { company: "Synergy Swift Technologies Limited", bank_details: "" } as { company: string; bank_details: string })
  ]);
  const { rows } = resolveModules(subscriptionModules(sub, plan), overrides);
  const price = sub && plan ? await priceFor(svc, sub, plan) : null;
  return NextResponse.json({
    plan: plan ? { name: plan.name, blurb: plan.blurb } : null,
    subscription: sub ? { status: sub.status, cycle: sub.cycle, band: sub.band, band_label: bandLabel(sub.band), add_on_groups: sub.add_on_groups, period_start: sub.period_start, period_end: sub.period_end, cancel_at_period_end: sub.cancel_at_period_end } : null,
    price: price ? { lines: price.lines, annual: price.annual, per_invoice: price.perInvoice } : null,
    groups: MODULE_GROUPS,
    modules: rows.map(r => ({ key: r.key, label: r.label, group: r.group, on: r.effective, until: !r.expired && r.mode !== "inherit" ? r.expires_at : null })),
    invoices: (invoices.data ?? []).map((i: any) => ({ ...i, pay_token: i.status === "open" ? payToken(i.id) : null })), pay_online: onlineInvoicePayments(), requests: requests.data ?? [], billing
  });
}

const Ask = z.object({ module: z.enum(MODULE_KEYS as [string, ...string[]]), action: z.enum(["add", "remove"]), note: z.string().trim().max(500).nullish() });

/** Ask Synergy Swift to add or remove a module. The platform team is told at once and answers on the platform. */
export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.admin);
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Ask.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => i.message).join("; "));
  const b = parsed.data;
  const on = ctx.tenant.modules?.[b.module] !== false;
  if (b.action === "add" && on) return jsonError("this module is already on for your school");
  if (b.action === "remove" && !on) return jsonError("this module is already off for your school");
  const { data: open } = await ctx.sb.from("module_requests").select("id").eq("tenant_id", ctx.tenant.id).eq("module", b.module).eq("status", "pending").maybeSingle();
  if (open) return jsonError("there is already a request waiting for this module");
  const { error } = await ctx.sb.from("module_requests").insert({ tenant_id: ctx.tenant.id, module: b.module, action: b.action, note: b.note ?? null, requested_by: ctx.userId });
  if (error) return jsonError(error.message);
  // Tell the platform team (owner and admins) by email.
  const svc = createServiceClient();
  const { data: admins } = await svc.from("platform_admins").select("email").in("role", ["owner", "admin"]);
  for (const a of admins ?? []) if (a.email) await sendEmail({ to: a.email, fromName: "Synergy Swift", subject: `${ctx.tenant.name} asks to ${b.action} ${moduleLabel(b.module)}`,
    text: `${ctx.profile.full_name} (${ctx.profile.email}) at ${ctx.tenant.name} asks to ${b.action === "add" ? "add" : "remove"} ${moduleLabel(b.module)}.${b.note ? `\n\n"${b.note}"` : ""}\n\nAnswer it on the platform's Billing page.` }).catch(() => null);
  return NextResponse.json({ ok: true }, { status: 201 });
}
