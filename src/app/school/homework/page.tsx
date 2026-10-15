"use client";
import { useEffect, useState } from "react";
import { useApi, send, Page, PageHeader, Alert, Empty, Modal, Field, Badge, Tabs, fmtDate, Loading } from "@/components/ui";
import RichText from "@/components/content/RichText";
import MarkSubmission, { type Submission } from "@/components/homework/MarkSubmission";
import Badges from "@/components/homework/Badges";

type Hw = { id: string; title: string; due_at: string; max_score: number | null; group_ids: string[]; class_groups: { name: string } | null; subjects: { name: string } | null; homework_submissions: { count: number }[] };
type Structure = { class_groups: { id: string; name: string }[]; subjects: { id: string; name: string }[] };

export default function HomeworkPage() {
  const { data, error, reload } = useApi<Hw[]>("/api/homework");
  const { data: structure } = useApi<Structure>("/api/school/structure");
  const { data: providers } = useApi<{ drafting: boolean }>("/api/homework/capabilities");
  const [tab, setTab] = useState<"homework" | "groups" | "badges">("homework");
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<string | null>(null);
  return (
    <Page wide>
      <PageHeader eyebrow="Learning" title="Homework" subtitle="Set homework for a class or for groups within it, take answers and files, comment on the work, record spoken feedback, and mark with any late penalty applied."
        actions={<button className="btn btn-primary" onClick={() => setOpen(true)}>+ Set homework</button>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "homework", label: "Homework" }, { id: "groups", label: "Learning groups" }, { id: "badges", label: "Badges & points" }]} />
      {error && <Alert>{error}</Alert>}
      {tab === "badges" ? <Badges classes={structure?.class_groups ?? []} /> : tab === "groups" ? <Groups classes={structure?.class_groups ?? []} /> : !data?.length ? <Empty>No homework set yet.</Empty> : (
        <div className="card overflow-x-auto"><table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-2">Homework</th><th className="p-2">Class</th><th className="p-2">Due</th><th className="p-2 text-center">Handed in</th><th className="p-2" /></tr></thead>
          <tbody>{data.map(h => (
            <tr key={h.id} className="border-t border-slate-100"><td className="p-2 font-medium">{h.title}<div className="text-xs text-slate-400">{h.subjects?.name}</div></td>
              <td className="p-2">{h.class_groups?.name}{h.group_ids?.length ? <Badge tone="violet">groups</Badge> : null}</td>
              <td className={"p-2 " + (new Date(h.due_at) < new Date() ? "text-slate-500" : "font-semibold")}>{fmtDate(h.due_at, true)}</td><td className="p-2 text-center">{h.homework_submissions?.[0]?.count ?? 0}</td>
              <td className="p-2 text-right"><button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setView(h.id)}>Open</button></td></tr>))}</tbody></table></div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Set homework" wide>
        <NewHomework structure={structure ?? { class_groups: [], subjects: [] }} onDone={() => { setOpen(false); reload(); }} />
      </Modal>
      <Modal open={Boolean(view)} onClose={() => setView(null)} title="Submissions" wide>{view && <Submissions id={view} canDraft={Boolean(providers?.drafting)} onChange={reload} />}</Modal>
    </Page>
  );
}

function NewHomework({ structure, onDone }: { structure: Structure; onDone: () => void }) {
  const [f, setF] = useState({ class_group_id: "", subject_id: "", title: "", instructions: "", attachment_url: "", due: "", max_score: "", allow_late: true,
    late_penalty_pct: "0", late_penalty_max: "50", allow_resubmit: false, max_attempts: "2", accept_files: true, check_originality: true, group_ids: [] as string[] });
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  useEffect(() => {
    if (!f.class_group_id) { setGroups([]); return; }
    fetch(`/api/learning-groups?class_group_id=${f.class_group_id}`).then(r => r.json()).then(j => setGroups(j.groups ?? [])).catch(() => setGroups([]));
  }, [f.class_group_id]);
  return (
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={async e => {
      e.preventDefault();
      const r = await send("/api/homework", { action: "create", class_group_id: f.class_group_id, subject_id: f.subject_id || null, title: f.title, instructions: f.instructions || null,
        attachment_url: f.attachment_url || null, due_at: new Date(f.due).toISOString(), max_score: f.max_score ? Number(f.max_score) : null, allow_late: f.allow_late,
        late_penalty_pct: f.allow_late ? Number(f.late_penalty_pct) || 0 : 0, late_penalty_max: Number(f.late_penalty_max) || 100, allow_resubmit: f.allow_resubmit,
        max_attempts: f.allow_resubmit ? Number(f.max_attempts) || 2 : 1, accept_files: f.accept_files, check_originality: f.check_originality, group_ids: f.group_ids });
      if (!r.ok) return setErr(r.error);
      onDone();
    }}>
      <Field label="Class"><select className="input" required value={f.class_group_id} onChange={e => setF({ ...f, class_group_id: e.target.value, group_ids: [] })}><option value="">—</option>{structure.class_groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>
      <Field label="Subject"><select className="input" value={f.subject_id} onChange={e => setF({ ...f, subject_id: e.target.value })}><option value="">—</option>{structure.subjects.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>
      {groups.length > 0 && (
        <div className="sm:col-span-2"><span className="label">For (differentiated work)</span>
          <div className="flex flex-wrap gap-1">
            <button type="button" aria-pressed={!f.group_ids.length} onClick={() => setF({ ...f, group_ids: [] })} className={"rounded-full border px-2 py-0.5 text-xs " + (!f.group_ids.length ? "border-brand-600 bg-brand-50" : "border-slate-300")}>Whole class</button>
            {groups.map(g => { const on = f.group_ids.includes(g.id); return <button type="button" key={g.id} aria-pressed={on} onClick={() => setF({ ...f, group_ids: on ? f.group_ids.filter(x => x !== g.id) : [...f.group_ids, g.id] })} className={"rounded-full border px-2 py-0.5 text-xs " + (on ? "border-brand-600 bg-brand-50" : "border-slate-300")}>{g.name}</button>; })}
          </div></div>
      )}
      <div className="sm:col-span-2"><Field label="Title"><input className="input" required value={f.title} onChange={e => setF({ ...f, title: e.target.value })} /></Field></div>
      <div className="sm:col-span-2"><Field label="Instructions" hint={String.raw`Formatting: **bold**, - lists. Maths: $$\frac{1}{2}$$ or \(x^2\). Code: three backticks and the language.`}>
        <textarea className="input h-28 font-mono text-xs" value={f.instructions} onChange={e => setF({ ...f, instructions: e.target.value })} />
        <button type="button" className="mt-1 text-xs text-brand-700" onClick={() => setPreview(!preview)}>{preview ? "Hide preview" : "Preview"}</button>
        {preview && <div className="mt-1 rounded border border-slate-200 p-2"><RichText text={f.instructions} /></div>}
      </Field></div>
      <Field label="Attachment link (optional)"><input className="input" type="url" value={f.attachment_url} onChange={e => setF({ ...f, attachment_url: e.target.value })} /></Field>
      <Field label="Due"><input className="input" type="datetime-local" required value={f.due} onChange={e => setF({ ...f, due: e.target.value })} /></Field>
      <Field label="Marks out of (optional)"><input className="input" type="number" min={0} value={f.max_score} onChange={e => setF({ ...f, max_score: e.target.value })} /></Field>
      <div className="space-y-1 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.allow_late} onChange={e => setF({ ...f, allow_late: e.target.checked })} /> Accept late work</label>
        {f.allow_late && <label className="flex items-center gap-1 text-xs">Lose <input className="input w-16 py-0.5" type="number" min={0} max={100} value={f.late_penalty_pct} onChange={e => setF({ ...f, late_penalty_pct: e.target.value })} />% a day, up to <input className="input w-16 py-0.5" type="number" min={0} max={100} value={f.late_penalty_max} onChange={e => setF({ ...f, late_penalty_max: e.target.value })} />%</label>}
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.allow_resubmit} onChange={e => setF({ ...f, allow_resubmit: e.target.checked })} /> Students may hand in again
          {f.allow_resubmit && <span className="flex items-center gap-1 text-xs">(up to <input className="input w-14 py-0.5" type="number" min={2} max={10} value={f.max_attempts} onChange={e => setF({ ...f, max_attempts: e.target.value })} /> tries)</span>}</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.accept_files} onChange={e => setF({ ...f, accept_files: e.target.checked })} /> Students can attach files (photos, PDFs, recordings)</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.check_originality} onChange={e => setF({ ...f, check_originality: e.target.checked })} /> Check written answers for copying</label>
      </div>
      {err && <div className="sm:col-span-2"><Alert>{err}</Alert></div>}
      <div className="flex justify-end sm:col-span-2"><button className="btn btn-primary">Set homework</button></div>
    </form>
  );
}

function Submissions({ id, canDraft, onChange }: { id: string; canDraft: boolean; onChange: () => void }) {
  const { data, reload } = useApi<{ homework: any; groups: { id: string; name: string }[]; students: { id: string; name: string; admission_no: string; submission: Submission | null }[] }>(`/api/homework?id=${id}`, [id]);
  const [sel, setSel] = useState<string | null>(null);
  if (!data) return <Loading />;
  const done = data.students.filter(s => s.submission).length;
  const names = Object.fromEntries(data.students.map(s => [s.id, s.name]));
  const cur = data.students.find(s => s.id === sel);
  return (
    <div className="space-y-3 text-sm">
      <p><b>{data.homework.title}</b> · {data.homework.class_groups?.name}{data.homework.group_ids?.length ? ` (${data.groups.filter(g => data.homework.group_ids.includes(g.id)).map(g => g.name).join(", ")})` : ""} · due {fmtDate(data.homework.due_at, true)} · {done}/{data.students.length} handed in</p>
      {data.homework.instructions && <div className="rounded bg-slate-50 p-2"><RichText text={data.homework.instructions} /></div>}
      <div className="grid gap-3 lg:grid-cols-[16rem,1fr]">
        <ul className="max-h-[70vh] divide-y divide-slate-100 overflow-y-auto rounded border border-slate-200">{data.students.map(s => (
          <li key={s.id}><button className={"flex w-full items-center justify-between gap-1 p-2 text-left " + (sel === s.id ? "bg-brand-50" : "hover:bg-slate-50")} onClick={() => setSel(s.id)} disabled={!s.submission}>
            <span className="truncate">{s.name}</span>
            {!s.submission ? <Badge tone="red">missing</Badge> : s.submission.status === "marked" ? <Badge tone="green">{s.submission.score ?? "marked"}</Badge>
              : s.submission.status === "returned" ? <Badge tone="amber">sent back</Badge> : <span className="flex gap-1">{s.submission.late && <Badge tone="amber">late</Badge>}{(s.submission.originality?.similarity ?? 0) >= 0.15 && <Badge tone="red">!</Badge>}<Badge tone="blue">new</Badge></span>}
          </button></li>
        ))}</ul>
        <div>{cur?.submission ? <MarkSubmission key={cur.id} sub={cur.submission} maxScore={data.homework.max_score} names={names} canDraft={canDraft} onSaved={() => { reload(); onChange(); }} />
          : <Empty>Choose a student who has handed in.</Empty>}</div>
      </div>
      <button className="btn btn-ghost text-xs text-rose-600" onClick={async () => { if (confirm("Delete this homework and all submissions?")) { await send("/api/homework", { action: "delete", id }); onChange(); } }}>Delete homework</button>
    </div>
  );
}

function Groups({ classes }: { classes: { id: string; name: string }[] }) {
  const [cls, setCls] = useState("");
  const { data, reload } = useApi<{ groups: { id: string; name: string; kind: string; members: string[] }[]; students: { id: string; name: string }[] }>(cls ? `/api/learning-groups?class_group_id=${cls}` : null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState("support");
  const [msg, setMsg] = useState<string | null>(null);
  const act = async (b: Record<string, unknown>, ok: string) => { const r = await send("/api/learning-groups", b); setMsg(r.ok ? ok : r.error); if (r.ok) reload(); };
  return (
    <div className="space-y-3 text-sm">
      <p className="text-slate-600">Groups let you set different homework for children who need more support or more challenge. Only the children in a group see its homework.</p>
      <select className="input w-auto" value={cls} onChange={e => setCls(e.target.value)} aria-label="Class"><option value="">Choose a class</option>{classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      {msg && <p className="text-xs text-slate-600" role="status">{msg}</p>}
      {data && (
        <>
          <form className="flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); act({ action: "save", class_group_id: cls, name, kind }, "Group added."); setName(""); }}>
            <input className="input w-48" value={name} onChange={e => setName(e.target.value)} placeholder="Group name" required aria-label="Group name" />
            <select className="input w-auto" value={kind} onChange={e => setKind(e.target.value)} aria-label="Kind"><option value="support">Support</option><option value="core">Core</option><option value="extension">Extension</option><option value="custom">Other</option></select>
            <button className="btn btn-outline">Add group</button>
          </form>
          <div className="grid gap-3 md:grid-cols-2">{data.groups.map(g => (
            <section key={g.id} className="card p-3">
              <p className="mb-1 flex items-center gap-2"><b className="flex-1">{g.name}</b><Badge>{g.kind}</Badge><button className="text-xs text-rose-600" onClick={() => confirm(`Delete ${g.name}?`) && act({ action: "delete", id: g.id }, "Deleted.")}>Delete</button></p>
              <div className="flex flex-wrap gap-1">{data.students.map(s => { const on = g.members.includes(s.id); return (
                <button key={s.id} aria-pressed={on} onClick={() => act({ action: "members", id: g.id, student_ids: on ? g.members.filter(x => x !== s.id) : [...g.members, s.id] }, "Saved.")}
                  className={"rounded-full border px-2 py-0.5 text-xs " + (on ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-300 text-slate-500")}>{s.name}</button>); })}</div>
            </section>
          ))}</div>
        </>
      )}
    </div>
  );
}
