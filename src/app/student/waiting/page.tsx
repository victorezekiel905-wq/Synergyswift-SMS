"use client";
import { useEffect, useState } from "react";
import { browserClient } from "@/lib/supabase/lazy";
import { Monogram } from "@/components/AppShell";

type State = { state: "waiting" | "approved" | "none"; name?: string; class_name?: string | null; school?: string | null; logo_url?: string | null };

/**
 * A student who signed up with their class's code waits here until the class teacher confirms
 * them. The page checks every 20 seconds and opens their student page as soon as they are in.
 */
export default function WaitingPage() {
  const [s, setS] = useState<State | null>(null);
  useEffect(() => {
    let stop = false;
    const check = async () => {
      const r = await fetch("/api/student/waiting", { cache: "no-store" }).catch(() => null);
      if (!r) return;
      if (r.status === 401) { window.location.assign("/login?as=student"); return; }
      const j: State = await r.json().catch(() => ({ state: "none" }));
      if (stop) return;
      if (j.state === "approved") { window.location.assign("/student"); return; }
      setS(j);
    };
    check();
    const t = setInterval(() => { if (document.visibilityState === "visible") check(); }, 20_000);
    return () => { stop = true; clearInterval(t); };
  }, []);

  async function signOut() { await (await browserClient()).auth.signOut(); window.location.assign("/login?as=student"); }

  return (
    <main className="mx-auto flex min-h-screen max-w-[440px] flex-col px-5 py-10 sm:py-16">
      <div className="flex items-center gap-2.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {s?.logo_url ? <img src={s.logo_url} alt="" className="h-9 w-auto max-w-[140px] object-contain" /> : <Monogram />}
        <span className="text-[15px] font-semibold tracking-tight">{s?.school ?? "Synergy Swift"}</span>
      </div>
      {!s ? <p className="mt-14 text-sm text-slate-500">Checking…</p> : s.state === "none" ? (
        <>
          <h1 className="mt-14 font-serif text-[28px] font-semibold leading-tight">Your sign-up was not kept</h1>
          <p className="mt-2 text-[15px] text-slate-600">Your class teacher may have declined it, for example if the name did not match anyone in the class. Check your name and code with your teacher, then sign up again.</p>
          <a href="/join?as=student" className="btn btn-primary mt-6">Sign up again</a>
        </>
      ) : (
        <>
          <h1 className="mt-14 font-serif text-[28px] font-semibold leading-tight">Almost there{s.name ? `, ${s.name.split(" ")[0]}` : ""}</h1>
          <p className="mt-2 text-[15px] text-slate-600">
            You signed up for <b>{s.class_name ?? "your class"}</b>. Your class teacher now checks it is you and confirms your account. This page opens your student page by itself as soon as they do.
          </p>
          <div className="card mt-6 flex items-center gap-3 p-4 text-sm text-slate-600">
            <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-amber-500" aria-hidden />
            Waiting for your class teacher. You can close this page and sign in later with your username and password.
          </div>
        </>
      )}
      <button className="btn btn-ghost mt-6 self-start text-sm" onClick={signOut}>Sign out</button>
    </main>
  );
}
