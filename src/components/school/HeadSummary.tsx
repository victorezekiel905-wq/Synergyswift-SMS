"use client";
import { useState } from "react";
import { send, Alert } from "@/components/ui";

type Summary = { headline: string; points: { text: string; tone: "good" | "watch" | "act" }[]; next_steps: string[] };
const DOT = { good: "bg-emerald-600", watch: "bg-amber-500", act: "bg-rose-600" } as const;

/** "This week in plain words": the head's summary written from the daily school figures (phase 14q). */
export default function HeadSummary() {
  const [s, setS] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function write() {
    setBusy(true); setErr(null);
    const r = await send<Summary>("/api/school/summary");
    setBusy(false);
    if (!r.ok) return setErr(r.error ?? "Please try again.");
    setS(r.data);
  }
  return (
    <section className="card mb-6 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">This week in plain words</h2>
          <p className="text-sm text-slate-500">A short briefing written from the school&apos;s daily figures: what improved, what to watch, what to do.</p>
        </div>
        <button className="btn btn-outline" onClick={write} disabled={busy}>{busy ? "Writing…" : s ? "Write it again" : "Write my summary"}</button>
      </div>
      {err && <div className="mt-3"><Alert>{err}</Alert></div>}
      {s && (
        <div className="mt-4 border-t border-slate-100 pt-4">
          <p className="font-serif text-[17px] font-semibold leading-snug">{s.headline}</p>
          <ul className="mt-3 space-y-2 text-sm text-slate-700">
            {s.points.map((p, i) => <li key={i} className="flex gap-2.5"><span aria-hidden className={`mt-[7px] h-2 w-2 shrink-0 rounded-full ${DOT[p.tone]}`} /><span><span className="sr-only">{p.tone === "good" ? "Good: " : p.tone === "watch" ? "Watch: " : "Act: "}</span>{p.text}</span></li>)}
          </ul>
          {s.next_steps.length > 0 && <>
            <p className="mt-4 text-[13px] font-medium text-slate-900">Next steps</p>
            <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm text-slate-700">{s.next_steps.map((n, i) => <li key={i}>{n}</li>)}</ol>
          </>}
          <p className="mt-3 text-xs text-slate-500">Written by AI from the figures above. Check before you share it.</p>
        </div>
      )}
    </section>
  );
}
