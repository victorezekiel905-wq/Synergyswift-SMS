import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { moreCreds, remitaPaymentPage, type RemitaCreds } from "@/lib/payments-more";
import { appUrl } from "@/lib/school";

export const dynamic = "force-dynamic";

/** Takes the parent from the pay page to Remita's payment page for a pending payment. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ reference: string }> }) {
  const { reference } = await params;
  const svc = createServiceClient();
  const { data: pay } = await svc.from("fee_payments").select("tenant_id,status,provider,meta").eq("reference", reference).maybeSingle();
  if (!pay || pay.provider !== "remita" || pay.status !== "pending" || !pay.meta?.rrr) return new NextResponse("This payment link is not valid.", { status: 404 });
  const creds = (await moreCreds(svc, pay.tenant_id, "remita")) as RemitaCreds | null;
  if (!creds) return new NextResponse("Remita is not set up for this school.", { status: 404 });
  return new NextResponse(remitaPaymentPage(creds, String(pay.meta.rrr), `${appUrl(req)}/api/pay/verify?reference=${encodeURIComponent(reference)}`),
    { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
