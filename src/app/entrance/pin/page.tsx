"use client";
import { useEffect, useRef, useState } from "react";

/**
 * The test-centre computer (phase 14e): the candidate types their one-time PIN and the
 * entrance test opens. Safe Exam Browser starts here when the intake locks centre tests.
 */
export default function EntrancePin() {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { setDone(new URLSearchParams(window.location.search).has("done")); input.current?.focus(); }, []);

  async function go(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const r = await fetch("/api/entrance/pin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setBusy(false); setErr(j.error ?? "That PIN did not work."); setPin(""); input.current?.focus(); return; }
    window.location.href = `/entrance/${j.token}?kiosk=1`;
  }

  // Shown as XXXX-XXXX while typing.
  const shown = pin.replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 8).replace(/^(.{4})(.+)$/, "$1-$2");
  return (
    <main className="grid min-h-screen place-items-center bg-slate-100 p-6">
      <div className="card w-full max-w-md p-8 text-center">
        <h1 className="text-[26px] font-serif font-semibold tracking-[-0.01em]">Entrance test</h1>
        {done && <p className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">Your test has been handed in. Thank you. The next candidate can start below.</p>}
        <p className="mt-2 text-slate-600">Type your test PIN to begin. It has 8 letters and numbers.</p>
        <form onSubmit={go} className="mt-5 space-y-3">
          <input ref={input} value={shown} onChange={e => setPin(e.target.value)} aria-label="Test PIN" autoComplete="off" autoCapitalize="characters" spellCheck={false}
            className="input text-center font-mono text-3xl font-bold tracking-[0.3em]" placeholder="XXXX-XXXX" maxLength={9} />
          <button className="btn btn-primary w-full py-3 text-lg" disabled={busy || shown.replace("-", "").length !== 8}>{busy ? "Checking…" : "Start my test"}</button>
        </form>
        {err && <p role="alert" className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-900">{err}</p>}
        <p className="mt-6 text-xs text-slate-500">Lost your PIN? A member of staff can give you a new one.</p>
      </div>
    </main>
  );
}
