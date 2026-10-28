import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { readJson, jsonError } from "@/lib/auth";
import { appUrl } from "@/lib/school";
import { invoiceFromToken, invoiceForPayment, startInvoicePayment, onlineInvoicePayments } from "@/lib/platform-pay";
import { platformSetting } from "@/lib/saas-server";

export const dynamic = "force-dynamic";

const BAD_LINK = "This payment link isn't right. Use the link in the latest email from Synergy Swift.";

/** A Synergy Swift invoice by its private pay link (14q). Works without signing in, so a paused school can still pay. */
export async function GET(_req: NextRequest, props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  const id = invoiceFromToken(token);
  if (!id) return jsonError(BAD_LINK, 404);
  const svc = createServiceClient();
  const inv = await invoiceForPayment(svc, id);
  if (!inv) return jsonError(BAD_LINK, 404);
  const billing = await platformSetting(svc, "billing", { company: "Synergy Swift Technologies Limited", bank_details: "" } as { company: string; bank_details: string });
  return NextResponse.json({
    school: inv.tenants?.name ?? "", email: inv.tenants?.contact_email ?? "", number: inv.number, status: inv.status, kind: inv.kind,
    amount: inv.amount_cents / 100, currency: inv.currency ?? "NGN", lines: inv.lines ?? [], period_start: inv.period_start, period_end: inv.period_end,
    due_at: inv.due_at, paid_at: inv.paid_at, pay_online: onlineInvoicePayments(), company: billing.company, bank_details: billing.bank_details || null
  });
}

const Body = z.object({ email: z.string().trim().toLowerCase().email().max(254) });

export async function POST(req: NextRequest, props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  const id = invoiceFromToken(token);
  if (!id) return jsonError(BAD_LINK, 404);
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError("Enter the email address for the receipt.");
  const r = await startInvoicePayment(createServiceClient(), id, parsed.data.email, appUrl(req));
  return "error" in r ? jsonError(r.error, r.status ?? 400) : NextResponse.json(r);
}
