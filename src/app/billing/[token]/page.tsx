"use client";
import { Suspense, use, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Wordmark } from "@/components/site/SiteChrome";

type Inv = { school: string; email: string; number: string; status: string; kind: string; amount: number; currency: string; lines: { label: string; amount: number }[];
  period_start: string | null; period_end: string | null; due_at: string | null; paid_at: string | null; pay_online: boolean; company: string; bank_details: string | null };

const naira = (n: number) => `₦${n.toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;
const day = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "");

/** Pay a Synergy Swift invoice (14q): the private link from the billing email, no sign-in needed. */
export default function BillingPage(props: { params: Promise<{ token: string }> }) {
  const { token } = use(props.params);
  return <Suspense fallback={null}><Billing token={token} /></Suspense>;
}

function Billing({ token }: { token: string }) {
  const q = useSearchParams();
  const [inv, setInv] = useState<Inv | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const payment = q.get("payment");
  useEffect(() => {
    fetch(`/api/billing/${token}`).then(async r => {
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return setErr(j.error ?? "This link isn't right.");
      setInv(j); setEmail(j.email ?? "");
    }).catch(() => setErr("Couldn't load the invoice. Check your connection and try again."));
  }, [token, payment]);

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const r = await fetch(`/api/billing/${token}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.url) { setBusy(false); return setErr(j.error ?? "Couldn't start the payment. Please try again."); }
    window.location.href = j.url;
  }

  const paid = payment === "success" || inv?.status === "paid";
  return (
    <main className="min-h-screen bg-paper px-5 py-10 sm:py-16">
      <div className="mx-auto max-w-lg">
        <Wordmark />
        {err && !inv && <p className="mt-10 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{err}</p>}
        {inv && (
          <div className="card mt-8 p-6">
            <p className="font-mono text-[12px] text-brass-700">Invoice {inv.number}</p>
            <h1 className="mt-1 font-serif text-[26px] font-semibold tracking-[-0.01em] text-navy">{inv.school}</h1>
            {inv.period_start && inv.period_end && <p className="mt-1 text-sm text-slate-600">Synergy Swift, {day(inv.period_start)} to {day(inv.period_end)}</p>}
            {paid ? (
              <div className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                <p className="font-semibold">Paid{inv.paid_at ? ` on ${day(inv.paid_at)}` : ""}. Thank you.</p>
                <p className="mt-1">A receipt has been emailed, and your school&apos;s Synergy Swift is up to date.</p>
              </div>
            ) : inv.status !== "open" ? (
              <p className="mt-6 text-sm text-slate-600">This invoice was cancelled. Please contact Synergy Swift.</p>
            ) : (
              <>
                {payment === "failed" && <p className="mt-4 rounded-md bg-rose-50 p-3 text-sm text-rose-800">The payment didn&apos;t go through. Nothing was taken; you can try again.</p>}
                {payment === "pending" && <p className="mt-4 rounded-md bg-amber-50 p-3 text-sm text-amber-900">Your bank is still confirming the payment. There is no need to pay again; this page shows it as paid once it is confirmed.</p>}
                <table className="mt-6 w-full text-sm">
                  <tbody>
                    {inv.lines.map((l, i) => <tr key={i} className="border-t border-slate-100"><td className="py-2 pr-3 text-slate-700">{l.label}</td><td className="py-2 text-right tabular-nums">{naira(l.amount)}</td></tr>)}
                    <tr className="border-t-2 border-slate-300 font-semibold"><td className="py-2">Total</td><td className="py-2 text-right tabular-nums">{naira(inv.amount)}</td></tr>
                  </tbody>
                </table>
                {inv.due_at && <p className="mt-2 text-xs text-slate-500">Due {day(inv.due_at)}</p>}
                {inv.pay_online ? (
                  <form onSubmit={pay} className="mt-6 space-y-3">
                    <label className="block"><span className="label">Email for the receipt</span>
                      <input className="input" type="email" required value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" /></label>
                    {err && <p className="text-sm text-rose-700">{err}</p>}
                    <button className="btn h-11 w-full bg-navy text-[15px] text-white hover:bg-brand-900" disabled={busy}>{busy ? "Opening Paystack…" : `Pay ${naira(inv.amount)}`}</button>
                    <p className="text-center text-xs text-slate-500">Card, bank transfer or USSD, through Paystack.</p>
                  </form>
                ) : <p className="mt-6 text-sm text-slate-600">Online payment isn&apos;t available yet. Please pay by bank transfer.</p>}
                {inv.bank_details && <p className="mt-5 whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-sm"><b>Or pay by transfer to</b><br />{inv.bank_details}<br /><span className="text-slate-600">Use {inv.number} as the reference.</span></p>}
              </>
            )}
            <p className="mt-6 text-xs text-slate-500">{inv.company}</p>
          </div>
        )}
      </div>
    </main>
  );
}
