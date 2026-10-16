"use client";
import { useState } from "react";
import { useApi, send, money, Alert } from "@/components/ui";
import { sparkline, trend, targetTone, KPI_TARGETS, type Kpis } from "@/lib/portal";

type Data = {
  today: Kpis; series: { day: string; metrics: Partial<Kpis> }[];
  targets: Partial<Record<keyof Kpis, number>>; student_sees_fees: boolean; can_edit: boolean;
};

type Tile = { key: keyof Kpis; label: string; fmt: (v: number | null) => string; higherIsBetter?: boolean; hint?: (k: Kpis) => string };
const pct = (v: number | null) => (v === null ? "—" : `${v}%`);
const num = (v: number | null) => (v === null ? "—" : String(v));
const TILES: Tile[] = [
  { key: "attendance_rate", label: "Attendance today", fmt: pct, hint: k => `${k.absent_today} absent` },
  { key: "registers_taken", label: "Registers taken", fmt: pct },
  { key: "collection_rate", label: "Fees collected this term", fmt: pct, hint: k => `${money(k.paid)} of ${money(k.billed)}` },
  { key: "overdue_amount", label: "Past-due fees", fmt: v => (v === null ? "—" : money(v)), higherIsBetter: false, hint: k => `${k.overdue_invoices} invoice${k.overdue_invoices === 1 ? "" : "s"}` },
  { key: "students", label: "Students", fmt: num, hint: k => `${k.admitted_this_term} joined this term` },
  { key: "staff_on_leave", label: "Staff on leave today", fmt: num, higherIsBetter: false, hint: k => `of ${k.staff} staff` },
  { key: "incidents_week", label: "Behaviour incidents (7 days)", fmt: num, higherIsBetter: false },
  { key: "applications_open", label: "Applications in progress", fmt: num },
  { key: "library_overdue", label: "Overdue library books", fmt: num, higherIsBetter: false },
  { key: "low_stock", label: "Stock to reorder", fmt: num, higherIsBetter: false }
];

/** The head's dashboard: today's key numbers, 60-day trend lines, and the school's targets. */
export default function KpiBoard() {
  const { data, reload } = useApi<Data>("/api/school/kpis");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  if (!data) return null; // not a school leader, or still loading
  const k = data.today;

  async function saveTargets() {
    const r = await send("/api/school/kpis", { action: "set_targets", targets: draft });
    setMsg(r.ok ? null : r.error); if (r.ok) { setEditing(false); reload(); }
  }
  async function toggleFees(on: boolean) {
    const r = await send("/api/school/kpis", { action: "set_student_fees", on });
    setMsg(r.ok ? null : r.error); reload();
  }

  return (
    <section className="mb-8">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Key numbers</h2>
        {data.can_edit && <button className="btn btn-outline px-3 py-1 text-xs" onClick={() => { setDraft(Object.fromEntries(KPI_TARGETS.map(t => [t.key, data.targets[t.key]?.toString() ?? ""]))); setEditing(!editing); }}>{editing ? "Close" : "Targets & settings"}</button>}
      </div>
      {msg && <div className="mb-3"><Alert>{msg}</Alert></div>}
      {editing && (
        <div className="card mb-4 space-y-3 p-4 text-sm">
          <p className="text-slate-600">Figures turn green when they meet the target, amber when close, red when well short.</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {KPI_TARGETS.map(t => (
              <label key={t.key} className="flex items-center justify-between gap-2">
                <span>{t.label}{t.higherIsBetter ? " (at least)" : " (at most)"}</span>
                <input className="input w-24" inputMode="decimal" value={draft[t.key] ?? ""} onChange={e => setDraft({ ...draft, [t.key]: e.target.value })} />
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
            <label className="flex items-center gap-2"><input type="checkbox" checked={data.student_sees_fees} onChange={e => toggleFees(e.target.checked)} /> Students can see their own fees in the student portal</label>
            <button className="btn btn-primary" onClick={saveTargets}>Save targets</button>
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {TILES.map(t => {
          const value = k[t.key] as number | null;
          const series = data.series.map(s => ({ day: s.day, value: (s.metrics[t.key] as number | null | undefined) ?? null }));
          const tr = trend(series);
          const target = data.targets[t.key];
          const tone = targetTone(value, target, t.higherIsBetter !== false);
          const path = sparkline(series.map(s => s.value), 100, 24);
          const good = tr.direction === "flat" || tr.direction === null ? null : (tr.direction === "up") === (t.higherIsBetter !== false);
          return (
            <div key={t.key} className="card p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{t.label}</p>
              <p className={`mt-1 text-xl font-bold tabular-nums ${tone === "good" ? "text-emerald-600" : tone === "warn" ? "text-amber-600" : tone === "bad" ? "text-rose-600" : "text-slate-900"}`}>{t.fmt(value)}</p>
              <p className="text-xs text-slate-500">
                {t.hint ? t.hint(k) : ""}{target !== undefined ? `${t.hint ? " · " : ""}target ${t.fmt(target)}` : ""}
              </p>
              {path && (
                <div className="mt-1 flex items-center gap-2">
                  <svg viewBox="0 0 100 24" className="h-6 w-24" aria-hidden><path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" className="text-brand-500" /></svg>
                  {tr.change !== null && <span className={`text-xs ${good === null ? "text-slate-500" : good ? "text-emerald-600" : "text-rose-600"}`}>{tr.direction === "up" ? "▲" : tr.direction === "down" ? "▼" : "▶"} {Math.abs(tr.change)}</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {!data.series.length && <p className="mt-2 text-xs text-slate-500">Trend lines appear after the first few school days (figures are kept each afternoon).</p>}
    </section>
  );
}
