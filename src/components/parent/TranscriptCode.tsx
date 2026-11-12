"use client";
import { useState } from "react";
import { send } from "@/components/ui";
import { formatCode, isCodeShape, cleanCode } from "@/lib/sign-up-codes";

/** A parent types the transcript code the school gave them for a child. */
export default function TranscriptCode({ onUnlocked }: { onUnlocked: (studentId: string | null) => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <form className="card space-y-3 p-5" onSubmit={async e => {
      e.preventDefault();
      if (!isCodeShape(code)) { setErr("A transcript code has 8 letters and numbers, like ABCD-EFGH."); return; }
      setBusy(true); setErr(null);
      const r = await send<{ student_id: string | null }>("/api/parent/transcript-code", { code: cleanCode(code) }, "POST", { quiet: true });
      setBusy(false);
      if (!r.ok) { setErr(r.error ?? "Please try again."); return; }
      setCode(""); onUnlocked(r.data.student_id);
    }}>
      <div>
        <h2 className="font-semibold">Enter the transcript code</h2>
        <p className="mt-1 text-sm text-slate-600">The school gives each child&apos;s transcript its own code. Type it here once to open the transcript; it works only for this child&apos;s parents.</p>
      </div>
      <input className="input text-center font-mono text-xl uppercase tracking-[0.25em]" placeholder="ABCD-EFGH" maxLength={9} autoComplete="off" spellCheck={false} autoFocus
        value={code} onChange={e => setCode(formatCode(e.target.value))} aria-label="Transcript code" />
      {err && <p className="text-sm text-rose-600" role="alert">{err}</p>}
      <button className="btn btn-primary w-full" disabled={busy}>{busy ? "Checking…" : "Open the transcript"}</button>
      <p className="text-xs text-slate-500">No code yet? Ask the school office.</p>
    </form>
  );
}
