"use client";
import { useEffect, useState } from "react";
import { useApi, send, Page, PageHeader, Alert, Field, Loading } from "@/components/ui";
import PlatformNav from "@/components/platform/PlatformNav";
import { BANDS, MODULE_GROUPS, bandLabel, modulesInGroups, moduleLabel } from "@/lib/saas";

type Plan = { code: string; name: string; groups: string[]; prices: number[] | null; blurb: string | null; active: boolean };
type Data = { plans: Plan[]; group_prices: Record<string, number[]>; billing: { company: string; bank_details: string; grace_days: number }; role: string };

/** Prices for each plan and add-on group by school size, and the details printed on invoices. */
export default function PlansPage() {
  const { data, reload } = useApi<Data>("/api/platform/plans");
  const [d, setD] = useState<Data | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { if (data) setD(JSON.parse(JSON.stringify(data))); }, [data]);
  if (!d) return <Page wide><PlatformNav /><Loading /></Page>;
  const readOnly = d.role === "support";
  const setPlan = (code: string, p: Partial<Plan>) => setD({ ...d, plans: d.plans.map(x => (x.code === code ? { ...x, ...p } : x)) });
  async function save() {
    const r = await send("/api/platform/plans", { plans: d!.plans.map(p => ({ ...p, blurb: p.blurb || null })), group_prices: d!.group_prices, billing: d!.billing }, "PATCH");
    setMsg({ ok: r.ok, text: r.ok ? "Saved. New prices apply to each school's next invoice." : r.error ?? "failed" });
    if (r.ok) reload();
  }
  const priceRow = (vals: number[], onChange: (v: number[]) => void) => BANDS.map((_, i) => (
    <td key={i} className="p-1"><input className="input w-28 py-1 text-right tabular-nums" type="number" min={0} disabled={readOnly} value={vals[i] ?? 0} onChange={e => onChange(vals.map((v, j) => (j === i ? Number(e.target.value) : v)))} aria-label={bandLabel(i)} /></td>
  ));
  return (
    <Page wide>
      <PlatformNav />
      <PageHeader eyebrow="Synergy Swift platform" title="Plans and prices" subtitle="Yearly prices in naira by school size. Termly billing is a third of the year plus 10%. Above 2,000 students, prices are agreed per school."
        actions={!readOnly && <button className="btn btn-primary" onClick={save}>Save</button>} />
      {msg && <div className="mb-4"><Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert></div>}
      <section className="card mb-5 overflow-x-auto p-5">
        <h2 className="mb-3 font-semibold">Plans</h2>
        <table className="text-sm">
          <thead className="text-left text-xs text-slate-500"><tr><th className="p-1">Plan</th>{BANDS.map((_, i) => <th key={i} className="p-1 text-right">{bandLabel(i).replace("Up to ", "≤ ")}</th>)}<th className="p-1">On sale</th></tr></thead>
          <tbody>
            {d.plans.map(p => (
              <tr key={p.code} className="border-t border-slate-100 align-top">
                <td className="p-1"><input className="input w-36 py-1 font-semibold" value={p.name} disabled={readOnly} onChange={e => setPlan(p.code, { name: e.target.value })} aria-label="Plan name" /></td>
                {p.prices ? priceRow(p.prices, v => setPlan(p.code, { prices: v })) : <td colSpan={BANDS.length} className="p-2 text-slate-500">Agreed per school</td>}
                <td className="p-2"><input type="checkbox" checked={p.active} disabled={readOnly} onChange={e => setPlan(p.code, { active: e.target.checked })} aria-label={`${p.name} on sale`} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {d.plans.map(p => (
            <div key={p.code} className="rounded-lg border border-slate-200 p-3">
              <p className="mb-1 font-semibold">{p.name}: what it includes</p>
              <div className="mb-2 flex flex-wrap gap-3 text-sm">
                {MODULE_GROUPS.map(g => <label key={g.key} className="flex items-center gap-1"><input type="checkbox" disabled={readOnly || g.key === "core"} checked={p.groups.includes(g.key)} onChange={e => setPlan(p.code, { groups: e.target.checked ? [...p.groups, g.key] : p.groups.filter(x => x !== g.key) })} /> {g.label}</label>)}
              </div>
              <Field label="Description"><input className="input" value={p.blurb ?? ""} disabled={readOnly} onChange={e => setPlan(p.code, { blurb: e.target.value })} /></Field>
              <p className="mt-2 text-xs text-slate-500">{modulesInGroups(p.groups).map(moduleLabel).join(" · ")}</p>
            </div>
          ))}
        </div>
      </section>
      <section className="card mb-5 overflow-x-auto p-5">
        <h2 className="mb-1 font-semibold">Add-on groups</h2>
        <p className="mb-3 text-sm text-slate-600">What a school pays a year to add a group its plan does not include.</p>
        <table className="text-sm">
          <thead className="text-left text-xs text-slate-500"><tr><th className="p-1">Group</th>{BANDS.map((_, i) => <th key={i} className="p-1 text-right">{bandLabel(i).replace("Up to ", "≤ ")}</th>)}</tr></thead>
          <tbody>
            {MODULE_GROUPS.map(g => (
              <tr key={g.key} className="border-t border-slate-100"><td className="p-1 font-medium">{g.label}</td>{priceRow(d.group_prices[g.key] ?? [0, 0, 0, 0, 0], v => setD({ ...d, group_prices: { ...d.group_prices, [g.key]: v } }))}</tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="card grid gap-3 p-5 md:grid-cols-2">
        <h2 className="font-semibold md:col-span-2">On every invoice</h2>
        <Field label="Company name"><input className="input" value={d.billing.company} disabled={readOnly} onChange={e => setD({ ...d, billing: { ...d.billing, company: e.target.value } })} /></Field>
        <Field label="Days to pay after a period ends (default)"><input className="input" type="number" min={0} max={90} value={d.billing.grace_days} disabled={readOnly} onChange={e => setD({ ...d, billing: { ...d.billing, grace_days: Number(e.target.value) } })} /></Field>
        <div className="md:col-span-2"><Field label="Bank details for transfers" hint="Bank, account name and number. Shown on invoices and renewal emails."><textarea className="input h-24" value={d.billing.bank_details} disabled={readOnly} onChange={e => setD({ ...d, billing: { ...d.billing, bank_details: e.target.value } })} /></Field></div>
      </section>
    </Page>
  );
}
