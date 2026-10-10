"use client";
import { useState } from "react";
import { useApi, Alert, Loading, Stat, money } from "@/components/ui";
import { STAGE_LABEL, SOURCE_LABEL, type Stage, type Source } from "@/lib/crm";

type Data = {
  range: { from: string; to: string };
  totals: { leads: number; enrolled: number; conversion: number | null; spend: number; cost_per_enrolment: number | null };
  funnel: { stage: Stage; count: number; from_previous: number | null }[];
  sources: { source: Source; leads: number; applied: number; enrolled: number; conversion: number | null; spend: number; cost_per_lead: number | null; cost_per_enrolment: number | null }[];
  staff: { owner_id: string; name: string; leads: number; enrolled: number; conversion: number | null; median_first_response_hours: number | null; not_contacted: number }[];
  monthly: { month: string; leads: number; enrolled: number }[];
  lost: { reason: string; count: number }[];
  campaigns: { campaign: string; leads: number; enrolled: number; spend: number; cost_per_enrolment: number | null }[];
};

/**
 * Admissions analytics. Each chart is one measure in one hue (the brand
 * colour), values printed beside the bars, a tooltip on hover, and the same
 * numbers in the tables below.
 */
export default function Analytics({ currency }: { currency: string }) {
  const [from, setFrom] = useState(new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const { data, error } = useApi<Data>(`/api/crm/analytics?from=${from}&to=${to}`, [from, to]);
  if (error) return <Alert>{error}</Alert>;
  const m = (v: number | null) => (v === null ? "—" : money(v, currency));
  const pct = (v: number | null) => (v === null ? "—" : `${v}%`);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm">From <input className="input w-auto" type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
        <label className="text-sm">to <input className="input w-auto" type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
        {[90, 180, 365].map(d => <button key={d} className="btn btn-ghost px-2 py-1 text-xs" onClick={() => { setFrom(new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10)); setTo(new Date().toISOString().slice(0, 10)); }}>Last {d} days</button>)}
      </div>
      {!data ? <Loading /> : <>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Stat label="Enquiries" value={data.totals.leads} /><Stat label="Enrolled" value={data.totals.enrolled} tone="good" />
          <Stat label="Enquiry → enrolled" value={pct(data.totals.conversion)} /><Stat label="Marketing spend" value={m(data.totals.spend)} />
          <Stat label="Cost per enrolment" value={m(data.totals.cost_per_enrolment)} />
        </div>

        <section className="card p-4">
          <h3 className="mb-3 font-semibold">Funnel</h3>
          <Bars rows={data.funnel.map(f => ({ label: STAGE_LABEL[f.stage], value: f.count, note: f.from_previous === null ? "" : `${f.from_previous}% of ${f.stage === "applied" ? "enquiries" : "previous step"}` }))} />
          <p className="mt-2 text-xs text-slate-500">Each step counts families who got at least that far. Tours are optional, so &quot;Applied&quot; is measured against all enquiries.</p>
        </section>

        <section className="card overflow-x-auto p-4">
          <h3 className="mb-2 font-semibold">Where families come from</h3>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-slate-500"><tr><th className="p-1">Source</th><th className="p-1 text-right">Enquiries</th><th className="p-1 text-right">Applied</th><th className="p-1 text-right">Enrolled</th><th className="p-1 text-right">Conversion</th><th className="p-1 text-right">Spend</th><th className="p-1 text-right">Per enquiry</th><th className="p-1 text-right">Per enrolment</th></tr></thead>
            <tbody>{data.sources.map(s => (
              <tr key={s.source} className="border-t border-slate-100"><td className="p-1">{SOURCE_LABEL[s.source]}</td><td className="p-1 text-right tabular-nums">{s.leads}</td><td className="p-1 text-right tabular-nums">{s.applied}</td>
                <td className="p-1 text-right tabular-nums">{s.enrolled}</td><td className="p-1 text-right tabular-nums">{pct(s.conversion)}</td><td className="p-1 text-right tabular-nums">{s.spend ? m(s.spend) : "—"}</td>
                <td className="p-1 text-right tabular-nums">{m(s.cost_per_lead)}</td><td className="p-1 text-right font-semibold tabular-nums">{m(s.cost_per_enrolment)}</td></tr>
            ))}</tbody>
          </table>
          {data.campaigns.length > 0 && (<>
            <h4 className="mb-1 mt-4 text-sm font-semibold">Campaigns (from utm_campaign links)</h4>
            <table className="w-full text-sm"><tbody>{data.campaigns.map(c => <tr key={c.campaign} className="border-t border-slate-100"><td className="p-1">{c.campaign}</td><td className="p-1 text-right tabular-nums">{c.leads} enquiries</td><td className="p-1 text-right tabular-nums">{c.enrolled} enrolled</td><td className="p-1 text-right tabular-nums">{c.spend ? m(c.spend) : "—"}</td><td className="p-1 text-right tabular-nums">{m(c.cost_per_enrolment)} per enrolment</td></tr>)}</tbody></table>
          </>)}
          <p className="mt-2 text-xs text-slate-500">Add marketing spend under Setup to see cost per enquiry and per enrolment.</p>
        </section>

        <div className="grid gap-5 lg:grid-cols-2">
          <section className="card p-4">
            <h3 className="mb-3 font-semibold">Enquiries per month</h3>
            {!data.monthly.length ? <p className="text-sm text-slate-500">No enquiries in this period.</p> : <Bars rows={data.monthly.map(x => ({ label: new Date(`${x.month}-01T12:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "2-digit" }), value: x.leads, note: `${x.enrolled} enrolled` }))} />}
          </section>
          <section className="card p-4">
            <h3 className="mb-2 font-semibold">Why families did not go ahead</h3>
            {!data.lost.length ? <p className="text-sm text-slate-500">No lost enquiries in this period.</p> : <Bars rows={data.lost.map(l => ({ label: l.reason, value: l.count, note: "" }))} />}
          </section>
        </div>

        <section className="card overflow-x-auto p-4">
          <h3 className="mb-2 font-semibold">Team</h3>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-slate-500"><tr><th className="p-1">Staff</th><th className="p-1 text-right">Families</th><th className="p-1 text-right">Enrolled</th><th className="p-1 text-right">Conversion</th><th className="p-1 text-right">Median first reply</th><th className="p-1 text-right">Not contacted</th></tr></thead>
            <tbody>{data.staff.map(s => (
              <tr key={s.owner_id} className="border-t border-slate-100"><td className="p-1">{s.name}</td><td className="p-1 text-right tabular-nums">{s.leads}</td><td className="p-1 text-right tabular-nums">{s.enrolled}</td><td className="p-1 text-right tabular-nums">{pct(s.conversion)}</td>
                <td className="p-1 text-right tabular-nums">{s.median_first_response_hours === null ? "—" : s.median_first_response_hours < 1 ? `${Math.round(s.median_first_response_hours * 60)} min` : `${s.median_first_response_hours} h`}</td>
                <td className={"p-1 text-right tabular-nums " + (s.not_contacted ? "font-semibold text-rose-700" : "")}>{s.not_contacted}</td></tr>
            ))}</tbody>
          </table>
        </section>
      </>}
    </div>
  );
}

/** Horizontal bars, one hue, value and note in text colour beside each bar, hover tooltip. */
function Bars({ rows }: { rows: { label: string; value: number; note: string }[] }) {
  const max = Math.max(1, ...rows.map(r => r.value));
  return (
    <ul className="space-y-1.5" role="list">
      {rows.map(r => (
        <li key={r.label} className="group grid grid-cols-[120px_1fr] items-center gap-2 text-sm" title={`${r.label}: ${r.value}${r.note ? ` (${r.note})` : ""}`}>
          <span className="truncate text-slate-600">{r.label}</span>
          <span className="flex items-center gap-2">
            <span className="h-3 rounded-r bg-brand-500 transition-opacity group-hover:opacity-80" style={{ width: `${(r.value / max) * 100}%`, minWidth: r.value ? 4 : 0 }} />
            <span className="whitespace-nowrap tabular-nums text-slate-900">{r.value}</span>
            {r.note && <span className="whitespace-nowrap text-xs text-slate-500">{r.note}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
