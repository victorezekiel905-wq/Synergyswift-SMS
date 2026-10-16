"use client";
import { useState } from "react";
import { useApi, send, Alert, Badge, Empty, Field, Loading, Modal, Stat, fmtDate, statusTone } from "@/components/ui";
import type { Question } from "@/lib/community";

type ListData = {
  items: { id: string; title: string; status: string; anonymous: boolean; created_at: string; sent_at: string | null; closes_at: string | null; invited: number; responded: number; nps: number | null }[];
  overall: { responses: number; nps: number | null; promoters: number; passives: number; detractors: number };
  template: Question[]; segments: { id: string; name: string }[]; classes: { id: string; name: string }[];
};
type Draft = { id?: string; title: string; intro: string; questions: Question[]; anonymous: boolean; audience: { class_group_ids?: string[]; segment_id?: string | null }; closes_at: string };

const npsTone = (n: number | null) => (n === null ? undefined : n >= 30 ? "good" : n < 0 ? "bad" : "warn") as "good" | "bad" | "warn" | undefined;

/** NPS and satisfaction surveys sent to families by link; detractors on named surveys become follow-up tickets. */
export default function Surveys() {
  const { data, error, reload } = useApi<ListData>("/api/community/surveys");
  const [edit, setEdit] = useState<Draft | null>(null);
  const [view, setView] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  const act = async (body: Record<string, unknown>, ok: (d: any) => string, confirmText?: string) => {
    if (confirmText && !confirm(confirmText)) return;
    const r = await send("/api/community/surveys", body);
    setMsg({ ok: r.ok, text: r.ok ? ok(r.data) : r.error ?? "failed" });
    reload();
  };
  const o = data.overall;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Net Promoter Score (all surveys)" value={o.nps ?? "—"} tone={npsTone(o.nps)} hint={`${o.responses} answers`} />
        <Stat label="Promoters (9–10)" value={o.promoters} tone="good" />
        <Stat label="Passives (7–8)" value={o.passives} />
        <Stat label="Detractors (0–6)" value={o.detractors} tone={o.detractors ? "bad" : undefined} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex-1 text-sm text-slate-600">Families answer from a private link in two minutes. Anyone scoring 0–6 on a named survey gets a follow-up ticket so someone calls them.</p>
        <button className="btn btn-primary" onClick={() => setEdit({ title: "How are we doing?", intro: "", questions: data.template, anonymous: false, audience: {}, closes_at: "" })}>New survey</button>
      </div>
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      {!data.items.length ? <Empty>No surveys yet. Start with the NPS template.</Empty> : (
        <ul className="card divide-y divide-slate-100 text-sm">{data.items.map(s => (
          <li key={s.id} className="flex flex-wrap items-center gap-3 p-3">
            <button className="flex-1 text-left" onClick={() => setView(s.id)}>
              <span className="font-medium">{s.title}</span> <Badge tone={statusTone(s.status === "open" ? "active" : s.status)}>{s.status}</Badge>{s.anonymous && <Badge tone="violet">anonymous</Badge>}
              <span className="block text-xs text-slate-500">{s.sent_at ? `sent ${fmtDate(s.sent_at)}` : `created ${fmtDate(s.created_at)}`}{s.closes_at ? ` · closes ${fmtDate(s.closes_at)}` : ""}</span>
            </button>
            <span className="text-xs tabular-nums">{s.responded}/{s.invited} answered{s.invited ? ` (${Math.round((s.responded / s.invited) * 100)}%)` : ""}</span>
            <span className="w-20 text-right">{s.nps !== null ? <b>NPS {s.nps}</b> : ""}</span>
            <span className="flex gap-1">
              {s.status === "draft" && <button className="btn btn-outline px-2 py-1 text-xs" onClick={async () => { const r = await fetch(`/api/community/surveys?id=${s.id}`).then(x => x.json()); setEdit({ id: s.id, title: r.survey.title, intro: r.survey.intro ?? "", questions: r.survey.questions, anonymous: r.survey.anonymous, audience: r.survey.audience ?? {}, closes_at: r.survey.closes_at?.slice(0, 10) ?? "" }); }}>Edit</button>}
              {s.status !== "closed" && <button className="btn btn-primary px-2 py-1 text-xs" onClick={() => act({ action: "send", id: s.id }, d => `Sent to ${d.invited} new famil${d.invited === 1 ? "y" : "ies"}.`, s.status === "draft" ? "Send this survey to the chosen families now?" : "Send to families added since it was first sent?")}>{s.status === "draft" ? "Send" : "Send to new families"}</button>}
              {s.status === "open" && <button className="btn btn-outline px-2 py-1 text-xs" onClick={() => act({ action: "remind", id: s.id }, d => `Reminded ${d.invited} famil${d.invited === 1 ? "y" : "ies"}.`)}>Remind</button>}
              {s.status === "open" && <button className="btn btn-outline px-2 py-1 text-xs" onClick={() => act({ action: "close", id: s.id }, () => "Closed.")}>Close</button>}
              {s.status === "draft" && <button className="btn btn-outline px-2 py-1 text-xs text-rose-700" onClick={() => act({ action: "delete", id: s.id }, () => "Deleted.", "Delete this draft?")}>Delete</button>}
            </span>
          </li>
        ))}</ul>
      )}
      <Modal open={Boolean(edit)} onClose={() => setEdit(null)} title={edit?.id ? "Edit survey" : "New survey"} wide>
        {edit && <SurveyEditor draft={edit} segments={data.segments} classes={data.classes} onDone={() => { setEdit(null); reload(); }} />}
      </Modal>
      <Modal open={Boolean(view)} onClose={() => setView(null)} title="Results" wide>
        {view && <SurveyResults id={view} />}
      </Modal>
    </div>
  );
}

function SurveyEditor({ draft, segments, classes, onDone }: { draft: Draft; segments: ListData["segments"]; classes: ListData["classes"]; onDone: () => void }) {
  const [d, setD] = useState<Draft>(draft);
  const [err, setErr] = useState<string | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const setQ = (i: number, q: Partial<Question>) => setD({ ...d, questions: d.questions.map((x, j) => (j === i ? { ...x, ...q } : x)) });
  const add = (type: Question["type"]) => {
    const n = d.questions.length + 1;
    setD({ ...d, questions: [...d.questions, { id: `q${n}_${Date.now() % 1000}`, type, label: "", ...(type === "choice" ? { options: ["Yes", "No"] } : {}) }] });
  };
  const checkCount = async (audience: Draft["audience"]) => { const r = await send<{ families: number }>("/api/community/surveys", { action: "count", audience }); setCount(r.ok ? r.data.families : null); };
  return (
    <form className="space-y-3 text-sm" onSubmit={async e => {
      e.preventDefault();
      const r = await send("/api/community/surveys", { action: "save", id: d.id ?? null, title: d.title, intro: d.intro || null, questions: d.questions, anonymous: d.anonymous,
        audience: d.audience, closes_at: d.closes_at ? new Date(`${d.closes_at}T23:59:00`).toISOString() : null });
      if (r.ok) onDone(); else setErr(r.error);
    }}>
      {err && <Alert>{err}</Alert>}
      <Field label="Title"><input className="input" value={d.title} onChange={e => setD({ ...d, title: e.target.value })} required minLength={2} maxLength={160} /></Field>
      <Field label="Introduction (optional)"><textarea className="input min-h-16" value={d.intro} onChange={e => setD({ ...d, intro: e.target.value })} maxLength={1000} /></Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Send to">
          <select className="input" value={d.audience.segment_id ?? ""} onChange={e => { const a = { ...d.audience, segment_id: e.target.value || null }; setD({ ...d, audience: a }); checkCount(a); }}>
            <option value="">All families{d.audience.class_group_ids?.length ? " in the chosen classes" : ""}</option>{segments.map(s => <option key={s.id} value={s.id}>Segment: {s.name}</option>)}
          </select>
        </Field>
        <Field label="Only these classes" hint="Hold Ctrl or ⌘ to pick several.">
          <select className="input" multiple size={3} value={d.audience.class_group_ids ?? []} onChange={e => { const a = { ...d.audience, class_group_ids: [...e.target.selectedOptions].map(o => o.value) }; setD({ ...d, audience: a }); checkCount(a); }}>
            {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Closes on (optional)"><input className="input" type="date" value={d.closes_at} onChange={e => setD({ ...d, closes_at: e.target.value })} /></Field>
      </div>
      {count !== null && <p className="text-xs text-slate-600">{count} famil{count === 1 ? "y" : "ies"} will be asked.</p>}
      <label className="flex items-center gap-2"><input type="checkbox" checked={d.anonymous} onChange={e => setD({ ...d, anonymous: e.target.checked })} /> Anonymous: answers are not linked to families (no follow-up tickets).</label>
      <div className="space-y-2">
        <span className="label">Questions</span>
        {d.questions.map((q, i) => (
          <div key={q.id} className="flex flex-wrap items-start gap-2 rounded-lg border border-slate-200 p-2">
            <Badge>{q.type === "nps" ? "0–10" : q.type === "rating" ? "1–5 stars" : q.type === "choice" ? "choice" : "text"}</Badge>
            <div className="min-w-64 flex-1 space-y-1">
              <input className="input" value={q.label} onChange={e => setQ(i, { label: e.target.value })} placeholder="Question" required minLength={2} maxLength={300} aria-label={`Question ${i + 1}`} />
              {q.type === "choice" && <input className="input" value={(q.options ?? []).join(", ")} onChange={e => setQ(i, { options: e.target.value.split(",").map(x => x.trim()).filter(Boolean) })} placeholder="Options, separated by commas" aria-label="Options" />}
            </div>
            <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={Boolean(q.required)} onChange={e => setQ(i, { required: e.target.checked })} /> required</label>
            <button type="button" className="text-xs text-slate-500" disabled={i === 0} onClick={() => { const qs = [...d.questions]; [qs[i - 1], qs[i]] = [qs[i], qs[i - 1]]; setD({ ...d, questions: qs }); }} aria-label="Move up">↑</button>
            <button type="button" className="text-xs text-rose-600" onClick={() => setD({ ...d, questions: d.questions.filter((_, j) => j !== i) })} aria-label="Remove question">✕</button>
          </div>
        ))}
        <div className="flex flex-wrap gap-2 text-xs">
          {!d.questions.some(q => q.type === "nps") && <button type="button" className="btn btn-outline px-2 py-1" onClick={() => add("nps")}>+ NPS (0–10)</button>}
          <button type="button" className="btn btn-outline px-2 py-1" onClick={() => add("rating")}>+ Rating</button>
          <button type="button" className="btn btn-outline px-2 py-1" onClick={() => add("choice")}>+ Multiple choice</button>
          <button type="button" className="btn btn-outline px-2 py-1" onClick={() => add("text")}>+ Written answer</button>
        </div>
      </div>
      <button className="btn btn-primary">Save draft</button>
    </form>
  );
}

type Results = {
  survey: { title: string; anonymous: boolean; status: string };
  invited: number; responded: number; nps: { nps: number | null; promoters: number; passives: number; detractors: number; responses: number };
  questions: { id: string; type: string; label: string; count: number; average?: number | null; nps?: number | null; counts?: Record<string, number>; texts?: string[]; promoters?: number; passives?: number; detractors?: number }[];
  trend: { month: string; nps: number | null; responses: number }[];
  responses: { id: string; nps: number | null; created_at: string; guardians: { id: string; full_name: string } | null; answers: Record<string, unknown> }[];
};

function SurveyResults({ id }: { id: string }) {
  const { data, error } = useApi<Results>(`/api/community/surveys?id=${id}`);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  const n = data.nps;
  const bar = (v: number, tone: string) => n.responses ? <div className={`h-3 ${tone}`} style={{ width: `${(v / n.responses) * 100}%` }} /> : null;
  return (
    <div className="space-y-4 text-sm">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Answered" value={`${data.responded}/${data.invited}`} hint={data.invited ? `${Math.round((data.responded / data.invited) * 100)}% response rate` : undefined} />
        <Stat label="NPS" value={n.nps ?? "—"} tone={npsTone(n.nps)} />
        <div className="card p-4">
          <p className="text-[13px] text-slate-500">Promoters · passives · detractors</p>
          <div className="mt-2 flex overflow-hidden rounded" role="img" aria-label={`${n.promoters} promoters, ${n.passives} passives, ${n.detractors} detractors`}>{bar(n.promoters, "bg-emerald-500")}{bar(n.passives, "bg-slate-300")}{bar(n.detractors, "bg-rose-500")}</div>
          <p className="mt-1 text-xs text-slate-500">{n.promoters} · {n.passives} · {n.detractors}</p>
        </div>
      </div>
      {data.trend.length > 1 && <p className="text-xs text-slate-600">NPS by month: {data.trend.map(t => `${t.month}: ${t.nps ?? "—"} (${t.responses})`).join(" · ")}</p>}
      {data.questions.filter(q => q.type !== "nps").map(q => (
        <section key={q.id} className="rounded-lg border border-slate-200 p-3">
          <p className="font-medium">{q.label} <span className="text-xs font-normal text-slate-500">({q.count} answers)</span></p>
          {q.type === "rating" && <p className="text-lg font-semibold">{q.average ?? "—"} <span className="text-sm font-normal text-slate-500">/ 5</span></p>}
          {q.type === "choice" && <ul>{Object.entries(q.counts ?? {}).map(([k, v]) => <li key={k} className="flex items-center gap-2"><span className="w-40 truncate">{k}</span><span className="h-2 rounded bg-brand-500" style={{ width: `${q.count ? (v / q.count) * 200 : 0}px` }} /><span className="text-xs">{v}</span></li>)}</ul>}
          {q.type === "text" && <ul className="max-h-60 space-y-1 overflow-y-auto">{(q.texts ?? []).map((t, i) => <li key={i} className="rounded bg-slate-50 p-2">“{t}”</li>)}</ul>}
        </section>
      ))}
      {!data.survey.anonymous && data.responses.length > 0 && (
        <section>
          <p className="mb-1 font-medium">Who answered</p>
          <ul className="max-h-60 divide-y divide-slate-100 overflow-y-auto">{data.responses.map(r => <li key={r.id} className="flex justify-between py-1"><span>{r.guardians?.full_name ?? "—"}</span><span>{r.nps ?? ""} <span className="text-xs text-slate-400">{fmtDate(r.created_at)}</span></span></li>)}</ul>
        </section>
      )}
    </div>
  );
}
