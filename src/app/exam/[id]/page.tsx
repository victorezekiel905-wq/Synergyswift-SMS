"use client";
import { useCallback, useEffect, useRef, useState, use } from "react";
import Link from "next/link";
import QuestionView, { type PublicQuestion } from "@/components/exams/QuestionView";
import Calculator from "@/components/exams/Calculator";

type ExamInfo = {
  id: string; title: string; instructions: string | null; duration_minutes: number; opens_at: string | null; closes_at: string | null;
  window: "not_open" | "open" | "closed"; require_seb: boolean; seb_config_url: string; seb_launch_url: string;
  require_fullscreen: boolean; block_copy_paste: boolean; violation_limit: number; allow_spellcheck: boolean; allow_calculator: boolean;
};
type AttemptState = { id: string; status: string; started_at: string; deadline_at: string; violations: number; server_now: string; answers: Record<string, any>; questions: PublicQuestion[] };
type Result = { released: boolean; pending_manual?: boolean; total_score?: number; max_score?: number; per_question?: { id: string; prompt: string; points: number; max: number; feedback: string | null }[] | null };

async function api(id: string, body?: unknown) {
  const r = await fetch(`/api/student/exams/${id}`, body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data: j };
}

/**
 * Student exam room. Lockdown behaviour (exam.net style): full screen, focus
 * tracking, copy/paste blocking, automatic lock after too many violations,
 * server-authoritative timer, autosave with an offline backup in the browser.
 */
export default function ExamRoom(props: { params: Promise<{ id: string }> }) {
  const params = use(props.params);
  const id = params.id;
  const [exam, setExam] = useState<ExamInfo | null>(null);
  const [attempt, setAttempt] = useState<AttemptState | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [current, setCurrent] = useState(0);
  const [flags, setFlags] = useState<Set<string>>(new Set());
  const [saveState, setSaveState] = useState<"saved" | "saving" | "offline" | "idle">("idle");
  const [violations, setViolations] = useState(0);
  const [warning, setWarning] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number>(0);
  const [calc, setCalc] = useState(false);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [isFs, setIsFs] = useState(true);
  const dirty = useRef<Record<string, any>>({});
  const offset = useRef(0);
  const statusRef = useRef<string | null>(null);
  statusRef.current = status;
  const backupKey = `exam-backup-${id}`;

  const load = useCallback(async () => {
    const r = await api(id);
    if (r.data.exam) setExam(r.data.exam);
    if (!r.ok && !r.data.exam) { setError(r.data.error ?? "Could not load the exam."); return; }
    if (r.data.seb_error) { setError(r.data.seb_error); setStatus(r.data.attempt?.status ?? null); return; }
    const a = r.data.attempt;
    if (!a) { setStatus(null); return; }
    setStatus(a.status);
    if (a.questions) {
      setAttempt(a);
      offset.current = new Date(a.server_now).getTime() - Date.now();
      setViolations(a.violations);
      let saved = a.answers ?? {};
      try { const b = JSON.parse(localStorage.getItem(backupKey) ?? "null"); if (b?.attempt === a.id) { saved = { ...saved, ...b.answers }; dirty.current = b.answers; } } catch { /* ignore */ }
      setAnswers(saved);
    } else if (r.data.result) {
      setResult(r.data.result);
    }
  }, [id, backupKey]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const sync = () => setIsFs(Boolean(document.fullscreenElement));
    sync();
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  // ---- server-synced countdown ----
  useEffect(() => {
    if (!attempt) return;
    const tick = () => setRemaining(Math.max(0, new Date(attempt.deadline_at).getTime() - (Date.now() + offset.current)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [attempt]);

  // ---- autosave ----
  const flush = useCallback(async () => {
    const pending = dirty.current;
    if (!attempt || !Object.keys(pending).length || statusRef.current !== "in_progress") return;
    setSaveState("saving");
    try {
      const r = await api(id, { action: "save", answers: pending });
      if (r.ok) {
        if (dirty.current === pending) dirty.current = {};
        else for (const k of Object.keys(pending)) if (dirty.current[k] === pending[k]) delete dirty.current[k];
        localStorage.removeItem(backupKey);
        setSaveState("saved");
        if (r.data.deadline_at && r.data.deadline_at !== attempt.deadline_at) setAttempt(a => a && ({ ...a, deadline_at: r.data.deadline_at }));
      } else if (r.status === 423) { setStatus("locked"); setSaveState("idle"); }
      else if (r.status === 409) { setSaveState("idle"); load(); }
      else setSaveState("offline");
    } catch { setSaveState("offline"); }
  }, [attempt, id, backupKey, load]);
  useEffect(() => { const t = setInterval(flush, 5000); return () => clearInterval(t); }, [flush]);

  function answer(qid: string, v: any) {
    setAnswers(a => ({ ...a, [qid]: v }));
    dirty.current = { ...dirty.current, [qid]: v };
    try { localStorage.setItem(backupKey, JSON.stringify({ attempt: attempt?.id, answers: dirty.current })); } catch { /* storage full */ }
    setSaveState("idle");
  }

  // ---- integrity monitoring ----
  const report = useCallback(async (kind: string, meta: Record<string, unknown> = {}) => {
    if (statusRef.current !== "in_progress") return;
    const r = await api(id, { action: "event", kind, meta }).catch(() => null);
    if (r?.ok) {
      if (typeof r.data.violations === "number") setViolations(r.data.violations);
      if (r.data.status === "locked") setStatus("locked");
    }
  }, [id]);

  useEffect(() => {
    if (!attempt || !exam || status !== "in_progress") return;
    let lastBlur = 0;
    const warn = (t: string) => { setWarning(t); setTimeout(() => setWarning(null), 4000); };
    const onVis = () => { if (document.hidden) { report("visibility_hidden"); warn("You left the exam tab. This has been recorded."); } };
    const onBlur = () => { if (Date.now() - lastBlur > 1500) { lastBlur = Date.now(); report("blur"); warn("The exam window lost focus. This has been recorded."); } };
    const onFs = () => { if (exam.require_fullscreen && !exam.require_seb && !document.fullscreenElement) { report("fullscreen_exit"); warn("Return to full screen to continue."); } };
    const block = (kind: string) => (e: Event) => { if (exam.block_copy_paste) { e.preventDefault(); report(kind); warn("Copy and paste are disabled in this exam."); } };
    const onCopy = block("copy"), onPaste = block("paste"), onCut = block("copy");
    const onCtx = (e: Event) => { if (exam.block_copy_paste) { e.preventDefault(); report("context_menu"); } };
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === "f12" || ((e.ctrlKey || e.metaKey) && e.shiftKey && ["i", "j", "c"].includes(k))) { e.preventDefault(); report("devtools"); }
      if ((e.ctrlKey || e.metaKey) && k === "p") { e.preventDefault(); report("print"); }
      if (k === "printscreen") report("print", { key: "printscreen" });
    };
    const onPrint = () => report("print");
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("blur", onBlur);
    document.addEventListener("fullscreenchange", onFs);
    document.addEventListener("copy", onCopy); document.addEventListener("paste", onPaste); document.addEventListener("cut", onCut);
    document.addEventListener("contextmenu", onCtx);
    window.addEventListener("keydown", onKey);
    window.addEventListener("beforeprint", onPrint);
    // Multiple monitors (Window Management API, where supported).
    const scr = window.screen as Screen & { isExtended?: boolean };
    if (scr.isExtended) report("multiple_screens");
    const beforeUnload = (e: BeforeUnloadEvent) => { if (Object.keys(dirty.current).length) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("fullscreenchange", onFs);
      document.removeEventListener("copy", onCopy); document.removeEventListener("paste", onPaste); document.removeEventListener("cut", onCut);
      document.removeEventListener("contextmenu", onCtx);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("beforeprint", onPrint);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [attempt, exam, status, report]);

  // While locked, poll for the teacher to unlock.
  useEffect(() => {
    if (status !== "locked") return;
    const t = setInterval(async () => { const r = await api(id); const s = r.data.attempt?.status; if (s && s !== "locked") { setStatus(s); if (s !== "in_progress") load(); } }, 5000);
    return () => clearInterval(t);
  }, [status, id, load]);

  // Time up → submit.
  useEffect(() => {
    if (attempt && status === "in_progress" && remaining === 0 && Date.now() + offset.current > new Date(attempt.deadline_at).getTime()) submit(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining]);

  async function start() {
    setError(null);
    if (exam?.require_fullscreen && !exam.require_seb) { try { await document.documentElement.requestFullscreen(); } catch { /* user can re-enter */ } }
    const r = await api(id, { action: "start", access_code: code });
    if (!r.ok) { setError(r.data.error ?? "Could not start."); return; }
    const a = r.data.attempt as AttemptState;
    offset.current = new Date(a.server_now).getTime() - Date.now();
    setAttempt(a); setAnswers(a.answers ?? {}); setStatus(a.status); setViolations(a.violations);
  }

  async function submit(auto = false) {
    setConfirmSubmit(false);
    const r = await api(id, { action: "submit", answers: dirty.current });
    if (r.ok || r.status === 409) {
      dirty.current = {}; localStorage.removeItem(backupKey);
      setStatus(r.data.status ?? "submitted"); setResult(r.data.result ?? null); setAttempt(null);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    } else if (!auto) setError(r.data.error ?? "Submit failed. Check your connection and try again.");
  }

  // ---------------- render ----------------
  if (error && !exam) return <Shell><p role="alert" className="rounded-lg bg-rose-50 p-4 text-rose-700">{error}</p><Link className="btn btn-ghost mt-4" href="/student">Back</Link></Shell>;
  if (!exam) return <Shell><p className="text-slate-500">Loading exam…</p></Shell>;

  if (error && exam.require_seb && !attempt) {
    return (
      <Shell title={exam.title}>
        <p role="alert" className="rounded-lg bg-amber-50 p-4 text-amber-900">{error}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <a className="btn btn-primary" href={exam.seb_launch_url}>Open in Safe Exam Browser</a>
          <a className="btn btn-outline" href={exam.seb_config_url}>Download exam file (.seb)</a>
        </div>
        <p className="mt-3 text-sm text-slate-500">Install Safe Exam Browser from safeexambrowser.org if you do not have it.</p>
      </Shell>
    );
  }

  if (status === "submitted" || status === "graded") {
    return (
      <Shell title={exam.title}>
        <div className="rounded-xl bg-emerald-50 p-6 text-center">
          <p className="text-2xl font-bold text-emerald-700">Submitted ✓</p>
          {result?.released
            ? <p className="mt-2 text-lg">Your score: <b>{result.total_score} / {result.max_score}</b></p>
            : <p className="mt-2 text-slate-600">{result?.pending_manual ? "Some answers are marked by your teacher. " : ""}Your teacher will release the results.</p>}
        </div>
        {result?.per_question && (
          <ul className="mt-4 space-y-2 text-sm">
            {result.per_question.map((q, i) => <li key={q.id} className="card p-3"><b>Q{i + 1}</b> {q.points}/{q.max}{q.feedback ? <span className="block text-slate-600">{q.feedback}</span> : null}</li>)}
          </ul>
        )}
        <Link href={exam.require_seb ? `/exam/${id}/done` : "/student"} className="btn btn-primary mt-6">{exam.require_seb ? "Finish and quit" : "Back to my exams"}</Link>
      </Shell>
    );
  }

  if (!attempt) {
    return (
      <Shell title={exam.title}>
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div className="card p-3"><dt className="text-xs text-slate-500">Duration</dt><dd className="font-semibold">{exam.duration_minutes} minutes</dd></div>
          <div className="card p-3"><dt className="text-xs text-slate-500">Opens</dt><dd className="font-semibold">{exam.opens_at ? new Date(exam.opens_at).toLocaleString() : "Now"}</dd></div>
          <div className="card p-3"><dt className="text-xs text-slate-500">Closes</dt><dd className="font-semibold">{exam.closes_at ? new Date(exam.closes_at).toLocaleString() : "—"}</dd></div>
          <div className="card p-3"><dt className="text-xs text-slate-500">Violation limit</dt><dd className="font-semibold">{exam.violation_limit}</dd></div>
        </dl>
        {exam.instructions && <div className="card mt-4 whitespace-pre-wrap p-4 text-sm">{exam.instructions}</div>}
        <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-slate-600">
          {exam.require_fullscreen && <li>The exam runs in full screen. Leaving full screen is recorded.</li>}
          <li>Switching to another tab or app is recorded. After {exam.violation_limit} violations your exam locks until the teacher unlocks it.</li>
          {exam.block_copy_paste && <li>Copy, paste and right-click are disabled.</li>}
          <li>Your answers save automatically. If your connection drops, keep working; they are kept on this device and sent when you reconnect.</li>
        </ul>
        {exam.window !== "open" ? (
          <p className="mt-6 rounded-lg bg-amber-50 p-4 text-amber-900">{exam.window === "not_open" ? "This exam has not opened yet." : "This exam is closed."}</p>
        ) : (
          <form className="mt-6 flex max-w-md gap-2" onSubmit={e => { e.preventDefault(); start(); }}>
            <input className="input text-center font-mono text-xl uppercase tracking-widest" placeholder="EXAM CODE" value={code} onChange={e => setCode(e.target.value.toUpperCase())} aria-label="Exam code" required />
            <button className="btn btn-primary px-6">Start</button>
          </form>
        )}
        {error && <p role="alert" className="mt-3 text-sm text-rose-600">{error}</p>}
      </Shell>
    );
  }

  const q = attempt.questions[current];
  const mins = Math.floor(remaining / 60000), secs = Math.floor(remaining / 1000) % 60;
  const answered = (qid: string) => { const v = answers[qid]; return v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && !v.some(x => x)) && !(typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length); };
  const answeredCount = attempt.questions.filter(x => answered(x.id)).length;
  // SEB is already a kiosk window, so the browser full-screen rule applies only outside SEB.
  const needFs = exam.require_fullscreen && !exam.require_seb && !isFs;

  return (
    <div className="flex min-h-screen select-none flex-col bg-slate-100" style={exam.block_copy_paste ? { WebkitUserSelect: "none" } : undefined}>
      <header className="sticky top-0 z-20 flex items-center gap-4 border-b border-slate-200 bg-white px-4 py-2">
        <p className="truncate font-semibold">{exam.title}</p>
        <span className="text-xs text-slate-500">{answeredCount}/{attempt.questions.length} answered</span>
        <span className={"text-xs " + (saveState === "offline" ? "text-rose-600" : "text-slate-500")} aria-live="polite">
          {saveState === "saving" ? "Saving…" : saveState === "saved" ? "All changes saved" : saveState === "offline" ? "Offline: answers kept on this device" : ""}
        </span>
        <div className="ml-auto flex items-center gap-3">
          {violations > 0 && <span className="rounded bg-rose-100 px-2 py-1 text-xs font-semibold text-rose-700">Violations {violations}/{exam.violation_limit}</span>}
          {exam.allow_calculator && <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setCalc(c => !c)}>Calculator</button>}
          <span className={"rounded-lg px-3 py-1 font-mono text-lg font-bold tabular-nums " + (remaining < 5 * 60000 ? "bg-rose-600 text-white" : "bg-slate-900 text-white")} aria-label="Time remaining">
            {String(mins).padStart(2, "0")}:{String(secs).padStart(2, "0")}
          </span>
          <button className="btn btn-primary" onClick={() => { flush(); setConfirmSubmit(true); }}>Submit</button>
        </div>
      </header>
      {warning && <div role="alert" className="bg-amber-500 px-4 py-2 text-center text-sm font-semibold text-white">{warning}</div>}
      <div className="flex flex-1">
        <nav aria-label="Questions" className="hidden w-52 shrink-0 overflow-y-auto border-r border-slate-200 bg-white p-3 md:block">
          <div className="grid grid-cols-5 gap-1.5">
            {attempt.questions.map((x, i) => (
              <button key={x.id} onClick={() => { flush(); setCurrent(i); }} aria-label={`Question ${i + 1}${answered(x.id) ? ", answered" : ""}${flags.has(x.id) ? ", flagged" : ""}`}
                className={"relative h-8 rounded text-xs font-semibold " + (i === current ? "ring-2 ring-brand-600 " : "") + (answered(x.id) ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-700")}>
                {i + 1}{flags.has(x.id) && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-amber-500" />}
              </button>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-slate-500">Blue = answered · orange dot = flagged</p>
        </nav>
        <main className="mx-auto w-full max-w-3xl flex-1 p-4 sm:p-8">
          {q.section && (current === 0 || attempt.questions[current - 1]?.section !== q.section) && <p className="mb-2 text-xs font-bold uppercase tracking-wide text-brand-600">{q.section}</p>}
          <div className="mb-3 flex items-center gap-2 text-sm text-slate-500">
            <span className="font-semibold text-slate-800">Question {current + 1} of {attempt.questions.length}</span> · {q.points} {q.points === 1 ? "mark" : "marks"}
            <button className="ml-auto text-xs text-amber-700 hover:underline" onClick={() => setFlags(f => { const n = new Set(f); n.has(q.id) ? n.delete(q.id) : n.add(q.id); return n; })}>{flags.has(q.id) ? "Unflag" : "Flag for review"}</button>
          </div>
          <div className="card p-5 sm:p-6">
            <QuestionView key={q.id} q={q} value={answers[q.id]} onChange={v => answer(q.id, v)} spellcheck={exam.allow_spellcheck}
              onUpload={async (file) => {
                const fd = new FormData(); fd.set("question_id", q.id); fd.set("file", file);
                const r = await fetch(`/api/student/exams/${id}/upload`, { method: "POST", body: fd });
                const j = await r.json().catch(() => ({}));
                if (!r.ok) throw new Error(j.error ?? "Upload failed");
                setAnswers(a => ({ ...a, [q.id]: j }));
              }} />
          </div>
          <div className="mt-4 flex justify-between">
            <button className="btn btn-ghost border border-slate-300 bg-white" disabled={current === 0} onClick={() => { flush(); setCurrent(c => c - 1); }}>← Previous</button>
            {current < attempt.questions.length - 1
              ? <button className="btn btn-primary" onClick={() => { flush(); setCurrent(c => c + 1); }}>Next →</button>
              : <button className="btn btn-primary" onClick={() => { flush(); setConfirmSubmit(true); }}>Review and submit</button>}
          </div>
          <div className="mt-6 flex flex-wrap gap-1.5 md:hidden">
            {attempt.questions.map((x, i) => <button key={x.id} onClick={() => setCurrent(i)} className={"h-8 w-8 rounded text-xs font-semibold " + (answered(x.id) ? "bg-brand-600 text-white" : "bg-white text-slate-700")}>{i + 1}</button>)}
          </div>
        </main>
      </div>

      {calc && <Calculator onClose={() => setCalc(false)} />}

      {confirmSubmit && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 p-4">
          <div className="card max-w-md p-6" role="dialog" aria-modal="true" aria-label="Submit exam">
            <h2 className="text-lg font-semibold">Submit your exam?</h2>
            <p className="mt-2 text-sm text-slate-600">You answered {answeredCount} of {attempt.questions.length} questions{flags.size ? ` and flagged ${flags.size} for review` : ""}. You cannot change answers after submitting.</p>
            <div className="mt-4 flex justify-end gap-2"><button className="btn btn-ghost" onClick={() => setConfirmSubmit(false)}>Keep working</button><button className="btn btn-primary" onClick={() => submit(false)}>Submit</button></div>
          </div>
        </div>
      )}

      {status === "locked" && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-rose-700/95 p-6 text-center text-white">
          <div>
            <p className="text-3xl font-bold">Exam locked</p>
            <p className="mt-3 max-w-md">Too many integrity violations were recorded. Stay where you are and raise your hand. Your teacher can unlock the exam, and your answers are safe.</p>
            <p className="mt-4 text-sm opacity-80">Checking for unlock every few seconds…</p>
          </div>
        </div>
      )}

      {status === "in_progress" && needFs && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-slate-900/90 p-6 text-center text-white">
          <div>
            <p className="text-xl font-semibold">This exam must be taken in full screen.</p>
            <button className="btn btn-primary mt-4" onClick={() => document.documentElement.requestFullscreen().catch(() => {})}>Return to full screen</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Shell({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-3xl px-4 py-10">
        {title && <h1 className="mb-6 text-2xl font-semibold">{title}</h1>}
        {children}
      </div>
    </main>
  );
}
