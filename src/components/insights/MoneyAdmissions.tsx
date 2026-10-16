"use client";
import { useApi, Alert, Loading, money } from "@/components/ui";
import { MonthBars } from "./Charts";

type Point = { month: string; value: number };
type Finance = { term: string | null; collected: Point[]; billed: Point[]; methods: { method: string; amount: number }[]; by_class: { class_name: string; billed: number; paid: number; outstanding: number; rate: number | null }[] };
type Admissions = { by_month: Point[]; enrolled_by_month: Point[]; by_source: { source: string; applications: number; enrolled: number; lost: number; open: number; conversion: number | null }[]; funnel: { status: string; count: number }[]; by_level: { level: string; count: number }[] };

/** Fees billed and collected over the year, and collection by class this term. */
export function FinanceDashboard() {
  const { data, error } = useApi<Finance>("/api/insights?view=finance");
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  const billed = data.billed.reduce((a, p) => a + p.value, 0), got = data.collected.reduce((a, p) => a + p.value, 0);
  return (
    <div className="space-y-4">
      <section className="card p-4">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2"><h3 className="font-semibold">Billed and collected, last 12 months</h3><span className="text-sm text-slate-500">{money(got)} collected of {money(billed)} billed</span></div>
        <MonthBars format={v => money(v)} series={[{ label: "Billed", color: "#cbd5e1", points: data.billed }, { label: "Collected", color: "#1d5ddb", points: data.collected }]} />
      </section>
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="card overflow-x-auto lg:col-span-2">
          <h3 className="p-3 font-semibold">Collection by class{data.term ? `: ${data.term}` : ""}</h3>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="p-2 text-left">Class</th><th className="p-2 text-right">Billed</th><th className="p-2 text-right">Paid</th><th className="p-2 text-right">Outstanding</th><th className="p-2">Collected</th></tr></thead>
            <tbody>{data.by_class.map(c => (
              <tr key={c.class_name} className="border-t border-slate-100"><td className="p-2">{c.class_name}</td><td className="p-2 text-right tabular-nums">{money(c.billed)}</td><td className="p-2 text-right tabular-nums">{money(c.paid)}</td><td className="p-2 text-right tabular-nums">{money(c.outstanding)}</td>
                <td className={`p-2 text-center font-semibold ${(c.rate ?? 0) >= 90 ? "text-emerald-700" : (c.rate ?? 0) >= 70 ? "text-amber-700" : "text-rose-700"}`}>{c.rate === null ? "—" : `${c.rate}%`}</td></tr>))}
              {!data.by_class.length && <tr><td colSpan={5} className="p-4 text-center text-slate-500">No invoices this term yet.</td></tr>}
            </tbody>
          </table>
        </section>
        <section className="card p-3">
          <h3 className="mb-2 font-semibold">How families paid</h3>
          <ul className="space-y-1 text-sm">{data.methods.map(m => <li key={m.method} className="flex justify-between"><span className="capitalize">{m.method}</span><span className="tabular-nums">{money(m.amount)}</span></li>)}</ul>
        </section>
      </div>
    </div>
  );
}

/** Applications over the year, where they come from and how many enrol. */
export function AdmissionsDashboard() {
  const { data, error } = useApi<Admissions>("/api/insights?view=admissions");
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  const maxF = Math.max(1, ...data.funnel.map(f => f.count));
  return (
    <div className="space-y-4">
      <section className="card p-4">
        <h3 className="mb-2 font-semibold">Applications, last 12 months</h3>
        <MonthBars series={[{ label: "Applications", color: "#93c5fd", points: data.by_month }, { label: "Enrolled", color: "#059669", points: data.enrolled_by_month }]} />
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card overflow-x-auto">
          <h3 className="p-3 font-semibold">By source</h3>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="p-2 text-left">Source</th><th className="p-2">Applications</th><th className="p-2">Enrolled</th><th className="p-2">Still open</th><th className="p-2">Conversion</th></tr></thead>
            <tbody>{data.by_source.map(s => <tr key={s.source} className="border-t border-slate-100"><td className="p-2 capitalize">{s.source.replace(/_/g, " ")}</td><td className="p-2 text-center">{s.applications}</td><td className="p-2 text-center">{s.enrolled}</td><td className="p-2 text-center">{s.open}</td><td className="p-2 text-center font-semibold">{s.conversion === null ? "—" : `${s.conversion}%`}</td></tr>)}</tbody>
          </table>
        </section>
        <section className="card p-3">
          <h3 className="mb-2 font-semibold">Where applications stand</h3>
          <ul className="space-y-1 text-sm">{data.funnel.map(f => (
            <li key={f.status} className="flex items-center gap-2"><span className="w-24 capitalize">{f.status}</span><span className="h-3 rounded bg-brand-500" style={{ width: `${(f.count / maxF) * 70}%` }} /><span className="tabular-nums">{f.count}</span></li>))}</ul>
          {data.by_level.length > 0 && <p className="mt-3 text-xs text-slate-500">Most asked-for: {data.by_level.slice(0, 5).map(l => `${l.level} (${l.count})`).join(", ")}</p>}
        </section>
      </div>
    </div>
  );
}
