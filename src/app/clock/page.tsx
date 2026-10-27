"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";

type Result = { ok: boolean; title: string; detail?: string };

/**
 * Where a staff member lands after scanning the clock-in code at the entrance (phase 14i).
 * It signs them in (or out, if they are already in) straight away.
 */
export default function ClockPage() {
  const [result, setResult] = useState<Result | null>(null);
  const [signIn, setSignIn] = useState<string | null>(null);
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    const token = new URLSearchParams(window.location.search).get("t");
    // A refresh must not clock again.
    window.history.replaceState(null, "", "/clock");
    if (!token) { setResult({ ok: false, title: "Scan the code at the entrance", detail: "This page signs you in when you scan the clock-in code on the screen at school." }); return; }
    (async () => {
      const me = await fetch("/api/gate/self", { cache: "no-store" });
      if (me.status === 401) { setSignIn(`/login?next=${encodeURIComponent(`/clock?t=${token}`)}`); return; }
      const info = await me.json().catch(() => ({}));
      if (!me.ok || !info.staff) { setResult({ ok: false, title: "Not linked to a staff record", detail: info.error ?? "Ask HR to link your account to your staff record." }); return; }
      const post = async (lat?: number, lng?: number) => {
        const r = await fetch("/api/gate/self", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ direction: "auto", qr: token, lat: lat ?? null, lng: lng ?? null }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) { setResult({ ok: false, title: "Not recorded", detail: j.error ?? "Please try again." }); return; }
        const time = new Date(j.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
        setResult({ ok: true, title: j.duplicate ? `Already signed ${j.direction}` : `Signed ${j.direction} at ${time}`,
          detail: j.duplicate ? "Your last scan was a moment ago." : j.late ? "You are late for your shift today." : j.early ? "This is before the end of your shift." : j.direction === "in" ? "Have a good day." : "See you next time." });
      };
      const needsPlace = info.geofence && ["geofence", "qr_and_geofence", "auto"].includes(info.mode);
      if (needsPlace && navigator.geolocation) navigator.geolocation.getCurrentPosition(p => post(p.coords.latitude, p.coords.longitude), () => post(), { enableHighAccuracy: true, timeout: 10000 });
      else await post();
    })().catch(() => setResult({ ok: false, title: "No connection", detail: "Check your data or Wi-Fi and scan again." }));
  }, []);
  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 p-6">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        {signIn ? (<>
          <h1 className="text-xl font-semibold text-slate-900">Sign in to clock in</h1>
          <p className="mt-2 text-slate-600">Sign in to Synergy Swift once on this phone; after that, scanning is enough.</p>
          <Link className="btn btn-primary mt-6 w-full justify-center py-3" href={signIn}>Sign in</Link>
        </>) : !result ? <p className="text-slate-600">Recording…</p> : (<>
          <div className={"mx-auto grid h-14 w-14 place-items-center rounded-full text-2xl " + (result.ok ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800")} aria-hidden>{result.ok ? "✓" : "!"}</div>
          <h1 className="mt-4 text-xl font-semibold text-slate-900">{result.title}</h1>
          {result.detail && <p className="mt-2 text-slate-600">{result.detail}</p>}
          <Link className="mt-6 inline-block text-sm text-brand-700 underline" href="/school/gate">My sign-ins today</Link>
        </>)}
      </div>
    </main>
  );
}
