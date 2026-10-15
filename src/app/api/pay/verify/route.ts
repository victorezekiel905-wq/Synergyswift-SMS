import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { confirmOnlinePayment } from "@/lib/fees";
import { appUrl } from "@/lib/school";
import { confirmWalletTopUp, safeReturnPath } from "@/lib/wallet";
import { confirmAdmissionPayment } from "@/lib/admissions-crm";

export const dynamic = "force-dynamic";

/** Provider redirects the parent here after checkout; we verify server-side, then show the invoice. */
export async function GET(req: NextRequest) {
  const u = new URL(req.url);
  const reference = u.searchParams.get("reference") ?? u.searchParams.get("tx_ref") ?? u.searchParams.get("trxref") ?? u.searchParams.get("orderID");
  const base = appUrl(req);
  if (!reference) return NextResponse.redirect(`${base}/`);
  if (reference.startsWith("WAL-")) {
    const w = await confirmWalletTopUp(createServiceClient(), reference);
    const back = safeReturnPath(u.searchParams.get("return"));
    return NextResponse.redirect(`${base}${back}${back.includes("?") ? "&" : "?"}wallet=${encodeURIComponent(w.status)}#wallet`);
  }
  if (reference.startsWith("ADM-")) {
    const a = await confirmAdmissionPayment(createServiceClient(), reference);
    return NextResponse.redirect(a.token ? `${base}/apply/track/${a.token}?payment=${encodeURIComponent(a.status)}` : `${base}/`);
  }
  const r = await confirmOnlinePayment(createServiceClient(), reference, base);
  if (!r.token) return NextResponse.redirect(`${base}/`);
  return NextResponse.redirect(`${base}/pay/${r.token}?payment=${encodeURIComponent(r.status)}`);
}
