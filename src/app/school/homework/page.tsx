"use client";
import { useState } from "react";
import { useApi, send, Page, PageHeader, Alert, Empty, Modal, Field, Badge, fmtDate, Loading } from "@/components/ui";

type Hw = { id: string; title: string; due_at: string; max_score: number | null; class_groups: { name: string } | null; subjects: { name: string } | null; homework_submissions: { count: number }[] };

export default function HomeworkPage() {
  const { data, error, reload } = useApi<Hw[]>("/api/homework");
  const { data: structure } = useApi<{ class_groups: { id: string; name: string }[]; subjects: { id: string; name: string }[] }>("/api/school/structure");
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<string | null>(null);
  return (
    <Page wide>
      <PageHeader eyebrow="Learning" title="Homework" subtitle="Set homework for a class, see who has submitted, mark with feedback. Parents and students see it in their portals."
        actions={<button className="btn btn-primary" onClick={() => setOpen(true)}>+ Set homework</button>} />
      {error && <Alert>{error}</Alert>}
      {!data?.length ? <Empty>No homework set yet.</Empty> : (
        <div className="card overflow-x-auto"><table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-2">Homework</th><th className="p-2">Class</th><th className="p-2">Due</th><th className="p-2 text-center">Submitted</th><th className="p-2" /></tr></thead>
          <tbody>{data.map(h => (
            <tr key={h.id} className="border-t border-slate-100"><td className="p-2 font-medium">{h.title}<div className="text-xs text-slate-400">{h.subjects?.name}</div></td><td className="p-2">{h.class_groups?.name}</td>
              <td className={"p-2 " + (new Date(h.due_at) < new Date() ? "text-slate-500" : "font-semibold")}>{fmtDate(h.due_at, true)}</td><td className="p-2 text-center">{h.homework_submissions?.[0]?.count ?? 0}</td>
              <td className="p-2 text-right"><button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setView(h.id)}>Open</button></td></tr>))}</tbody></table></div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Set homework" wide>
        <NewHomework groups={structure?.class_groups ?? []} subjects={structure?.subjects ?? []} onDone={() => { setOpen(false); reload(); }} />
      </Modal>
      <Modal open={Boolean(view)} onClose={() => setView(null)} title="Submissions" wide>{view && <Submissions id={view} onChange={reload} />}</Modal>
    </Page>
  );
}

function NewHomework({ groups, subjects, onDone }: { groups: { id: string; name: string }[]; subjects: { id: string; name: string }[]; onDone: () => void }) {
  const [f, setF] = useState({ class_group_id: "", subject_id: "", title: "", instructions: "", attachment_url: "", due: "", max_score: "", allow_late: true });
  const [err, setErr] = useState<string | null>(null);
  return (
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={async e => {
      e.preventDefault();
      const r = await send("/api/homework", { action: "create", class_group_id: f.class_group_id, subject_id: f.subject_id || null, title: f.title, instructions: f.instructions || null,
        attachment_url: f.attachment_url || null, due_at: new Date(f.due).toISOString(), max_score: f.max_score ? Number(f.max_score) : null, allow_late: f.allow_late });
      if (!r.ok) return setErr(r.error);
      onDone();
    }}>
      <Field label="Class"><select className="input" required value={f.class_group_id} onChange={e => setF({ ...f, class_group_id: e.target.value })}><option value="">—</option>{groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>
      <Field label="Subject"><select className="input" value={f.subject_id} onChange={e => setF({ ...f, subject_id: e.target.value })}><option value="">—</option>{subjects.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>
      <div className="sm:col-span-2"><Field label="Title"><input className="input" required value={f.title} onChange={e => setF({ ...f, title: e.target.value })} /></Field></div>
      <div className="sm:col-span-2"><Field label="Instructions"><textarea className="input h-28" value={f.instructions} onChange={e => setF({ ...f, instructions: e.target.value })} /></Field></div>
      <Field label="Attachment link (optional)"><input className="input" type="url" value={f.attachment_url} onChange={e => setF({ ...f, attachment_url: e.target.value })} /></Field>
      <Field label="Due"><input className="input" type="datetime-local" required value={f.due} onChange={e => setF({ ...f, due: e.target.value })} /></Field>
      <Field label="Marks out of (optional)"><input className="input" type="number" min={0} value={f.max_score} onChange={e => setF({ ...f, max_score: e.target.value })} /></Field>
      <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={f.allow_late} onChange={e => setF({ ...f, allow_late: e.target.checked })} /> Accept late submissions</label>
      {err && <div className="sm:col-span-2"><Alert>{err}</Alert></div>}
      <div className="flex justify-end sm:col-span-2"><button className="btn btn-primary">Set homework</button></div>
    </form>
  );
}

function Submissions({ id, onChange }: { id: string; onChange: () => void }) {
  const { data, reload } = useApi<{ homework: any; students: { id: string; name: string; admission_no: string; submission: any }[] }>(`/api/homework?id=${id}`, [id]);
  const [marks, setMarks] = useState<Record<string, { score: string; feedback: string }>>({});
  if (!data) return <Loading />;
  const done = data.students.filter(s => s.submission).length;
  return (
    <div className="space-y-3 text-sm">
      <p><b>{data.homework.title}</b> · {data.homework.class_groups?.name} · due {fmtDate(data.homework.due_at, true)} · {done}/{data.students.length} submitted</p>
      {data.homework.instructions && <p className="whitespace-pre-wrap rounded bg-slate-50 p-2">{data.homework.instructions}</p>}
      <ul className="divide-y divide-slate-100">
        {data.students.map(s => (
          <li key={s.id} className="py-2">
            <div className="flex items-center justify-between"><span className="font-medium">{s.name}</span>
              {s.submission ? <span className="flex gap-1">{s.submission.late && <Badge tone="amber">late</Badge>}{s.submission.marked_at ? <Badge tone="green">marked {s.submission.score ?? ""}</Badge> : <Badge tone="blue">submitted</Badge>}</span> : <Badge tone="red">missing</Badge>}</div>
            {s.submission && (
              <div className="mt-1 space-y-1">
                <p className="whitespace-pre-wrap rounded bg-slate-50 p-2 text-xs">{s.submission.body}</p>
                <div className="flex gap-2">
                  <input className="input w-24 py-1" type="number" min={0} placeholder="Score" defaultValue={s.submission.score ?? ""} onChange={e => setMarks({ ...marks, [s.submission.id]: { ...(marks[s.submission.id] ?? { feedback: s.submission.feedback ?? "" }), score: e.target.value } })} aria-label="Score" />
                  <input className="input py-1" placeholder="Feedback" defaultValue={s.submission.feedback ?? ""} onChange={e => setMarks({ ...marks, [s.submission.id]: { ...(marks[s.submission.id] ?? { score: String(s.submission.score ?? "") }), feedback: e.target.value } })} aria-label="Feedback" />
                  <button className="btn btn-primary px-3 py-1 text-xs" onClick={async () => { const m = marks[s.submission.id] ?? { score: String(s.submission.score ?? ""), feedback: s.submission.feedback ?? "" };
                    await send("/api/homework", { action: "mark", submission_id: s.submission.id, score: m.score ? Number(m.score) : null, feedback: m.feedback || null }); reload(); onChange(); }}>Save</button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
      <button className="btn btn-ghost text-xs text-rose-600" onClick={async () => { if (confirm("Delete this homework and all submissions?")) { await send("/api/homework", { action: "delete", id }); onChange(); } }}>Delete homework</button>
    </div>
  );
}
