"use client";
import { useState } from "react";
import { useApi, send, Alert, Empty, Field, Badge, Modal, fmtDate } from "@/components/ui";
import ContentPlayer from "@/components/content/ContentPlayer";

type Opt = { id: string; name: string };
type Pkg = { id: string; title: string; description: string | null; kind: string; subject_id: string | null; level: string | null; size_bytes: number; mastery_score: number | null;
  class_group_ids: string[]; created_by: string; created_at: string; subjects: { name: string } | null };
export const KIND: Record<string, string> = { scorm12: "SCORM 1.2", scorm2004: "SCORM 2004", xapi: "xAPI", h5p: "H5P", html: "Web page" };
const mb = (b: number) => `${(b / 1024 / 1024).toFixed(b > 10 * 1024 * 1024 ? 0 : 1)} MB`;
const STATUS: Record<string, string> = { not_attempted: "Not started", incomplete: "In progress", completed: "Completed", passed: "Passed", failed: "Not passed yet" };

function ClassPicker({ classes, value, onChange }: { classes: Opt[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex max-h-28 flex-wrap gap-x-3 gap-y-1 overflow-y-auto rounded border border-slate-200 p-2">
      {classes.map(c => <label key={c.id} className="flex items-center gap-1"><input type="checkbox" checked={value.includes(c.id)} onChange={e => onChange(e.target.checked ? [...value, c.id] : value.filter(x => x !== c.id))} />{c.name}</label>)}
    </div>
  );
}
export { ClassPicker };

/** Upload SCORM, xAPI, H5P or HTML packages, choose which classes can open them, and see who has done them. */
export default function ContentLibrary({ classes, subjects }: { classes: Opt[]; subjects: Opt[] }) {
  const { data, reload } = useApi<{ items: Pkg[]; me: string; limits: { zipMb: number } }>("/api/content");
  const [up, setUp] = useState({ title: "", subject_id: "", level: "", class_group_ids: [] as string[], file: null as File | null });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [play, setPlay] = useState<string | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const [edit, setEdit] = useState<Pkg | null>(null);
  const className = (id: string) => classes.find(c => c.id === id)?.name ?? "";

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!up.file) return;
    setBusy(true); setMsg(null);
    const fd = new FormData();
    fd.append("file", up.file);
    fd.append("meta", JSON.stringify({ title: up.title || null, subject_id: up.subject_id || null, level: up.level || null, class_group_ids: up.class_group_ids }));
    const r = await fetch("/api/content", { method: "POST", body: fd }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { error: "no connection" };
    setBusy(false);
    if (!r?.ok) return setMsg({ ok: false, text: j.error ?? "upload failed" });
    setMsg({ ok: true, text: `Added (${KIND[j.kind]}, ${j.files} files).` });
    setUp({ title: "", subject_id: up.subject_id, level: up.level, class_group_ids: up.class_group_ids, file: null });
    (e.target as HTMLFormElement).reset();
    reload();
  }

  return (
    <div className="space-y-4 text-sm">
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      <form className="card grid gap-2 p-4 sm:grid-cols-4" onSubmit={upload}>
        <h2 className="font-semibold sm:col-span-4">Add content</h2>
        <p className="text-xs text-slate-500 sm:col-span-4">A SCORM 1.2 or 2004 package, an xAPI (Tin Can) package, an H5P file, or a zipped web page, up to {data?.limits.zipMb ?? 80} MB. Progress and scores are recorded for each student.</p>
        <div className="sm:col-span-2"><Field label="File (.zip or .h5p)"><input className="input" type="file" accept=".zip,.h5p,application/zip" required onChange={e => setUp({ ...up, file: e.target.files?.[0] ?? null })} /></Field></div>
        <div className="sm:col-span-2"><Field label="Title" hint="Leave blank to use the package's own title"><input className="input" value={up.title} onChange={e => setUp({ ...up, title: e.target.value })} maxLength={160} /></Field></div>
        <Field label="Subject"><select className="input" value={up.subject_id} onChange={e => setUp({ ...up, subject_id: e.target.value })}><option value="">—</option>{subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Level"><input className="input" value={up.level} onChange={e => setUp({ ...up, level: e.target.value })} maxLength={40} /></Field>
        <div className="sm:col-span-2"><Field label="Classes that can open it on its own" hint="Or add it to a learning path"><ClassPicker classes={classes} value={up.class_group_ids} onChange={v => setUp({ ...up, class_group_ids: v })} /></Field></div>
        <div className="sm:col-span-4"><button className="btn btn-primary" disabled={busy}>{busy ? "Unpacking and checking… (large packages take a minute)" : "Upload"}</button></div>
      </form>

      {!data ? null : !data.items.length ? <Empty>No content yet.</Empty> : (
        <div className="card overflow-x-auto"><table className="w-full">
          <thead className="bg-slate-50 text-left text-[13px] text-slate-500"><tr><th className="p-2">Title</th><th className="p-2">Type</th><th className="p-2">Subject</th><th className="p-2">Classes</th><th className="p-2">Size</th><th className="p-2" /></tr></thead>
          <tbody>{data.items.map(p => (
            <tr key={p.id} className="border-t border-slate-100">
              <td className="p-2 font-medium">{p.title}<span className="block text-xs font-normal text-slate-500">added {fmtDate(p.created_at)}</span></td>
              <td className="p-2"><Badge tone="blue">{KIND[p.kind]}</Badge></td>
              <td className="p-2">{p.subjects?.name ?? "—"}{p.level ? ` · ${p.level}` : ""}</td>
              <td className="p-2 text-xs">{p.class_group_ids.map(className).filter(Boolean).join(", ") || <span className="text-slate-400">paths only</span>}</td>
              <td className="p-2 text-xs">{mb(p.size_bytes)}</td>
              <td className="whitespace-nowrap p-2 text-right text-xs">
                <button className="text-brand-700" onClick={() => setPlay(p.id)}>Preview</button> · <button className="text-brand-700" onClick={() => setReport(p.id)}>Results</button>
                {(p.created_by === data.me) && <> · <button className="text-brand-700" onClick={() => setEdit(p)}>Edit</button></>}
              </td>
            </tr>))}</tbody></table></div>
      )}
      <Modal open={Boolean(play)} onClose={() => setPlay(null)} title="Preview" wide>{play && <ContentPlayer packageId={play} onClose={() => setPlay(null)} />}</Modal>
      <Modal open={Boolean(report)} onClose={() => setReport(null)} title="Results" wide>{report && <Report id={report} classes={classes} />}</Modal>
      <Modal open={Boolean(edit)} onClose={() => setEdit(null)} title="Edit content">
        {edit && <EditPkg pkg={edit} classes={classes} subjects={subjects} onDone={t => { setEdit(null); if (t) { setMsg({ ok: true, text: t }); reload(); } }} />}
      </Modal>
    </div>
  );
}

function EditPkg({ pkg, classes, subjects, onDone }: { pkg: Pkg; classes: Opt[]; subjects: Opt[]; onDone: (msg?: string) => void }) {
  const [f, setF] = useState({ title: pkg.title, description: pkg.description ?? "", subject_id: pkg.subject_id ?? "", level: pkg.level ?? "", class_group_ids: pkg.class_group_ids, mastery: pkg.mastery_score?.toString() ?? "" });
  const [err, setErr] = useState<string | null>(null);
  return (
    <form className="space-y-2 text-sm" onSubmit={async e => {
      e.preventDefault();
      const r = await send("/api/content", { action: "update", id: pkg.id, title: f.title, description: f.description || null, subject_id: f.subject_id || null, level: f.level || null,
        class_group_ids: f.class_group_ids, mastery_score: f.mastery === "" ? null : Number(f.mastery) });
      if (!r.ok) return setErr(r.error);
      onDone("Saved.");
    }}>
      {err && <Alert>{err}</Alert>}
      <Field label="Title"><input className="input" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} required minLength={2} maxLength={160} /></Field>
      <Field label="Description"><textarea className="input min-h-16" value={f.description} onChange={e => setF({ ...f, description: e.target.value })} maxLength={2000} /></Field>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Subject"><select className="input" value={f.subject_id} onChange={e => setF({ ...f, subject_id: e.target.value })}><option value="">—</option>{subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Level"><input className="input" value={f.level} onChange={e => setF({ ...f, level: e.target.value })} maxLength={40} /></Field>
        <Field label="Pass mark %"><input className="input" type="number" min={0} max={100} value={f.mastery} onChange={e => setF({ ...f, mastery: e.target.value })} /></Field>
      </div>
      <Field label="Classes that can open it"><ClassPicker classes={classes} value={f.class_group_ids} onChange={v => setF({ ...f, class_group_ids: v })} /></Field>
      <div className="flex gap-2"><button className="btn btn-primary">Save</button>
        <button type="button" className="btn btn-ghost text-rose-600" onClick={async () => { if (!confirm("Delete this content and everyone's progress on it?")) return; const r = await send("/api/content", { action: "delete", id: pkg.id }); if (!r.ok) return setErr(r.error); onDone("Deleted."); }}>Delete</button></div>
    </form>
  );
}

function Report({ id, classes }: { id: string; classes: Opt[] }) {
  const { data } = useApi<{ package: { title: string; mastery_score: number | null }; attempts: { status: string; score: number | null; time_seconds: number; launches: number; updated_at: string; students: { first_name: string; last_name: string; class_group_id: string } | null }[] }>(`/api/content?id=${id}`);
  if (!data) return null;
  const done = data.attempts.filter(a => a.status === "completed" || a.status === "passed").length;
  return (
    <div className="space-y-2 text-sm">
      <p><b>{data.package.title}</b>: {data.attempts.length} started, {done} finished{data.package.mastery_score !== null ? ` · pass mark ${data.package.mastery_score}%` : ""}</p>
      {!data.attempts.length ? <Empty>No student has opened it yet.</Empty> : (
        <table className="w-full text-xs"><thead className="text-left text-slate-500"><tr><th className="p-1">Student</th><th className="p-1">Class</th><th className="p-1">Status</th><th className="p-1">Score</th><th className="p-1">Time</th><th className="p-1">Last opened</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{data.attempts.map((a, i) => (
            <tr key={i}><td className="p-1">{a.students ? `${a.students.first_name} ${a.students.last_name}` : "—"}</td><td className="p-1">{classes.find(c => c.id === a.students?.class_group_id)?.name ?? ""}</td>
              <td className="p-1"><Badge tone={a.status === "passed" || a.status === "completed" ? "green" : a.status === "failed" ? "red" : "slate"}>{STATUS[a.status]}</Badge></td>
              <td className="p-1">{a.score !== null ? `${a.score}%` : "—"}</td><td className="p-1">{Math.round(a.time_seconds / 60)} min</td><td className="p-1">{fmtDate(a.updated_at, true)}</td></tr>))}</tbody></table>
      )}
    </div>
  );
}
