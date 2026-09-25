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
        subtitle="Twelve question types, automatic marking, live proctoring with lock-on-violation, Safe Exam Browser support, and one click to push scores into report cards."
        actions={<button className="btn btn-primary" onClick={() => setOpen(true)}>+ New exam</button>} />
      {error && <Alert>{error}</Alert>}
      {!data?.length ? <Empty>No exams yet.</Empty> : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-3">Exam</th><th className="p-3">Class</th><th className="p-3">Window</th><th className="p-3">Code</th><th className="p-3 text-center">Questions</th><th className="p-3 text-center">Attempts</th><th className="p-3">Status</th></tr></thead>
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
