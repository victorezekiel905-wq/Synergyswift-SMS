"use client";
import { useEffect, useState } from "react";
import { useApi, send, Alert, Badge, Empty, Field, fmtDate, Loading } from "@/components/ui";

type Profile = Record<string, string>;
type ReturnRow = { id: string; kind: string; period: string; status: "draft" | "submitted"; prepared_at: string; submitted_at: string | null; reference: string | null; notes: string | null };
type Full = ReturnRow & { data: { rows: (string | number)[][]; edited?: boolean } };

const PROFILE_FIELDS: { key: string; label: string; options?: string[] }[] = [
  { key: "school_code", label: "School / EMIS code" }, { key: "state", label: "State" }, { key: "lga", label: "Local government area" },
  { key: "ownership", label: "Ownership", options: ["", "private", "public", "mission", "community"] },
  { key: "school_type", label: "Type (e.g. junior and senior secondary)" }, { key: "location", label: "Location", options: ["", "urban", "rural"] },
  { key: "year_established", label: "Year established" }, { key: "head_name", label: "Head teacher / principal" }, { key: "phone", label: "Phone" }, { key: "email", label: "Email" }
];

function thisPeriod() {
  const d = new Date(), y = d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}/${y + 1}`;
}

/** The annual school census: worked out from records, checked and edited, downloaded, then marked submitted. */
export default function Census() {
  const { data, error, reload } = useApi<{ profile: Profile; returns: ReturnRow[] }>("/api/insights/census");
  const [profile, setProfile] = useState<Profile>({});
  const [period, setPeriod] = useState(thisPeriod());
  const [asOf, setAsOf] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { if (data) setProfile(data.profile); }, [data]);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;

  async function act(body: Record<string, unknown>, ok: string) {
    const r = await send("/api/insights/census", body);
    setMsg({ ok: r.ok, text: r.ok ? ok : r.error ?? "failed" });
    if (r.ok) reload();
    return r;
  }
  return (
    <div className="space-y-5">
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      <details className="card p-4" open={!Object.keys(data.profile).length}>
        <summary className="cursor-pointer font-semibold">School details for government returns</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PROFILE_FIELDS.map(f => (
            <Field key={f.key} label={f.label}>
              {f.options ? <select className="input" value={profile[f.key] ?? ""} onChange={e => setProfile({ ...profile, [f.key]: e.target.value })}>{f.options.map(o => <option key={o} value={o}>{o || "—"}</option>)}</select>
                : <input className="input" value={profile[f.key] ?? ""} onChange={e => setProfile({ ...profile, [f.key]: e.target.value })} />}
            </Field>
          ))}
        </div>
        <button className="btn btn-primary mt-3" onClick={() => act({ action: "save_profile", profile }, "School details saved.")}>Save details</button>
      </details>

      <section className="card space-y-3 p-4">
        <h3 className="font-semibold">Annual school census</h3>
        <p className="text-sm text-slate-600">Works out enrolment by class and sex, ages, new entrants, repeaters, children with special needs, staff by sex and qualification, TRCN registration, classrooms and ratios from your records. Check and correct the figures, download the spreadsheet for the ministry’s form or portal, then mark it submitted with their reference. A submitted return is kept exactly as sent.</p>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="School year"><input className="input w-32" value={period} onChange={e => setPeriod(e.target.value)} placeholder="2026/2027" /></Field>
          <Field label="Census day"><input type="date" className="input" value={asOf} onChange={e => setAsOf(e.target.value)} /></Field>
          <button className="btn btn-primary" onClick={async () => { const r = await act({ action: "prepare", period, ...(asOf ? { as_of: asOf } : {}) }, "Census worked out from your records. Check the figures below."); if (r.ok) setOpen(r.data.id); }}>Work out the census</button>
        </div>
      </section>

      {!data.returns.length ? <Empty>No returns yet.</Empty> : (
        <ul className="space-y-2">{data.returns.map(r => (
          <li key={r.id} className="card p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">School census {r.period}</span>
              <Badge tone={r.status === "submitted" ? "green" : "amber"}>{r.status}</Badge>
              <span className="text-xs text-slate-500">{r.status === "submitted" ? `submitted ${fmtDate(r.submitted_at)}${r.reference ? ` · ref ${r.reference}` : ""}` : `prepared ${fmtDate(r.prepared_at)}`}</span>
              <span className="ml-auto flex gap-2">
                <a className="btn btn-outline px-2 py-1 text-xs" href={`/api/insights/census?id=${r.id}&format=csv`}>Download</a>
                <button className="btn btn-outline px-2 py-1 text-xs" onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? "Close" : r.status === "draft" ? "Check & edit" : "View"}</button>
              </span>
            </div>
            {open === r.id && <ReturnEditor id={r.id} onDone={(text) => { setMsg({ ok: true, text }); reload(); }} />}
          </li>))}</ul>
      )}
    </div>
  );
}

function ReturnEditor({ id, onDone }: { id: string; onDone: (msg: string) => void }) {
  const { data, error, reload } = useApi<Full>(`/api/insights/census?id=${id}`);
  const [rows, setRows] = useState<(string | number)[][]>([]);
  const [notes, setNotes] = useState("");
  const [reference, setReference] = useState("");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (data) { setRows(data.data.rows ?? []); setNotes(data.notes ?? ""); setReference(data.reference ?? ""); } }, [data]);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  const locked = data.status === "submitted";
  const set = (i: number, j: number, v: string) => setRows(rows.map((r, a) => a !== i ? r : r.map((c, b) => b !== j ? c : (v === "" ? "" : Number.isFinite(Number(v)) ? Number(v) : v))));
  async function save() {
    const r = await send("/api/insights/census", { action: "save_rows", id, rows, notes: notes || null });
    if (!r.ok) { setErr(r.error); return; }
    setErr(null); reload(); onDone("Changes saved.");
  }
  async function submit() {
    if (!confirm("Mark this census as submitted? It will be kept exactly as it is now and cannot be changed afterwards.")) return;
    await save();
    const r = await send("/api/insights/census", { action: "submit", id, reference: reference || null });
    if (!r.ok) { setErr(r.error); return; }
    onDone("Marked as submitted.");
  }
  const [head, ...body] = rows;
  return (
    <div className="mt-3 space-y-3">
      {err && <Alert>{err}</Alert>}
      <div className="max-h-[60vh] overflow-auto rounded border border-slate-200">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-slate-50"><tr>{(head ?? []).map((h, j) => <th key={j} className="p-1.5 text-left">{h}</th>)}</tr></thead>
          <tbody>{body.map((r, i) => (
            <tr key={i} className="border-t border-slate-100">
              <td className="p-1.5 text-slate-500">{r[0]}</td><td className="p-1.5">{r[1]}</td>
              {r.slice(2).map((c, j) => <td key={j} className="p-1">{locked || c === "" && j < 3 ? <span className="tabular-nums">{c}</span>
                : <input className="w-20 rounded border border-slate-200 px-1 py-0.5 text-right tabular-nums" value={String(c)} onChange={e => set(i + 1, j + 2, e.target.value)} aria-label={`${r[1]} ${head?.[j + 2]}`} />}</td>)}
            </tr>))}</tbody>
        </table>
      </div>
      {data.data.edited && <p className="text-xs text-amber-700">Some figures were edited by hand after they were worked out.</p>}
      <Field label="Notes (e.g. what was corrected and why)"><textarea className="input" rows={2} value={notes} disabled={locked} onChange={e => setNotes(e.target.value)} /></Field>
      <div className="flex flex-wrap items-end gap-2">
        {!locked && <button className="btn btn-outline" onClick={save}>Save changes</button>}
        <Field label="Ministry reference"><input className="input w-48" value={reference} onChange={e => setReference(e.target.value)} /></Field>
        {locked ? <button className="btn btn-outline" onClick={async () => { await send("/api/insights/census", { action: "set_reference", id, reference: reference || null, notes: data.notes }); onDone("Reference saved."); }}>Save reference</button>
          : <button className="btn btn-primary" onClick={submit}>Mark as submitted</button>}
      </div>
    </div>
  );
}
