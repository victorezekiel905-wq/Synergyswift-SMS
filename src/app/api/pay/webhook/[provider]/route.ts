import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { confirmOnlinePayment } from "@/lib/fees";
import { verifyWebhook, type Provider } from "@/lib/payments";
import { appUrl } from "@/lib/school";

export const dynamic = "force-dynamic";

/**
 * Provider webhooks (set these URLs in the Paystack / Flutterwave dashboards):
 *   /api/pay/webhook/paystack     /api/pay/webhook/flutterwave
 * The signature is checked, then the payment is re-verified with the provider
 * API; the webhook body itself is never trusted for amounts.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ provider: string }> }) {
  const { provider } = await props.params;
  if (provider !== "paystack" && provider !== "flutterwave") return new NextResponse("not found", { status: 404 });
  const raw = await req.text();
  if (!verifyWebhook(provider as Provider, raw, req.headers)) return new NextResponse("bad signature", { status: 401 });
  let body: any = {};
  try { body = JSON.parse(raw); } catch { return new NextResponse("bad body", { status: 400 }); }
  const reference = provider === "paystack" ? body?.data?.reference : body?.data?.tx_ref ?? body?.txRef;
  if (reference) await confirmOnlinePayment(createServiceClient(), String(reference), appUrl(req));
  return NextResponse.json({ ok: true });
}
