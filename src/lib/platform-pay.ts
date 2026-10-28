/**
 * Schools paying their Synergy Swift invoice online (phase 14q), with Paystack.
 *
 * Money goes to Synergy Swift's own Paystack account (PAYSTACK_SECRET_KEY, no
 * school subaccount). Every invoice has a private pay link, signed so it can't
 * be guessed, that works without signing in: a school paused for an unpaid bill
 * can still pay, and is unpaused the moment the payment is verified. The payment
 * reference starts with SSI- and carries the invoice id, so the return page and
 * the webhook both find the invoice. Nothing from the browser is trusted: the
 * amount and currency are checked with Paystack before the invoice is marked paid.
 */
import { initializePayment, verifyPayment, matchesExpected, providerConfigured } from "@/lib/payments";
import { markInvoicePaid, platformSetting } from "@/lib/saas-server";
import { sendEmail } from "@/lib/messaging/providers";

export { payToken, payLink, invoiceFromToken, newInvoiceReference, invoiceFromReference, INVOICE_PREFIX } from "@/lib/invoice-link";
import { payToken, newInvoiceReference, invoiceFromReference } from "@/lib/invoice-link";
export const onlineInvoicePayments = () => providerConfigured("paystack");

const naira = (n: number) => `₦${n.toLocaleString("en-NG", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

/** What the pay page shows. Never anything about another school. */
export async function invoiceForPayment(svc: any, invoiceId: string) {
  const { data: inv } = await svc.from("invoices").select("id,tenant_id,number,status,kind,amount_cents,currency,lines,period_start,period_end,due_at,paid_at,tenants(name,contact_email)")
    .eq("id", invoiceId).maybeSingle();
  return inv as null | { id: string; tenant_id: string; number: string; status: string; kind: string; amount_cents: number; currency: string; lines: { label: string; amount: number }[] | null;
    period_start: string | null; period_end: string | null; due_at: string | null; paid_at: string | null; tenants: { name: string; contact_email: string | null } | null };
}

/** Starts a Paystack checkout for an open invoice. */
export async function startInvoicePayment(svc: any, invoiceId: string, email: string, base: string): Promise<{ url: string } | { error: string; status?: number }> {
  if (!onlineInvoicePayments()) return { error: "Online payment isn't switched on yet. Please pay by bank transfer, using the invoice number as the reference.", status: 503 };
  const inv = await invoiceForPayment(svc, invoiceId);
  if (!inv) return { error: "not found", status: 404 };
  if (inv.status === "paid") return { error: "This invoice is already paid. Thank you." };
  if (inv.status !== "open") return { error: "This invoice can't be paid. Please contact Synergy Swift.", status: 409 };
  if ((inv.currency ?? "NGN") !== "NGN") return { error: "This invoice is not in naira; please pay by transfer.", status: 409 };
  const reference = newInvoiceReference(inv.id);
  const r = await initializePayment({ provider: "paystack", reference, amount: inv.amount_cents / 100, currency: "NGN", email, name: inv.tenants?.name ?? null,
    callbackUrl: `${base}/api/pay/verify`, description: `Synergy Swift invoice ${inv.number}`, metadata: { invoice: inv.number, kind: "synergy_swift_subscription" } });
  if (!r.ok) return { error: r.error, status: 502 };
  await svc.from("platform_audit_logs").insert({ actor_id: null, action: "invoice.checkout_started", tenant_id: inv.tenant_id, meta: { number: inv.number, reference } });
  return { url: r.url };
}

/** Checks a payment with Paystack and, when it matches, marks the invoice paid and sends the receipt. Safe to call twice. */
export async function confirmInvoicePayment(svc: any, reference: string): Promise<{ status: "success" | "failed" | "pending" | "unknown"; token: string | null }> {
  const id = invoiceFromReference(reference);
  if (!id) return { status: "unknown", token: null };
  const inv = await invoiceForPayment(svc, id);
  if (!inv) return { status: "unknown", token: null };
  const token = payToken(inv.id);
  if (inv.status === "paid") return { status: "success", token };
  const v = await verifyPayment("paystack", reference);
  if ("error" in v) return { status: "pending", token };
  if (!matchesExpected(v, inv.amount_cents / 100, "NGN")) return { status: v.status === "failed" ? "failed" : "pending", token };
  await markInvoicePaid(svc, inv.id, { method: "paystack", reference }, null);
  if (inv.tenants?.contact_email) {
    const billing = await platformSetting(svc, "billing", { company: "Synergy Swift Technologies Limited" } as { company: string });
    await sendEmail({ to: inv.tenants.contact_email, toName: inv.tenants.name, fromName: "Synergy Swift", subject: `Receipt for Synergy Swift invoice ${inv.number}`,
      text: `Thank you. We have received ${naira(inv.amount_cents / 100)} for invoice ${inv.number}${inv.period_start && inv.period_end ? ` (${inv.period_start} to ${inv.period_end})` : ""}.\n\nPaystack reference: ${reference}\n\nYour subscription is up to date.\n\n${billing.company}` }).catch(() => null);
  }
  return { status: "success", token };
}
