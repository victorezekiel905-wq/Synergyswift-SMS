"use client";
import { Field } from "@/components/ui";
import { BANDS, MODULE_GROUPS, bandLabel, quote, naira, type ModuleGroup, type Cycle } from "@/lib/saas";

export type PlanOption = { code: string; name: string; groups: string[]; prices: number[] | null; blurb: string | null; active: boolean };
export type PlanChoice = {
  plan_code: string; band: number | null; cycle: Cycle; add_on_groups: ModuleGroup[]; custom_annual: number | null;
  discount_pct: number; grace_days: number; status: "trial" | "active"; issue_invoice: boolean; notes: string;
};

export const emptyChoice = (band: number | null = 0): PlanChoice => ({
  plan_code: "growth", band, cycle: "annual", add_on_groups: [], custom_annual: null, discount_pct: 0, grace_days: 14, status: "active", issue_invoice: true, notes: ""
});

/** Plan, school size, add-ons and price for a school, with the bill worked out as you choose. */
export default function PlanPicker({ plans, groupPrices, value, onChange, students }: {
  plans: PlanOption[]; groupPrices: Record<string, number[]>; value: PlanChoice; onChange: (v: PlanChoice) => void; students?: number;
}) {
  const plan = plans.find(p => p.code === value.plan_code) ?? plans[0];
  const set = (p: Partial<PlanChoice>) => onChange({ ...value, ...p });
  const needsCustom = !plan?.prices || value.band === null;
  const q = plan ? quote({ plan: { name: plan.name, groups: plan.groups as ModuleGroup[], prices: plan.prices }, band: value.band, addOns: value.add_on_groups, cycle: value.cycle, groupPrices, customAnnual: needsCustom ? value.custom_annual : null, discountPct: value.discount_pct }) : null;
  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {plans.filter(p => p.active).map(p => (
          <button key={p.code} type="button" onClick={() => set({ plan_code: p.code, add_on_groups: value.add_on_groups.filter(g => !p.groups.includes(g)) })}
            className={"rounded-lg border p-3 text-left " + (p.code === value.plan_code ? "border-brand-600 ring-1 ring-brand-600" : "border-slate-200 hover:border-slate-300")}>
            <p className="font-semibold">{p.name}</p>
            <p className="mt-1 text-xs text-slate-600">{p.blurb}</p>
            <p className="mt-2 text-sm tabular-nums">{p.prices && value.band !== null ? `${naira(p.prices[value.band])} a year` : "Agreed price"}</p>
          </button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="School size" hint={students !== undefined ? `${students} active students now` : undefined}>
          <select className="input" value={value.band ?? "custom"} onChange={e => set({ band: e.target.value === "custom" ? null : Number(e.target.value) })}>
            {BANDS.map((_, i) => <option key={i} value={i}>{bandLabel(i)}</option>)}
            <option value="custom">{bandLabel(null)}</option>
          </select>
        </Field>
        <Field label="Billing"><select className="input" value={value.cycle} onChange={e => set({ cycle: e.target.value as Cycle })}><option value="annual">Yearly</option><option value="termly">Each term (+10%)</option></select></Field>
        <Field label="Start as"><select className="input" value={value.status} onChange={e => set({ status: e.target.value as "trial" | "active" })}><option value="active">Paid subscription</option><option value="trial">30-day free trial</option></select></Field>
      </div>
      <div>
        <p className="label">Add-on groups (beyond the plan)</p>
        <div className="grid gap-2 sm:grid-cols-3">
          {MODULE_GROUPS.filter(g => !plan?.groups.includes(g.key)).map(g => (
            <label key={g.key} className="flex items-start gap-2 rounded-lg border border-slate-200 p-2 text-sm">
              <input type="checkbox" className="mt-0.5" checked={value.add_on_groups.includes(g.key)} onChange={e => set({ add_on_groups: e.target.checked ? [...value.add_on_groups, g.key] : value.add_on_groups.filter(x => x !== g.key) })} />
              <span><span className="font-medium">{g.label}</span>{value.band !== null && groupPrices[g.key] && <span className="ml-1 tabular-nums text-slate-500">{naira(groupPrices[g.key][value.band])}</span>}<span className="block text-xs text-slate-500">{g.hint}</span></span>
            </label>
          ))}
          {plan && MODULE_GROUPS.every(g => plan.groups.includes(g.key)) && <p className="text-sm text-slate-500">This plan already includes every group.</p>}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {needsCustom && <Field label="Agreed price a year (₦)"><input className="input" type="number" min={0} value={value.custom_annual ?? ""} onChange={e => set({ custom_annual: e.target.value === "" ? null : Number(e.target.value) })} /></Field>}
        <Field label="Discount (%)" hint="Pilot schools, multi-year deals."><input className="input" type="number" min={0} max={100} value={value.discount_pct} onChange={e => set({ discount_pct: Number(e.target.value) })} /></Field>
        <Field label="Days to pay after the period ends"><input className="input" type="number" min={0} max={90} value={value.grace_days} onChange={e => set({ grace_days: Number(e.target.value) })} /></Field>
      </div>
      {q && q.annual !== null ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
          {q.lines.map((l, i) => <div key={i} className="flex justify-between"><span>{l.label}</span><span className="tabular-nums">{naira(l.amount)}</span></div>)}
          <div className="mt-1 flex justify-between border-t border-slate-200 pt-1 font-semibold"><span>Total a year</span><span className="tabular-nums">{naira(q.annual)}</span></div>
          {value.cycle === "termly" && <div className="flex justify-between text-slate-600"><span>Each term</span><span className="tabular-nums">{naira(q.perInvoice ?? 0)}</span></div>}
        </div>
      ) : <p className="text-sm text-amber-700">Enter the agreed yearly price for this school.</p>}
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={value.issue_invoice} disabled={value.status === "trial"} onChange={e => set({ issue_invoice: e.target.checked })} /> Send the first invoice now</label>
      </div>
      <Field label="Notes (platform only)"><input className="input" value={value.notes} onChange={e => set({ notes: e.target.value })} placeholder="e.g. pilot school, 50% for the first year" /></Field>
    </div>
  );
}
