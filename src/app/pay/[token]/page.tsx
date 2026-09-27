"use client";
import { use, useState } from "react";
import { useApi, send, money, fmtDate } from "@/components/ui";

type Data = {
  school: { name: string; logo_url: string | null; address: string | null; phone: string | null; email: string | null; brand_color: string | null };
  invoice: { invoice_no: string; title: string; status: string; total: number; amount_paid: number; balance: number; due_date: string | null; created_at: string;
    student: { name: string; admission_no: string; class_name: string | null };
    lines: { kind: string; description: string; amount: number }[];
    payments: { amount: number; method: string; receipt_no: string | null; paid_at: string | null; reference: string }[] };
  currency: string; bank_details: string | null; online: boolean; provider: string | null;
};

/** Public invoice + pay page (from the parent's WhatsApp / email link). Also prints as a statement with receipts. */
export default function PayPage(props: { params: Promise<{ token: string }> }) {
  const { token } = use(props.params);
  const { data, error, reload } = useApi<Data>(`/api/pay/${token}`);
  const [amount, setAmount] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const result = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("payment") : null;

  if (error) return <main className="mx-auto max-w-xl p-6"><p role="alert" className="rounded-lg bg-rose-50 p-4 text-rose-700">{error}</p></main>;
  if (!data) return <main className="p-10 text-center text-sm text-slate-500">Loading…</main>;
  const inv = data.invoice;
  const color = data.school.brand_color ?? "#1d5ddb";

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const r = await send<{ url: string }>(`/api/pay/${token}`, { amount: amount ? Number(amount) : null, email: email || null });
    if (!r.ok) { setBusy(false); setErr(r.error); return; }
    window.location.href = r.data.url;
  }

  return (
    <main className="mx-auto max-w-2xl bg-white p-4 text-slate-900 sm:p-8">
      <header className="flex items-center gap-3 border-b-4 pb-3" style={{ borderColor: color }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {data.school.logo_url && <img src={data.school.logo_url} alt="" className="h-14 w-14 object-contain" />}
        <div className="flex-1"><p className="text-lg font-bold" style={{ color }}>{data.school.name}</p><p className="text-xs text-slate-600">{data.school.address}{data.school.phone ? ` · ${data.school.phone}` : ""}</p></div>
        <div className="text-right text-xs"><p className="font-mono">{inv.invoice_no}</p><p>{fmtDate(inv.created_at)}</p></div>
      </header>
      {result === "success" && <p role="status" className="mt-4 rounded-lg bg-emerald-50 p-3 text-emerald-800">Payment received. Thank you! Your receipt has been sent to you.</p>}
      {result === "failed" && <p role="alert" className="mt-4 rounded-lg bg-rose-50 p-3 text-rose-800">The payment did not go through. You have not been charged; please try again.</p>}
      {result === "pending" && <p className="mt-4 rounded-lg bg-amber-50 p-3 text-amber-900">We are confirming your payment. Refresh in a minute. <button className="underline" onClick={reload}>Refresh</button></p>}
      <section className="mt-4 flex flex-wrap justify-between gap-2 text-sm">
        <div><p className="text-xs uppercase text-slate-500">Student</p><p className="font-semibold">{inv.student.name}</p><p className="text-slate-600">{inv.student.admission_no} · {inv.student.class_name}</p></div>
        <div className="text-right"><p className="text-xs uppercase text-slate-500">{inv.title}</p><p className="text-3xl font-black tabular-nums">{money(inv.balance, data.currency)}</p><p className="text-xs text-slate-500">balance{inv.due_date ? ` · due ${fmtDate(inv.due_date)}` : ""}</p></div>
      </section>
      <div className="overflow-x-auto print:overflow-visible"><table className="mt-4 w-full text-sm">
        <tbody>
          {inv.lines.map((l, i) => <tr key={i} className="border-t border-slate-100"><td className="py-1.5">{l.description}</td><td className="text-right tabular-nums">{money(l.amount, data.currency)}</td></tr>)}
          <tr className="border-t-2 border-slate-300 font-semibold"><td className="py-1.5">Total</td><td className="text-right tabular-nums">{money(inv.total, data.currency)}</td></tr>
          <tr><td className="py-1.5">Paid</td><td className="text-right tabular-nums">{money(inv.amount_paid, data.currency)}</td></tr>
        </tbody>
      </table></div>
      {inv.payments.length > 0 && (
        <section className="mt-4">
          <h2 className="text-sm font-semibold">Receipts</h2>
          <div className="overflow-x-auto print:overflow-visible"><table className="w-full text-sm"><tbody>{inv.payments.map((p, i) => (
            <tr key={i} className="border-t border-slate-100"><td className="py-1.5 font-mono text-xs">{p.receipt_no}</td><td>{fmtDate(p.paid_at, true)}</td><td className="capitalize">{p.method}</td><td className="text-right tabular-nums">{money(p.amount, data.currency)}</td></tr>))}</tbody></table></div>
        </section>
      )}
      {inv.balance > 0 && inv.status !== "void" && (
        <section className="mt-6 space-y-4 print:hidden">
          {data.online ? (
            <form onSubmit={pay} className="rounded-xl border-2 p-4" style={{ borderColor: color }}>
              <p className="font-semibold">Pay online (card, bank transfer or USSD)</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <label className="block text-sm"><span className="label">Amount (leave blank to pay the full balance)</span>
                  <input className="input" type="number" min={100} max={inv.balance} step="any" value={amount} onChange={e => setAmount(e.target.value)} placeholder={String(inv.balance)} /></label>
                <label className="block text-sm"><span className="label">Email for the receipt</span><input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" /></label>
              </div>
              {err && <p role="alert" className="mt-2 text-sm text-rose-600">{err}</p>}
              <button className="btn mt-3 w-full py-3 text-white" style={{ background: color }} disabled={busy}>{busy ? "Opening secure payment…" : `Pay ${amount ? money(Number(amount), data.currency) : money(inv.balance, data.currency)}`}</button>
              <p className="mt-2 text-center text-xs text-slate-500">Secured by {data.provider === "flutterwave" ? "Flutterwave" : "Paystack"}. The school never sees your card details.</p>
            </form>
          ) : <p className="rounded-lg bg-slate-50 p-3 text-sm">Online payment is not enabled for this school yet.</p>}
          {data.bank_details && <div className="rounded-lg bg-slate-50 p-3 text-sm"><p className="font-semibold">Pay by bank transfer</p><p className="whitespace-pre-wrap">{data.bank_details}</p><p className="mt-1 text-xs text-slate-500">Use <b>{inv.invoice_no}</b> as the transfer narration.</p></div>}
        </section>
      )}
      <div className="mt-6 text-center print:hidden"><button className="btn btn-outline" onClick={() => window.print()}>Print or save as PDF</button></div>
    </main>
  );
}
