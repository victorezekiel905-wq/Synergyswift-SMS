/**
 * Online fee payments through Paystack or Flutterwave.
 *
 * The platform holds one account per provider (PAYSTACK_SECRET_KEY,
 * FLW_SECRET_KEY). Each school sets its provider "subaccount" code in School
 * setup → Finance, so money settles straight into the school's bank account.
 *
 * Nothing is trusted from the browser: a payment is marked successful only
 * after the server verifies the reference with the provider and the amount
 * and currency match what was requested.
 */
import { createHmac, timingSafeEqual } from "crypto";

export type Provider = "paystack" | "flutterwave";

const env = (k: string) => {
  const v = process.env[k];
  return v && !v.includes("replace") ? v : undefined;
};

export function providerConfigured(p: Provider | null | undefined): p is Provider {
  if (p === "paystack") return Boolean(env("PAYSTACK_SECRET_KEY"));
  if (p === "flutterwave") return Boolean(env("FLW_SECRET_KEY"));
  return false;
}

/** Amount in the provider's minor unit (kobo, cents). Rounded to avoid float drift. */
export function toMinor(amount: number): number {
  return Math.round(Number(amount) * 100);
}

export type InitInput = {
  provider: Provider; reference: string; amount: number; currency: string; email: string;
  name?: string | null; phone?: string | null; callbackUrl: string; subaccount?: string | null;
  description: string; logoUrl?: string | null; metadata?: Record<string, unknown>;
};

export async function initializePayment(i: InitInput): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  if (!providerConfigured(i.provider)) return { ok: false, error: `${i.provider} is not configured on this server` };
  try {
    if (i.provider === "paystack") {
      const r = await fetch("https://api.paystack.co/transaction/initialize", {
        method: "POST",
        headers: { Authorization: `Bearer ${env("PAYSTACK_SECRET_KEY")}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          email: i.email, amount: toMinor(i.amount), currency: i.currency, reference: i.reference, callback_url: i.callbackUrl,
          ...(i.subaccount ? { subaccount: i.subaccount, bearer: "subaccount" } : {}),
          metadata: { ...i.metadata, custom_fields: [{ display_name: "Description", variable_name: "description", value: i.description }] }
        })
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.status && j.data?.authorization_url) return { ok: true, url: j.data.authorization_url };
      return { ok: false, error: j.message ?? `paystack ${r.status}` };
    }
    const r = await fetch("https://api.flutterwave.com/v3/payments", {
      method: "POST",
      headers: { Authorization: `Bearer ${env("FLW_SECRET_KEY")}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        tx_ref: i.reference, amount: Number(i.amount.toFixed(2)), currency: i.currency, redirect_url: i.callbackUrl,
        customer: { email: i.email, name: i.name ?? undefined, phonenumber: i.phone ?? undefined },
        customizations: { title: i.description.slice(0, 60), logo: i.logoUrl ?? undefined },
        ...(i.subaccount ? { subaccounts: [{ id: i.subaccount }] } : {}),
        meta: i.metadata
      })
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.status === "success" && j.data?.link) return { ok: true, url: j.data.link };
    return { ok: false, error: j.message ?? `flutterwave ${r.status}` };
  } catch (e) {
    return { ok: false, error: `payment provider unreachable: ${(e as Error).message}` };
  }
}

export type Verification = { status: "success" | "failed" | "pending"; amount: number; currency: string; raw?: unknown };

/** Normalises provider verify responses (pure, unit-tested). */
export function normaliseVerification(provider: Provider, body: any): Verification {
  if (provider === "paystack") {
    const d = body?.data ?? {};
    const status = d.status === "success" ? "success" : ["failed", "abandoned", "reversed"].includes(d.status) ? "failed" : "pending";
    return { status, amount: Number(d.amount ?? 0) / 100, currency: String(d.currency ?? "").toUpperCase() };
  }
  const d = body?.data ?? {};
  const status = d.status === "successful" ? "success" : d.status === "failed" ? "failed" : "pending";
  return { status, amount: Number(d.amount ?? 0), currency: String(d.currency ?? "").toUpperCase() };
}

export async function verifyPayment(provider: Provider, reference: string): Promise<Verification | { error: string }> {
  if (!providerConfigured(provider)) return { error: `${provider} is not configured` };
  try {
    const r = provider === "paystack"
      ? await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, { headers: { Authorization: `Bearer ${env("PAYSTACK_SECRET_KEY")}` } })
      : await fetch(`https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`, { headers: { Authorization: `Bearer ${env("FLW_SECRET_KEY")}` } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok && r.status !== 400) return { error: `verify failed (${r.status})` };
    return { ...normaliseVerification(provider, j), raw: j?.data ? { id: j.data.id, channel: j.data.channel ?? j.data.payment_type } : undefined };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** A verified payment must match exactly what we asked for. */
export function matchesExpected(v: Verification, expectedAmount: number, currency: string): boolean {
  return v.status === "success" && toMinor(v.amount) === toMinor(expectedAmount) && v.currency === currency.toUpperCase();
}

/** Webhook authenticity: Paystack signs with HMAC-SHA512; Flutterwave sends a shared secret hash. */
export function verifyWebhook(provider: Provider, rawBody: string, headers: Headers, secrets = {
  paystack: env("PAYSTACK_SECRET_KEY"), flutterwave: env("FLW_SECRET_HASH")
}): boolean {
  if (provider === "paystack") {
    const sig = headers.get("x-paystack-signature") ?? "";
    if (!secrets.paystack || !sig) return false;
    const expected = createHmac("sha512", secrets.paystack).update(rawBody).digest("hex");
    return safeEqual(expected, sig);
  }
  const hash = headers.get("verif-hash") ?? "";
  return Boolean(secrets.flutterwave && hash && safeEqual(secrets.flutterwave, hash));
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Reference that tells us the school at a glance and cannot collide. */
export function newReference(prefix = "EDU"): string {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}
