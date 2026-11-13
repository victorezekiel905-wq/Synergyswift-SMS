"use client";
import { useMemo, useState } from "react";
import { useApi, send, Alert, Badge, Field, Empty, Tabs } from "@/components/ui";
import { parseGrid, readXlsxGrid } from "@/lib/spreadsheet";

type Student = { id: string; name: string; admission_no: string | null; class_name: string | null };
type Method = "invite" | "otp" | "code";

/** The three ways in, as for staff: the email link first, it is the easiest. */
const METHODS: { id: Method; label: string; hint: string }[] = [
  { id: "invite", label: "Email link", hint: "They get an email, click the link and set their password. Easiest." },
  { id: "otp", label: "One-time password", hint: "Their email is the username. They sign in with a one-time password and must set a new one." },
  { id: "code", label: "Sign-up code", hint: "They get a code by email and make their account at /signup or /join with it." }
];

/**
 * Parent onboarding, like staff onboarding: name, email and their children, and one of three ways in.
 * Parents can also sign up on their own and add each child with the child's code (the list below).
 */
export default function AddParents({ onAdded }: { onAdded: () => void }) {
  const { data } = useApi<{ students: Student[] }>("/api/school/class-codes?students=1");
  const [mode, setMode] = useState<"one" | "many">("one");
  const [method, setMethod] = useState<Method>("invite");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const students = data?.students ?? [];
  const done = (ok: boolean, text: string) => { setMsg({ ok, text }); if (ok) onAdded(); };
  return (
    <section className="card mb-4 p-5 print:hidden">
      <h3 className="font-semibold">Add parents</h3>
      <ol className="my-3 grid gap-2 text-sm sm:grid-cols-3" aria-label="How it works">
        {["Add their name, email and children", "They get their sign-in (email link, one-time password or code)", "They sign in and find their children ready"].map((s, i) => (
          <li key={s} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">{i + 1}</span>{s}</li>))}
      </ol>
      {msg && <div className="mb-3" role="status"><Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert></div>}
      <Tabs value={mode} onChange={setMode} tabs={[{ id: "one", label: "Add one person" }, { id: "many", label: "Add many at once" }]} />
      <fieldset className="my-4">
        <legend className="label">How will they sign in?</legend>
        <div className="grid gap-2 md:grid-cols-3">
          {METHODS.map(m => (
            <label key={m.id} className={"flex cursor-pointer items-start gap-2 rounded-md border p-2.5 text-sm " + (method === m.id ? "border-brand-500 bg-brand-50" : "border-slate-200")}>
              <input type="radio" name="parent-sign-in-method" className="mt-0.5" checked={method === m.id} onChange={() => setMethod(m.id)} />
              <span><b>{m.label}</b><span className="block text-xs text-slate-600">{m.hint}</span></span>
            </label>))}
        </div>
      </fieldset>
      {!data ? <p className="text-sm text-slate-500">Loading students…</p> : !students.length ? <Empty>No students in your classes yet. Add students first.</Empty>
        : mode === "one" ? <AddOne students={students} method={method} onDone={done} /> : <AddMany students={students} method={method} onDone={done} />}
    </section>
  );
}

const blank = { full_name: "", email: "", phone: "", children: [] as string[] };

function AddOne({ students, method, onDone }: { students: Student[]; method: Method; onDone: (ok: boolean, text: string) => void }) {
  const [f, setF] = useState(blank);
  const [find, setFind] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const shown = useMemo(() => {
    const t = find.trim().toLowerCase();
    return t.length < 2 ? [] : students.filter(s => !f.children.includes(s.id) && `${s.name} ${s.admission_no ?? ""} ${s.class_name ?? ""}`.toLowerCase().includes(t)).slice(0, 8);
  }, [find, students, f.children]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!f.children.length) { setErr("Choose at least one child."); return; }
    setBusy(true); setErr(null);
    const r = await send<{ message: string; access_error?: string }>("/api/school/class-codes", {
      action: "add_parent", full_name: f.full_name, email: f.email, phone: f.phone || null, student_ids: f.children, method }, "POST", { quiet: true });
    setBusy(false);
    if (!r.ok) return setErr(r.error ?? "Please try again.");
    setF(blank); setFind("");
    onDone(!r.data.access_error, r.data.message);
  }
  const button = method === "invite" ? "Add and email the link" : method === "otp" ? "Add and send one-time password" : "Add and email the code";
  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Full name"><input className="input" required minLength={2} value={f.full_name} onChange={e => setF({ ...f, full_name: e.target.value })} autoComplete="off" /></Field>
        <Field label="Email"><input className="input" type="email" required value={f.email} onChange={e => setF({ ...f, email: e.target.value })} placeholder="name@example.com" autoComplete="off" /></Field>
        <Field label="Phone (optional)"><input className="input" value={f.phone} maxLength={30} onChange={e => setF({ ...f, phone: e.target.value })} autoComplete="off" /></Field>
      </div>
      <div>
        <p className="label">Their children</p>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {f.children.map(id => { const s = students.find(x => x.id === id); return (
            <button type="button" key={id} onClick={() => setF({ ...f, children: f.children.filter(x => x !== id) })} className="rounded-full border border-brand-600 bg-brand-600 px-3 py-1 text-sm text-white" title="Remove">
              ✓ {s?.name}{s?.class_name ? ` · ${s.class_name}` : ""} ×</button>); })}
        </div>
        <input className="input sm:max-w-sm" placeholder="Type a child's name or admission number" value={find} onChange={e => setFind(e.target.value)} aria-label="Find a child" />
        {shown.length > 0 && (
          <ul className="mt-1 max-w-sm rounded-md border border-slate-200 bg-white text-sm shadow-sm">
            {shown.map(s => <li key={s.id}><button type="button" className="w-full px-3 py-1.5 text-left hover:bg-slate-50" onClick={() => { setF({ ...f, children: [...f.children, s.id] }); setFind(""); }}>
              {s.name} <span className="text-xs text-slate-500">{[s.admission_no, s.class_name].filter(Boolean).join(" · ")}</span></button></li>)}
          </ul>)}
      </div>
      {err && <Alert>{err}</Alert>}
      <div className="flex justify-end"><button className="btn btn-primary" disabled={busy}>{busy ? "Adding…" : button}</button></div>
    </form>
  );
}

type Line = { line: number; full_name: string; email: string; phone: string; children: string[]; unknown: string[]; problem: string | null };

/** Reads "Name, Email, Children, Phone": children by admission number or full name, several separated by ";". */
function readLines(grid: string[][], students: Student[]): Line[] {
  const rows = grid.filter(r => r.some(c => String(c ?? "").trim()));
  const head = rows[0]?.map(c => String(c).trim().toLowerCase()) ?? [];
  const hasHead = head.includes("email") || head.includes("name");
  const col = (n: string, d: number) => hasHead ? Math.max(head.findIndex(h => h.startsWith(n)), -1) : d;
  const [iN, iE, iC, iP] = [col("name", 0), col("email", 1), col("child", 2), col("phone", 3)];
  const byAdm = new Map(students.filter(s => s.admission_no).map(s => [s.admission_no!.toLowerCase(), s.id]));
  const byName = new Map<string, string[]>();
  for (const s of students) byName.set(s.name.toLowerCase(), [...(byName.get(s.name.toLowerCase()) ?? []), s.id]);
  return (hasHead ? rows.slice(1) : rows).map((r, i) => {
    const cell = (k: number) => (k >= 0 ? String(r[k] ?? "").trim() : "");
    const wanted = cell(iC).split(/[;|]/).map(x => x.trim()).filter(Boolean);
    const children: string[] = [], unknown: string[] = [];
    for (const w of wanted) {
      const id = byAdm.get(w.toLowerCase()) ?? ((byName.get(w.toLowerCase()) ?? []).length === 1 ? byName.get(w.toLowerCase())![0] : undefined);
      if (id) children.push(id); else unknown.push(w);
    }
    const email = cell(iE).toLowerCase();
    const problem = cell(iN).length < 2 ? "no name" : !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? "no valid email" : !children.length ? "no child found in your classes" : null;
    return { line: i + (hasHead ? 2 : 1), full_name: cell(iN), email, phone: cell(iP), children: [...new Set(children)], unknown, problem };
  });
}

function AddMany({ students, method, onDone }: { students: Student[]; method: Method; onDone: (ok: boolean, text: string) => void }) {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<Line[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Record<number, { ok: boolean; text: string }>>({});
  const [err, setErr] = useState<string | null>(null);
  const name = (id: string) => students.find(s => s.id === id)?.name ?? "";
  const read = (grid: string[][]) => { setRows(readLines(grid, students)); setResults({}); };
  async function upload(file: File) {
    setErr(null);
    try { read(/\.xlsx$/i.test(file.name) ? await readXlsxGrid(await file.arrayBuffer()) : parseGrid(await file.text())); }
    catch (e) { setErr((e as Error).message || "Could not read that file. Use Excel (.xlsx) or CSV."); }
  }
  function template() {
    const csv = "﻿Name,Email,Children,Phone\r\nMrs Ngozi Obi,ngozi@example.com,ADM-0101; ADM-0102,\r\nMr Tunde Bello,tunde@example.com,Musa Bello,+2348000000000\r\n";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = "parent-list.csv"; a.click();
  }
  const good = (rows ?? []).filter(r => !r.problem && !results[r.line]?.ok);
  async function addAll() {
    setBusy(true);
    const out: Record<number, { ok: boolean; text: string }> = { ...results };
    for (const r of good) {
      const res = await send<{ message: string; access_error?: string }>("/api/school/class-codes", {
        action: "add_parent", full_name: r.full_name, email: r.email, phone: r.phone || null, student_ids: r.children.slice(0, 10), method }, "POST", { quiet: true });
      out[r.line] = res.ok ? { ok: !res.data.access_error, text: res.data.access_error ?? "Added" } : { ok: false, text: res.error ?? "Failed" };
      setResults({ ...out });
    }
    setBusy(false);
    onDone(true, `${Object.values(out).filter(x => x.ok).length} parents added and sent their sign-in. Anyone with a problem is marked in the list.`);
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">Paste a list (one parent per line: name, email, children) or upload an Excel or CSV file with columns <b>Name</b>, <b>Email</b>, <b>Children</b> and optionally <b>Phone</b>. Children by admission number or full name; separate several with “;”.</p>
      <div className="flex flex-wrap gap-2">
        <label className="btn btn-outline cursor-pointer">Upload Excel or CSV<input type="file" accept=".xlsx,.csv,.txt,text/csv" className="sr-only" onChange={e => { const file = e.target.files?.[0]; if (file) upload(file); e.target.value = ""; }} /></label>
        <button type="button" className="btn btn-ghost" onClick={template}>Download a template</button>
      </div>
      <textarea className="input min-h-28 font-mono text-sm" value={text} onChange={e => setText(e.target.value)} placeholder={"Mrs Ngozi Obi, ngozi@example.com, ADM-0101; ADM-0102\nMr Tunde Bello, tunde@example.com, Musa Bello"} aria-label="Parent list" />
      <div className="flex justify-end"><button type="button" className="btn btn-outline" disabled={!text.trim()} onClick={() => read(parseGrid(text))}>Check the list</button></div>
      {err && <Alert>{err}</Alert>}
      {rows && (rows.length === 0 ? <Empty>No one found in the list.</Empty> : (
        <>
          <div className="overflow-x-auto rounded-lg border border-slate-200"><table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="p-2">Name</th><th className="p-2">Email</th><th className="p-2">Children</th><th className="p-2">Status</th></tr></thead>
            <tbody>{rows.map(r => { const res = results[r.line]; return (
              <tr key={r.line} className="border-t border-slate-100 align-top">
                <td className="p-2">{r.full_name || <i className="text-slate-400">none</i>}</td>
                <td className="p-2">{r.email || <i className="text-slate-400">none</i>}</td>
                <td className="p-2"><div className="flex flex-wrap gap-1">{r.children.map(id => <Badge key={id}>{name(id)}</Badge>)}{r.unknown.map(u => <Badge key={u} tone="red">{u}?</Badge>)}</div>
                  {r.unknown.length > 0 && <span className="text-xs text-rose-700">Not found in your classes; left out.</span>}</td>
                <td className="p-2">{res ? <span className={res.ok ? "text-emerald-700" : "text-rose-700"}>{res.text}</span> : r.problem ? <span className="text-rose-700">Line {r.line}: {r.problem}</span> : <span className="text-slate-600">Ready</span>}</td>
              </tr>); })}</tbody>
          </table></div>
          <div className="flex items-center justify-end gap-3">
            {rows.some(r => r.problem) && <span className="text-sm text-slate-500">Lines with a problem are skipped. Fix them and check again.</span>}
            <button type="button" className="btn btn-primary" disabled={busy || !good.length} onClick={addAll}>{busy ? `Adding… ${Object.keys(results).length}` : `Add and invite ${good.length} parent${good.length === 1 ? "" : "s"}`}</button>
          </div>
        </>
      ))}
    </div>
  );
}
