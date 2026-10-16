"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useApi, send, Page, PageHeader, Alert, Empty, Modal, Field, Badge, statusTone, fmtDate } from "@/components/ui";

type Exam = {
  id: string; title: string; status: string; duration_minutes: number; opens_at: string | null; closes_at: string | null; access_code: string;
  results_released: boolean; settings: { require_seb?: boolean }; class_groups: { name: string } | null; subjects: { name: string } | null;
  exam_questions: { count: number }[]; exam_attempts: { count: number }[];
};

export default function ExamsPage() {
  const { data, error } = useApi<Exam[]>("/api/exams");
  const { data: structure } = useApi<{ class_groups: { id: string; name: string }[]; subjects: { id: string; name: string }[] }>("/api/school/structure");
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ title: "", class_group_id: "", subject_id: "", duration_minutes: "60" });
  const [err, setErr] = useState<string | null>(null);
  const [mock, setMock] = useState(false);
  const router = useRouter();

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const r = await send<{ id: string }>("/api/exams", { title: f.title, class_group_id: f.class_group_id || null, subject_id: f.subject_id || null, duration_minutes: Number(f.duration_minutes) });
    if (!r.ok) return setErr(r.error);
    router.push(`/exams/${r.data.id}`);
  }

  return (
    <Page wide>
      <PageHeader eyebrow="Assessment" title="Secure exams"
        subtitle="Fourteen question types, a shared question bank, mock papers in WAEC, NECO, JAMB, BECE and IGCSE format, automatic marking, live proctoring, Safe Exam Browser support, and one click to push scores into report cards."
        actions={<>
          <Link href="/exams/bank" className="btn btn-ghost">Question bank</Link>
          <button className="btn btn-outline" onClick={() => setMock(true)}>New mock exam</button>
          <button className="btn btn-primary" onClick={() => setOpen(true)}>+ New exam</button>
        </>} />
      {error && <Alert>{error}</Alert>}
      {!data?.length ? <Empty>No exams yet.</Empty> : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-[13px] text-slate-500"><tr><th className="p-3">Exam</th><th className="p-3">Class</th><th className="p-3">Window</th><th className="p-3">Code</th><th className="p-3 text-center">Questions</th><th className="p-3 text-center">Attempts</th><th className="p-3">Status</th></tr></thead>
            <tbody>
              {data.map(x => (
                <tr key={x.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="p-3"><Link href={`/exams/${x.id}`} className="font-semibold text-brand-700 hover:underline">{x.title}</Link><div className="text-xs text-slate-500">{x.subjects?.name ?? ""} · {x.duration_minutes} min{x.settings?.require_seb ? " · Safe Exam Browser" : ""}</div></td>
                  <td className="p-3">{x.class_groups?.name ?? "All"}</td>
                  <td className="p-3 text-xs">{x.opens_at ? fmtDate(x.opens_at, true) : "any time"}<br />{x.closes_at ? `to ${fmtDate(x.closes_at, true)}` : ""}</td>
                  <td className="p-3 font-mono">{x.access_code}</td>
                  <td className="p-3 text-center">{x.exam_questions?.[0]?.count ?? 0}</td>
                  <td className="p-3 text-center">{x.exam_attempts?.[0]?.count ?? 0}</td>
                  <td className="p-3"><Badge tone={statusTone(x.status)}>{x.status}</Badge> {x.results_released && <Badge tone="violet">released</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={mock} onClose={() => setMock(false)} title="New mock exam" wide>
        {mock && <MockForm structure={structure} onCreated={id => router.push(`/exams/${id}`)} />}
      </Modal>
      <Modal open={open} onClose={() => setOpen(false)} title="New exam">
        <form onSubmit={create} className="space-y-3">
          <Field label="Title"><input className="input" required value={f.title} onChange={e => setF({ ...f, title: e.target.value })} placeholder="JSS2 Mathematics: First term examination" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Class"><select className="input" value={f.class_group_id} onChange={e => setF({ ...f, class_group_id: e.target.value })}><option value="">All students</option>{(structure?.class_groups ?? []).map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>
            <Field label="Subject"><select className="input" value={f.subject_id} onChange={e => setF({ ...f, subject_id: e.target.value })}><option value="">—</option>{(structure?.subjects ?? []).map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>
          </div>
          <Field label="Duration (minutes)"><input className="input" type="number" min={1} max={600} value={f.duration_minutes} onChange={e => setF({ ...f, duration_minutes: e.target.value })} /></Field>
          {err && <Alert>{err}</Alert>}
          <div className="flex justify-end gap-2"><button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn-primary">Create and add questions</button></div>
        </form>
      </Modal>
    </Page>
  );
}


type Format = { id: string; label: string; exam_body: string; duration_minutes: number; subjects: number; fixedFirstSubject?: string; instructions: string; sections: { name: string; count: number }[] };

function MockForm({ structure, onCreated }: { structure: { class_groups: { id: string; name: string }[]; subjects: { id: string; name: string }[] } | null; onCreated: (id: string) => void }) {
  const { data: formats } = useApi<Format[]>("/api/exams/from-format");
  const { data: sessions } = useApi<{ id: string; name: string; terms: { id: string; name: string; is_current: boolean }[] }[]>("/api/school/academic");
  const [f, setF] = useState({ format: "waec_obj", title: "", class_group_id: "", term_id: "", subjects: [] as string[], past_only: false, pool: "1" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fmt = formats?.find(x => x.id === f.format);
  const subjects = structure?.subjects ?? [];
  const n = fmt?.subjects ?? 1;
  const slots = Array.from({ length: n }, (_, i) => f.subjects[i] ?? (i === 0 && fmt?.fixedFirstSubject ? subjects.find(s => s.name.toLowerCase().includes(fmt.fixedFirstSubject!.toLowerCase()))?.id ?? "" : ""));
  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const r = await send<{ id: string; questions: number; shortfalls: string[] }>("/api/exams/from-format", {
      format: f.format, title: f.title || `${fmt?.label ?? "Mock exam"}`, class_group_id: f.class_group_id || null, term_id: f.term_id || null,
      subject_ids: slots, past_questions_only: f.past_only, pool_factor: Number(f.pool)
    });
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    if (r.data.shortfalls.length) alert(`Created with ${r.data.questions} questions. The bank was short: ${r.data.shortfalls.join("; ")}. Add more questions to the bank or write them in the exam.`);
    onCreated(r.data.id);
  }
  return (
    <form onSubmit={create} className="space-y-3">
      <Field label="Format">
        <select className="input" value={f.format} onChange={e => setF({ ...f, format: e.target.value, subjects: [] })}>
          {(formats ?? []).map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
        </select>
      </Field>
      {fmt && <p className="rounded bg-slate-50 p-2 text-xs text-slate-600">{fmt.duration_minutes} minutes · {fmt.sections.map(s => `${s.name}: ${s.count} questions`).join(" · ")}. Everything can be edited after creating.</p>}
      <Field label="Title"><input className="input" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} placeholder={fmt ? `SS3 ${fmt.label} mock` : ""} /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        {slots.map((v, i) => (
          <Field key={i} label={n > 1 ? `Subject ${i + 1}${i === 0 && fmt?.fixedFirstSubject ? ` (${fmt.fixedFirstSubject})` : ""}` : "Subject"}>
            <select className="input" required value={v} onChange={e => { const s = [...slots]; s[i] = e.target.value; setF({ ...f, subjects: s }); }}>
              <option value="">Choose…</option>{subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
        ))}
        <Field label="Class"><select className="input" value={f.class_group_id} onChange={e => setF({ ...f, class_group_id: e.target.value })}><option value="">All students</option>{(structure?.class_groups ?? []).map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>
        <Field label="Term"><select className="input" value={f.term_id} onChange={e => setF({ ...f, term_id: e.target.value })}><option value="">—</option>{(sessions ?? []).flatMap(s => s.terms.map(t => <option key={t.id} value={t.id}>{t.name} {s.name}</option>))}</select></Field>
        <Field label="Different paper per student" hint="2× puts twice as many questions in each section and gives every student a random half.">
          <select className="input" value={f.pool} onChange={e => setF({ ...f, pool: e.target.value })}><option value="1">No, same questions for all</option><option value="1.5">Yes, 1.5× pool</option><option value="2">Yes, 2× pool</option><option value="3">Yes, 3× pool</option></select>
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.past_only} onChange={e => setF({ ...f, past_only: e.target.checked })} /> Only use {fmt?.exam_body ?? ""} past questions from the bank</label>
      {err && <Alert>{err}</Alert>}
      <div className="flex justify-end"><button className="btn btn-primary" disabled={busy || slots.some(s => !s)}>{busy ? "Building…" : "Build mock exam"}</button></div>
    </form>
  );
}
