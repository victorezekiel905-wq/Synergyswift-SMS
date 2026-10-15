"use client";
import { useEffect, useRef, useState } from "react";
import { useApi, send, Alert, Empty, Badge, Modal, Loading, fmtDate } from "@/components/ui";
import RichText from "@/components/content/RichText";
import ContentPlayer, { keepOffline, isKeptOffline, forgetOffline } from "@/components/content/ContentPlayer";
import { KIND } from "@/components/learning/ContentLibrary";
import { STEP_KIND } from "@/components/learning/PathsAdmin";
import { PROVIDER } from "@/components/learning/OnlineLessons";

// ---------------- learning paths ----------------

type PathCard = { id: string; title: string; description: string | null; subject: string | null; done: number; total: number; pct: number; complete: boolean };
type PublicQ = { id: string; type: string; prompt: string; points: number; media_url: string | null; data: any };
type StepView = { id: string; title: string; kind: string; state: "open" | "locked" | "done"; waiting: string[]; progress: { status: string; score: number | null } | null; pass_pct: number;
  body: string | null; url: string | null; package: { id: string; title: string; kind: string } | null; homework: { id: string; title: string; due_at: string } | null; questions: PublicQ[] };

const Bar = ({ pct }: { pct: number }) => <div className="h-2 overflow-hidden rounded bg-slate-100" role="img" aria-label={`${pct}% done`}><div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} /></div>;

export function StudentPaths({ onAsk }: { onAsk: (ctx: { kind: "step"; ref_id: string; title: string }) => void }) {
  const { data, reload } = useApi<{ items: PathCard[] }>("/api/learning-paths");
  const [open, setOpen] = useState<string | null>(null);
  if (open) return <PathView id={open} onBack={() => { setOpen(null); reload(); }} onAsk={onAsk} />;
  if (!data) return <Loading />;
  if (!data.items.length) return <Empty>Your teachers have not shared a learning path with your class yet.</Empty>;
  return (
    <ul className="grid gap-3 sm:grid-cols-2">{data.items.map(p => (
      <li key={p.id}><button className="card w-full space-y-2 p-4 text-left hover:border-brand-300" onClick={() => setOpen(p.id)}>
        <span className="flex items-center gap-2"><b className="mr-auto">{p.title}</b>{p.complete && <Badge tone="green">Finished</Badge>}</span>
        {p.subject && <span className="block text-xs text-slate-500">{p.subject}</span>}
        <Bar pct={p.pct} /><span className="block text-xs text-slate-500">{p.done} of {p.total} steps</span>
      </button></li>))}</ul>
  );
}

function PathView({ id, onBack, onAsk }: { id: string; onBack: () => void; onAsk: (ctx: { kind: "step"; ref_id: string; title: string }) => void }) {
  const { data, error, reload } = useApi<{ path: { title: string; description: string | null; subject: string | null }; pct: number; done: number; total: number; steps: StepView[] }>(`/api/learning-paths?id=${id}`, [id]);
  const [play, setPlay] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  const titleOf = (sid: string) => data.steps.find(s => s.id === sid)?.title ?? "an earlier step";
  return (
    <div className="space-y-3 text-sm">
      <button className="text-brand-700 hover:underline" onClick={onBack}>← My learning paths</button>
      <section className="card space-y-2 p-4">
        <h2 className="text-lg font-semibold">{data.path.title}</h2>
        {data.path.description && <p className="text-slate-600">{data.path.description}</p>}
        <Bar pct={data.pct} /><p className="text-xs text-slate-500">{data.done} of {data.total} steps done</p>
      </section>
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      <ol className="space-y-2">{data.steps.map((s, i) => (
        <li key={s.id} className={"card p-4 " + (s.state === "locked" ? "opacity-60" : "")}>
          <div className="flex items-center gap-2">
            <span className={"grid h-7 w-7 place-items-center rounded-full text-xs font-bold " + (s.state === "done" ? "bg-emerald-100 text-emerald-700" : s.state === "open" ? "bg-brand-100 text-brand-700" : "bg-slate-100 text-slate-500")}>{s.state === "done" ? "✓" : s.state === "locked" ? "🔒" : i + 1}</span>
            <b className="mr-auto">{s.title}</b><Badge tone="slate">{STEP_KIND[s.kind]}</Badge>
            {s.progress?.score != null && <Badge tone={s.state === "done" ? "green" : "amber"}>{s.progress.score}%</Badge>}
          </div>
          {s.state === "locked" ? <p className="mt-2 text-xs text-slate-500">Finish {s.waiting.map(titleOf).join(" and ")} first.</p> : (
            <div className="mt-2 space-y-2">
              {s.body && <RichText text={s.body} />}
              {(s.kind === "link" || s.kind === "video") && s.url && <a className="btn btn-outline" href={s.url} target="_blank" rel="noopener noreferrer">{s.kind === "video" ? "Watch the video" : "Open the link"}</a>}
              {s.kind === "content" && s.package && <button className="btn btn-primary" onClick={() => setPlay(s.package!.id)}>{s.state === "done" ? "Open again" : "Start"}: {s.package.title}</button>}
              {s.kind === "homework" && s.homework && <p>Hand in <b>{s.homework.title}</b> (due {fmtDate(s.homework.due_at, true)}) on <a className="text-brand-700 underline" href="/student">My school</a>. This step ticks itself off when you do.</p>}
              {s.kind === "quiz" && <QuizStep step={s} onDone={(t, ok) => { setMsg({ ok, text: t }); reload(); }} />}
              <div className="flex flex-wrap gap-2">
                {["text", "link", "video"].includes(s.kind) && s.state === "open" && <button className="btn btn-primary" onClick={async () => { const r = await send("/api/learning-paths", { action: "complete", step_id: s.id }); setMsg({ ok: r.ok, text: r.ok ? "Step done. Well done!" : r.error ?? "failed" }); if (r.ok) reload(); }}>I have done this</button>}
                <button className="btn btn-ghost text-xs" onClick={() => onAsk({ kind: "step", ref_id: s.id, title: s.title })}>Ask the study helper</button>
              </div>
            </div>
          )}
        </li>))}</ol>
      <Modal open={Boolean(play)} onClose={() => { setPlay(null); reload(); }} title="Learning content" wide>{play && <ContentPlayer packageId={play} onClose={() => { setPlay(null); reload(); }} />}</Modal>
    </div>
  );
}

function QuizStep({ step, onDone }: { step: StepView; onDone: (text: string, ok: boolean) => void }) {
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [result, setResult] = useState<{ pct: number; passed: boolean; right: Record<string, boolean>; explanations: Record<string, string | null> } | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (id: string, v: unknown) => setAnswers({ ...answers, [id]: v });
  return (
    <form className="space-y-3" onSubmit={async e => {
      e.preventDefault();
      setBusy(true);
      const r = await send<typeof result>("/api/learning-paths", { action: "quiz", step_id: step.id, answers });
      setBusy(false);
      if (!r.ok || !r.data) return onDone(r.error ?? "failed", false);
      setResult(r.data);
      onDone(r.data.passed ? `You scored ${r.data.pct}%. Passed!` : `You scored ${r.data.pct}%. You need ${step.pass_pct}% to pass: check the explanations and try again.`, r.data.passed);
    }}>
      <p className="text-xs text-slate-500">Pass mark {step.pass_pct}%.{step.progress?.status === "passed" ? " You have already passed; you can practise again." : ""}</p>
      {step.questions.map((q, i) => (
        <fieldset key={q.id} className={"rounded-lg border p-3 " + (result ? (result.right[q.id] ? "border-emerald-300 bg-emerald-50/40" : "border-rose-300 bg-rose-50/40") : "border-slate-200")}>
          <legend className="px-1 text-xs text-slate-500">Question {i + 1}</legend>
          <RichText text={q.prompt} />
          {q.type === "mcq_single" && (q.data.options ?? []).map((o: { id: string; text: string }) => (
            <label key={o.id} className="flex items-center gap-2"><input type="radio" name={q.id} checked={answers[q.id] === o.id} onChange={() => set(q.id, o.id)} />{o.text}</label>))}
          {q.type === "mcq_multi" && (q.data.options ?? []).map((o: { id: string; text: string }) => {
            const cur = (answers[q.id] as string[] | undefined) ?? [];
            return <label key={o.id} className="flex items-center gap-2"><input type="checkbox" checked={cur.includes(o.id)} onChange={e => set(q.id, e.target.checked ? [...cur, o.id] : cur.filter(x => x !== o.id))} />{o.text}</label>;
          })}
          {q.type === "true_false" && ["true", "false"].map(v => <label key={v} className="mr-4 inline-flex items-center gap-2"><input type="radio" name={q.id} checked={answers[q.id] === v} onChange={() => set(q.id, v)} />{v === "true" ? "True" : "False"}</label>)}
          {(q.type === "short_answer" || q.type === "numeric" || q.type === "math") && (
            <span className="flex items-center gap-2"><input className="input max-w-xs" value={String(answers[q.id] ?? "")} onChange={e => set(q.id, e.target.value)} inputMode={q.type === "numeric" ? "decimal" : undefined} aria-label={`Answer ${i + 1}`} />{q.data.unit && <span>{q.data.unit}</span>}</span>
          )}
          {!["mcq_single", "mcq_multi", "true_false", "short_answer", "numeric", "math"].includes(q.type) && <p className="text-xs text-slate-500">This question type is answered in exams.</p>}
          {result && result.explanations[q.id] && <p className="mt-1 text-xs text-slate-700"><b>{result.right[q.id] ? "Right." : "Not quite."}</b> {result.explanations[q.id]}</p>}
        </fieldset>
      ))}
      <button className="btn btn-primary" disabled={busy}>{busy ? "Marking…" : result ? "Try again" : "Check my answers"}</button>
    </form>
  );
}

// ---------------- content ----------------

export function StudentContent() {
  const { data, reload } = useApi<{ items: { id: string; title: string; kind: string; description: string | null; size_bytes: number; subjects: { name: string } | null }[]; attempts: { package_id: string; status: string; score: number | null }[] }>("/api/content");
  const [play, setPlay] = useState<string | null>(null);
  const [kept, setKept] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState<{ id: string; done: number; total: number } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!data) return;
    Promise.all(data.items.map(async p => [p.id, await isKeptOffline(p.id)] as const)).then(r => setKept(Object.fromEntries(r)));
  }, [data]);
  if (!data) return <Loading />;
  if (!data.items.length) return <Empty>No interactive content for your class yet.</Empty>;
  const att = (id: string) => data.attempts.find(a => a.package_id === id);
  return (
    <div className="space-y-2 text-sm">
      {msg && <Alert tone="amber">{msg}</Alert>}
      <ul className="grid gap-3 sm:grid-cols-2">{data.items.map(p => {
        const a = att(p.id);
        return (
          <li key={p.id} className="card space-y-2 p-4">
            <div className="flex items-center gap-2"><b className="mr-auto">{p.title}</b><Badge tone="blue">{KIND[p.kind]}</Badge></div>
            <p className="text-xs text-slate-500">{p.subjects?.name ?? ""}{a ? ` · ${a.status === "passed" ? "Passed" : a.status === "completed" ? "Completed" : a.status === "failed" ? "Not passed yet" : "In progress"}${a.score !== null ? ` (${a.score}%)` : ""}` : " · Not started"}</p>
            {p.description && <p className="text-xs text-slate-600">{p.description}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <button className="btn btn-primary" onClick={() => setPlay(p.id)}>{a ? "Continue" : "Start"}</button>
              {p.kind !== "h5p" && (kept[p.id]
                ? <button className="text-xs text-slate-500" onClick={async () => { await forgetOffline(p.id); setKept({ ...kept, [p.id]: false }); }}>Saved offline · remove</button>
                : <button className="text-xs text-brand-700" disabled={Boolean(saving)} onClick={async () => {
                  setSaving({ id: p.id, done: 0, total: 1 });
                  const r = await keepOffline(p.id, (done, total) => setSaving({ id: p.id, done, total }));
                  setSaving(null);
                  if (r.ok) setKept({ ...kept, [p.id]: true }); else setMsg(r.error ?? "could not save offline");
                }}>{saving?.id === p.id ? `Saving ${saving.done}/${saving.total}…` : `Keep for offline use (${(p.size_bytes / 1048576).toFixed(1)} MB)`}</button>)}
            </div>
          </li>
        );
      })}</ul>
      <Modal open={Boolean(play)} onClose={() => { setPlay(null); reload(); }} title="Learning content" wide>{play && <ContentPlayer packageId={play} onClose={() => { setPlay(null); reload(); }} />}</Modal>
    </div>
  );
}

// ---------------- online lessons ----------------

export function StudentOnline() {
  const { data } = useApi<{ items: { id: string; title: string; provider: string; passcode: string | null; starts_at: string; duration_min: number; status: string; window: string; subjects: { name: string } | null; class_groups: { name: string } | null }[] }>("/api/online-lessons");
  if (!data) return <Loading />;
  if (!data.items.length) return <Empty>No online lessons coming up.</Empty>;
  return (
    <ul className="space-y-2 text-sm">{data.items.map(l => (
      <li key={l.id} className="card flex flex-wrap items-center gap-2 p-4">
        <div className="mr-auto"><b>{l.title}</b> <Badge tone="blue">{PROVIDER[l.provider]}</Badge>
          <span className="block text-xs text-slate-500">{l.subjects?.name ? `${l.subjects.name} · ` : ""}{fmtDate(l.starts_at, true)} · {l.duration_min} min{l.passcode ? ` · passcode ${l.passcode}` : ""}</span></div>
        {l.status === "cancelled" ? <Badge tone="red">Cancelled</Badge>
          : l.window === "open" ? <a className="btn btn-primary" href={`/api/online-lessons/join?id=${l.id}`} target="_blank" rel="noreferrer">Join now</a>
          : <span className="text-xs text-slate-500">Opens 15 minutes before</span>}
      </li>))}</ul>
  );
}

// ---------------- study helper ----------------

type Msg = { role: "student" | "tutor"; content: string };
export function TutorChat({ start }: { start: { kind: "homework" | "step"; ref_id: string; title: string } | null }) {
  const list = useApi<{ items: { id: string; title: string; updated_at: string; subjects: { name: string } | null }[]; settings: { enabled: boolean; limit?: number; used?: number } }>("/api/tutor");
  const [conv, setConv] = useState<string | null>(null);
  const [context, setContext] = useState(start);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const end = useRef<HTMLDivElement | null>(null);
  useEffect(() => { setContext(start); if (start) { setConv(null); setMsgs([]); } }, [start]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [msgs]);
  async function openConv(id: string) {
    setConv(id); setContext(null); setErr(null);
    const r = await send<{ messages: Msg[] }>(`/api/tutor?id=${id}`, undefined, "GET");
    setMsgs(r.ok ? r.data.messages : []);
  }
  if (!list.data) return <Loading />;
  const s = list.data.settings;
  if (!s.enabled) return <Empty>The study helper is not switched on for your school.</Empty>;
  return (
    <div className="grid gap-3 text-sm md:grid-cols-[14rem,1fr]">
      <aside className="space-y-1">
        <button className="btn btn-outline w-full" onClick={() => { setConv(null); setMsgs([]); setContext(null); }}>+ New question</button>
        <ul className="space-y-1">{list.data.items.map(c => (
          <li key={c.id}><button className={"w-full rounded px-2 py-1 text-left " + (conv === c.id ? "bg-brand-50 text-brand-800" : "hover:bg-slate-50")} onClick={() => openConv(c.id)}>
            <span className="line-clamp-1">{c.title}</span><span className="block text-xs text-slate-500">{fmtDate(c.updated_at)}</span></button></li>))}</ul>
      </aside>
      <section className="card flex min-h-[24rem] flex-col p-3">
        <p className="mb-2 text-xs text-slate-500">This is an AI study helper. It gives hints and explanations rather than answers. Your teachers and parents can read these chats.{s.limit ? ` ${Math.max(0, s.limit - (s.used ?? 0))} questions left today.` : ""}</p>
        {context && <p className="mb-2 rounded bg-slate-50 px-2 py-1 text-xs">About: <b>{context.title}</b></p>}
        <div className="flex-1 space-y-2 overflow-y-auto">
          {!msgs.length && <p className="text-slate-400">Ask about anything you are learning. For example: “Can you explain how to add fractions with different denominators?”</p>}
          {msgs.map((m, i) => (
            <div key={i} className={"rounded-lg p-2 " + (m.role === "student" ? "ml-8 bg-brand-50" : "mr-8 bg-slate-50")}>
              {m.role === "student" ? <p className="whitespace-pre-wrap">{m.content}</p> : <RichText text={m.content} />}
            </div>))}
          {busy && <p className="text-xs text-slate-500">Thinking…</p>}
          <div ref={end} />
        </div>
        {err && <Alert>{err}</Alert>}
        <form className="mt-2 flex gap-2" onSubmit={async e => {
          e.preventDefault();
          const t = text.trim();
          if (!t || busy) return;
          setBusy(true); setErr(null); setText("");
          setMsgs(m => [...m, { role: "student", content: t }]);
          const r = await send<{ conversation_id: string; reply: string }>("/api/tutor", { action: "send", conversation_id: conv, text: t, context: !conv && context ? { kind: context.kind, ref_id: context.ref_id } : null });
          setBusy(false);
          if (!r.ok) { setErr(r.error); setMsgs(m => m.slice(0, -1)); setText(t); return; }
          setMsgs(m => [...m, { role: "tutor", content: r.data.reply }]);
          if (!conv) { setConv(r.data.conversation_id); list.reload(); }
        }}>
          <textarea className="input min-h-12 flex-1" value={text} onChange={e => setText(e.target.value)} maxLength={4000} placeholder="Type your question" aria-label="Your question"
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); (e.currentTarget.form as HTMLFormElement).requestSubmit(); } }} />
          <button className="btn btn-primary" disabled={busy || !text.trim()}>Send</button>
        </form>
      </section>
    </div>
  );
}

// ---------------- lite mode ----------------

/** Uses less data: audio-only live classes, no animations, images load only when needed. Kept on this device. */
export function LiteModeToggle() {
  const [on, setOn] = useState(false);
  useEffect(() => { try { setOn(localStorage.getItem("ecf-lite") === "1"); } catch { /* storage unavailable */ } }, []);
  return (
    <label className="flex items-center gap-2 text-xs text-slate-600" title="Audio-only live classes, no animations, fewer images">
      <input type="checkbox" checked={on} onChange={e => {
        const v = e.target.checked; setOn(v);
        try { if (v) localStorage.setItem("ecf-lite", "1"); else localStorage.removeItem("ecf-lite"); } catch { /* storage unavailable */ }
        document.documentElement.dataset.lite = v ? "1" : "";
      }} /> Save data (lite mode)
    </label>
  );
}
