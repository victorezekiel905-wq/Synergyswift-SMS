"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useApi, send, Page, PageHeader, Alert, Badge, Stat, Empty, Loading, Modal, fmtDate, fmtTime } from "@/components/ui";

type Duty = { id: string; hall_id: string; staff_user_id: string; name: string; chief: boolean; checked_in_at: string | null; cover_for: string | null; state: "here" | "expected" | "late" | "away" };
type Hall = { hall_id: string; name: string; expected: number; checked_in: number; started: number; submitted: number; missing_after_start: number;
  missing: { student_id: string; paper_id: string; name: string; seat: string; paper: string }[]; duties: Duty[]; needs_cover: boolean };
type Board = {
  series: { id: string; name: string; sessions: { label: string; start: string; minutes: number }[]; require_checkin: boolean; starts_on: string; ends_on: string };
  date: string; session: number; times: { label: string; start: string; end: string } | null; papers: { id: string; title: string; exam_id: string | null }[];
  halls: Hall[]; candidates: { id: string; name: string; at_school: boolean }[]; can_run: boolean; is_admin: boolean; me: string;
  totals: { expected: number; checked_in: number; started: number; submitted: number };
};
type Result = { tone: "green" | "amber" | "red"; title: string; detail?: string };

const DUTY: Record<Duty["state"], { label: string; tone: "green" | "slate" | "amber" | "red" }> = {
  here: { label: "in the hall", tone: "green" }, expected: { label: "expected", tone: "slate" }, late: { label: "not here yet", tone: "amber" }, away: { label: "absent today", tone: "red" }
};

export default function HallPage() {
  return <Suspense fallback={<Loading />}><HallBoard /></Suspense>;
}

/** Exam-hall check-in desk and live board for one session (phase 14i-2). */
function HallBoard() {
  const params = useSearchParams();
  const router = useRouter();
  const series = params.get("series") ?? "";
  const q = new URLSearchParams({ series, ...(params.get("date") ? { date: params.get("date")! } : {}), ...(params.get("session") ? { session: params.get("session")! } : {}) });
  const { data, error, reload } = useApi<Board>(series ? `/api/exam-planner/hall?${q}` : null, [q.toString()]);
  const [hall, setHall] = useState("");
  const [code, setCode] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [cover, setCover] = useState<Duty | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { const t = setInterval(reload, 20_000); return () => clearInterval(t); }, [reload]);
  useEffect(() => {
    if (!data || hall) return;
    const mine = data.halls.find(h => h.duties.some(d => d.staff_user_id === data.me));
    if (mine) setHall(mine.hall_id);
  }, [data, hall]);
  if (!series) return <Page><Empty>Open the live board from an exam period in the Exam planner.</Empty></Page>;
  if (error) return <Page><Alert>{error}</Alert></Page>;
  if (!data) return <Page><Loading /></Page>;
  const go = (date: string, session: number) => router.replace(`/school/exam-planner/hall?series=${series}&date=${date}&session=${session}`);
  const slot = { series_id: data.series.id, date: data.date, session: data.session };
  const act = async (body: Record<string, unknown>) => {
    const r = await send<any>("/api/exam-planner/hall", { ...slot, ...body });
    if (!r.ok) setMsg(r.error ?? "failed"); else { setMsg(null); reload(); }
    return r;
  };
  const checkIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    const r = await send<any>("/api/exam-planner/hall", { ...slot, action: "checkin", code, hall_id: hall || null });
    setCode("");
    input.current?.focus();
    if (!r.ok) setResult({ tone: "red", title: r.error ?? "Not checked in" });
    else if (r.data.wrong_hall) setResult({ tone: "amber", title: `${r.data.name}: wrong hall`, detail: `Go to ${r.data.hall}, seat ${r.data.seat}.` });
    else { setResult({ tone: "green", title: `${r.data.name}${r.data.already ? " (already checked in)" : ""}`, detail: `${r.data.hall} · seat ${r.data.seat} · ${r.data.paper}` }); reload(); }
  };
  const t = data.totals;
  return (
    <Page wide>
      <Link className="text-sm text-brand-700 hover:underline" href="/school/exam-planner">← Exam planner</Link>
      <PageHeader eyebrow="Exams" title={`${data.series.name}: live board`}
        subtitle={data.times ? `${data.times.label}, ${fmtDate(data.date)} · ${fmtTime(data.times.start)}–${fmtTime(data.times.end)} · ${data.papers.map(p => p.title).join(", ") || "no papers in this session"}` : undefined} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input className="input w-auto" type="date" value={data.date} min={data.series.starts_on} max={data.series.ends_on} onChange={e => e.target.value && go(e.target.value, data.session)} aria-label="Day" />
        <div className="flex gap-1">{data.series.sessions.map((s, i) => (
          <button key={i} onClick={() => go(data.date, i)} className={"rounded-full border px-3 py-1.5 text-sm " + (i === data.session ? "border-brand-700 bg-brand-700 text-white" : "border-slate-300 bg-white")}>{s.label}</button>))}</div>
        {data.series.require_checkin && <Badge tone="blue">online papers open only after check-in</Badge>}
      </div>
      {msg && <div className="mb-3"><Alert>{msg}</Alert></div>}
      <div className="mb-4 grid gap-2 sm:grid-cols-4">
        <Stat label="Candidates" value={t.expected} /><Stat label="Checked in" value={`${t.checked_in} of ${t.expected}`} tone={t.expected && t.checked_in === t.expected ? "good" : undefined} />
        <Stat label="Started (online)" value={t.started} /><Stat label="Submitted (online)" value={t.submitted} />
      </div>
      {data.can_run && (
        <section className="card mb-4 p-4">
          <h2 className="mb-2 font-semibold">Check-in desk</h2>
          <form onSubmit={checkIn} className="flex flex-wrap items-center gap-2">
            <select className="input w-auto" value={hall} onChange={e => setHall(e.target.value)} aria-label="This hall"><option value="">Any hall</option>{data.halls.map(h => <option key={h.hall_id} value={h.hall_id}>{h.name}</option>)}</select>
            <input ref={input} autoFocus className="input min-w-[14rem] flex-1 text-lg" value={code} onChange={e => setCode(e.target.value)} placeholder="Scan the ID card or type the admission number" aria-label="Card or admission number" />
            <button className="btn btn-primary">Check in</button>
          </form>
          {result && <div className={"mt-3 rounded-xl p-4 " + (result.tone === "green" ? "bg-emerald-50 text-emerald-900" : result.tone === "amber" ? "bg-amber-50 text-amber-900" : "bg-red-50 text-red-900")} role="status">
            <p className="text-lg font-semibold">{result.title}</p>{result.detail && <p>{result.detail}</p>}</div>}
        </section>
      )}
      {!data.halls.length ? <Empty>No candidates are seated in this session yet. Seat them in the Exam planner (3. Seating).</Empty> : (
        <div className="grid gap-4 lg:grid-cols-2">{data.halls.map(h => (
          <section key={h.hall_id} className={"card p-4 " + (h.needs_cover ? "border-amber-300" : "")}>
            <div className="flex flex-wrap items-baseline gap-2"><h3 className="mr-auto font-semibold">{h.name}</h3>
              <span className="text-sm text-slate-600">{h.checked_in} of {h.expected} in{h.started ? ` · ${h.started} started` : ""}{h.submitted ? ` · ${h.submitted} submitted` : ""}</span></div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden><div className="h-full bg-emerald-600" style={{ width: `${h.expected ? Math.round(100 * h.checked_in / h.expected) : 0}%` }} /></div>
            <ul className="mt-3 space-y-1.5 text-sm">{h.duties.length ? h.duties.map(d => (
              <li key={d.id} className="flex flex-wrap items-center gap-2"><span className="mr-auto">{d.name}{d.chief ? " (chief)" : ""}{d.cover_for ? <span className="text-xs text-slate-500"> · covering</span> : null}</span>
                <Badge tone={DUTY[d.state].tone}>{DUTY[d.state].label}</Badge>
                {d.staff_user_id === data.me && !d.checked_in_at && <button className="btn btn-primary px-3 py-1 text-xs" onClick={() => act({ action: "here", invigilation_id: d.id })}>I&apos;m here</button>}
                {data.is_admin && d.state !== "here" && <button className="btn btn-outline px-3 py-1 text-xs" onClick={() => setCover(d)}>Find cover</button>}
              </li>)) : <li className="text-amber-800">No invigilator for this hall.</li>}</ul>
            {h.missing.length > 0 && <details className="mt-3" open={h.missing_after_start > 0 && h.missing.length <= 12}>
              <summary className="cursor-pointer text-sm font-medium">{h.missing_after_start ? <span className="text-red-700">{h.missing.length} not checked in</span> : `${h.missing.length} still to check in`}</summary>
              <ul className="mt-2 space-y-1 text-sm">{h.missing.map(m => (
                <li key={m.paper_id + m.student_id} className="flex items-center gap-2"><span className="w-12 tabular-nums text-slate-500">{m.seat}</span><span className="mr-auto">{m.name}</span>
                  {data.can_run && <button className="text-xs text-brand-700 underline" onClick={() => act({ action: "manual", paper_id: m.paper_id, student_id: m.student_id })}>Check in by hand</button>}</li>))}</ul>
            </details>}
          </section>))}</div>
      )}
      <p className="mt-4 text-xs text-slate-500">Refreshes every 20 seconds. Invigilators on leave or recorded absence show as absent; staff already signed in at the gate are suggested first for cover.</p>
      <Modal open={Boolean(cover)} onClose={() => setCover(null)} title={`Cover for ${cover?.name ?? ""}`}>
        {cover && (!data.candidates.length ? <p className="text-sm text-slate-600">Nobody is free in this session.</p> : <ul className="max-h-80 space-y-1 overflow-y-auto text-sm">{data.candidates.map(c => (
          <li key={c.id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2"><span className="mr-auto">{c.name}</span>{c.at_school && <Badge tone="green">at school</Badge>}
            <button className="btn btn-primary px-3 py-1 text-xs" onClick={async () => { const r = await act({ action: "cover", invigilation_id: cover.id, staff_user_id: c.id }); if (r.ok) setCover(null); }}>Ask to cover</button></li>))}</ul>)}
      </Modal>
    </Page>
  );
}
