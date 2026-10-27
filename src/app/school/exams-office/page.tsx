"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useApi, send, Page, PageHeader, Tabs, Alert, Empty, Loading, Modal, Field, Badge, Stat, fmtDate, fmtTime } from "@/components/ui";

type ExamRef = { id: string; title: string; class_name: string | null; teacher: string | null; opens_at: string | null; closes_at: string | null };
type Office = {
  live: (ExamRef & { writing: number; locked: number; submitted: number; flagged: number })[]; upcoming: ExamRef[];
  marking: (ExamRef & { waiting: number })[]; to_release: ExamRef[];
  requests: { id: string; kind: string; created_at: string; minutes: number | null; arrangement: string | null; student: string; exam: string | null }[];
  arrangements: { extra_time: number; other: number }; incidents: number;
  series: { id: string; name: string; starts_on: string; ends_on: string; status: string; running: boolean }[];
  today: { papers: number; seated: number; checked_in: number };
};
type Req = { id: string; kind: string; status: string; minutes: number | null; opens_at: string | null; closes_at: string | null; arrangement: string | null; reason: string;
  requested_as: string; decision_note: string | null; created_at: string; student: string; class_name: string | null; admission_no: string | null; exam: string | null };
const KIND: Record<string, string> = { extra_time: "Extra time", late_sitting: "Late sitting", resit: "Resit", special_arrangement: "Special arrangement" };
type Tab = "today" | "requests";

/** The exams office (phase 14j): everything about exams on one page, and requests to decide. */
export default function ExamsOffice() {
  const [tab, setTab] = useState<Tab>("today");
  useEffect(() => { if (new URLSearchParams(window.location.search).get("tab") === "requests") setTab("requests"); }, []);
  return (
    <Page wide>
      <PageHeader eyebrow="Exams & results" title="Exams office" subtitle="Papers being written now, what is coming, marking and results waiting, and requests for extra time, late sittings, resits and arrangements." />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "today", label: "At a glance" }, { id: "requests", label: "Requests" }]} />
      {tab === "today" ? <Glance onRequests={() => setTab("requests")} /> : <Requests />}
    </Page>
  );
}

function Glance({ onRequests }: { onRequests: () => void }) {
  const { data, error, reload } = useApi<Office>("/api/exams/office");
  useEffect(() => { const t = setInterval(reload, 30_000); return () => clearInterval(t); }, [reload]);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  const writing = data.live.reduce((t, e) => t + e.writing, 0);
  const List = ({ title, rows, right, empty }: { title: string; rows: ExamRef[]; right: (e: any) => React.ReactNode; empty: string }) => (
    <section className="card p-4">
      <h2 className="mb-2 font-semibold">{title}</h2>
      {!rows.length ? <p className="text-sm text-slate-500">{empty}</p> : <ul className="divide-y divide-slate-100 text-sm">{rows.map(e => (
        <li key={e.id} className="flex flex-wrap items-center gap-2 py-2"><Link className="mr-auto font-medium text-brand-800 hover:underline" href={`/exams/${e.id}`}>{e.title}</Link>
          <span className="text-slate-500">{[e.class_name, e.teacher].filter(Boolean).join(" · ")}</span>{right(e)}</li>))}</ul>}
    </section>
  );
  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Writing now" value={writing} hint={`${data.live.length} paper${data.live.length === 1 ? "" : "s"} open`} />
        <Stat label="Scripts to mark" value={data.marking.reduce((t, e) => t + e.waiting, 0)} />
        <Stat label="Results to release" value={data.to_release.length} />
        <Stat label="Requests waiting" value={data.requests.length} tone={data.requests.length ? "warn" : undefined} />
        <Stat label="Integrity flags" value={data.incidents} hint="3 or more warnings" tone={data.incidents ? "warn" : undefined} />
      </div>
      {data.series.some(s => s.running) && (
        <section className="card flex flex-wrap items-center gap-3 p-4">
          <div className="mr-auto"><h2 className="font-semibold">{data.series.filter(s => s.running).map(s => s.name).join(", ")}</h2>
            <p className="text-sm text-slate-600">Today: {data.today.papers} paper{data.today.papers === 1 ? "" : "s"} · {data.today.checked_in} of {data.today.seated} candidates checked in</p></div>
          {data.series.filter(s => s.running).map(s => <Link key={s.id} className="btn btn-outline" href={`/school/exam-planner/hall?series=${s.id}`}>Live board</Link>)}
        </section>)}
      <div className="grid gap-4 lg:grid-cols-2">
        <List title="Being written now" rows={data.live} empty="No paper is open right now."
          right={(e: Office["live"][number]) => <span className="flex gap-1"><Badge tone="blue">{e.writing} writing</Badge>{e.submitted > 0 && <Badge tone="green">{e.submitted} done</Badge>}{e.locked > 0 && <Badge tone="amber">{e.locked} locked</Badge>}{e.flagged > 0 && <Badge tone="red">{e.flagged} flagged</Badge>}</span>} />
        <List title="Coming up (14 days)" rows={data.upcoming} empty="Nothing scheduled." right={(e: ExamRef) => <span className="text-slate-600">{e.opens_at ? `${fmtDate(e.opens_at)} ${fmtTime(e.opens_at)}` : ""}</span>} />
        <List title="Marking waiting" rows={data.marking} empty="All scripts are marked." right={(e: Office["marking"][number]) => <Badge tone="amber">{e.waiting} to mark</Badge>} />
        <List title="Marked, results not released" rows={data.to_release} empty="Nothing waiting to be released." right={() => <Badge>release</Badge>} />
      </div>
      <section className="card p-4 text-sm">
        <div className="flex flex-wrap items-center gap-2"><h2 className="mr-auto font-semibold">Requests and arrangements</h2><button className="btn btn-outline" onClick={onRequests}>Open requests</button></div>
        <p className="mt-1 text-slate-600">{data.arrangements.extra_time} student{data.arrangements.extra_time === 1 ? " has" : "s have"} extra time from the SEN register (applied automatically to online papers); {data.arrangements.other} {data.arrangements.other === 1 ? "has" : "have"} other access arrangements.</p>
        {data.requests.length > 0 && <ul className="mt-2 space-y-1">{data.requests.slice(0, 6).map(r => <li key={r.id}><b>{r.student}</b>: {KIND[r.kind]}{r.minutes ? ` (${r.minutes} min)` : ""}{r.arrangement ? ` (${r.arrangement})` : ""}{r.exam ? ` · ${r.exam}` : ""}</li>)}</ul>}
      </section>
    </div>
  );
}

function Requests() {
  const [status, setStatus] = useState("pending");
  const { data, error, reload } = useApi<{ ready: boolean; can_decide: boolean; requests: Req[] }>(`/api/exams/requests${status ? `?status=${status}` : ""}`, [status]);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  const decide = async (id: string, approve: boolean) => {
    const r = await send("/api/exams/requests", { action: "decide", id, approve, note: note[id] || null });
    setMsg({ ok: r.ok, text: r.ok ? (approve ? "Approved: it applies automatically." : "Declined.") : r.error ?? "failed" });
    if (r.ok) reload();
  };
  return (
    <div className="space-y-4 text-sm">
      {!data.ready && <Alert tone="amber">Exam requests need this month&apos;s database update.</Alert>}
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      <div className="flex flex-wrap items-center gap-2">
        <select className="input w-auto" value={status} onChange={e => setStatus(e.target.value)} aria-label="Show"><option value="pending">Waiting</option><option value="approved">Approved</option><option value="declined">Declined</option><option value="">All</option></select>
        <button className="btn btn-primary ml-auto" onClick={() => setAsking(true)}>New request</button>
      </div>
      {!data.requests.length ? <Empty>No requests here.</Empty> : data.requests.map(r => (
        <div key={r.id} className="card p-4">
          <div className="flex flex-wrap items-center gap-2"><b>{r.student}</b><span className="text-slate-500">{[r.class_name, r.admission_no].filter(Boolean).join(" · ")}</span>
            <Badge tone="blue">{KIND[r.kind]}{r.minutes ? `: ${r.minutes} min` : ""}</Badge>{r.exam && <span className="text-slate-600">{r.exam}</span>}
            <span className="ml-auto text-xs text-slate-500">asked by {r.requested_as} · {fmtDate(r.created_at)}</span></div>
          {r.arrangement && <p className="mt-1"><b>Arrangement:</b> {r.arrangement}</p>}
          {r.opens_at && <p className="mt-1">Sitting between {fmtDate(r.opens_at, true)} and {fmtDate(r.closes_at, true)}</p>}
          <p className="mt-1 text-slate-700">{r.reason}</p>
          {r.decision_note && <p className="mt-1 text-xs text-slate-500">Reply: {r.decision_note}</p>}
          {r.status === "pending" && data.can_decide ? (
            <div className="mt-2 flex flex-wrap gap-2"><input className="input flex-1" placeholder="Reply (optional)" value={note[r.id] ?? ""} onChange={e => setNote({ ...note, [r.id]: e.target.value })} maxLength={500} />
              <button className="btn btn-primary" onClick={() => decide(r.id, true)}>Approve</button><button className="btn btn-ghost border border-slate-300" onClick={() => decide(r.id, false)}>Decline</button></div>
          ) : <p className="mt-2"><Badge tone={r.status === "approved" ? "green" : r.status === "pending" ? "amber" : "slate"}>{r.status}</Badge></p>}
        </div>))}
      <Modal open={asking} onClose={() => setAsking(false)} title="New exam request" wide>
        {asking && <AskForm onDone={() => { setAsking(false); setMsg({ ok: true, text: "Request sent to the exams office." }); reload(); }} />}
      </Modal>
    </div>
  );
}

function AskForm({ onDone }: { onDone: () => void }) {
  const [q, setQ] = useState("");
  const { data: found } = useApi<{ id: string; first_name: string; last_name: string; admission_no: string; class_groups: { name: string } | null }[]>(q.trim().length >= 2 ? `/api/sims/students?q=${encodeURIComponent(q.trim())}` : null, [q]);
  const { data: exams } = useApi<{ id: string; title: string; status: string; class_groups: { name: string } | null }[]>("/api/exams");
  const [f, setF] = useState({ student_id: "", student: "", exam_id: "", kind: "extra_time", minutes: "15", opens_at: "", closes_at: "", arrangement: "", reason: "" });
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    const r = await send("/api/exams/requests", { action: "create", student_id: f.student_id, exam_id: f.exam_id, kind: f.kind, reason: f.reason,
      minutes: f.kind === "extra_time" ? Number(f.minutes) : null, arrangement: f.kind === "special_arrangement" ? f.arrangement : null,
      opens_at: f.kind === "late_sitting" && f.opens_at ? new Date(f.opens_at).toISOString() : null, closes_at: f.kind === "late_sitting" && f.closes_at ? new Date(f.closes_at).toISOString() : null });
    if (!r.ok) return setErr(r.error);
    onDone();
  };
  return (
    <div className="space-y-3 text-sm">
      {f.student_id ? <p>Student: <b>{f.student}</b> <button className="ml-2 text-brand-700 underline" onClick={() => setF({ ...f, student_id: "", student: "" })}>change</button></p> : (
        <Field label="Student"><input className="input" value={q} onChange={e => setQ(e.target.value)} placeholder="Name or admission number" />
          {(found ?? []).slice(0, 8).map(s => <button key={s.id} type="button" className="block w-full rounded px-2 py-1 text-left hover:bg-slate-100" onClick={() => setF({ ...f, student_id: s.id, student: `${s.first_name} ${s.last_name}` })}>{s.first_name} {s.last_name} <span className="text-slate-500">{s.admission_no} · {s.class_groups?.name ?? ""}</span></button>)}</Field>)}
      <Field label="Exam"><select className="input" value={f.exam_id} onChange={e => setF({ ...f, exam_id: e.target.value })}><option value="">Choose…</option>
        {(exams ?? []).filter(e => e.status !== "draft").map(e => <option key={e.id} value={e.id}>{e.title}{e.class_groups ? ` (${e.class_groups.name})` : ""}</option>)}</select></Field>
      <Field label="Request"><select className="input" value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })}>
        <option value="extra_time">Extra time</option><option value="late_sitting">A late sitting (after the class has written it)</option><option value="resit">A resit (the first attempt is kept)</option><option value="special_arrangement">A special arrangement (reader, scribe, separate room…)</option></select></Field>
      {f.kind === "extra_time" && <Field label="Extra minutes"><input className="input" type="number" min={1} max={240} value={f.minutes} onChange={e => setF({ ...f, minutes: e.target.value })} /></Field>}
      {f.kind === "late_sitting" && <div className="grid gap-3 sm:grid-cols-2"><Field label="Can start from"><input className="input" type="datetime-local" value={f.opens_at} onChange={e => setF({ ...f, opens_at: e.target.value })} /></Field>
        <Field label="Until"><input className="input" type="datetime-local" value={f.closes_at} onChange={e => setF({ ...f, closes_at: e.target.value })} /></Field></div>}
      {f.kind === "special_arrangement" && <Field label="Arrangement"><input className="input" value={f.arrangement} onChange={e => setF({ ...f, arrangement: e.target.value })} maxLength={200} placeholder="e.g. a reader, a separate room, rest breaks" /></Field>}
      <Field label="Reason"><textarea className="input" rows={3} value={f.reason} onChange={e => setF({ ...f, reason: e.target.value })} maxLength={1000} /></Field>
      {err && <Alert>{err}</Alert>}
      <button className="btn btn-primary" disabled={!f.student_id || !f.exam_id || f.reason.trim().length < 3} onClick={submit}>Send to the exams office</button>
    </div>
  );
}
