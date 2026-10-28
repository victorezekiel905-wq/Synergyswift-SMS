"use client";
import { useEffect, useRef, useState } from "react";

type Turn = { role: "user" | "model"; text: string };
type Info = { enabled: boolean; per_day: number; phone: string | null; email: string | null };

/**
 * "Ask the school" (phase 14q): a small help chat in the parent portal. It answers from what the school has
 * published and the parent's own children's fees, and points to the school office for anything else.
 */
export default function AskTheSchool() {
  const [info, setInfo] = useState<Info | null>(null);
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { fetch("/api/ai/help").then(r => (r.ok ? r.json() : null)).then(setInfo).catch(() => setInfo(null)); }, []);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [turns, busy]);
  if (!info?.enabled) return null;

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    const q = text.trim();
    if (!q || busy) return;
    const next: Turn[] = [...turns, { role: "user", text: q }];
    setTurns(next); setText(""); setBusy(true); setErr(null);
    const r = await fetch("/api/ai/help", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ turns: next.slice(-12) }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setErr(j.error ?? "Please try again in a minute."); return; }
    const office = j.needs_office && (info?.phone || info?.email) ? `\n\nSchool office: ${[info?.phone, info?.email].filter(Boolean).join(" · ")}` : "";
    setTurns([...next, { role: "model", text: `${j.answer}${office}` }]);
  }

  return (
    <div className="fixed bottom-20 right-4 z-40 sm:bottom-6 sm:right-6">
      {open ? (
        <section className="flex h-[min(520px,75vh)] w-[min(360px,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-overlay" aria-label="Ask the school">
          <header className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2.5">
            <div><p className="text-sm font-semibold">Ask the school</p><p className="text-[11px] text-slate-500">Term dates, events, fees, how-to. Answers by AI.</p></div>
            <button className="btn btn-ghost h-8 w-8 p-0" onClick={() => setOpen(false)} aria-label="Close">
              <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" /></svg>
            </button>
          </header>
          <div className="flex-1 space-y-2.5 overflow-y-auto px-4 py-3 text-sm" aria-live="polite">
            {!turns.length && (
              <div className="space-y-2 text-slate-600">
                <p>Ask about term dates, upcoming events, school notices, how to pay fees, or your child&apos;s fee balance.</p>
                <div className="flex flex-wrap gap-1.5">
                  {["When does the term end?", "How much do I still owe?", "What events are coming up?"].map(s => (
                    <button key={s} className="rounded-full border border-slate-300 px-2.5 py-1 text-xs hover:bg-slate-50" onClick={() => setText(s)}>{s}</button>))}
                </div>
              </div>
            )}
            {turns.map((t, i) => (
              <p key={i} className={`whitespace-pre-wrap rounded-lg px-3 py-2 ${t.role === "user" ? "ml-8 bg-brand-700 text-white" : "mr-8 bg-slate-100 text-slate-800"}`}>{t.text}</p>
            ))}
            {busy && <p className="mr-8 rounded-lg bg-slate-100 px-3 py-2 text-slate-500">Looking that up…</p>}
            {err && <p className="text-xs text-rose-700">{err}</p>}
            <div ref={end} />
          </div>
          <form onSubmit={ask} className="flex gap-2 border-t border-slate-200 p-2.5">
            <input className="input" value={text} onChange={e => setText(e.target.value)} maxLength={600} placeholder="Type your question" aria-label="Your question" />
            <button className="btn btn-primary shrink-0" disabled={busy || !text.trim()}>Ask</button>
          </form>
        </section>
      ) : (
        <button className="btn btn-primary rounded-full px-4 py-2.5 shadow-pop" onClick={() => setOpen(true)}>
          <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden><path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>
          Ask the school
        </button>
      )}
    </div>
  );
}
