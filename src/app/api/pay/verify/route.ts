import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { confirmOnlinePayment } from "@/lib/fees";
import { appUrl } from "@/lib/school";
import { confirmWalletTopUp, safeReturnPath } from "@/lib/wallet";
import { confirmAdmissionPayment } from "@/lib/admissions-crm";
import { confirmDonation } from "@/lib/collections-server";
import { confirmInvoicePayment } from "@/lib/platform-pay";

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
  // A school paying its Synergy Swift invoice (14q).
  if (reference.startsWith("SSI-")) {
    const p = await confirmInvoicePayment(createServiceClient(), reference);
    return NextResponse.redirect(p.token ? `${base}/billing/${p.token}?payment=${encodeURIComponent(p.status)}` : `${base}/`);
  }
  if (reference.startsWith("DON-")) {
    const d = await confirmDonation(createServiceClient(), reference, base);
    return NextResponse.redirect(`${base}${d.path}?gift=${encodeURIComponent(d.status)}`);
  }
  if (reference.startsWith("ADM-")) {
    const a = await confirmAdmissionPayment(createServiceClient(), reference);
    return NextResponse.redirect(a.token ? `${base}/apply/track/${a.token}?payment=${encodeURIComponent(a.status)}` : `${base}/`);
  }
  const r = await confirmOnlinePayment(createServiceClient(), reference, base);
  if (!r.token) return NextResponse.redirect(`${base}/`);
  return NextResponse.redirect(`${base}/pay/${r.token}?payment=${encodeURIComponent(r.status)}`);
}
