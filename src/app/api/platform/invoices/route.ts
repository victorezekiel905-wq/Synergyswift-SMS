import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAdmin, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { markInvoicePaid } from "@/lib/saas-server";

/** Every school's platform invoices, newest first, with totals for the billing page. */
export async function GET(req: NextRequest) {
  const gate = await requirePlatformAdmin();
  if (gate instanceof NextResponse) return gate;
  const svc = createServiceClient();
  const status = new URL(req.url).searchParams.get("status");
  let q = svc.from("invoices").select("*,tenants(name,slug)").order("created_at", { ascending: false }).limit(500);
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) return jsonError(error.message);
  const { data: subs } = await svc.from("subscriptions").select("tenant_id,status,cycle,period_end,custom_annual,band,plans(name,code)").limit(5000);
  return NextResponse.json({ invoices: data ?? [], subscriptions: subs ?? [] });
}

const Create = z.object({
  tenant_id: z.string().uuid(),
  lines: z.array(z.object({ label: z.string().trim().min(2).max(200), amount: z.number().int().min(-100_000_000).max(10_000_000_000) })).min(1).max(20),
  due_at: z.string().datetime({ offset: true }).nullish(),
  notes: z.string().trim().max(1000).nullish()
});

/** A one-off invoice (an add-on part-way through the year, training, an adjustment). */
export async function POST(req: NextRequest) {
  const gate = await requirePlatformAdmin("admin");
  if (gate instanceof NextResponse) return gate;
  const parsed = Create.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const total = b.lines.reduce((s, l) => s + l.amount, 0);
  if (total <= 0) return jsonError("the invoice total must be more than zero");
  const svc = createServiceClient();
  const { data: t } = await svc.from("tenants").select("id").eq("id", b.tenant_id).maybeSingle();
  if (!t) return jsonError("school not found", 404);
  const { data: number } = await svc.rpc("next_platform_invoice_number");
  const { data, error } = await svc.from("invoices").insert({
    tenant_id: b.tenant_id, number, kind: "adjustment", status: "open", currency: "NGN", amount_cents: total * 100, lines: b.lines,
    due_at: b.due_at ?? new Date(Date.now() + 14 * 86_400_000).toISOString(), notes: b.notes ?? null, created_by: gate.userId
  }).select("*").single();
  if (error) return jsonError(error.message);
  await svc.from("platform_audit_logs").insert({ actor_id: gate.userId, action: "invoice.created", tenant_id: b.tenant_id, meta: { number, total } });
  return NextResponse.json(data, { status: 201 });
}

const Patch = z.discriminatedUnion("action", [
  z.object({ action: z.literal("paid"), id: z.string().uuid(), method: z.enum(["transfer", "card", "cash", "cheque", "paystack", "other"]), reference: z.string().trim().max(120).nullish(), paid_at: z.string().datetime({ offset: true }).nullish() }),
  z.object({ action: z.literal("void"), id: z.string().uuid(), reason: z.string().trim().min(3).max(300) })
]);

/** Record a payment (lifts a billing hold and moves the subscription on) or cancel an unpaid invoice. */
export async function PATCH(req: NextRequest) {
  const gate = await requirePlatformAdmin("admin");
  if (gate instanceof NextResponse) return gate;
  const parsed = Patch.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const svc = createServiceClient();
  if (b.action === "paid") {
    try { return NextResponse.json(await markInvoicePaid(svc, b.id, { method: b.method, reference: b.reference, paid_at: b.paid_at }, gate.userId)); }
    catch (e) { return jsonError((e as Error).message); }
  }
  const { data: inv } = await svc.from("invoices").select("id,status,number,tenant_id,notes").eq("id", b.id).maybeSingle();
  if (!inv) return jsonError("invoice not found", 404);
  if (inv.status === "paid") return jsonError("a paid invoice cannot be cancelled; issue a credit adjustment instead");
  await svc.from("invoices").update({ status: "void", notes: [inv.notes, `Cancelled: ${b.reason}`].filter(Boolean).join("\n") }).eq("id", b.id);
  await svc.from("platform_audit_logs").insert({ actor_id: gate.userId, action: "invoice.void", tenant_id: inv.tenant_id, meta: { number: inv.number, reason: b.reason } });
  return NextResponse.json({ ok: true });
}
