"use client";
import { useState } from "react";
import { useApi, send, Alert, Empty, Field, Badge, Modal, Loading, fmtDate } from "@/components/ui";
import { ClassPicker, KIND } from "@/components/learning/ContentLibrary";
import QuizGenerator from "@/components/exams/QuizGenerator";

type Opt = { id: string; name: string };
type Step = { id: string; path_id: string; position: number; title: string; kind: string; body: string | null; url: string | null; package_id: string | null; homework_id: string | null;
  question_ids: string[]; pass_pct: number; requires: string[] };
type Detail = { path: { id: string; title: string; description: string | null; subject_id: string | null; class_group_ids: string[]; status: string };
  steps: Step[]; students: { id: string; first_name: string; last_name: string; class_group_id: string }[]; progress: { step_id: string; student_id: string; status: string; score: number | null; attempts: number }[];
  packages: { id: string; title: string; kind: string }[]; homework: { id: string; title: string }[]; mine: boolean };
export const STEP_KIND: Record<string, string> = { text: "Reading", link: "Web link", video: "Video", content: "Interactive content", quiz: "Quiz", homework: "Homework" };

/** Learning paths: ordered steps with prerequisites, published to classes, with each student's progress. */
export default function PathsAdmin({ classes, subjects }: { classes: Opt[]; subjects: Opt[] }) {
  const { data, reload } = useApi<{ items: { id: string; title: string; status: string; class_group_ids: string[]; updated_at: string; subjects: { name: string } | null; learning_path_steps: { count: number }[] }[] }>("/api/learning-paths");
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  if (open) return <PathEditor id={open} classes={classes} subjects={subjects} onBack={() => { setOpen(null); reload(); }} />;
  return (
    <div className="space-y-3 text-sm">
      <div className="flex"><p className="mr-auto text-slate-600">A path is a series of steps (reading, links, videos, interactive content, quizzes, homework). Steps can wait for earlier ones to be finished.</p>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>+ New path</button></div>
      {!data ? <Loading /> : !data.items.length ? <Empty>No learning paths yet.</Empty> : (
        <ul className="grid gap-2 sm:grid-cols-2">{data.items.map(p => (
          <li key={p.id}><button className="card w-full p-3 text-left hover:border-brand-300" onClick={() => setOpen(p.id)}>
            <span className="flex items-center gap-2"><b className="mr-auto">{p.title}</b><Badge tone={p.status === "published" ? "green" : p.status === "draft" ? "amber" : "slate"}>{p.status}</Badge></span>
            <span className="block text-xs text-slate-500">{p.subjects?.name ?? "No subject"} · {p.learning_path_steps?.[0]?.count ?? 0} steps · {p.class_group_ids.map(id => classes.find(c => c.id === id)?.name).filter(Boolean).join(", ") || "no classes yet"} · {fmtDate(p.updated_at)}</span>
          </button></li>))}</ul>
      )}
      <Modal open={creating} onClose={() => setCreating(false)} title="New learning path">
        {creating && <PathForm classes={classes} subjects={subjects} onDone={id => { setCreating(false); reload(); if (id) setOpen(id); }} />}
      </Modal>
    </div>
  );
}

function PathForm({ path, classes, subjects, onDone }: { path?: Detail["path"]; classes: Opt[]; subjects: Opt[]; onDone: (id?: string) => void }) {
  const [f, setF] = useState({ title: path?.title ?? "", description: path?.description ?? "", subject_id: path?.subject_id ?? "", class_group_ids: path?.class_group_ids ?? [], status: path?.status ?? "draft" });
  const [err, setErr] = useState<string | null>(null);
  return (
    <form className="space-y-2 text-sm" onSubmit={async e => {
      e.preventDefault();
      const r = await send<{ id: string }>("/api/learning-paths", { action: "save_path", id: path?.id ?? null, ...f, description: f.description || null, subject_id: f.subject_id || null });
      if (!r.ok) return setErr(r.error);
      onDone(r.data.id);
    }}>
      {err && <Alert>{err}</Alert>}
      <Field label="Title"><input className="input" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} required minLength={2} maxLength={160} /></Field>
      <Field label="What students will learn"><textarea className="input min-h-16" value={f.description} onChange={e => setF({ ...f, description: e.target.value })} maxLength={4000} /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Subject"><select className="input" value={f.subject_id} onChange={e => setF({ ...f, subject_id: e.target.value })}><option value="">—</option>{subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Status"><select className="input" value={f.status} onChange={e => setF({ ...f, status: e.target.value })}><option value="draft">Draft (only staff see it)</option><option value="published">Published to the classes</option><option value="archived">Archived</option></select></Field>
      </div>
      <Field label="Classes"><ClassPicker classes={classes} value={f.class_group_ids} onChange={v => setF({ ...f, class_group_ids: v })} /></Field>
      <button className="btn btn-primary">Save</button>
    </form>
  );
}

function PathEditor({ id, classes, subjects, onBack }: { id: string; classes: Opt[]; subjects: Opt[]; onBack: () => void }) {
  const { data, error, reload } = useApi<Detail>(`/api/learning-paths?id=${id}`, [id]);
  const [step, setStep] = useState<Partial<Step> | null>(null);
  const [editPath, setEditPath] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  const { path, steps } = data;
  const act = async (b: Record<string, unknown>, ok: string) => { const r = await send("/api/learning-paths", b); setMsg({ ok: r.ok, text: r.ok ? ok : r.error ?? "failed" }); if (r.ok) reload(); return r.ok; };
  const move = (i: number, d: number) => { const ids = steps.map(s => s.id); const j = i + d; if (j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j], ids[i]]; void act({ action: "reorder", path_id: path.id, ids }, "Order saved."); };
  const titleOf = (sid: string) => steps.find(s => s.id === sid)?.title ?? "";
  const cell = (stepId: string, studentId: string) => data.progress.find(p => p.step_id === stepId && p.student_id === studentId);
  return (
    <div className="space-y-4 text-sm">
      <button className="text-brand-700 hover:underline" onClick={onBack}>← All paths</button>
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      <section className="card space-y-1 p-4">
        <div className="flex items-center gap-2"><h2 className="mr-auto text-lg font-semibold">{path.title}</h2><Badge tone={path.status === "published" ? "green" : "amber"}>{path.status}</Badge>
          {data.mine && <button className="btn btn-outline px-2 py-1 text-xs" onClick={() => setEditPath(true)}>Edit details</button>}</div>
        {path.description && <p className="text-slate-600">{path.description}</p>}
        <p className="text-xs text-slate-500">Classes: {path.class_group_ids.map(c => classes.find(x => x.id === c)?.name).filter(Boolean).join(", ") || "none yet"}</p>
      </section>
      <section className="card space-y-2 p-4">
        <div className="flex items-center"><h3 className="mr-auto font-semibold">Steps</h3>
          {data.mine && <button className="btn btn-outline px-2 py-1 text-xs" onClick={() => setStep({ kind: "text", title: "", requires: steps.length ? [steps[steps.length - 1].id] : [], pass_pct: 60, question_ids: [] })}>+ Add step</button>}</div>
        {!steps.length ? <Empty>No steps yet.</Empty> : (
          <ol className="divide-y divide-slate-100">{steps.map((s, i) => (
            <li key={s.id} className="flex items-center gap-2 py-2">
              <span className="w-6 text-xs text-slate-500">{i + 1}.</span>
              <div className="flex-1"><b>{s.title}</b> <Badge tone="slate">{STEP_KIND[s.kind]}</Badge>
                {s.kind === "content" && <span className="text-xs text-slate-500"> {data.packages.find(p => p.id === s.package_id)?.title}</span>}
                {s.kind === "homework" && <span className="text-xs text-slate-500"> {data.homework.find(h => h.id === s.homework_id)?.title}</span>}
                {s.kind === "quiz" && <span className="text-xs text-slate-500"> {s.question_ids.length} questions, pass {s.pass_pct}%</span>}
                {s.requires.length > 0 && <span className="block text-xs text-slate-500">After: {s.requires.map(titleOf).join(", ")}</span>}</div>
              {data.mine && <span className="flex gap-1 text-xs"><button onClick={() => move(i, -1)} aria-label="Move up" disabled={!i}>↑</button><button onClick={() => move(i, 1)} aria-label="Move down" disabled={i === steps.length - 1}>↓</button>
                <button className="text-brand-700" onClick={() => setStep(s)}>Edit</button></span>}
            </li>))}</ol>
        )}
      </section>
      {data.students.length > 0 && steps.length > 0 && (
        <section className="card overflow-x-auto p-4">
          <h3 className="mb-2 font-semibold">Progress</h3>
          <table className="text-xs"><thead><tr><th className="p-1 text-left">Student</th>{steps.map((s, i) => <th key={s.id} className="p-1" title={s.title}>{i + 1}</th>)}<th className="p-1">Done</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{data.students.map(st => {
              const done = steps.filter(s => ["done", "passed"].includes(cell(s.id, st.id)?.status ?? "")).length;
              return <tr key={st.id}><td className="whitespace-nowrap p-1">{st.first_name} {st.last_name}</td>{steps.map(s => {
                const c = cell(s.id, st.id);
                return <td key={s.id} className="p-1 text-center" title={c ? `${c.status}${c.score !== null ? ` ${c.score}%` : ""} · ${c.attempts} tries` : "not yet"}>{!c ? "·" : c.status === "failed" ? <span className="text-rose-600">✗</span> : <span className="text-emerald-600">✓</span>}</td>;
              })}<td className="p-1 text-center">{done}/{steps.length}</td></tr>;
            })}</tbody></table>
        </section>
      )}
      <Modal open={editPath} onClose={() => setEditPath(false)} title="Path details">
        {editPath && <PathForm path={path} classes={classes} subjects={subjects} onDone={() => { setEditPath(false); reload(); }} />}
        {editPath && <button className="btn btn-ghost mt-2 text-rose-600" onClick={async () => { if (confirm("Delete this path and everyone's progress on it?") && await act({ action: "delete_path", id: path.id }, "Deleted.")) onBack(); }}>Delete path</button>}
      </Modal>
      <Modal open={Boolean(step)} onClose={() => setStep(null)} title={step?.id ? "Edit step" : "Add a step"} wide>
        {step && <StepForm step={step} path={path} steps={steps} subjects={subjects} onDone={t => { setStep(null); if (t) { setMsg({ ok: true, text: t }); reload(); } }} />}
      </Modal>
    </div>
  );
}

function StepForm({ step, path, steps, subjects, onDone }: { step: Partial<Step>; path: Detail["path"]; steps: Step[]; subjects: Opt[]; onDone: (msg?: string) => void }) {
  const [f, setF] = useState({ title: step.title ?? "", kind: step.kind ?? "text", body: step.body ?? "", url: step.url ?? "", package_id: step.package_id ?? "", homework_id: step.homework_id ?? "",
    question_ids: step.question_ids ?? [], pass_pct: step.pass_pct ?? 60, requires: step.requires ?? [] });
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [drafting, setDrafting] = useState(false);
  const pkgs = useApi<{ items: { id: string; title: string; kind: string }[] }>(f.kind === "content" ? "/api/content" : null, [f.kind]);
  const hws = useApi<{ id: string; title: string; class_group_id: string; class_groups: { name: string } | null }[]>(f.kind === "homework" ? "/api/homework" : null, [f.kind]);
  const bank = useApi<{ questions: { id: string; prompt: string; type: string; topic: string | null }[] }>(f.kind === "quiz" ? `/api/question-bank?limit=50${path.subject_id ? `&subject_id=${path.subject_id}` : ""}${search ? `&search=${encodeURIComponent(search)}` : ""}` : null, [f.kind, search]);
  const chosen = new Set(f.question_ids);
  return (
    <form className="space-y-2 text-sm" onSubmit={async e => {
      e.preventDefault();
      const r = await send("/api/learning-paths", { action: "save_step", id: step.id ?? null, path_id: path.id, title: f.title, kind: f.kind, body: f.body || null, url: f.url || null,
        package_id: f.package_id || null, homework_id: f.homework_id || null, question_ids: f.question_ids, pass_pct: Number(f.pass_pct), requires: f.requires });
      if (!r.ok) return setErr(r.error);
      onDone("Step saved.");
    }}>
      {err && <Alert>{err}</Alert>}
      <div className="grid gap-2 sm:grid-cols-3">
        <Field label="Type"><select className="input" value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })}>{Object.entries(STEP_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <div className="sm:col-span-2"><Field label="Title"><input className="input" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} required maxLength={160} /></Field></div>
      </div>
      <Field label={f.kind === "text" ? "What to read (headings, lists, maths between $…$, code)" : "Instructions for students (optional)"}>
        <textarea className="input min-h-24" value={f.body} onChange={e => setF({ ...f, body: e.target.value })} maxLength={20000} required={f.kind === "text"} /></Field>
      {(f.kind === "link" || f.kind === "video") && <Field label="Link (https)"><input className="input" type="url" value={f.url} onChange={e => setF({ ...f, url: e.target.value })} required placeholder="https://" /></Field>}
      {f.kind === "content" && <Field label="Content"><select className="input" value={f.package_id} onChange={e => setF({ ...f, package_id: e.target.value })} required><option value="">Choose from the content library…</option>
        {(pkgs.data?.items ?? []).map(p => <option key={p.id} value={p.id}>{p.title} ({KIND[p.kind]})</option>)}</select></Field>}
      {f.kind === "homework" && <Field label="Homework" hint="Finished when the student hands it in"><select className="input" value={f.homework_id} onChange={e => setF({ ...f, homework_id: e.target.value })} required><option value="">Choose…</option>
        {(hws.data ?? []).filter(h => !path.class_group_ids.length || path.class_group_ids.includes(h.class_group_id)).map(h => <option key={h.id} value={h.id}>{h.title} ({h.class_groups?.name})</option>)}</select></Field>}
      {(f.kind === "quiz" || f.kind === "content") && <Field label="Pass mark %"><input className="input w-24" type="number" min={0} max={100} value={f.pass_pct} onChange={e => setF({ ...f, pass_pct: Number(e.target.value) })} /></Field>}
      {f.kind === "quiz" && (
        <Field label={`Questions (${f.question_ids.length} chosen; multiple choice, true/false, short answer and number questions are marked straight away)`}>
          <div className="flex gap-2"><input className="input" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search the question bank" aria-label="Search questions" />
            <button type="button" className="btn btn-outline whitespace-nowrap" onClick={() => setDrafting(!drafting)}>{drafting ? "Close drafting" : "Draft new questions"}</button></div>
          {drafting && <div className="mt-2 rounded-lg bg-slate-50 p-3"><QuizGenerator subjects={subjects} defaults={{ subject_id: path.subject_id, topic: f.title }} onSaved={ids => { setF({ ...f, question_ids: [...new Set([...f.question_ids, ...ids])] }); setDrafting(false); bank.reload(); }} /></div>}
          <ul className="mt-1 max-h-48 space-y-1 overflow-y-auto rounded border border-slate-200 p-2">{(bank.data?.questions ?? []).filter(q => !["essay", "code", "file_upload"].includes(q.type)).map(q => (
            <li key={q.id}><label className="flex gap-2"><input type="checkbox" checked={chosen.has(q.id)} onChange={e => setF({ ...f, question_ids: e.target.checked ? [...f.question_ids, q.id] : f.question_ids.filter(x => x !== q.id) })} />
              <span className="line-clamp-2">{q.prompt}{q.topic && <span className="text-xs text-slate-500"> · {q.topic}</span>}</span></label></li>))}
            {bank.error && <li className="text-xs text-rose-600">{bank.error}</li>}</ul>
        </Field>
      )}
      {steps.filter(s => s.id !== step.id).length > 0 && (
        <Field label="Students must finish first">
          <div className="flex flex-wrap gap-x-3 gap-y-1">{steps.filter(s => s.id !== step.id).map(s => (
            <label key={s.id} className="flex items-center gap-1"><input type="checkbox" checked={f.requires.includes(s.id)} onChange={e => setF({ ...f, requires: e.target.checked ? [...f.requires, s.id] : f.requires.filter(x => x !== s.id) })} />{s.title}</label>))}</div>
        </Field>
      )}
      <div className="flex gap-2"><button className="btn btn-primary">Save step</button>
        {step.id && <button type="button" className="btn btn-ghost text-rose-600" onClick={async () => { if (!confirm("Delete this step?")) return; const r = await send("/api/learning-paths", { action: "delete_step", id: step.id }); if (!r.ok) return setErr(r.error); onDone("Step deleted."); }}>Delete step</button>}</div>
    </form>
  );
}
