"use client";
import { useEffect, useMemo, useRef, useState } from "react";

// §3.2 — Universal student renderer for the activity kinds supported by the
// schema. Each kind is its own component so hooks always run in the same
// order. Students never receive answers: the server grades through the
// submit_activity_response RPC.
//
// Supported kinds: multiple_choice, poll, open_ended, fill_blank, matching,
// drag_drop, draw, collab_board, code.
export interface ActivityConfig {
  id: string;
  kind: string;
  title: string;
  body?: string;
  choices?: string[];
  /** Matching: left items and the pool of right items (never the pairing). */
  left?: string[];
  right?: string[];
  /** Fill blank: body contains markers like [b1]; only the marker names are needed here. */
  blank_ids?: string[];
  starter_code?: { language: string; source: string };
}

type Submit = (response: unknown) => Promise<void>;
type Props = { activity: ActivityConfig; sessionId?: string | null; onSubmitted?: (res: { correct: boolean; awarded: number }) => void; disabled?: boolean };

export default function ActivityRenderer({ activity, sessionId, onSubmitted, disabled }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(Date.now());

  const submit: Submit = async (response) => {
    setBusy(true); setError(null);
    const r = await fetch(`/api/activities/${activity.id}/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId ?? null, response, elapsed_ms: Date.now() - started.current })
    });
    setBusy(false);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setError(j.error ?? "Could not submit"); return; }
    onSubmitted?.({ correct: !!j.correct, awarded: j.awarded ?? 0 });
  };

  const off = Boolean(disabled || busy);
  const common = { activity, submit, off, busy };
  let body: React.ReactNode;
  switch (activity.kind) {
    case "multiple_choice": case "poll": body = <Choice {...common} />; break;
    case "open_ended": body = <OpenEnded {...common} />; break;
    case "fill_blank": body = <FillBlank {...common} />; break;
    case "matching": body = <Matching {...common} />; break;
    case "drag_drop": body = <Ordering {...common} />; break;
    case "draw": case "collab_board": body = <Draw {...common} />; break;
    case "code": body = <Code {...common} />; break;
    default: body = <p className="text-sm text-rose-600">Unsupported activity kind: {activity.kind}</p>;
  }
  return (
    <div className="space-y-2">
      <h3 className="text-lg font-semibold">{activity.title}</h3>
      {activity.body && activity.kind !== "fill_blank" && <p className="whitespace-pre-wrap text-sm text-slate-600">{activity.body}</p>}
      {body}
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
    </div>
  );
}

type Part = { activity: ActivityConfig; submit: Submit; off: boolean; busy: boolean };

function Choice({ activity, submit, off, busy }: Part) {
  const [answer, setAnswer] = useState<number | null>(null);
  return (
    <>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {(activity.choices ?? []).map((c, i) => (
          <button key={i} disabled={off} aria-pressed={answer === i}
            className={"rounded-lg border p-3 text-left text-sm transition " + (answer === i ? "border-brand-500 bg-brand-50 ring-2 ring-brand-300" : "border-slate-200 hover:border-slate-400")}
            onClick={() => setAnswer(i)}>{c}</button>
        ))}
      </div>
      <button className="btn btn-primary text-xs" disabled={off || answer === null} onClick={() => submit({ choice: answer })}>{busy ? "…" : "Submit"}</button>
    </>
  );
}

function OpenEnded({ submit, off, busy }: Part) {
  const [text, setText] = useState("");
  return (
    <>
      <textarea className="input min-h-[120px]" placeholder="Type your answer…" disabled={off} value={text} onChange={e => setText(e.target.value)} aria-label="Your answer" />
      <button className="btn btn-primary text-xs" disabled={off || !text.trim()} onClick={() => submit({ text })}>{busy ? "…" : "Submit"}</button>
    </>
  );
}

function FillBlank({ activity, submit, off, busy }: Part) {
  const [values, setValues] = useState<Record<string, string>>({});
  const parts = (activity.body ?? "").split(/(\[[a-z0-9_]+\])/i);
  return (
    <>
      <p className="text-sm text-slate-600">Type the missing words into the boxes.</p>
      <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm leading-8">
        {parts.map((part, i) => {
          const m = /^\[([a-z0-9_]+)\]$/i.exec(part);
          if (!m) return <span key={i} className="whitespace-pre-wrap">{part}</span>;
          return <input key={i} aria-label={`Blank ${m[1]}`} disabled={off} value={values[part] ?? ""}
            className="mx-1 inline-block w-32 rounded border border-slate-300 px-2 py-1 text-sm"
            onChange={e => setValues(v => ({ ...v, [part]: e.target.value }))} />;
        })}
      </div>
      <button className="btn btn-primary text-xs" disabled={off} onClick={() => submit({ blanks: values })}>{busy ? "…" : "Submit"}</button>
    </>
  );
}

function shuffled<T>(a: T[]): T[] {
  const x = a.slice();
  for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; }
  return x;
}

function Matching({ activity, submit, off, busy }: Part) {
  const left = activity.left ?? [];
  const pool = useMemo(() => shuffled(activity.right ?? []), [activity.right]);
  const [match, setMatch] = useState<Record<string, string>>({});
  return (
    <>
      <p className="text-sm text-slate-600">Choose the matching item for each row.</p>
      <div className="space-y-2">
        {left.map(l => (
          <div key={l} className="grid grid-cols-1 items-center gap-2 sm:grid-cols-2">
            <span className="rounded bg-slate-100 px-3 py-2 text-sm">{l}</span>
            <select className="input" disabled={off} value={match[l] ?? ""} onChange={e => setMatch(m => ({ ...m, [l]: e.target.value }))} aria-label={`Match for ${l}`}>
              <option value="">Choose…</option>
              {pool.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        ))}
      </div>
      <button className="btn btn-primary text-xs" disabled={off || Object.keys(match).length < left.length} onClick={() => submit({ pairs: match })}>{busy ? "…" : "Submit matches"}</button>
    </>
  );
}

function Ordering({ activity, submit, off, busy }: Part) {
  const [order, setOrder] = useState<string[]>(() => shuffled(activity.choices ?? []));
  const move = (i: number, d: number) => setOrder(o => { const n = o.slice(); const j = i + d; if (j < 0 || j >= n.length) return o; [n[i], n[j]] = [n[j], n[i]]; return n; });
  return (
    <>
      <p className="text-sm text-slate-600">Put the items in the correct order.</p>
      <ol className="space-y-2">
        {order.map((c, i) => (
          <li key={c} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-2 text-sm">
            <span className="w-5 text-center font-bold text-slate-400">{i + 1}</span><span className="flex-1">{c}</span>
            <button className="btn btn-ghost px-2 py-1" disabled={off || i === 0} onClick={() => move(i, -1)} aria-label="Move up">↑</button>
            <button className="btn btn-ghost px-2 py-1" disabled={off || i === order.length - 1} onClick={() => move(i, 1)} aria-label="Move down">↓</button>
          </li>
        ))}
      </ol>
      <button className="btn btn-primary text-xs" disabled={off} onClick={() => submit({ order })}>{busy ? "…" : "Submit order"}</button>
    </>
  );
}

function Draw({ submit, off, busy }: Part) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const c = canvas.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    ctx.lineWidth = 2; ctx.lineCap = "round"; ctx.strokeStyle = "#1f2937";
    let drawing = false, lastX = 0, lastY = 0;
    const pos = (e: PointerEvent) => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) * (c.width / r.width), (e.clientY - r.top) * (c.height / r.height)]; };
    const down = (e: PointerEvent) => { drawing = true; [lastX, lastY] = pos(e); };
    const move = (e: PointerEvent) => { if (!drawing) return; const [x, y] = pos(e); ctx.beginPath(); ctx.moveTo(lastX, lastY); ctx.lineTo(x, y); ctx.stroke(); lastX = x; lastY = y; };
    const up = () => { drawing = false; };
    c.addEventListener("pointerdown", down); c.addEventListener("pointermove", move);
    c.addEventListener("pointerup", up); c.addEventListener("pointerleave", up);
    return () => { c.removeEventListener("pointerdown", down); c.removeEventListener("pointermove", move); c.removeEventListener("pointerup", up); c.removeEventListener("pointerleave", up); };
  }, []);
  return (
    <>
      <canvas ref={canvas} className="block w-full rounded-lg border border-slate-200 bg-white" width={640} height={360} style={{ touchAction: "none" }} aria-label="Drawing area" />
      <button className="btn btn-primary text-xs" disabled={off} onClick={() => submit({ image: canvas.current?.toDataURL("image/png") ?? "" })}>{busy ? "…" : "Submit drawing"}</button>
    </>
  );
}

function Code({ activity, submit, off, busy }: Part) {
  const language = (activity.starter_code?.language ?? "javascript") as "javascript" | "python" | "html" | "css";
  const [code, setCode] = useState(activity.starter_code?.source ?? "");
  return (
    <>
      <textarea className="input min-h-[180px] font-mono text-xs" value={code} disabled={off} spellCheck={false} onChange={e => setCode(e.target.value)} aria-label={`Your ${language} code`} />
      <RunSandbox language={language} source={code} />
      <button className="btn btn-primary text-xs" disabled={off} onClick={() => submit({ language, source: code })}>{busy ? "…" : "Submit code"}</button>
    </>
  );
}

/**
 * Runs student code in a sandboxed iframe with no same-origin access, so it
 * cannot read the student's session, cookies or call the app's APIs.
 */
function RunSandbox({ language, source }: { language: "javascript" | "python" | "html" | "css"; source: string }) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const [out, setOut] = useState("");
  const [doc, setDoc] = useState<string | null>(null);
  useEffect(() => {
    const onMsg = (e: MessageEvent) => { if (e.source === frame.current?.contentWindow && typeof e.data?.edu_out === "string") setOut(e.data.edu_out); };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);
  function run() {
    if (language === "python") { setOut("Python is checked by your teacher after you submit."); setDoc(null); return; }
    if (language === "javascript") {
      const escaped = JSON.stringify(source).replace(/</g, "\\u003c");
      setDoc(`<script>const logs=[];const console={log:(...a)=>logs.push(a.map(String).join(" ")),error:(...a)=>logs.push("Error: "+a.join(" "))};
try{new Function("console",${escaped})(console)}catch(e){logs.push("Error: "+e.message)}
parent.postMessage({edu_out:logs.join("\\n")||"(no output)"},"*");<\/script>`);
      return;
    }
    setOut("Preview below.");
    setDoc(language === "html" ? source : `<style>${source}</style><div class="preview">Preview</div>`);
  }
  return (
    <div className="space-y-2">
      <button className="btn btn-ghost border border-slate-200 text-xs" onClick={run}>Run</button>
      <pre className="rounded-lg border border-slate-200 bg-slate-900 p-3 text-xs text-slate-100">{out || "// click Run"}</pre>
      {doc !== null && <iframe ref={frame} title="Code output" sandbox="allow-scripts" srcDoc={doc}
        className={language === "javascript" ? "hidden" : "h-48 w-full rounded border border-slate-200 bg-white"} />}
    </div>
  );
}
