/**
 * Remita (RRR payments, common for Nigerian schools and government-linked
 * fees) and Stripe (cards from abroad). A school can enter its own keys
 * (kept server-side in integration_secrets); otherwise the platform's
 * REMITA_* / STRIPE_* environment keys are used.
 *
 * As with Paystack and Flutterwave, nothing from the browser is trusted:
 * a payment is settled only after the server asks Remita or Stripe for the
 * status and the amount matches.
 */
import { createHash, createHmac, timingSafeEqual } from "crypto";
import type { Verification } from "./payments";

export type RemitaCreds = { merchant_id: string; service_type_id: string; api_key: string; live?: boolean };
export type StripeCreds = { secret_key: string; webhook_secret?: string | null };

const sha512 = (s: string) => createHash("sha512").update(s).digest("hex");
const remitaBase = (c: RemitaCreds) => (c.live ? "https://login.remita.net" : "https://demo.remita.net");

export async function moreCreds(svc: any, tenantId: string, provider: "remita" | "stripe"): Promise<RemitaCreds | StripeCreds | null> {
  const { data } = await svc.from("integration_secrets").select("data").eq("tenant_id", tenantId).eq("provider", provider).maybeSingle();
  if (provider === "remita") {
    const d = data?.data;
    if (d?.merchant_id && d?.service_type_id && d?.api_key) return d as RemitaCreds;
    const e = process.env;
    return e.REMITA_MERCHANT_ID && e.REMITA_SERVICE_TYPE_ID && e.REMITA_API_KEY
      ? { merchant_id: e.REMITA_MERCHANT_ID, service_type_id: e.REMITA_SERVICE_TYPE_ID, api_key: e.REMITA_API_KEY, live: e.REMITA_LIVE === "1" } : null;
  }
  const d = data?.data;
  if (d?.secret_key) return d as StripeCreds;
  return process.env.STRIPE_SECRET_KEY ? { secret_key: process.env.STRIPE_SECRET_KEY, webhook_secret: process.env.STRIPE_WEBHOOK_SECRET ?? null } : null;
}

// ---------------- Remita ----------------

/** Remita answers some calls wrapped as `jsonp ({...})`. */
export function unwrapJsonp(text: string): any {
  const m = text.trim().match(/^[\w$]*\s*\(([\s\S]*)\)\s*;?$/);
  try { return JSON.parse(m ? m[1] : text); } catch { return null; }
}

export async function remitaInit(c: RemitaCreds, p: { orderId: string; amount: number; payerName: string; payerEmail: string; payerPhone?: string | null; description: string }) {
  const amount = p.amount.toFixed(2);
  const hash = sha512(c.merchant_id + c.service_type_id + p.orderId + amount + c.api_key);
  const r = await fetch(`${remitaBase(c)}/remita/exapp/api/v1/send/api/echannelsvc/merchant/api/paymentinit`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `remitaConsumerKey=${c.merchant_id},remitaConsumerToken=${hash}` },
    body: JSON.stringify({ serviceTypeId: c.service_type_id, amount, orderId: p.orderId, payerName: p.payerName, payerEmail: p.payerEmail, payerPhone: p.payerPhone ?? "", description: p.description.slice(0, 100) }),
    signal: AbortSignal.timeout(20000)
  });
  const j = unwrapJsonp(await r.text());
  if (!j?.RRR) throw new Error(j?.status ?? j?.message ?? "Remita did not create a payment reference");
  return { rrr: String(j.RRR) };
}

/** The auto-submitting form that takes the parent to Remita's payment page. */
export function remitaPaymentPage(c: RemitaCreds, rrr: string, returnUrl: string): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]!));
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Remita</title></head>
<body style="font-family:system-ui;padding:24px"><p>Taking you to Remita… Your Remita reference (RRR) is <b>${esc(rrr)}</b>. You can also pay it at any bank or on your banking app.</p>
<form id="f" method="POST" action="${remitaBase(c)}/remita/ecomm/finalize.reg"><input type="hidden" name="merchantId" value="${esc(c.merchant_id)}">
<input type="hidden" name="hash" value="${sha512(c.merchant_id + rrr + c.api_key)}"><input type="hidden" name="rrr" value="${esc(rrr)}">
<input type="hidden" name="responseurl" value="${esc(returnUrl)}"><noscript><button>Continue to Remita</button></noscript></form>
<script>document.getElementById("f").submit()</script></body></html>`;
}

/** Status 00 or 01 means paid. */
export function normaliseRemita(j: any, currency: string): Verification {
  const s = String(j?.status ?? "");
  return { status: s === "00" || s === "01" ? "success" : s === "02" || s === "022" ? "failed" : "pending", amount: Number(j?.amount ?? 0), currency };
}

export async function remitaStatus(c: RemitaCreds, orderId: string, currency: string): Promise<Verification | { error: string }> {
  const hash = sha512(orderId + c.api_key + c.merchant_id);
  try {
    const r = await fetch(`${remitaBase(c)}/remita/exapp/api/v1/send/api/echannelsvc/${c.merchant_id}/${encodeURIComponent(orderId)}/${hash}/orderstatus.reg`, {
      headers: { Authorization: `remitaConsumerKey=${c.merchant_id},remitaConsumerToken=${hash}` }, signal: AbortSignal.timeout(20000) });
    const j = unwrapJsonp(await r.text());
    if (!j) return { error: `remita ${r.status}` };
    return { ...normaliseRemita(j, currency), raw: { rrr: j.RRR, message: j.message } };
  } catch (e) { return { error: (e as Error).message }; }
}

// ---------------- Stripe ----------------

const ZERO_DECIMAL = new Set(["BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF"]);
export const stripeMinor = (amount: number, currency: string) => (ZERO_DECIMAL.has(currency.toUpperCase()) ? Math.round(amount) : Math.round(amount * 100));

export async function stripeCheckout(c: StripeCreds, p: { reference: string; amount: number; currency: string; email: string; description: string; successUrl: string; cancelUrl: string }) {
  const form = new URLSearchParams({
    mode: "payment", success_url: p.successUrl, cancel_url: p.cancelUrl, client_reference_id: p.reference, customer_email: p.email,
    "line_items[0][quantity]": "1", "line_items[0][price_data][currency]": p.currency.toLowerCase(),
    "line_items[0][price_data][unit_amount]": String(stripeMinor(p.amount, p.currency)), "line_items[0][price_data][product_data][name]": p.description.slice(0, 120),
    "metadata[reference]": p.reference, "payment_intent_data[metadata][reference]": p.reference
  });
  const r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST", headers: { Authorization: `Bearer ${c.secret_key}`, "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": p.reference },
    body: form, signal: AbortSignal.timeout(20000)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.url) throw new Error(j?.error?.message ?? "Stripe could not start the payment");
  return { url: String(j.url), id: String(j.id) };
}

export function normaliseStripe(session: any): Verification {
  const cur = String(session?.currency ?? "").toUpperCase();
  const amt = Number(session?.amount_total ?? 0);
  return { status: session?.payment_status === "paid" ? "success" : session?.status === "expired" ? "failed" : "pending", amount: ZERO_DECIMAL.has(cur) ? amt : amt / 100, currency: cur };
}

export async function stripeSession(c: StripeCreds, id: string): Promise<Verification | { error: string }> {
  try {
    const r = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${c.secret_key}` }, signal: AbortSignal.timeout(20000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { error: j?.error?.message ?? `stripe ${r.status}` };
    return { ...normaliseStripe(j), raw: { id: j.id, payment_intent: j.payment_intent } };
  } catch (e) { return { error: (e as Error).message }; }
}

/** Stripe-Signature: "t=<time>,v1=<hex HMAC-SHA256 of `${t}.${body}`>"; five minutes' tolerance. */
export function verifyStripeSignature(raw: string, header: string | null, secret: string | null | undefined, now = Date.now()): boolean {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(",").map(x => x.split("=") as [string, string]).filter(x => x.length === 2));
  const t = Number(parts.t);
  if (!t || Math.abs(now / 1000 - t) > 300) return false;
  const want = createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex");
  return header.split(",").filter(x => x.startsWith("v1=")).some(x => {
    const got = x.slice(3);
    return got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want));
  });
}
