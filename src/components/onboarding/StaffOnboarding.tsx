"use client";
import { useEffect, useMemo, useState } from "react";
import { useApi, send, Alert, Badge, Field, Loading, Empty, Modal, Tabs } from "@/components/ui";
import { staffListFromGrid, stageOf, STAGE_TEXT, assignmentKey, type Assignment, type ListRow, type Stage } from "@/lib/staff-onboarding";
import { parseGrid, readXlsxGrid } from "@/lib/spreadsheet";

type Row = { id: string; full_name: string; email: string | null; staff_no: string; position: string | null; created_at: string;
  subject_ids: string[]; has_account: boolean; role: string | null; code: string | null; classes: number; active: boolean | null; assignments: Assignment[];
  signed_in?: boolean | null };
type Subject = { id: string; name: string; code?: string | null };
type ClassGroup = { id: string; name: string; level: string | null };
type Data = { subjects: Subject[]; classes: ClassGroup[]; taken: Record<string, string>; staff: Row[]; roles: string[] };
type Method = "invite" | "otp" | "code";

/** The three ways in, the email link first: it is the easiest for staff. */
const METHODS: { id: Method; label: string; hint: string }[] = [
  { id: "invite", label: "Email link", hint: "They get an email, click the link and set their password. Easiest." },
  { id: "otp", label: "One-time password", hint: "Their email is the username. They sign in with a one-time password and must set a new one." },
  { id: "code", label: "Sign-up code", hint: "They get a code by email and make their account at /join with it." }
];
const STAGE_TONE: Record<Stage, "amber" | "blue" | "green"> = { waiting: "amber", needs_classes: "blue", ready: "green" };
const words = (r: string) => r.replace(/_/g, " ");
const blank = { full_name: "", email: "", staff_no: "", phone: "", role: "teacher", subject_ids: [] as string[], classes: [] as Assignment[] };

/**
 * Staff onboarding, made simple: name, email and subjects (classes too, if you like), and one of
 * three ways in. One list shows where everyone is, with the one thing to do next.
 */
export default function StaffOnboarding() {
  const { data, error, reload } = useApi<Data>("/api/school/staff-onboarding");
  const [mode, setMode] = useState<"one" | "many">("one");
  const [method, setMethod] = useState<Method>("invite");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  useEffect(() => { setFocus(new URLSearchParams(window.location.search).get("focus")); }, []);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  const done = (ok: boolean, text: string) => { setMsg({ ok, text }); if (ok) reload(); window.scrollTo({ top: 0, behavior: "smooth" }); };

  return (
    <div>
      <p className="mb-3 text-sm text-slate-600">Add staff in three steps: who they are and what they teach, how they sign in, and their classes. You can choose classes now or once they have joined.</p>
      <ol className="mb-5 grid gap-2 text-sm sm:grid-cols-3" aria-label="How it works">
        {["Add their name, email and subjects", "They get their sign-in (email link, one-time password or code)", "They join and find their classes ready"].map((s, i) => (
          <li key={s} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">{i + 1}</span>{s}</li>))}
      </ol>
      {msg && <div className="mb-4" role="status"><Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert></div>}

      <section className="card mb-6 p-5">
        <Tabs value={mode} onChange={setMode} tabs={[{ id: "one", label: "Add one person" }, { id: "many", label: "Add many at once" }]} />
        <MethodPicker value={method} onChange={setMethod} />
        {mode === "one" ? <AddOne data={data} method={method} onDone={done} /> : <AddMany data={data} method={method} onDone={done} />}
      </section>

      <People data={data} focus={focus} onDone={done} />
    </div>
  );
}

function MethodPicker({ value, onChange }: { value: Method; onChange: (m: Method) => void }) {
  return (
    <fieldset className="my-4">
      <legend className="label">How will they sign in?</legend>
      <div className="grid gap-2 md:grid-cols-3">
        {METHODS.map(m => (
          <label key={m.id} className={"flex cursor-pointer items-start gap-2 rounded-md border p-2.5 text-sm " + (value === m.id ? "border-brand-500 bg-brand-50" : "border-slate-200")}>
            <input type="radio" name="sign-in-method" className="mt-0.5" checked={value === m.id} onChange={() => onChange(m.id)} />
            <span><b>{m.label}</b><span className="block text-xs text-slate-600">{m.hint}</span></span>
          </label>))}
      </div>
    </fieldset>
  );
}

/** Ticks for the school's subjects, with a search box when there are many. */
function SubjectTicks({ subjects, value, onChange }: { subjects: Subject[]; value: string[]; onChange: (ids: string[]) => void }) {
  const [find, setFind] = useState("");
  if (!subjects.length) return <p className="text-sm text-slate-500">No subjects yet. Add them under <a className="text-brand-700 underline" href="/school/setup">School setup</a>.</p>;
  const shown = subjects.filter(s => !find || s.name.toLowerCase().includes(find.toLowerCase()));
  return (
    <div>
      {subjects.length > 12 && <input className="input mb-2 sm:max-w-xs" placeholder="Find a subject" value={find} onChange={e => setFind(e.target.value)} aria-label="Find a subject" />}
      <div className="flex flex-wrap gap-1.5">
        {shown.map(s => { const on = value.includes(s.id); return (
          <button type="button" key={s.id} aria-pressed={on} onClick={() => onChange(on ? value.filter(x => x !== s.id) : [...value, s.id])}
            className={"rounded-full border px-3 py-1 text-sm " + (on ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 bg-white hover:border-brand-400")}>{on ? "✓ " : ""}{s.name}</button>); })}
      </div>
    </div>
  );
}

/** For each subject they teach, the classes; and the class they are form teacher of. */
function ClassPicker({ data, subjectIds, value, onChange }: { data: Data; subjectIds: string[]; value: Assignment[]; onChange: (a: Assignment[]) => void }) {
  if (!data.classes.length) return <p className="text-sm text-slate-500">No classes yet. Add them under <a className="text-brand-700 underline" href="/school/setup">School setup</a>.</p>;
  const has = (a: Assignment) => value.some(v => assignmentKey(v) === assignmentKey(a));
  const flip = (a: Assignment) => onChange(has(a) ? value.filter(v => assignmentKey(v) !== assignmentKey(a)) : [...value, a]);
  const chip = (a: Assignment, label: string) => {
    const on = has(a), now = data.taken[assignmentKey(a)];
    return (
      <button type="button" key={assignmentKey(a)} aria-pressed={on} onClick={() => flip(a)} title={now ? `Now: ${now}` : undefined}
        className={"rounded-md border px-2.5 py-1 text-sm " + (on ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-300 bg-white hover:border-emerald-500")}>
        {on ? "✓ " : ""}{label}{now && !on ? <span className="ml-1 text-xs text-slate-500">({now})</span> : null}
      </button>
    );
  };
  const subjectName = (id: string) => data.subjects.find(s => s.id === id)?.name ?? "";
  return (
    <div className="space-y-3">
      {!subjectIds.length && <p className="text-sm text-slate-500">Tick their subjects above to choose the classes they teach them in.</p>}
      {subjectIds.map(sid => (
        <div key={sid}>
          <p className="mb-1 text-sm font-medium">{subjectName(sid)} in:</p>
          <div className="flex flex-wrap gap-1.5">{data.classes.map(c => chip({ class_group_id: c.id, subject_id: sid }, c.name))}</div>
        </div>))}
      <div>
        <p className="mb-1 text-sm font-medium">Form teacher of: <span className="font-normal text-slate-500">(optional)</span></p>
        <div className="flex flex-wrap gap-1.5">{data.classes.map(c => chip({ class_group_id: c.id, subject_id: null }, c.name))}</div>
      </div>
      <p className="text-xs text-slate-500">A name in brackets is who has it now; choosing it here gives it to this person instead.</p>
    </div>
  );
}

function AddOne({ data, method, onDone }: { data: Data; method: Method; onDone: (ok: boolean, text: string) => void }) {
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showClasses, setShowClasses] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    // Classes only for subjects still ticked.
    const classes = f.classes.filter(a => a.subject_id === null || f.subject_ids.includes(a.subject_id));
    const r = await send<{ message: string; access_error?: string }>("/api/school/staff-onboarding", {
      action: "onboard", full_name: f.full_name, email: f.email, staff_no: f.staff_no || null, phone: f.phone || null, role: f.role,
      subject_ids: f.subject_ids, classes, method }, "POST", { quiet: true });
    setBusy(false);
    if (!r.ok) return setErr(r.error ?? "Please try again.");
    setF(blank); setShowClasses(false);
    onDone(!r.data.access_error, r.data.message);
  }
  const button = method === "invite" ? "Add and email the link" : method === "otp" ? "Add and send one-time password" : "Add and email the code";
  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Full name"><input className="input" required minLength={2} value={f.full_name} onChange={e => setF({ ...f, full_name: e.target.value })} autoComplete="off" /></Field>
        <Field label="Email"><input className="input" type="email" required value={f.email} onChange={e => setF({ ...f, email: e.target.value })} placeholder="name@example.com" autoComplete="off" /></Field>
      </div>
      <div>
        <p className="label">Subjects they teach <span className="font-normal text-slate-500">(tick all that apply)</span></p>
        <SubjectTicks subjects={data.subjects} value={f.subject_ids} onChange={ids => setF({ ...f, subject_ids: ids })} />
      </div>
      <div className="rounded-lg border border-slate-200">
        <button type="button" className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-medium" aria-expanded={showClasses} onClick={() => setShowClasses(!showClasses)}>
          <span>Classes <span className="font-normal text-slate-500">(optional: you can do this later{f.classes.length ? ` · ${f.classes.length} chosen` : ""})</span></span><span aria-hidden>{showClasses ? "▾" : "▸"}</span>
        </button>
        {showClasses && <div className="border-t border-slate-200 p-3"><ClassPicker data={data} subjectIds={f.subject_ids} value={f.classes} onChange={classes => setF({ ...f, classes })} /></div>}
      </div>
      <details className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
        <summary className="cursor-pointer font-medium">More details <span className="font-normal text-slate-500">(role: {words(f.role)}; ID number and phone are optional)</span></summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Field label="Role"><select className="input" value={f.role} onChange={e => setF({ ...f, role: e.target.value })}>{data.roles.map(r => <option key={r} value={r}>{words(r)}</option>)}</select></Field>
          <Field label="ID number"><input className="input" value={f.staff_no} maxLength={40} onChange={e => setF({ ...f, staff_no: e.target.value })} placeholder="Made for you if blank" /></Field>
          <Field label="Phone"><input className="input" value={f.phone} maxLength={30} onChange={e => setF({ ...f, phone: e.target.value })} /></Field>
        </div>
      </details>
      {err && <Alert>{err}</Alert>}
      <div className="flex justify-end"><button className="btn btn-primary" disabled={busy}>{busy ? "Adding…" : button}</button></div>
    </form>
  );
}

function AddMany({ data, method, onDone }: { data: Data; method: Method; onDone: (ok: boolean, text: string) => void }) {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<ListRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Record<number, { ok: boolean; text: string }>>({});
  const [err, setErr] = useState<string | null>(null);
  const name = (id: string) => data.subjects.find(s => s.id === id)?.name ?? "";
  const read = (grid: string[][]) => { setRows(staffListFromGrid(grid, data.subjects)); setResults({}); };
  async function upload(file: File) {
    setErr(null);
    try {
      if (/\.xlsx$/i.test(file.name)) read(await readXlsxGrid(await file.arrayBuffer()));
      else read(parseGrid(await file.text()));
    } catch (e) { setErr((e as Error).message || "Could not read that file. Use Excel (.xlsx) or CSV."); }
  }
  function template() {
    const csv = "﻿Name,Email,Subjects,ID number,Phone\r\nAda Obi,ada@example.com,Mathematics; Further Mathematics,,\r\nTunde Bello,tunde@example.com,English Language,STF-0102,\r\n";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = "staff-list.csv"; a.click();
  }
  const good = (rows ?? []).filter(r => !r.problem && !results[r.line]?.ok);
  async function inviteAll() {
    setBusy(true);
    const out: Record<number, { ok: boolean; text: string }> = { ...results };
    for (const r of good) {
      const res = await send<{ message: string; access_error?: string }>("/api/school/staff-onboarding", {
        action: "onboard", full_name: r.full_name, email: r.email, staff_no: r.staff_no || null, phone: r.phone || null, subject_ids: r.subject_ids, method }, "POST", { quiet: true });
      out[r.line] = res.ok ? { ok: !res.data.access_error, text: res.data.access_error ? res.data.access_error : "Added" } : { ok: false, text: res.error ?? "Failed" };
      setResults({ ...out });
    }
    setBusy(false);
    const added = Object.values(out).filter(x => x.ok).length;
    onDone(true, `${added} staff added and sent their sign-in. Anyone with a problem is marked in the list below the form.`);
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">Paste a list (one person per line: name, email, subjects) or upload an Excel or CSV file with columns <b>Name</b>, <b>Email</b>, <b>Subjects</b>, and optionally <b>ID number</b> and <b>Phone</b>. Separate several subjects with “;”.</p>
      <div className="flex flex-wrap gap-2">
        <label className="btn btn-outline cursor-pointer">Upload Excel or CSV<input type="file" accept=".xlsx,.csv,.txt,text/csv" className="sr-only" onChange={e => { const file = e.target.files?.[0]; if (file) upload(file); e.target.value = ""; }} /></label>
        <button type="button" className="btn btn-ghost" onClick={template}>Download a template</button>
      </div>
      <textarea className="input min-h-28 font-mono text-sm" value={text} onChange={e => setText(e.target.value)} placeholder={"Ada Obi, ada@example.com, Mathematics; Physics\nTunde Bello, tunde@example.com, English"} aria-label="Staff list" />
      <div className="flex justify-end"><button type="button" className="btn btn-outline" disabled={!text.trim()} onClick={() => read(parseGrid(text))}>Check the list</button></div>
      {err && <Alert>{err}</Alert>}
      {rows && (rows.length === 0 ? <Empty>No one found in the list.</Empty> : (
        <>
          <div className="overflow-x-auto rounded-lg border border-slate-200"><table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="p-2">Name</th><th className="p-2">Email</th><th className="p-2">Subjects</th><th className="p-2">Status</th></tr></thead>
            <tbody>{rows.map(r => { const res = results[r.line]; return (
              <tr key={r.line} className="border-t border-slate-100 align-top">
                <td className="p-2">{r.full_name || <i className="text-slate-400">none</i>}</td>
                <td className="p-2">{r.email || <i className="text-slate-400">none</i>}</td>
                <td className="p-2"><div className="flex flex-wrap gap-1">{r.subject_ids.map(id => <Badge key={id}>{name(id)}</Badge>)}{r.unknown.map(u => <Badge key={u} tone="red">{u}?</Badge>)}</div>
                  {r.unknown.length > 0 && <span className="text-xs text-rose-700">Not a subject in the school; it will be left out.</span>}</td>
                <td className="p-2">{res ? <span className={res.ok ? "text-emerald-700" : "text-rose-700"}>{res.text}</span> : r.problem ? <span className="text-rose-700">Line {r.line}: {r.problem}</span> : <span className="text-slate-600">Ready</span>}</td>
              </tr>); })}</tbody>
          </table></div>
          <div className="flex items-center justify-end gap-3">
            {rows.some(r => r.problem) && <span className="text-sm text-slate-500">Lines with a problem are skipped. Fix them and check again.</span>}
            <button type="button" className="btn btn-primary" disabled={busy || !good.length} onClick={inviteAll}>{busy ? `Adding… ${Object.keys(results).length}/${good.length + Object.keys(results).length}` : `Add and invite ${good.length} staff`}</button>
          </div>
        </>
      ))}
    </div>
  );
}

function People({ data, focus, onDone }: { data: Data; focus: string | null; onDone: (ok: boolean, text: string) => void }) {
  const [show, setShow] = useState<Stage | "all">("all");
  const [find, setFind] = useState("");
  const [open, setOpen] = useState<Row | null>(null);
  const [again, setAgain] = useState<Record<string, { method: Method; email: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const subjectName = useMemo(() => new Map(data.subjects.map(s => [s.id, s.name])), [data.subjects]);
  useEffect(() => { if (focus) document.getElementById(`staff-${focus}`)?.scrollIntoView({ block: "center" }); }, [focus]);
  const staged = data.staff.map(s => ({ ...s, stage: stageOf(s) }));
  const count = (st: Stage) => staged.filter(s => s.stage === st).length;
  const list = staged.filter(s => (show === "all" || s.stage === show) && (!find || `${s.full_name} ${s.email ?? ""} ${s.staff_no}`.toLowerCase().includes(find.toLowerCase())));

  async function resend(s: Row) {
    const a = again[s.id] ?? { method: "invite" as Method, email: s.email ?? "" };
    setBusy(s.id);
    const r = await send<{ message: string }>("/api/school/staff-onboarding", { action: "resend", staff_id: s.id, method: a.method, email: a.email || s.email }, "POST", { quiet: true });
    setBusy(null);
    onDone(r.ok, r.ok ? r.data.message : r.error ?? "Please try again.");
  }

  return (
    <section className="card p-5" aria-labelledby="people">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 id="people" className="mr-auto font-semibold">Everyone</h2>
        <input className="input max-w-xs py-1" placeholder="Find someone" value={find} onChange={e => setFind(e.target.value)} aria-label="Find someone" />
      </div>
      <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Show">
        {([["all", `All (${staged.length})`], ["waiting", `🟡 ${STAGE_TEXT.waiting} (${count("waiting")})`], ["needs_classes", `🔵 ${STAGE_TEXT.needs_classes} (${count("needs_classes")})`], ["ready", `🟢 ${STAGE_TEXT.ready} (${count("ready")})`]] as [Stage | "all", string][]).map(([v, label]) => (
          <button key={v} type="button" aria-pressed={show === v} onClick={() => setShow(v)} className={"rounded-full border px-3 py-1 text-sm " + (show === v ? "border-navy bg-navy text-white" : "border-slate-300 bg-white")}>{label}</button>))}
      </div>
      {!list.length ? <Empty>Nobody here.</Empty> : (
        <ul className="divide-y divide-slate-100">
          {list.map(s => {
            const a = again[s.id] ?? { method: "invite" as Method, email: s.email ?? "" };
            return (
              <li key={s.id} id={`staff-${s.id}`} className={"flex flex-wrap items-start gap-3 py-3 " + (focus === s.id ? "rounded-md bg-amber-50 px-2" : "")}>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{s.full_name} <Badge tone={STAGE_TONE[s.stage]}>{STAGE_TEXT[s.stage]}</Badge></p>
                  <p className="text-xs text-slate-500">{s.staff_no}{s.email ? ` · ${s.email}` : " · no email"}{s.role ? ` · ${words(s.role)}` : ""}{s.code ? ` · code ${s.code}` : ""}{s.has_account && s.signed_in === false ? " · sign-in sent, not used yet" : ""}{s.active === false ? " · login disabled" : ""}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {s.subject_ids.map(id => <Badge key={id}>{subjectName.get(id) ?? "?"}</Badge>)}
                    {s.assignments.length > 0 && <span className="text-xs text-slate-600">{s.has_account ? "" : "Waiting for them: "}{s.assignments.length} class{s.assignments.length === 1 ? "" : "es"}</span>}
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {s.stage === "waiting" && <>
                    {!s.email && !s.has_account && <input className="input w-48 py-1 text-sm" type="email" placeholder="Their email" value={a.email} onChange={e => setAgain({ ...again, [s.id]: { ...a, email: e.target.value } })} aria-label={`Email for ${s.full_name}`} />}
                    <select className="input py-1 text-sm" value={a.method} onChange={e => setAgain({ ...again, [s.id]: { ...a, method: e.target.value as Method } })} aria-label={`How ${s.full_name} signs in`}>
                      {/* Their account exists already once a link or password was sent: a code no longer applies. */}
                      {METHODS.filter(m => !s.has_account || m.id !== "code").map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</select>
                    <button className="btn btn-primary px-3 py-1 text-sm" disabled={busy === s.id} onClick={() => resend(s)}>{busy === s.id ? "Sending…" : "Send again"}</button>
                    <button className="btn btn-ghost px-2 py-1 text-sm" onClick={() => setOpen(s)}>Subjects &amp; classes</button>
                  </>}
                  {s.stage === "needs_classes" && <button className="btn btn-primary px-3 py-1 text-sm" onClick={() => setOpen(s)}>Add to classes</button>}
                  {s.stage === "ready" && <button className="btn btn-ghost px-3 py-1 text-sm" onClick={() => setOpen(s)}>Subjects &amp; classes</button>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <ClassesModal data={data} row={open} onClose={() => setOpen(null)} onDone={(ok, t) => { if (ok) setOpen(null); onDone(ok, t); }} />
    </section>
  );
}

/** One place for what someone teaches: their subjects, then their classes. */
function ClassesModal({ data, row, onClose, onDone }: { data: Data; row: Row | null; onClose: () => void; onDone: (ok: boolean, text: string) => void }) {
  const [subjects, setSubjects] = useState<string[]>([]);
  const [classes, setClasses] = useState<Assignment[]>([]);
  const [busy, setBusy] = useState(false);
  // Subjects in their classes count as theirs even if they were not ticked before.
  useEffect(() => { if (row) { setSubjects([...new Set([...row.subject_ids, ...(row.assignments.map(a => a.subject_id).filter(Boolean) as string[])])]); setClasses(row.assignments); } }, [row]);
  const shownSubjects = subjects;
  // Unticking a subject takes its classes off too.
  const pickSubjects = (ids: string[]) => { setSubjects(ids); setClasses(cs => cs.filter(a => a.subject_id === null || ids.includes(a.subject_id))); };
  async function save() {
    if (!row) return;
    setBusy(true);
    const s = await send("/api/school/staff-onboarding", { action: "subjects", staff_id: row.id, subject_ids: shownSubjects }, "POST", { quiet: true });
    const keep = classes.filter(a => a.subject_id === null || shownSubjects.includes(a.subject_id));
    const c = s.ok ? await send<{ message: string }>("/api/school/staff-onboarding", { action: "classes", staff_id: row.id, classes: keep }, "POST", { quiet: true }) : null;
    setBusy(false);
    if (!s.ok) return onDone(false, s.error ?? "Please try again.");
    onDone(Boolean(c?.ok), c?.ok ? `${row.full_name}: ${c.data.message}` : c?.error ?? "Please try again.");
  }
  return (
    <Modal open={Boolean(row)} onClose={onClose} title={row ? `What ${row.full_name} teaches` : ""} wide>
      {row && (
        <div className="space-y-4">
          {!row.has_account && <Alert tone="amber">{row.full_name} has not signed up yet. The classes you choose are put in place the moment they do.</Alert>}
          <div><p className="label">Subjects</p><SubjectTicks subjects={data.subjects} value={shownSubjects} onChange={pickSubjects} /></div>
          <div><p className="label">Classes</p><ClassPicker data={data} subjectIds={shownSubjects} value={classes} onChange={setClasses} /></div>
          <div className="flex justify-end gap-2"><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button></div>
        </div>
      )}
    </Modal>
  );
}
