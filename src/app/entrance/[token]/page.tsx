"use client";
import { use, useCallback, useEffect, useRef, useState } from "react";
import QuestionView, { type PublicQuestion } from "@/components/exams/QuestionView";
import ExamTools from "@/components/exams/tools/ExamTools";
import WebcamProctor, { requestCamera } from "@/components/exams/WebcamProctor";
import type { ToolId } from "@/lib/exams/tools";

type Info = { title: string; instructions: string | null; duration_minutes: number; child: string; window: "not_open" | "open" | "closed"; opens_at: string | null; closes_at: string | null;
  status: string; school: { name: string; logo_url: string | null; brand_color: string | null }; tools: ToolId[]; reference_text: string | null;
  /** Taken at a centre (with a PIN on the school's computer), and whether the candidate has checked in there. */
  centre?: { name: string; address: string | null; starts_at: string; ends_at: string; checked_in: boolean } | null;
  /** The camera checks the right person is taking the test at home. */
  face_check?: boolean;
  /** The school asks for Safe Exam Browser at home: whether this page is open in it, and the applicant's own SEB file. */
  seb?: { required: boolean; in_seb: boolean; file_url: string; launch_url: string } | null };
type Attempt = { deadline_at: string; server_now: string; answers: Record<string, unknown>; questions: PublicQuestion[] };

async function api(token: string, body?: unknown) {
  const r = await fetch(`/api/entrance/${token}`, body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { ok: r.ok, data: await r.json().catch(() => ({})) };
}

/** Online entrance test for an applicant (private link, no account). Autosaves; submits itself when time runs out. */
export default function EntrancePage(props: { params: Promise<{ token: string }> }) {
  const { token } = use(props.params);
  const [info, setInfo] = useState<Info | null>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [i, setI] = useState(0);
  const [left, setLeft] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const dirty = useRef<Record<string, unknown>>({});
  const offset = useRef(0);
  const submitting = useRef(false);
  const [camera, setCamera] = useState<MediaStream | null>(null);
  const [consent, setConsent] = useState(false);
  // On a test-centre computer the page goes back to the PIN screen for the next candidate.
  const [kiosk, setKiosk] = useState(false);
  useEffect(() => { setKiosk(new URLSearchParams(window.location.search).get("kiosk") === "1"); }, []);

  const load = useCallback(async () => {
    const r = await api(token);
    if (!r.ok) return setErr(r.data.error ?? "This link is not valid.");
    setInfo(r.data.info);
    if (r.data.attempt) { setAttempt(r.data.attempt); setAnswers(r.data.attempt.answers ?? {}); offset.current = new Date(r.data.attempt.server_now).getTime() - Date.now(); }
    else setAttempt(null);
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const flush = useCallback(async () => {
    if (!attempt || !Object.keys(dirty.current).length) return;
    const pending = dirty.current; dirty.current = {};
    const r = await api(token, { action: "save", answers: pending });
    if (!r.ok) dirty.current = { ...pending, ...dirty.current };
  }, [attempt, token]);
  useEffect(() => { const t = setInterval(flush, 5000); return () => clearInterval(t); }, [flush]);

  const submit = useCallback(async () => {
    if (submitting.current) return;
    submitting.current = true;
    const r = await api(token, { action: "submit", answers: dirty.current });
    submitting.current = false;
    dirty.current = {};
    if (r.ok) {
      setAttempt(null); load();
      if (kiosk) setTimeout(() => { window.location.href = "/entrance/pin?done=1"; }, 6000);
      // In Safe Exam Browser at home, the quit page closes SEB once the thank-you has been read.
      else if (info?.seb?.in_seb) setTimeout(() => { window.location.href = `/entrance/${token}?done=1`; }, 8000);
    }
    else setErr(r.data.error ?? "Could not submit; check your connection and try again.");
  }, [token, load, kiosk, info?.seb?.in_seb]);
  const report = useCallback((kind: string, meta?: Record<string, unknown>) => { void api(token, { action: "event", kind, meta: meta ?? null }); }, [token]);

  useEffect(() => {
    if (!attempt) return;
    const tick = () => {
      const ms = Math.max(0, new Date(attempt.deadline_at).getTime() - (Date.now() + offset.current));
      setLeft(ms);
      if (ms === 0) submit();
    };
    tick();
    const t = setInterval(tick, 1000);
    const blur = () => api(token, { action: "event", kind: "blur" });
    window.addEventListener("blur", blur);
    return () => { clearInterval(t); window.removeEventListener("blur", blur); };
  }, [attempt, submit, token]);

  if (err && !info) return <main className="mx-auto max-w-xl p-6"><p className="rounded-lg bg-slate-100 p-4">{err}</p></main>;
  if (!info) return <main className="p-10 text-center text-sm text-slate-500">Loading…</main>;
  const color = info.school.brand_color ?? "#2f4f8f";

  if (!attempt) {
    const finished = ["submitted", "graded"].includes(info.status);
    return (
      <main className="mx-auto max-w-xl p-6">
        <p className="text-sm font-semibold" style={{ color }}>{info.school.name}</p>
        <h1 className="text-[26px] font-serif font-semibold tracking-[-0.01em]">{info.title}</h1>
        {finished ? <p className="mt-4 rounded-lg bg-emerald-50 p-4">Thank you, {info.child}. Your test has been submitted. The school will be in touch.{kiosk ? " This computer is getting ready for the next candidate." : ""}</p> : (<>
          <p className="mt-2">Hello {info.child}. This test takes {info.duration_minutes} minutes and must be done in one sitting.</p>
          {info.instructions && <div className="mt-3 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm">{info.instructions}</div>}
          <ul className="mt-3 list-disc pl-5 text-sm text-slate-600"><li>The timer keeps running if you close the page.</li><li>Answers save as you go.</li><li>Work on your own, without help.</li></ul>
          {info.centre && !info.centre.checked_in ? (
            <p className="mt-4 rounded-lg bg-slate-50 p-3">This test is taken at <b>{info.centre.name}</b>{info.centre.address ? `, ${info.centre.address}` : ""}, {new Date(info.centre.starts_at).toLocaleString("en-GB", { dateStyle: "full", timeStyle: "short" })}. {info.child} types the test PIN on the school&apos;s computer there.</p>
          ) : info.window !== "open" ? <p className="mt-4 rounded-lg bg-amber-50 p-3">{info.window === "not_open" ? `This test opens ${info.opens_at ? new Date(info.opens_at).toLocaleString() : "later"}.` : "This test has closed."}</p>
            : info.seb?.required && !info.seb.in_seb ? <SebAtHome seb={info.seb} child={info.child} color={color} />
            : (<>
              {info.face_check && (
                <label className="mt-4 flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-sm">
                  <input type="checkbox" className="mt-0.5" checked={consent} onChange={e => setConsent(e.target.checked)} />
                  <span>This test uses the camera to check that {info.child} is taking it alone: a photo every minute, seen only by the school&apos;s admissions team and deleted after 60 days. Sit facing the camera in a well-lit place.</span>
                </label>
              )}
              <button className="btn mt-4 px-6 py-3 text-white" style={{ background: color }} disabled={info.face_check && !consent} onClick={async () => {
                if (info.face_check) {
                  try { setCamera(await requestCamera()); }
                  catch { setErr("This test needs the camera. Allow camera access in your browser and press Start again."); return; }
                }
                const r = await api(token, { action: "start" }); if (!r.ok) setErr(r.data.error); else load();
              }}>Start the test</button>
            </>)}
          {err && <p role="alert" className="mt-3 text-sm text-rose-600">{err}</p>}
        </>)}
      </main>
    );
  }
  const q = attempt.questions[i];
  const mins = Math.floor(left / 60000), secs = Math.floor(left / 1000) % 60;
  const answered = attempt.questions.filter(x => { const v = answers[x.id]; return v !== undefined && v !== null && v !== ""; }).length;
  return (
    <div className="min-h-screen bg-slate-100">
      {info.face_check && <WebcamProctor examId={token} intervalSec={60} initialStream={camera} onEvent={report} uploadUrl={`/api/entrance/${token}/snapshot`} />}
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b bg-white px-4 py-2">
        <p className="truncate font-semibold">{info.title}</p><span className="text-xs text-slate-500">{answered}/{attempt.questions.length} answered</span>
        <span className="ml-auto flex items-center gap-2">
          <ExamTools tools={info.tools ?? []} referenceText={info.reference_text} storageKey={`entrance-rough-${token}`}
            getQuestionText={() => [q.prompt, ...((q.data?.options ?? []) as { text: string }[]).map(o => o.text)].join(". ")} />
          <span className={"rounded px-3 py-1 font-mono font-bold text-white " + (left < 300_000 ? "bg-rose-600" : "bg-slate-900")}>{String(mins).padStart(2, "0")}:{String(secs).padStart(2, "0")}</span>
          <button className="btn text-white" style={{ background: color }} onClick={() => confirm(`Submit now? You answered ${answered} of ${attempt.questions.length}.`) && submit()}>Submit</button>
        </span>
      </header>
      <main className="mx-auto max-w-3xl p-4 sm:p-8">
        <p className="mb-2 text-sm text-slate-600">Question {i + 1} of {attempt.questions.length} · {q.points} mark{q.points === 1 ? "" : "s"}</p>
        <div className="card p-5"><QuestionView key={q.id} q={q} value={answers[q.id]} onChange={v => { setAnswers(a => ({ ...a, [q.id]: v })); dirty.current = { ...dirty.current, [q.id]: v }; }} /></div>
        <div className="mt-4 flex justify-between">
          <button className="btn btn-ghost border border-slate-300 bg-white" disabled={i === 0} onClick={() => { flush(); setI(i - 1); }}>← Previous</button>
          {i < attempt.questions.length - 1 ? <button className="btn text-white" style={{ background: color }} onClick={() => { flush(); setI(i + 1); }}>Next →</button>
            : <button className="btn text-white" style={{ background: color }} onClick={() => confirm("Submit your test?") && submit()}>Submit</button>}
        </div>
        <div className="mt-6 flex flex-wrap gap-1.5">{attempt.questions.map((x, j) => <button key={x.id} onClick={() => { flush(); setI(j); }} className={"h-8 w-8 rounded text-xs font-semibold " + (answers[x.id] !== undefined && answers[x.id] !== "" ? "text-white" : "bg-white")} style={answers[x.id] !== undefined && answers[x.id] !== "" ? { background: color } : undefined} aria-label={`Question ${j + 1}`}>{j + 1}</button>)}</div>
        {err && <p role="alert" className="mt-3 text-sm text-rose-600">{err}</p>}
      </main>
    </div>
  );
}

/** The school asks for Safe Exam Browser at home: how to get it, then open this test in it. */
function SebAtHome({ seb, child, color }: { seb: NonNullable<Info["seb"]>; child: string; color: string }) {
  return (
    <section className="mt-4 rounded-lg border border-slate-200 bg-white p-4 text-sm">
      <h2 className="text-base font-semibold">This test opens in Safe Exam Browser</h2>
      <p className="mt-1 text-slate-600">The school asks for {child}&apos;s test to be taken in Safe Exam Browser, a free app that locks the computer to the test until it is submitted. It works on a Windows or Mac computer, or an iPad (not on Android phones or Chromebooks).</p>
      <ol className="mt-3 list-decimal space-y-1.5 pl-5">
        <li>Install Safe Exam Browser: <a className="underline" href="https://safeexambrowser.org/download_en.html" target="_blank" rel="noreferrer">Windows or Mac</a>, or <a className="underline" href="https://apps.apple.com/app/safeexambrowser/id1155002964" target="_blank" rel="noreferrer">iPad (App Store)</a>.</li>
        <li>Come back to this page on the same device and press the button below. Safe Exam Browser opens on the test.</li>
        <li>Press <b>Start the test</b> there. When it is submitted, Safe Exam Browser closes by itself.</li>
      </ol>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <a className="btn px-5 py-2.5 text-white no-underline" style={{ background: color }} href={seb.launch_url}>Open in Safe Exam Browser</a>
        <a className="text-sm underline" href={seb.file_url}>Or download the test file and open it</a>
      </div>
      <p className="mt-3 text-xs text-slate-500">If nothing happens, check Safe Exam Browser is installed, then press the button again. Keep this link private: it is {child}&apos;s own test.</p>
    </section>
  );
}
