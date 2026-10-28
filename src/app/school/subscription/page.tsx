"use client";
import { useState } from "react";
import { useApi, send, Page, PageHeader, Alert, Badge, Field, Loading, Modal, fmtDate } from "@/components/ui";
import { moduleLabel, naira } from "@/lib/saas";

type Data = {
  plan: { name: string; blurb: string | null } | null;
  subscription: { status: string; cycle: string; band_label: string; add_on_groups: string[]; period_start: string | null; period_end: string | null; cancel_at_period_end: boolean } | null;
  price: { lines: { label: string; amount: number }[]; annual: number | null; per_invoice: number | null } | null;
  groups: { key: string; label: string; hint: string }[];
  modules: { key: string; label: string; group: string; on: boolean; until: string | null }[];
  invoices: { id: string; number: string; status: string; amount_cents: number; lines: { label: string; amount: number }[]; period_start: string | null; period_end: string | null; due_at: string | null; paid_at: string | null; created_at: string; pay_token: string | null }[];
  pay_online?: boolean;
  requests: { id: string; module: string; action: string; note: string | null; status: string; reply: string | null; created_at: string }[];
  billing: { company: string; bank_details: string };
};

const STATUS: Record<string, [string, "green" | "blue" | "amber" | "red" | "slate"]> = {
  active: ["Paid up", "green"], trial: ["Free trial", "blue"], past_due: ["Payment overdue", "amber"], suspended: ["Paused for payment", "red"], cancelled: ["Ended", "slate"]
};

/** The school's Synergy Swift plan, which modules it has, its invoices, and asking for changes. */
export default function SubscriptionPage() {
  const { data, error, reload } = useApi<Data>("/api/school/subscription");
  const [ask, setAsk] = useState<{ module: string; action: "add" | "remove" } | null>(null);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [print, setPrint] = useState<Data["invoices"][number] | null>(null);
  if (error) return <Page><Alert>{error}</Alert></Page>;
  if (!data) return <Page><Loading /></Page>;
  const s = data.subscription;
  const waiting = new Set(data.requests.filter(r => r.status === "pending").map(r => r.module));
  return (
    <Page wide>
      <PageHeader eyebrow="Settings" title="Subscription and modules" subtitle="Your Synergy Swift plan, the parts of the system your school has, and your invoices." />
      {msg && <div className="mb-4"><Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert></div>}
      <section className="card mb-5 grid gap-4 p-5 text-sm md:grid-cols-4">
        <div><p className="text-xs text-slate-500">Plan</p><p className="text-lg font-semibold">{data.plan?.name ?? "Not on a plan yet"}</p><p className="text-slate-600">{data.plan?.blurb}</p></div>
        <div><p className="text-xs text-slate-500">Status</p>{s ? <Badge tone={(STATUS[s.status] ?? ["", "slate"])[1]}>{(STATUS[s.status] ?? [s.status])[0]}</Badge> : <span className="text-slate-500">—</span>}{s?.cancel_at_period_end && <p className="mt-1 text-amber-700">Ends at the end of this period</p>}</div>
        <div><p className="text-xs text-slate-500">Current period</p><p>{s?.period_start ? `${fmtDate(s.period_start)} to ${fmtDate(s.period_end!)}` : "—"}</p><p className="text-slate-600">{s ? `${s.band_label}, billed ${s.cycle === "annual" ? "yearly" : "each term"}` : ""}</p></div>
        <div><p className="text-xs text-slate-500">Price</p><p className="text-lg font-semibold tabular-nums">{data.price?.annual != null ? `${naira(data.price.annual)} a year` : "—"}</p>{s?.cycle === "termly" && data.price?.per_invoice != null && <p className="text-slate-600">{naira(data.price.per_invoice)} a term</p>}</div>
      </section>

      <section className="card mb-5 p-5">
        <h2 className="font-semibold">Modules</h2>
        <p className="mb-4 text-sm text-slate-600">Ask to add or remove any part. The Synergy Swift team answers quickly, and you will get an email.</p>
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {data.groups.map(g => (
            <div key={g.key}>
              <p className="text-sm font-semibold">{g.label}</p>
              <p className="mb-2 text-xs text-slate-500">{g.hint}</p>
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
                {data.modules.filter(m => m.group === g.key).map(m => (
                  <li key={m.key} className="flex items-center gap-2 px-3 py-2">
                    <span className={"h-2 w-2 shrink-0 rounded-full " + (m.on ? "bg-emerald-500" : "bg-slate-300")} aria-hidden />
                    <span className="flex-1">{m.label}{m.until && <span className="block text-xs text-slate-500">until {fmtDate(m.until)}</span>}</span>
                    {waiting.has(m.key) ? <span className="text-xs text-amber-700">asked</span>
                      : <button className="text-xs text-brand-700 hover:underline" onClick={() => { setAsk({ module: m.key, action: m.on ? "remove" : "add" }); setNote(""); }}>{m.on ? "Remove" : "Add"}</button>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {data.requests.length > 0 && (
        <section className="card mb-5 p-5">
          <h2 className="mb-2 font-semibold">Your requests</h2>
          <ul className="divide-y divide-slate-100 text-sm">
            {data.requests.map(r => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="flex-1">{r.action === "add" ? "Add" : "Remove"} {moduleLabel(r.module)}{r.reply && <span className="block text-slate-600">Reply: {r.reply}</span>}</span>
                <Badge tone={r.status === "done" ? "green" : r.status === "declined" ? "slate" : "amber"}>{r.status === "pending" ? "waiting" : r.status}</Badge>
                <span className="text-xs text-slate-500">{fmtDate(r.created_at)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card p-5">
        <h2 className="mb-2 font-semibold">Invoices</h2>
        {data.invoices.length === 0 ? <p className="text-sm text-slate-500">No invoices yet.</p> : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500"><tr><th className="py-1">Number</th><th>For</th><th className="text-right">Amount</th><th>Due</th><th>Status</th><th /></tr></thead>
            <tbody>
              {data.invoices.map(i => (
                <tr key={i.id} className="border-t border-slate-100">
                  <td className="py-2 font-mono text-xs">{i.number}</td>
                  <td>{i.period_start ? `${fmtDate(i.period_start)} to ${fmtDate(i.period_end!)}` : "—"}</td>
                  <td className="text-right tabular-nums">{naira(i.amount_cents / 100)}</td>
                  <td>{i.due_at ? fmtDate(i.due_at) : "—"}</td>
                  <td><Badge tone={i.status === "paid" ? "green" : i.status === "open" ? "amber" : "slate"}>{i.status === "open" ? "to pay" : i.status === "void" ? "cancelled" : "paid"}</Badge></td>
                  <td className="whitespace-nowrap text-right">{i.pay_token && data.pay_online && <a className="btn btn-primary mr-2 px-2.5 py-1 text-xs no-underline" href={`/billing/${i.pay_token}`}>Pay now</a>}<button className="text-xs text-brand-700 hover:underline" onClick={() => setPrint(i)}>View</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {data.billing.bank_details && <p className="mt-3 whitespace-pre-wrap rounded bg-slate-50 p-3 text-sm"><b>Pay by transfer to</b><br />{data.billing.bank_details}<br /><span className="text-slate-600">Use the invoice number as the reference.</span></p>}
      </section>

      {ask && (
        <Modal open onClose={() => setAsk(null)} title={`${ask.action === "add" ? "Add" : "Remove"} ${moduleLabel(ask.module)}`}>
          <div className="space-y-3">
            <p className="text-sm text-slate-600">{ask.action === "add" ? "The Synergy Swift team will switch it on and tell you about any change to your bill." : "Removing a module hides it from everyone in your school. Its records are kept and come back if you add it again."}</p>
            <Field label="Anything we should know? (optional)"><textarea className="input h-20" value={note} onChange={e => setNote(e.target.value)} /></Field>
            <div className="flex justify-end gap-2"><button className="btn btn-ghost" onClick={() => setAsk(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={async () => {
                const r = await send("/api/school/subscription", { ...ask, note: note || null });
                setMsg({ ok: r.ok, text: r.ok ? "Request sent. You will get an email when it is done." : r.error ?? "failed" });
                setAsk(null); if (r.ok) reload();
              }}>Send request</button></div>
          </div>
        </Modal>
      )}
      {print && (
        <Modal open onClose={() => setPrint(null)} title={`Invoice ${print.number}`} wide>
          <div className="space-y-3 text-sm" id="invoice">
            <div className="flex justify-between"><div><p className="font-serif text-lg">{data.billing.company}</p><p className="text-slate-500">Invoice {print.number} · {fmtDate(print.created_at)}</p></div><Badge tone={print.status === "paid" ? "green" : "amber"}>{print.status === "paid" ? `Paid ${print.paid_at ? fmtDate(print.paid_at) : ""}` : `Due ${print.due_at ? fmtDate(print.due_at) : ""}`}</Badge></div>
            {print.period_start && <p>Synergy Swift subscription, {fmtDate(print.period_start)} to {fmtDate(print.period_end!)}</p>}
            <table className="w-full"><tbody>{(print.lines ?? []).map((l, k) => <tr key={k} className="border-t border-slate-100"><td className="py-1">{l.label}</td><td className="text-right tabular-nums">{naira(l.amount)}</td></tr>)}
              <tr className="border-t-2 border-slate-300 font-semibold"><td className="py-1">Total</td><td className="text-right tabular-nums">{naira(print.amount_cents / 100)}</td></tr></tbody></table>
            {data.billing.bank_details && <p className="whitespace-pre-wrap text-slate-700">{data.billing.bank_details}</p>}
            <div className="flex justify-end"><button className="btn btn-outline" onClick={() => window.print()}>Print</button></div>
          </div>
        </Modal>
      )}
    </Page>
  );
}
