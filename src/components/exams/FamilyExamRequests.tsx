"use client";
import { useState } from "react";
import { useApi, send, Alert, Badge, Empty, Field, Loading, fmtDate } from "@/components/ui";

type Child = { id: string; name: string; exams: { id: string; title: string; at: string | null }[]; papers: { id: string; title: string; at: string | null }[] };
type Req = { id: string; kind: string; status: string; student: string; exam: string | null; minutes: number | null; arrangement: string | null; reason: string; decision_note?: string | null; created_at: string };

const KIND: Record<string, string> = { extra_time: "Extra time", late_sitting: "A late sitting", resit: "A resit", special_arrangement: "A special arrangement" };
const TONE: Record<string, "amber" | "green" | "red" | "slate"> = { pending: "amber", approved: "green", declined: "red", cancelled: "slate" };

/**
 * Parents and students ask the exams office for extra time, a late sitting, a resit or a special
 * arrangement, and follow the answer (phase 14j API; this is the family screen).
 */
export default function FamilyExamRequests({ who }: { who: "parent" | "student" }) {
  const { data: opts } = useApi<{ children: Child[] }>("/api/exams/requests?view=options");
  const { data, reload } = useApi<{ requests: Req[]; ready: boolean }>("/api/exams/requests");
  const [f, setF] = useState({ student_id: "", exam: "", kind: "extra_time", minutes: "15", arrangement: "", reason: "", opens: "", closes: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!opts || !data) return <Loading />;
  if (!data.ready) return <Alert tone="amber">Exam requests are not switched on for this school yet.</Alert>;
  const child = opts.children.find(c => c.id === (f.student_id || opts.children[0]?.id)) ?? null;
  const options = child ? [...child.exams.map(e => ({ v: `exam:${e.id}`, label: `${e.title}${e.at ? ` · ${fmtDate(e.at)}` : ""}` })), ...child.papers.map(p => ({ v: `paper:${p.id}`, label: `${p.title}${p.at ? ` · ${fmtDate(p.at)}` : ""}` }))] : [];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!child) return;
    const [type, id] = f.exam.split(":");
    const r = await send("/api/exams/requests", { action: "create", student_id: child.id, exam_id: type === "exam" ? id : null, paper_id: type === "paper" ? id : null, kind: f.kind,
      minutes: f.kind === "extra_time" ? Number(f.minutes) : null, arrangement: f.kind === "special_arrangement" ? f.arrangement : null, reason: f.reason,
      opens_at: f.kind === "late_sitting" && f.opens ? new Date(f.opens).toISOString() : null, closes_at: f.kind === "late_sitting" && f.closes ? new Date(f.closes).toISOString() : null });
    setMsg({ ok: r.ok, text: r.ok ? "Sent to the exams office. You will hear back here and by message." : r.error ?? "failed" });
    if (r.ok) { setF({ ...f, exam: "", reason: "", arrangement: "" }); reload(); }
  }

  return (
    <div className="space-y-4">
      <form className="card grid gap-3 p-4 sm:grid-cols-2" onSubmit={submit}>
        <h2 className="font-semibold sm:col-span-2">Ask the exams office</h2>
        {who === "parent" && opts.children.length > 1 && (
          <Field label="Child"><select className="input" value={child?.id ?? ""} onChange={e => setF({ ...f, student_id: e.target.value, exam: "" })}>{opts.children.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        )}
        <Field label="Exam"><select className="input" required value={f.exam} onChange={e => setF({ ...f, exam: e.target.value })}>
          <option value="">{options.length ? "Choose the exam" : "No exams in the next 90 days"}</option>{options.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}</select></Field>
        <Field label="What is needed"><select className="input" value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })}>{Object.entries(KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        {f.kind === "extra_time" && <Field label="Extra minutes"><input className="input" type="number" min={1} max={240} value={f.minutes} onChange={e => setF({ ...f, minutes: e.target.value })} /></Field>}
        {f.kind === "special_arrangement" && <Field label="The arrangement"><input className="input" required maxLength={200} placeholder="e.g. a seat near the front, a reader, rest breaks" value={f.arrangement} onChange={e => setF({ ...f, arrangement: e.target.value })} /></Field>}
        {f.kind === "late_sitting" && <>
          <Field label="Could start from"><input className="input" type="datetime-local" required value={f.opens} onChange={e => setF({ ...f, opens: e.target.value })} /></Field>
          <Field label="Must finish by"><input className="input" type="datetime-local" required value={f.closes} onChange={e => setF({ ...f, closes: e.target.value })} /></Field>
        </>}
        <div className="sm:col-span-2"><Field label="Why"><textarea className="input h-20" required minLength={3} maxLength={1000} placeholder={who === "parent" ? "e.g. She was in hospital that week; the doctor's note is with the school nurse." : "e.g. I was ill on the day of the test."} value={f.reason} onChange={e => setF({ ...f, reason: e.target.value })} /></Field></div>
        {msg && <div className="sm:col-span-2"><Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert></div>}
        <div className="sm:col-span-2"><button className="btn btn-primary" disabled={!f.exam}>Send request</button></div>
      </form>

      <section>
        <h2 className="mb-2 font-semibold">Requests</h2>
        {!data.requests.length ? <Empty>No requests yet.</Empty> : (
          <ul className="space-y-2">{data.requests.map(r => (
            <li key={r.id} className="card p-3 text-sm">
              <p className="flex flex-wrap items-center gap-2"><b>{KIND[r.kind] ?? r.kind}</b>{r.kind === "extra_time" && r.minutes ? ` (${r.minutes} min)` : ""} · {r.exam ?? "exam"}{who === "parent" ? ` · ${r.student}` : ""}
                <Badge tone={TONE[r.status] ?? "slate"}>{r.status}</Badge><span className="ml-auto text-xs text-slate-500">{fmtDate(r.created_at)}</span></p>
              <p className="mt-1 text-slate-600">{r.reason}</p>
              {r.decision_note && <p className="mt-1 text-slate-800"><b>Exams office:</b> {r.decision_note}</p>}
              {r.status === "pending" && <button className="mt-1 text-xs text-rose-700 underline" onClick={async () => { if (!confirm("Withdraw this request?")) return; await send("/api/exams/requests", { action: "cancel", id: r.id }); reload(); }}>Withdraw</button>}
            </li>))}</ul>
        )}
      </section>
    </div>
  );
}
