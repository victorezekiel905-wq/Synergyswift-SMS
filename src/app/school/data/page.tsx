"use client";
import { useEffect, useState } from "react";
import { useApi, send, Page, PageHeader, Alert, Badge, Field, Loading, Stat } from "@/components/ui";
import { autoMap, template, type Entity } from "@/lib/importers";
import { parseGrid, readXlsxGrid, toCsv, type Table } from "@/lib/spreadsheet";
import { organiseStudentList, type Organised } from "@/lib/class-sections";

type Result = { rows: number; created: number; updated: number; skipped: number; invited: number; errors: { row: number; error: string }[]; more_errors: number;
  numbered?: { reused: number; made: number } | null };

/** Rows from a CSV, Excel or PDF file, as they are in it. */
async function readGrid(f: File): Promise<string[][]> {
  if (/\.xlsx$/i.test(f.name)) return readXlsxGrid(await f.arrayBuffer());
  if (/\.xls$/i.test(f.name)) throw new Error("save the file as .xlsx or .csv first (File → Save as)");
  if (/\.pdf$/i.test(f.name) || f.type === "application/pdf") {
    const form = new FormData(); form.append("file", f);
    const r = await fetch("/api/data/pdf", { method: "POST", body: form });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error ?? "the PDF couldn't be read");
    return j.rows as string[][];
  }
  return parseGrid(await f.text());
}
const asTable = (grid: string[][]): Table => {
  const headers = (grid[0] ?? []).map(h => h.trim());
  return { headers, rows: grid.slice(1).map(r => headers.map((_, i) => (r[i] ?? "").trim())) };
};

/** Bring data in from spreadsheets or another school system, and take any of it out as CSV or Excel. */
export default function DataPage() {
  const { data, error } = useApi<{ entities: Entity[] }>("/api/data");
  const [key, setKey] = useState("");
  const [file, setFile] = useState<{ name: string; table: Table } | null>(null);
  const [map, setMap] = useState<Record<string, number>>({});
  const [logins, setLogins] = useState(false);
  const [result, setResult] = useState<{ dry: boolean; r: Result } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  // A whole-school list with each class as a heading, organised into one table with a Class column.
  const [organised, setOrganised] = useState<Organised | null>(null);
  // /school/data?entity=students (from the Students page) opens on that import.
  useEffect(() => { const k = new URLSearchParams(window.location.search).get("entity"); if (k) setKey(k); }, []);
  if (error) return <Page><Alert>{error}</Alert></Page>;
  if (!data) return <Page><Loading /></Page>;
  const e = data.entities.find(x => x.key === key) ?? null;

  const load = async (f: File) => {
    setErr(null); setResult(null); setOrganised(null); setReading(true);
    try {
      if (f.size > 8_000_000) throw new Error("the file is larger than 8 MB; split it into smaller files");
      const grid = await readGrid(f);
      // Students (or not chosen yet): a list grouped under class headings is recognised and organised.
      const org = !key || key === "students" ? organiseStudentList(grid) : null;
      const t = org ? org.table : asTable(grid);
      if (!t.headers.length || !t.rows.length) throw new Error("no rows found: the first row must hold the column names, or each class must have a heading");
      if (t.rows.length > 5000) throw new Error(`the file has ${t.rows.length} rows; import at most 5000 at a time`);
      const target = org ? data.entities.find(x => x.key === "students") ?? e : e;
      if (org && key !== "students") setKey("students");
      setOrganised(org);
      setFile({ name: f.name, table: t });
      if (target) setMap(autoMap(target, t.headers));
    } catch (x) { setFile(null); setErr((x as Error).message); }
    finally { setReading(false); }
  };
  const run = async (dry: boolean) => {
    if (!e || !file) return;
    setBusy(true); setErr(null);
    // Checking saves nothing, so only the real import says "Saved".
    const r = await send<Result>("/api/data", { entity: e.key, headers: file.table.headers, rows: file.table.rows, map, dry_run: dry, create_logins: logins }, "POST", { quiet: dry });
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    setResult({ dry, r: r.data });
  };
  const download = (name: string, text: string) => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" })); a.download = name; a.click(); URL.revokeObjectURL(a.href); };
  const mapped = e ? e.fields.filter(f => (map[f.key] ?? -1) >= 0).length : 0;

  return (
    <Page wide>
      <PageHeader eyebrow="Administration" title="Import & export"
        subtitle="Bring in students, parents, staff, classes, subjects, fee balances, alumni and vendors from a spreadsheet or your old school system. Every import is checked first and recorded in the change history." />
      <div className="grid gap-5 lg:grid-cols-[2fr,1fr]">
        <section className="card space-y-4 p-5 text-sm">
          <h2 className="font-semibold">Import</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="What are you importing?">
              <select className="input" value={key} onChange={ev => { setKey(ev.target.value); setResult(null); const n = data.entities.find(x => x.key === ev.target.value); if (n && file) setMap(autoMap(n, file.table.headers)); }}>
                <option value="">Choose…</option>{data.entities.map(x => <option key={x.key} value={x.key}>{x.label}</option>)}
              </select>
            </Field>
            <Field label="File" hint="CSV, Excel (.xlsx) or PDF. A whole school's student list with each class as a heading is organised for you.">
              <input className="input" type="file" accept=".csv,.txt,.xlsx,.pdf,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={ev => ev.target.files?.[0] && load(ev.target.files[0])} />
            </Field>
          </div>
          {reading && <p className="text-slate-500" role="status">Reading the file…</p>}
          {organised && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
              <p className="font-medium text-emerald-900">Organised by class: {organised.classes.length} class{organised.classes.length === 1 ? "" : "es"}, {organised.table.rows.length} students</p>
              <p className="mt-1 text-slate-700">{organised.classes.map(c => `${c.name} (${c.students})`).join(" · ")}</p>
              <p className="mt-1 text-xs text-slate-600">Classes that don&apos;t exist yet are created. {organised.namesSplit ? "Each name was split into first, last and other names. " : ""}Students without an admission number get one automatically, and a student already in the school keeps theirs.</p>
            </div>
          )}
          {e && <p className="text-slate-600">{e.hint} <button className="text-brand-700" onClick={() => download(`${e.key}-template.csv`, toCsv(template(e)))}>Download a blank template</button></p>}
          {err && <Alert>{err}</Alert>}
          {e && file && (
            <>
              <div>
                <p className="mb-2 font-medium">Match the columns <span className="font-normal text-slate-500">({file.table.rows.length} rows in {file.name}; {mapped} of {e.fields.length} fields matched)</span></p>
                <div className="grid gap-2 sm:grid-cols-2">{e.fields.map(f => (
                  <label key={f.key} className="flex items-center gap-2">
                    <span className="w-44 shrink-0">{f.label}{f.required && !(e.key === "students" && f.key === "admission_no") && <span className="text-rose-600"> *</span>}</span>
                    <select className="input py-1" value={map[f.key] ?? -1} onChange={ev => { setMap({ ...map, [f.key]: Number(ev.target.value) }); setResult(null); }}>
                      <option value={-1}>{e.key === "students" && f.key === "admission_no" ? "Not in this file (given automatically)" : "Not in this file"}</option>{file.table.headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                    </select>
                  </label>
                ))}</div>
              </div>
              <div className="overflow-x-auto">
                <p className="mb-1 text-xs text-slate-500">First rows as they will be read:</p>
                <table className="w-full text-xs"><thead className="bg-slate-50 text-left"><tr>{e.fields.filter(f => (map[f.key] ?? -1) >= 0).map(f => <th key={f.key} className="p-1">{f.label}</th>)}</tr></thead>
                  <tbody>{file.table.rows.slice(0, 5).map((r, i) => <tr key={i} className="border-t border-slate-100">{e.fields.filter(f => (map[f.key] ?? -1) >= 0).map(f => <td key={f.key} className="p-1">{r[map[f.key]]}</td>)}</tr>)}</tbody></table>
              </div>
              {e.key === "staff" && <label className="flex items-center gap-2"><input type="checkbox" checked={logins} onChange={ev => { setLogins(ev.target.checked); setResult(null); }} /> Create sign-in accounts for rows with an email and a role, and email them an invitation</label>}
              <div className="flex gap-2">
                <button className="btn btn-outline" disabled={busy} onClick={() => run(true)}>{busy ? "Checking…" : "Check the file"}</button>
                <button className="btn btn-primary" disabled={busy || !result?.dry || result.r.created + result.r.updated + result.r.invited === 0}
                  onClick={() => confirm(`Import ${result!.r.created + result!.r.updated} rows now?`) && run(false)}>{busy ? "Importing…" : "Import"}</button>
              </div>
              {result && (
                <div className="space-y-2">
                  <Alert tone={result.r.errors.length ? "amber" : "green"}>{result.dry ? "Check finished. Nothing has been saved yet." : "Import finished."}
                    {result.r.numbered && (result.r.numbered.made + result.r.numbered.reused) > 0 && ` Admission numbers: ${result.r.numbered.made} ${result.dry ? "will be given" : "given"}${result.r.numbered.reused ? `, ${result.r.numbered.reused} students already in the school kept theirs` : ""}.`}</Alert>
                  <div className="grid gap-3 sm:grid-cols-4">
                    <Stat label={result.dry ? "Will be added" : "Added"} value={result.r.created} tone="good" />
                    <Stat label={result.dry ? "Will be updated" : "Updated"} value={result.r.updated} />
                    <Stat label="Skipped" value={result.r.skipped} tone={result.r.skipped ? "warn" : undefined} />
                    {e.key === "staff" && <Stat label={result.dry ? "Logins to create" : "Invited"} value={result.r.invited} />}
                  </div>
                  {result.r.errors.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2"><p className="font-medium">Rows to fix</p>
                        <button className="text-xs text-brand-700" onClick={() => download("rows-to-fix.csv", toCsv({ headers: ["row", "problem"], rows: result.r.errors.map(x => [String(x.row), x.error]) }))}>Download the list</button></div>
                      <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto rounded border border-slate-200">{result.r.errors.map((x, i) => <li key={i} className="p-2"><Badge tone="amber">row {x.row}</Badge> {x.error}</li>)}</ul>
                      {result.r.more_errors > 0 && <p className="text-xs text-slate-500">…and {result.r.more_errors} more.</p>}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </section>
        <section className="card space-y-3 p-5 text-sm">
          <h2 className="font-semibold">Export</h2>
          <p className="text-slate-600">Download in the same columns as the import, so you can edit in Excel and import back.</p>
          <ul className="divide-y divide-slate-100">{data.entities.map(x => (
            <li key={x.key} className="flex items-center gap-2 py-2"><span className="flex-1">{x.label}</span>
              <a className="btn btn-outline px-2 py-1 text-xs" href={`/api/data?entity=${x.key}&format=xlsx`}>Excel</a>
              <a className="btn btn-outline px-2 py-1 text-xs" href={`/api/data?entity=${x.key}&format=csv`}>CSV</a></li>
          ))}</ul>
          <p className="text-xs text-slate-500">Moving from another system? Export from it as CSV or Excel and import here: common column names (Adm No, Surname, DOB, Class Arm, GSM…) are recognised automatically.</p>
        </section>
      </div>
    </Page>
  );
}
