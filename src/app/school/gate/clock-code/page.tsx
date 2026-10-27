"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import QrCode from "@/components/QrCode";

type Code = { url: string; refresh_s: number; campuses: string[]; campus: string | null; school: string };

/** Full-screen clock-in code for a screen at the entrance: staff scan it with their phone (phase 14i). */
export default function ClockCodePage() {
  const [campus, setCampus] = useState("");
  const [code, setCode] = useState<Code | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const saved = (() => { try { return localStorage.getItem("ss-clock-campus") ?? ""; } catch { return ""; } })();
    if (saved) setCampus(saved);
  }, []);
  useEffect(() => {
    let alive = true, timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const r = await fetch(`/api/gate/clock-code${campus ? `?campus=${encodeURIComponent(campus)}` : ""}`, { cache: "no-store" });
        const j = await r.json();
        if (!alive) return;
        if (!r.ok) { setError(j.error ?? "This screen cannot show the code."); if (r.status === 404 && campus) setCampus(""); }
        else { setCode(j); setError(null); }
        timer = setTimeout(load, (j.refresh_s ?? 15) * 1000);
      } catch { if (alive) timer = setTimeout(load, 5000); }
    };
    void load();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [campus]);
  useEffect(() => { setNow(new Date()); const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  const pick = (c: string) => { setCampus(c); try { localStorage.setItem("ss-clock-campus", c); } catch { /* private window */ } };
  return (
    <main className="min-h-screen bg-slate-900 p-6 text-white sm:p-10">
      <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
        <p className="text-sm uppercase tracking-[0.18em] text-slate-400">{code?.school ?? ""}{code?.campus ? ` · ${code.campus}` : ""}</p>
        <h1 className="mt-2 font-serif text-[34px] font-semibold tracking-[-0.015em]">Staff: scan to sign in or out</h1>
        <p className="mt-1 text-5xl font-light tabular-nums">{now?.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</p>
        <div className="mt-8 rounded-2xl bg-white p-5">
          {code ? <QrCode value={code.url} size={340} /> : <div className="grid h-[340px] w-[340px] place-items-center text-slate-500">{error ?? "Loading…"}</div>}
        </div>
        <p className="mt-6 max-w-md text-slate-300">Open your phone camera and point it at the code. The code changes every few seconds, so a photo of it will not work later.</p>
        {error && code && <p className="mt-3 text-amber-300">{error}</p>}
        {(code?.campuses.length ?? 0) > 0 && (
          <label className="mt-8 text-sm text-slate-400">Campus{" "}
            <select className="ml-2 rounded-lg bg-slate-800 px-3 py-2 text-white" value={campus} onChange={e => pick(e.target.value)}>
              <option value="">Main / not set</option>{code!.campuses.map(c => <option key={c} value={c}>{c}</option>)}
            </select></label>)}
        <Link href="/school/gate" className="mt-6 text-sm text-slate-400 hover:text-white">Exit</Link>
      </div>
    </main>
  );
}
