"use client";
import { useState } from "react";
import { useApi, send, Page, PageHeader, Tabs, Alert, Empty, Modal, Field, Badge, statusTone, fmtDate } from "@/components/ui";

type Note = { id: string; topic: string; week: number | null; status: string; ai_generated: boolean; review_comment: string | null; updated_at: string; author_id: string;
  subjects: { name: string } | null; class_groups: { name: string } | null; author: { full_name: string } | null };

export default function LessonNotesPage() {
  const [tab, setTab] = useState<"mine" | "queue">("mine");
  const mine = useApi<{ items: Note[]; reviewer: boolean; ai: boolean; me: string }>("/api/lesson-notes?mine=1");
  const queue = useApi<{ items: Note[] }>(mine.data?.reviewer ? "/api/lesson-notes?queue=1" : null, [mine.data?.reviewer]);
  const [edit, setEdit] = useState<string | "new" | null>(null);
  const [review, setReview] = useState<string | null>(null);
  const reload = () => { mine.reload(); queue.reload(); };
  return (
    <Page wide>
      <PageHeader eyebrow="Teaching" title="Lesson notes"
        subtitle="Write weekly lesson notes (or draft one with AI in seconds), submit for approval, and keep a complete record for inspections."
        actions={<button className="btn btn-primary" onClick={() => setEdit("new")}>+ New lesson note</button>} />
      {mine.data?.reviewer && <Tabs value={tab} onChange={setTab} tabs={[{ id: "mine", label: "My notes" }, { id: "queue", label: `Awaiting approval${queue.data?.items.length ? ` (${queue.data.items.length})` : ""}` }]} />}
      {mine.error && <Alert>{mine.error}</Alert>}
      <List items={(tab === "queue" ? queue.data?.items : mine.data?.items) ?? []} showAuthor={tab === "queue"} onOpen={id => tab === "queue" ? setReview(id) : setEdit(id)} />
      <Modal open={Boolean(edit)} onClose={() => setEdit(null)} title={edit === "new" ? "New lesson note" : "Lesson note"} wide>
        {edit && <Editor id={edit === "new" ? null : edit} ai={Boolean(mine.data?.ai)} onDone={() => { setEdit(null); reload(); }} />}
      </Modal>
      <Modal open={Boolean(review)} onClose={() => setReview(null)} title="Review lesson note" wide>
        {review && <Review id={review} onDone={() => { setReview(null); reload(); }} />}
      </Modal>
    </Page>
  );
}

function List({ items, showAuthor, onOpen }: { items: Note[]; showAuthor: boolean; onOpen: (id: string) => void }) {
  if (!items.length) return <Empty>Nothing here yet.</Empty>;
  return (
    <div className="card overflow-x-auto"><table className="w-full text-sm">
      <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-2">Topic</th>{showAuthor && <th className="p-2">Teacher</th>}<th className="p-2">Subject / class</th><th className="p-2">Week</th><th className="p-2">Status</th><th className="p-2">Updated</th></tr></thead>
      <tbody>{items.map(n => (
        <tr key={n.id} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50" onClick={() => onOpen(n.id)}>
          <td className="p-2 font-medium">{n.topic} {n.ai_generated && <Badge tone="violet">AI draft</Badge>}{n.status === "returned" && n.review_comment && <div className="text-xs text-rose-600">{n.review_comment}</div>}</td>
          {showAuthor && <td className="p-2">{n.author?.full_name}</td>}
          <td className="p-2">{n.subjects?.name} {n.class_groups?.name}</td><td className="p-2">{n.week ?? "—"}</td>
          <td className="p-2"><Badge tone={statusTone(n.status === "returned" ? "rejected" : n.status)}>{n.status}</Badge></td><td className="p-2 text-xs text-slate-500">{fmtDate(n.updated_at)}</td>
        </tr>))}</tbody></table></div>
  );
}

function Editor({ id, ai, onDone }: { id: string | null; ai: boolean; onDone: () => void }) {
  const { data: existing } = useApi<any>(id ? `/api/lesson-notes?id=${id}` : null, [id]);
  const { data: structure } = useApi<{ class_groups: { id: string; name: string; level: string | null }[]; subjects: { id: string; name: string }[] }>("/api/school/structure");
  const { data: sessions } = useApi<{ id: string; name: string; terms: { id: string; name: string; is_current: boolean }[] }[]>("/api/school/academic");
  const [f, setF] = useState<Record<string, any> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [gen, setGen] = useState({ busy: false, curriculum: "NERDC national curriculum", notes: "", minutes: 40 });
  const cur = f ?? (id ? (existing ? { ...existing } : null) : { topic: "", content: "", subject_id: "", class_group_id: "", term_id: sessions?.flatMap(s => s.terms).find(t => t.is_current)?.id ?? "", week: "" });
  if (!cur) return <p className="text-sm text-slate-500">Loading…</p>;
  const set = (k: string, v: unknown) => setF({ ...cur, [k]: v });
  const locked = cur.status === "approved" || cur.status === "submitted";
  async function save(submit: boolean) {
    const r = await send("/api/lesson-notes", { action: "save", id: id ?? undefined, topic: cur!.topic, content: cur!.content, subject_id: cur!.subject_id || null,
      class_group_id: cur!.class_group_id || null, term_id: cur!.term_id || null, week: cur!.week ? Number(cur!.week) : null, ai_generated: Boolean(cur!.ai_generated), submit });
    if (!r.ok) return setErr(r.error);
    onDone();
  }
  async function draft() {
    const subject = structure?.subjects.find(s => s.id === cur!.subject_id)?.name;
    const group = structure?.class_groups.find(g => g.id === cur!.class_group_id);
    if (!subject || !group || !cur!.topic) return setErr("Choose the subject, class and topic first.");
    setGen({ ...gen, busy: true }); setErr(null);
    const r = await send<{ text: string }>("/api/lesson-notes", { action: "generate", subject, level: group.level || group.name, topic: cur!.topic, week: cur!.week ? Number(cur!.week) : null,
      duration_minutes: gen.minutes, curriculum: gen.curriculum || null, notes: gen.notes || null });
    setGen({ ...gen, busy: false });
    if (!r.ok) return setErr(r.error);
    setF({ ...cur!, content: r.data.text, ai_generated: true });
  }
  return (
    <div className="space-y-3">
      {cur.status === "returned" && cur.review_comment && <Alert tone="amber">Returned for changes: {cur.review_comment}</Alert>}
      {cur.status === "approved" && <Alert tone="green">Approved{cur.review_comment ? `: ${cur.review_comment}` : ""}. Approved notes are locked.</Alert>}
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="sm:col-span-2"><Field label="Topic"><input className="input" disabled={locked} value={cur.topic} onChange={e => set("topic", e.target.value)} /></Field></div>
        <Field label="Subject"><select className="input" disabled={locked} value={cur.subject_id ?? ""} onChange={e => set("subject_id", e.target.value)}><option value="">—</option>{(structure?.subjects ?? []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Class"><select className="input" disabled={locked} value={cur.class_group_id ?? ""} onChange={e => set("class_group_id", e.target.value)}><option value="">—</option>{(structure?.class_groups ?? []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Term"><select className="input" disabled={locked} value={cur.term_id ?? ""} onChange={e => set("term_id", e.target.value)}><option value="">—</option>{(sessions ?? []).flatMap(se => se.terms.map(t => <option key={t.id} value={t.id}>{t.name} {se.name}</option>))}</select></Field>
        <Field label="Week"><input className="input" type="number" min={1} max={20} disabled={locked} value={cur.week ?? ""} onChange={e => set("week", e.target.value)} /></Field>
      </div>
      {ai && !locked && (
        <details className="rounded-lg border border-violet-200 bg-violet-50 p-3">
          <summary className="cursor-pointer text-sm font-semibold text-violet-800">Draft with AI</summary>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <Field label="Curriculum"><input className="input" value={gen.curriculum} onChange={e => setGen({ ...gen, curriculum: e.target.value })} /></Field>
            <Field label="Lesson minutes"><input className="input" type="number" min={10} max={240} value={gen.minutes} onChange={e => setGen({ ...gen, minutes: Number(e.target.value) })} /></Field>
            <Field label="Anything specific?"><input className="input" value={gen.notes} onChange={e => setGen({ ...gen, notes: e.target.value })} placeholder="e.g. include a group activity" /></Field>
          </div>
          <button className="btn btn-primary mt-2" disabled={gen.busy} onClick={draft}>{gen.busy ? "Writing… this can take up to a minute" : "Draft lesson note"}</button>
          <p className="mt-1 text-xs text-violet-800">Always read and adjust the draft before submitting. You are responsible for what you teach.</p>
        </details>
      )}
      <Field label="Lesson note"><textarea className="input h-96 font-mono text-sm" disabled={locked} value={cur.content} onChange={e => set("content", e.target.value)} /></Field>
      {err && <Alert>{err}</Alert>}
      {!locked && <div className="flex justify-end gap-2"><button className="btn btn-ghost border border-slate-200" onClick={() => save(false)}>Save draft</button><button className="btn btn-primary" onClick={() => save(true)}>Submit for approval</button></div>}
      {id && ["draft", "returned"].includes(cur.status) && <button className="btn btn-ghost text-xs text-rose-600" onClick={async () => { if (confirm("Delete this note?")) { await send("/api/lesson-notes", { action: "delete", id }); onDone(); } }}>Delete</button>}
    </div>
  );
}

function Review({ id, onDone }: { id: string; onDone: () => void }) {
  const { data } = useApi<any>(`/api/lesson-notes?id=${id}`, [id]);
  const [comment, setComment] = useState("");
  const [err, setErr] = useState<string | null>(null);
  if (!data) return <p className="text-sm text-slate-500">Loading…</p>;
  const decide = async (decision: string) => { const r = await send("/api/lesson-notes", { action: "review", id, decision, comment: comment || null }); if (!r.ok) return setErr(r.error); onDone(); };
  return (
    <div className="space-y-3">
      <p className="text-sm"><b>{data.topic}</b> · {data.subjects?.name} {data.class_groups?.name} · week {data.week ?? "—"} · by {data.author?.full_name} {data.ai_generated && <Badge tone="violet">AI draft</Badge>}</p>
      <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm">{data.content}</pre>
      <Field label="Comment for the teacher"><textarea className="input h-20" value={comment} onChange={e => setComment(e.target.value)} /></Field>
      {err && <Alert>{err}</Alert>}
      <div className="flex justify-end gap-2"><button className="btn btn-ghost border border-slate-200" onClick={() => decide("returned")}>Return for changes</button><button className="btn btn-primary" onClick={() => decide("approved")}>Approve</button></div>
    </div>
  );
}
