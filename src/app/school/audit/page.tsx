"use client";
import { useEffect, useState } from "react";
import { Page, PageHeader, Alert, Badge, Empty, Field, Loading, fmtDate } from "@/components/ui";

type Change = { id: number; table_name: string; table_label: string; row_id: string | null; op: "insert" | "update" | "delete"; who: string; changes: Record<string, unknown>; at: string };
type Data = { items: Change[]; tables: { key: string; label: string }[]; staff: { id: string; full_name: string }[]; next: number | null };
const OP: Record<Change["op"], { label: string; tone: "green" | "blue" | "red" }> = { insert: { label: "added", tone: "green" }, update: { label: "changed", tone: "blue" }, delete: { label: "deleted", tone: "red" } };
const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));

/** Every create, edit and delete in the school's data: who, when, and what changed. */
export default function AuditPage() {
  const [f, setF] = useState({ table: "", op: "", actor: "", row: "", q: "", from: "", to: "" });
  const [items, setItems] = useState<Change[]>([]);
  const [meta, setMeta] = useState<Omit<Data, "items" | "next"> | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const params = (extra: Record<string, string> = {}) => new URLSearchParams(Object.entries({ ...f, ...extra }).filter(([, v]) => v)).toString();
  const load = async (before?: number) => {
    setBusy(true);
    const r = await fetch(`/api/school/audit?${params(before ? { before: String(before) } : {})}`);
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setErr(j.error ?? "failed"); return; }
    setErr(null);
    setItems(before ? [...items, ...j.items] : j.items);
    setNext(j.next);
    if (!meta) setMeta({ tables: j.tables, staff: j.staff });
  };
  const filters = JSON.stringify(f);
  // Reload a moment after the filters stop changing.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setTimeout(() => load(), 300); return () => clearTimeout(t); }, [filters]);
  return (
    <Page wide>
      <PageHeader eyebrow="Administration" title="Change history"
        subtitle="Every record added, changed or deleted, with who did it and the values before and after. Passwords, tokens and signatures are never shown."
        actions={<a className="btn btn-outline" href={`/api/school/audit?${params({ format: "csv" })}`}>Download CSV</a>} />
      <div className="card mb-4 grid gap-3 p-4 sm:grid-cols-4 lg:grid-cols-7">
        <Field label="Area"><select className="input" value={f.table} onChange={e => setF({ ...f, table: e.target.value })}><option value="">Everything</option>{meta?.tables.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}</select></Field>
        <Field label="Action"><select className="input" value={f.op} onChange={e => setF({ ...f, op: e.target.value })}><option value="">Any</option><option value="insert">Added</option><option value="update">Changed</option><option value="delete">Deleted</option></select></Field>
        <Field label="By"><select className="input" value={f.actor} onChange={e => setF({ ...f, actor: e.target.value })}><option value="">Anyone</option><option value="system">System</option>{meta?.staff.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select></Field>
        <Field label="From"><input className="input" type="date" value={f.from} onChange={e => setF({ ...f, from: e.target.value })} /></Field>
        <Field label="To"><input className="input" type="date" value={f.to} onChange={e => setF({ ...f, to: e.target.value })} /></Field>
        <Field label="Containing"><input className="input" value={f.q} onChange={e => setF({ ...f, q: e.target.value })} placeholder="a name, a value…" /></Field>
        <Field label="Record id"><input className="input" value={f.row} onChange={e => setF({ ...f, row: e.target.value.trim() })} /></Field>
      </div>
      {err && <Alert>{err}</Alert>}
      {!items.length ? (busy ? <Loading /> : <Empty>No changes match.</Empty>) : (
        <ul className="card divide-y divide-slate-100 text-sm">{items.map(c => {
          const keys = Object.keys(c.changes);
          return (
            <li key={c.id} className="p-3">
              <button className="flex w-full flex-wrap items-center gap-2 text-left" onClick={() => setOpen(open === c.id ? null : c.id)} aria-expanded={open === c.id}>
                <span className="w-36 shrink-0 text-xs text-slate-500">{fmtDate(c.at, true)}</span>
                <span className="font-medium">{c.who}</span><Badge tone={OP[c.op].tone}>{OP[c.op].label}</Badge><span>{c.table_label}</span>
                {c.op === "update" && <span className="truncate text-xs text-slate-500">{keys.slice(0, 4).join(", ")}{keys.length > 4 ? ` +${keys.length - 4}` : ""}</span>}
              </button>
              {open === c.id && (
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-xs"><tbody>{keys.map(k => {
                    const v = c.changes[k];
                    const pair = c.op === "update" && Array.isArray(v) && v.length === 2;
                    return <tr key={k} className="border-t border-slate-100"><td className="w-40 py-1 pr-2 font-mono text-slate-500">{k}</td>
                      {pair ? <><td className="py-1 pr-2 text-rose-700 line-through">{show((v as unknown[])[0])}</td><td className="py-1 text-emerald-700">{show((v as unknown[])[1])}</td></> : <td className="py-1" colSpan={2}>{show(v)}</td>}</tr>;
                  })}</tbody></table>
                  {c.row_id && <button className="mt-1 text-xs text-brand-700" onClick={() => setF({ ...f, table: c.table_name, row: c.row_id!, op: "", q: "" })}>Full history of this record</button>}
                </div>
              )}
            </li>
          );
        })}</ul>
      )}
      {next && <div className="mt-3 text-center"><button className="btn btn-outline" disabled={busy} onClick={() => load(next)}>Load older</button></div>}
    </Page>
  );
}
