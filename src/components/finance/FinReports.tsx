"use client";
import { useState } from "react";
import { useApi, Alert, Empty, Field, Stat, money, fmtDate, localDate } from "@/components/ui";

type G = { label: string; count: number; amount: number };
type Collections = { currency: string; from: string; to: string; total: number; count: number; byDay: G[]; byMethod: G[]; byClass: G[] };
type Revenue = { currency: string; term_id: string | null; byClass: { label: string; invoices: number; billed: number; paid: number; outstanding: number; rate: number | null }[]; byItem: G[];
  totals: { billed: number; paid: number; outstanding: number } };

/** Collections by day, method and class; fees billed, paid and outstanding by class and by fee item. */
export function FinReports() {
  const [range, setRange] = useState({ from: localDate(30), to: localDate() });
  const { data: sessions } = useApi<{ name: string; terms: { id: string; name: string }[] | null }[]>("/api/school/academic");
  const terms = (sessions ?? []).flatMap(s => (s.terms ?? []).map(t => ({ id: t.id, label: `${s.name} · ${t.name}` })));
  const [term, setTerm] = useState("");
  const col = useApi<Collections>(`/api/accounts?view=collections&from=${range.from}&to=${range.to}`, [range.from, range.to]);
  const revQ = term === "range" ? `term_id=range&from=${range.from}&to=${range.to}` : `term_id=${term}`;
  const rev = useApi<Revenue>(`/api/accounts?view=revenue&${revQ}`, [revQ]);
  const cur = col.data?.currency ?? rev.data?.currency ?? "NGN";
  const maxDay = Math.max(1, ...(col.data?.byDay ?? []).map(d => d.amount));
  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <h2 className="mr-auto font-semibold">Collections</h2>
          <Field label="From"><input className="input" type="date" value={range.from} onChange={e => setRange({ ...range, from: e.target.value })} /></Field>
          <Field label="To"><input className="input" type="date" value={range.to} onChange={e => setRange({ ...range, to: e.target.value })} /></Field>
          <a className="btn btn-outline" href={`/api/accounts?view=collections&from=${range.from}&to=${range.to}&format=csv`}>CSV (every payment)</a>
        </div>
        {col.error && <Alert>{col.error}</Alert>}
        {col.data && (!col.data.count ? <Empty>No fees received in this period.</Empty> : <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3"><Stat label="Collected" value={money(col.data.total, cur)} tone="good" /><Stat label="Payments" value={col.data.count} /><Stat label="Average per day" value={money(col.data.total / Math.max(1, col.data.byDay.length), cur)} hint="on days with payments" /></div>
          <div className="card p-4">
            <h3 className="mb-2 text-sm font-semibold">By day</h3>
            <div className="flex h-32 items-end gap-0.5" role="img" aria-label="Fees collected each day">
              {col.data.byDay.map(d => <div key={d.label} className="flex-1 rounded-t bg-brand-500" style={{ height: `${Math.max(2, (d.amount / maxDay) * 100)}%` }} title={`${fmtDate(d.label)}: ${money(d.amount, cur)} (${d.count})`} />)}
            </div>
            <div className="mt-1 flex justify-between text-xs text-slate-500"><span>{fmtDate(col.data.byDay[0]?.label)}</span><span>{fmtDate(col.data.byDay[col.data.byDay.length - 1]?.label)}</span></div>
          </div>
          <div className="grid gap-4 lg:grid-cols-2"><Groups title="By method" rows={col.data.byMethod} total={col.data.total} cur={cur} /><Groups title="By class" rows={col.data.byClass} total={col.data.total} cur={cur} /></div>
        </>)}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <h2 className="mr-auto font-semibold">Revenue by class</h2>
          <Field label="Invoices for"><select className="input" value={term} onChange={e => setTerm(e.target.value)}>
            <option value="">Current term</option>{terms.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}<option value="range">Raised between the dates above</option></select></Field>
          <a className="btn btn-outline" href={`/api/accounts?view=revenue&${revQ}&format=csv`}>CSV</a>
        </div>
        {rev.error && <Alert>{rev.error}</Alert>}
        {rev.data && (!rev.data.byClass.length ? <Empty>No invoices for this term.</Empty> : <>
          <div className="grid grid-cols-3 gap-3"><Stat label="Billed" value={money(rev.data.totals.billed, cur)} /><Stat label="Paid" value={money(rev.data.totals.paid, cur)} tone="good" /><Stat label="Outstanding" value={money(rev.data.totals.outstanding, cur)} tone={rev.data.totals.outstanding > 0 ? "warn" : "good"} /></div>
          <div className="card overflow-x-auto"><table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-[13px] text-slate-500"><tr><th className="p-2">Class</th><th className="p-2 text-right">Invoices</th><th className="p-2 text-right">Billed</th><th className="p-2 text-right">Paid</th><th className="p-2 text-right">Outstanding</th><th className="p-2 w-36">Collected</th></tr></thead>
            <tbody>{rev.data.byClass.map(r => <tr key={r.label} className="border-t border-slate-100"><td className="p-2">{r.label}</td><td className="p-2 text-right tabular-nums">{r.invoices}</td><td className="p-2 text-right tabular-nums">{money(r.billed, cur)}</td>
              <td className="p-2 text-right tabular-nums">{money(r.paid, cur)}</td><td className="p-2 text-right tabular-nums">{money(r.outstanding, cur)}</td>
              <td className="p-2">{r.rate !== null && <div className="flex items-center gap-2"><div className="h-1.5 flex-1 rounded bg-slate-100"><div className="h-1.5 rounded bg-emerald-500" style={{ width: `${Math.min(100, r.rate)}%` }} /></div><span className="w-12 text-right text-xs tabular-nums">{r.rate}%</span></div>}</td></tr>)}</tbody></table></div>
          <Groups title="Billed by fee item (net of discounts)" rows={rev.data.byItem} total={rev.data.totals.billed} cur={cur} />
          <p className="text-xs text-slate-500">Debts by age and the debtors list are under Fees → Debtors.</p>
        </>)}
      </section>
    </div>
  );
}

function Groups({ title, rows, total, cur }: { title: string; rows: G[]; total: number; cur: string }) {
  return (
    <div className="card p-4">
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      <ul className="space-y-1.5 text-sm">{rows.map(r => (
        <li key={r.label}>
          <div className="flex justify-between gap-2"><span className="capitalize">{r.label} <span className="text-xs text-slate-400">({r.count})</span></span><span className="tabular-nums">{money(r.amount, cur)}</span></div>
          {total > 0 && r.amount > 0 && <div className="h-1 rounded bg-slate-100"><div className="h-1 rounded bg-brand-400" style={{ width: `${Math.min(100, (r.amount / total) * 100)}%` }} /></div>}
        </li>))}</ul>
    </div>
  );
}
