import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { confirmOnlinePayment } from "@/lib/fees";
import { verifyWebhook, type Provider } from "@/lib/payments";
import { appUrl } from "@/lib/school";
import { confirmWalletTopUp } from "@/lib/wallet";
import { confirmAdmissionPayment } from "@/lib/admissions-crm";
import { confirmDonation } from "@/lib/collections-server";
import { moreCreds, verifyStripeSignature, type StripeCreds } from "@/lib/payments-more";

export const dynamic = "force-dynamic";

/**
 * Provider webhooks (set these URLs in the Paystack / Flutterwave dashboards):
 *   /api/pay/webhook/paystack     /api/pay/webhook/flutterwave
 * The signature is checked, then the payment is re-verified with the provider
 * API; the webhook body itself is never trusted for amounts.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ provider: string }> }) {
  const { provider } = await props.params;
  if (provider === "stripe" || provider === "remita") return moreWebhook(req, provider);
  if (provider !== "paystack" && provider !== "flutterwave") return new NextResponse("not found", { status: 404 });
  const raw = await req.text();
  if (!verifyWebhook(provider as Provider, raw, req.headers)) return new NextResponse("bad signature", { status: 401 });
  let body: any = {};
  try { body = JSON.parse(raw); } catch { return new NextResponse("bad body", { status: 400 }); }
  const reference = provider === "paystack" ? body?.data?.reference : body?.data?.tx_ref ?? body?.txRef;
  if (reference && String(reference).startsWith("WAL-")) await confirmWalletTopUp(createServiceClient(), String(reference));
  else if (reference && String(reference).startsWith("ADM-")) await confirmAdmissionPayment(createServiceClient(), String(reference));
  else if (reference && String(reference).startsWith("DON-")) await confirmDonation(createServiceClient(), String(reference), appUrl(req));
  else if (reference) await confirmOnlinePayment(createServiceClient(), String(reference), appUrl(req));
  return NextResponse.json({ ok: true });
}

/**
 * Stripe: /api/pay/webhook/stripe (event checkout.session.completed), signed with the school's or platform's
 * webhook secret. Remita: /api/pay/webhook/remita (payment notifications). Either way the payment is then
 * re-checked with the provider before anything is settled.
 */
async function moreWebhook(req: NextRequest, provider: "stripe" | "remita") {
  const svc = createServiceClient();
  const raw = await req.text();
  let body: any = null;
  try { body = JSON.parse(raw); } catch { return new NextResponse("bad body", { status: 400 }); }
  const refs: string[] = [];
  if (provider === "stripe") {
    const ref = body?.data?.object?.client_reference_id ?? body?.data?.object?.metadata?.reference;
    if (!ref) return NextResponse.json({ ok: true });
    const { data: pay } = await svc.from("fee_payments").select("tenant_id").eq("reference", String(ref)).maybeSingle();
    if (!pay) return NextResponse.json({ ok: true });
    const creds = (await moreCreds(svc, pay.tenant_id, "stripe")) as StripeCreds | null;
    if (!verifyStripeSignature(raw, req.headers.get("stripe-signature"), creds?.webhook_secret)) return new NextResponse("bad signature", { status: 401 });
    refs.push(String(ref));
  } else {
    for (const n of Array.isArray(body) ? body : [body]) if (n?.orderRef || n?.orderId) refs.push(String(n.orderRef ?? n.orderId));
  }
  for (const r of refs.slice(0, 50)) await confirmOnlinePayment(svc, r, appUrl(req));
  return NextResponse.json({ ok: true });
}
