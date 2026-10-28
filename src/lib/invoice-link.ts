/**
 * Private pay links and payment references for Synergy Swift invoices (phase 14q).
 * Kept apart from platform-pay.ts so billing (saas-server.ts) can put the link in its emails.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";

export const INVOICE_PREFIX = "SSI-";

function linkKey(): Buffer {
  if (process.env.BILLING_LINK_KEY) return Buffer.from(process.env.BILLING_LINK_KEY);
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!svc) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  return createHash("sha256").update(`billing-link:${svc}`).digest();
}
const sign = (id: string) => createHmac("sha256", linkKey()).update(`invoice:${id}`).digest().subarray(0, 16).toString("base64url");
const compact = (uuid: string) => uuid.replace(/-/g, "").toLowerCase();
const expand = (hex: string) => `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;

/** The private pay link token for an invoice: its id and a signature. */
export const payToken = (invoiceId: string) => `${compact(invoiceId)}.${sign(invoiceId)}`;

/** The invoice id inside a pay token, or null when it was changed or made up. */
export function invoiceFromToken(token: string): string | null {
  const m = /^([0-9a-f]{32})\.([A-Za-z0-9_-]{20,24})$/.exec(token ?? "");
  if (!m) return null;
  const id = expand(m[1]);
  const a = Buffer.from(m[2]), b = Buffer.from(sign(id));
  return a.length === b.length && timingSafeEqual(a, b) ? id : null;
}

/** A new payment reference for an invoice, and the invoice id back out of one. */
export const newInvoiceReference = (invoiceId: string) => `${INVOICE_PREFIX}${compact(invoiceId)}-${randomBytes(4).toString("hex")}`;
export function invoiceFromReference(reference: string): string | null {
  const m = /^SSI-([0-9a-f]{32})-[0-9a-f]{8}$/.exec(reference ?? "");
  return m ? expand(m[1]) : null;
}

/** The full pay link for an invoice. */
export const payLink = (base: string, invoiceId: string) => `${base.replace(/\/+$/, "")}/billing/${payToken(invoiceId)}`;
