"use client";
import { useEffect, useMemo, useState } from "react";
import { useApi, send, Page, PageHeader, Alert, Badge, Empty, Field, Loading, fmtDate, money } from "@/components/ui";
import { OPS, aggKey, type Dataset, type Spec, type Output, type Agg, type Op } from "@/lib/report-builder";

type Saved = {
  id: string; owner_id: string; owner: string | null; name: string; description: string | null; dataset: string; spec: Spec; shared: boolean;
  schedule: "none" | "daily" | "weekly" | "monthly"; schedule_day: number | null; schedule_hour: number; recipient_ids: string[];
  next_run_at: string | null; last_sent_at: string | null; last_error: string | null; usable: boolean;
};
type Meta = { me: string; datasets: Dataset[]; saved: Saved[]; staff: { id: string; full_name: string; role: string }[]; terms: { id: string; label: string; is_current: boolean }[]; classes: { id: string; name: string }[] };

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const AGGS: { id: Agg; label: string }[] = [{ id: "count", label: "Number of rows" }, { id: "sum", label: "Total of" }, { id: "avg", label: "Average of" }, { id: "min", label: "Lowest" }, { id: "max", label: "Highest" }];

function fmt(v: unknown, type: string) {
  if (v === null || v === undefined || v === "") return "";
  if (type === "money" && typeof v === "number") return money(v);
  if (type === "bool") return v ? "yes" : "no";
  if (type === "date" && typeof v === "string") return fmtDate(v);
  return String(v);
}
function csv(o: Output) {
  const cell = (v: unknown) => { const s = v === null || v === undefined ? "" : v === true ? "yes" : v === false ? "no" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [o.columns.map(c => cell(c.label)).join(","), ...o.rows.map(r => r.map(cell).join(","))].join("\n");
}

/** Build a report from any dataset your role allows, save it, share it, and have it emailed on a schedule. */
export default function ReportBuilder() {
  const { data: meta, error, reload } = useApi<Meta>("/api/report-builder");
  const [editing, setEditing] = useState<Saved | null>(null);
  const [dataset, setDataset] = useState("");
  const [spec, setSpec] = useState<Spec>({ columns: [] });
  const [out, setOut] = useState<Output | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [save, setSave] = useState({ name: "", description: "", shared: false, schedule: "none" as Saved["schedule"], schedule_day: 1, schedule_hour: 7, recipient_ids: [] as string[] });
  const d = useMemo(() => meta?.datasets.find(x => x.id === dataset) ?? null, [meta, dataset]);

  // Open a saved report from a link (?id=) — used by scheduled emails.
  useEffect(() => {
    if (!meta) return;
    const id = new URLSearchParams(window.location.search).get("id");
    const r = id ? meta.saved.find(s => s.id === id) : null;
    if (r && !editing) open(r, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta]);

  if (error) return <Page><Alert>{error}</Alert></Page>;
  if (!meta) return <Page><Loading /></Page>;

  function pick(id: string) {
    const ds = meta!.datasets.find(x => x.id === id);
    setDataset(id); setOut(null); setEditing(null);
    setSpec({ columns: ds?.defaults ?? [], params: { term_id: meta!.terms.find(t => t.is_current)?.id ?? null } });
    setSave(s => ({ ...s, name: ds ? ds.label : "" }));
  }
  function open(r: Saved, runIt = false) {
    setEditing(r); setDataset(r.dataset); setSpec(r.spec); setOut(null);
    setSave({ name: r.name, description: r.description ?? "", shared: r.shared, schedule: r.schedule, schedule_day: r.schedule_day ?? 1, schedule_hour: r.schedule_hour, recipient_ids: r.recipient_ids });
    if (runIt) run(r.dataset, r.spec);
  }
  async function run(ds = dataset, s = spec) {
    setBusy(true); setMsg(null);
    const r = await send<Output>("/api/report-builder", { action: "run", dataset: ds, spec: s });
    setBusy(false);
    if (!r.ok) { setMsg({ ok: false, text: r.error ?? "failed" }); setOut(null); return; }
    setOut(r.data);
  }
  async function doSave() {
    const r = await send("/api/report-builder", { action: "save", id: editing && editing.owner_id === meta!.me ? editing.id : null, dataset, spec, ...save, description: save.description || null });
    setMsg({ ok: r.ok, text: r.ok ? (save.schedule === "none" ? "Report saved." : `Report saved. Next sent ${r.data.next_run_at ? fmtDate(r.data.next_run_at, true) : "—"}.`) : r.error ?? "failed" });
    if (r.ok) reload();
  }
  async function act(body: Record<string, unknown>, ok: string) {
    const r = await send("/api/report-builder", body);
    setMsg({ ok: r.ok, text: r.ok ? ok : r.error ?? "failed" });
    if (r.ok) reload();
  }
  const set = (patch: Partial<Spec>) => { setSpec({ ...spec, ...patch }); setOut(null); };
  const setParam = (k: string, v: string) => set({ params: { ...(spec.params ?? {}), [k]: v || null } });
  const cols = d?.columns ?? [];
  const sortable = spec.group_by ? [cols.find(c => c.key === spec.group_by)!, ...(spec.aggregates?.length ? spec.aggregates : [{ column: "", fn: "count" as Agg }]).map(a => ({ key: aggKey(a), label: a.fn === "count" ? "Number" : `${a.fn} ${cols.find(c => c.key === a.column)?.label ?? ""}` }))].filter(Boolean) : cols.filter(c => spec.columns.includes(c.key));

  return (
    <Page wide>
      <PageHeader eyebrow="Reports" title="Report builder" subtitle="Choose a dataset, the columns, filters and totals; save it, share it with colleagues, or have it emailed on a schedule." />
      {msg && <div className="mb-4"><Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert></div>}
      <div className="grid gap-5 lg:grid-cols-4">
        <aside className="space-y-2 lg:col-span-1">
          <h2 className="font-semibold">Saved reports</h2>
          {!meta.saved.length && <p className="text-sm text-slate-500">None yet.</p>}
          {meta.saved.map(r => (
            <div key={r.id} className={`card p-3 text-sm ${editing?.id === r.id ? "ring-2 ring-brand-300" : ""}`}>
              <button className="text-left font-semibold hover:underline disabled:opacity-50" disabled={!r.usable} onClick={() => open(r, true)}>{r.name}</button>
              <p className="text-xs text-slate-500">{meta.datasets.find(x => x.id === r.dataset)?.label ?? r.dataset}{r.owner_id !== meta.me && r.owner ? ` · by ${r.owner}` : ""}</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {r.shared && <Badge tone="blue">shared</Badge>}
                {r.schedule !== "none" && <Badge tone="violet">{r.schedule}</Badge>}
                {r.last_error && <Badge tone="red">not sent</Badge>}
              </div>
              {r.last_error && <p className="mt-1 text-xs text-rose-600">{r.last_error}</p>}
              {r.schedule !== "none" && r.next_run_at && <p className="mt-1 text-xs text-slate-500">next {fmtDate(r.next_run_at, true)}</p>}
              {r.usable && <div className="mt-2 flex flex-wrap gap-2 text-xs">
                <a className="text-brand-700 hover:underline" href={`/api/report-builder?id=${r.id}&format=csv`}>Download</a>
                {r.schedule !== "none" && <button className="text-brand-700 hover:underline" onClick={() => act({ action: "send_now", id: r.id }, "It will go out within a minute.")}>Send now</button>}
                <button className="text-rose-600 hover:underline" onClick={() => confirm(`Delete "${r.name}"?`) && act({ action: "delete", id: r.id }, "Deleted.")}>Delete</button>
              </div>}
            </div>
          ))}
        </aside>

        <div className="space-y-4 lg:col-span-3">
          <section className="card space-y-3 p-4">
            <Field label="Dataset">
              <select className="input" value={dataset} onChange={e => pick(e.target.value)}>
                <option value="">Choose what to report on…</option>
                {meta.datasets.map(x => <option key={x.id} value={x.id}>{x.label}: {x.description}</option>)}
              </select>
            </Field>
            {d && <>
              <div className="flex flex-wrap gap-3">
                {d.params.includes("term") && <Field label="Term"><select className="input" value={spec.params?.term_id ?? ""} onChange={e => setParam("term_id", e.target.value)}><option value="">{d.id === "invoices" ? "All terms" : "Current term"}</option>{meta.terms.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}</select></Field>}
                {d.params.includes("dates") && <><Field label="From"><input type="date" className="input" value={spec.params?.from ?? ""} onChange={e => setParam("from", e.target.value)} /></Field><Field label="To"><input type="date" className="input" value={spec.params?.to ?? ""} onChange={e => setParam("to", e.target.value)} /></Field></>}
                {d.params.includes("class") && <Field label="Class"><select className="input" value={spec.params?.class_group_id ?? ""} onChange={e => setParam("class_group_id", e.target.value)}><option value="">All classes</option>{meta.classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>}
              </div>
              <fieldset>
                <legend className="mb-1 text-sm font-medium">Columns</legend>
                <div className="flex flex-wrap gap-1.5">
                  {cols.map(c => {
                    const on = spec.columns.includes(c.key);
                    return <button key={c.key} type="button" onClick={() => set({ columns: on ? spec.columns.filter(k => k !== c.key) : [...spec.columns, c.key] })}
                      className={`rounded-full border px-2.5 py-1 text-xs ${on ? "border-brand-500 bg-brand-50 text-brand-800" : "border-slate-200 text-slate-600"}`}>{on ? "✓ " : ""}{c.label}</button>;
                  })}
                </div>
              </fieldset>
              <fieldset className="space-y-1.5">
                <legend className="text-sm font-medium">Filters</legend>
                {(spec.filters ?? []).map((f, i) => {
                  const op = OPS.find(o => o.id === f.op)!;
                  const upd = (p: Partial<typeof f>) => set({ filters: spec.filters!.map((x, j) => j === i ? { ...x, ...p } : x) });
                  return (
                    <div key={i} className="flex flex-wrap items-center gap-2">
                      <select className="input w-44" value={f.column} onChange={e => upd({ column: e.target.value })}>{cols.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}</select>
                      <select className="input w-36" value={f.op} onChange={e => upd({ op: e.target.value as Op })}>{OPS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
                      {op.needsValue && <input className="input w-44" value={String(f.value ?? "")} onChange={e => upd({ value: e.target.value })} />}
                      <button className="text-xs text-rose-600" onClick={() => set({ filters: spec.filters!.filter((_, j) => j !== i) })}>Remove</button>
                    </div>
                  );
                })}
                <button className="btn btn-outline px-2 py-1 text-xs" onClick={() => set({ filters: [...(spec.filters ?? []), { column: cols[0].key, op: "eq", value: "" }] })}>+ Add a filter</button>
              </fieldset>
              <div className="flex flex-wrap items-end gap-3">
                <Field label="Group rows by"><select className="input" value={spec.group_by ?? ""} onChange={e => set({ group_by: e.target.value || null, sort: null })}><option value="">No grouping (one row each)</option>{cols.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}</select></Field>
                {spec.group_by && (
                  <div className="space-y-1">
                    <span className="text-sm font-medium">Totals</span>
                    {(spec.aggregates ?? []).map((a, i) => (
                      <div key={i} className="flex gap-2">
                        <select className="input w-40" value={a.fn} onChange={e => set({ aggregates: spec.aggregates!.map((x, j) => j === i ? { ...x, fn: e.target.value as Agg } : x) })}>{AGGS.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}</select>
                        {a.fn !== "count" && <select className="input w-40" value={a.column} onChange={e => set({ aggregates: spec.aggregates!.map((x, j) => j === i ? { ...x, column: e.target.value } : x) })}>{cols.filter(c => a.fn === "min" || a.fn === "max" || ["number", "money"].includes(c.type)).map(c => <option key={c.key} value={c.key}>{c.label}</option>)}</select>}
                        <button className="text-xs text-rose-600" onClick={() => set({ aggregates: spec.aggregates!.filter((_, j) => j !== i) })}>×</button>
                      </div>
                    ))}
                    <button className="btn btn-outline px-2 py-1 text-xs" onClick={() => set({ aggregates: [...(spec.aggregates ?? []), { column: cols.find(c => ["number", "money"].includes(c.type))?.key ?? "", fn: cols.some(c => ["number", "money"].includes(c.type)) ? "sum" : "count" }] })}>+ Add a total</button>
                  </div>
                )}
                <Field label="Sort by"><select className="input" value={spec.sort?.column ?? ""} onChange={e => set({ sort: e.target.value ? { column: e.target.value, dir: spec.sort?.dir ?? "asc" } : null })}><option value="">As loaded</option>{sortable.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}</select></Field>
                {spec.sort && <Field label="Order"><select className="input" value={spec.sort.dir} onChange={e => set({ sort: { ...spec.sort!, dir: e.target.value as "asc" | "desc" } })}><option value="asc">Lowest / A first</option><option value="desc">Highest / Z first</option></select></Field>}
                <Field label="Rows (max)"><input className="input w-24" inputMode="numeric" value={spec.limit ?? ""} onChange={e => set({ limit: e.target.value ? Math.max(1, Math.min(20000, Number(e.target.value) || 1)) : null })} /></Field>
                <button className="btn btn-primary" disabled={busy || !spec.columns.length} onClick={() => run()}>{busy ? "Running…" : "Run"}</button>
              </div>
            </>}
          </section>

          {out && (
            <section className="card overflow-hidden">
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3 text-sm">
                <span className="mr-auto">{out.total_rows} {spec.group_by ? "group" : "row"}{out.total_rows === 1 ? "" : "s"}{out.truncated ? ` (showing the first ${out.rows.length})` : ""}</span>
                <button className="btn btn-outline px-2 py-1 text-xs" onClick={() => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv(out)], { type: "text/csv" })); a.download = `${save.name || "report"}.csv`; a.click(); }}>Download these rows</button>
              </div>
              {!out.rows.length ? <Empty>Nothing matches.</Empty> : (
                <div className="max-h-[60vh] overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-slate-50 text-xs text-slate-500"><tr>{out.columns.map(c => <th key={c.key} className={`p-2 ${["number", "money"].includes(c.type) ? "text-right" : "text-left"}`}>{c.label}</th>)}</tr></thead>
                    <tbody>{out.rows.slice(0, 500).map((r, i) => <tr key={i} className="border-t border-slate-100">{r.map((v, j) => <td key={j} className={`p-2 ${["number", "money"].includes(out.columns[j].type) ? "text-right tabular-nums" : ""}`}>{fmt(v, out.columns[j].type)}</td>)}</tr>)}</tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {d && (
            <section className="card space-y-3 p-4">
              <h2 className="font-semibold">{editing && editing.owner_id === meta.me ? "Update this report" : editing ? "Save your own copy" : "Save this report"}</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Name"><input className="input" value={save.name} onChange={e => setSave({ ...save, name: e.target.value })} /></Field>
                <Field label="Description (optional)"><input className="input" value={save.description} onChange={e => setSave({ ...save, description: e.target.value })} /></Field>
              </div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={save.shared} onChange={e => setSave({ ...save, shared: e.target.checked })} /> Share with colleagues (they still see only what their role allows)</label>
              <div className="flex flex-wrap items-end gap-3">
                <Field label="Email it"><select className="input" value={save.schedule} onChange={e => setSave({ ...save, schedule: e.target.value as Saved["schedule"] })}><option value="none">Never</option><option value="daily">Every day</option><option value="weekly">Every week</option><option value="monthly">Every month</option></select></Field>
                {save.schedule === "weekly" && <Field label="On"><select className="input" value={save.schedule_day} onChange={e => setSave({ ...save, schedule_day: Number(e.target.value) })}>{WEEKDAYS.map((w, i) => <option key={w} value={i + 1}>{w}</option>)}</select></Field>}
                {save.schedule === "monthly" && <Field label="On day"><select className="input" value={save.schedule_day} onChange={e => setSave({ ...save, schedule_day: Number(e.target.value) })}>{Array.from({ length: 28 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select></Field>}
                {save.schedule !== "none" && <Field label="At"><select className="input" value={save.schedule_hour} onChange={e => setSave({ ...save, schedule_hour: Number(e.target.value) })}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}</select></Field>}
              </div>
              {save.schedule !== "none" && (
                <div>
                  <p className="mb-1 text-sm font-medium">Send to (staff only)</p>
                  <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
                    {meta.staff.map(s => { const on = save.recipient_ids.includes(s.id); return (
                      <button key={s.id} type="button" onClick={() => setSave({ ...save, recipient_ids: on ? save.recipient_ids.filter(x => x !== s.id) : [...save.recipient_ids, s.id] })}
                        className={`rounded-full border px-2.5 py-1 text-xs ${on ? "border-brand-500 bg-brand-50" : "border-slate-200"}`}>{on ? "✓ " : ""}{s.full_name}</button>); })}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">Grouped reports carry their totals in the email. Row-by-row reports send the count and a link that needs sign-in, so no student’s details travel by email. Each report runs as its author, so it never shows more than you could see.</p>
                </div>
              )}
              <button className="btn btn-primary" disabled={!save.name.trim() || !spec.columns.length} onClick={doSave}>{editing && editing.owner_id === meta.me ? "Save changes" : "Save report"}</button>
            </section>
          )}
        </div>
      </div>
    </Page>
  );
}
