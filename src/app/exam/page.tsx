"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Monogram } from "@/components/AppShell";

/**
 * synergyswift.com/exam: the short way into an exam. The student types the code their teacher
 * gave, and the exam opens with the code filled in, ready to start. Not signed in: sign in first
 * and come straight back here.
 */
export default function ExamByCode() {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  useEffect(() => { const c = new URLSearchParams(window.location.search).get("code"); if (c) setCode(c.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12)); }, []);

  async function go(e: React.FormEvent) {
    e.preventDefault();
    const c = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (c.length < 4) { setErr("Type the exam code your teacher gave you."); return; }
    setBusy(true); setErr(null); setSignedOut(false);
    const r = await fetch("/api/student/exams/find", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: c }) }).catch(() => null);
    if (!r) { setBusy(false); setErr("No connection. Check the internet and try again."); return; }
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) { setBusy(false); setSignedOut(true); return; }
    if (r.status === 403 && /forbidden/i.test(j.error ?? "")) { setBusy(false); setErr("Exams are taken with a student account. Sign out and sign in as the student."); return; }
    if (!r.ok) { setBusy(false); setErr(j.error ?? "Please try again."); return; }
    window.location.assign(`/exam/${j.id}?code=${encodeURIComponent(c)}`);
  }

  const back = `/exam${code ? `?code=${encodeURIComponent(code)}` : ""}`;
  return (
    <main className="mx-auto flex min-h-screen max-w-[420px] flex-col px-5 py-10 sm:py-16">
      <Link href="/" className="flex items-center gap-2.5 self-start"><Monogram /><span className="text-[15px] font-semibold tracking-tight">Synergy Swift</span></Link>
      <h1 className="mt-14 font-serif text-[30px] font-semibold leading-tight tracking-[-0.01em]">Join an exam</h1>
      <p className="mt-2 text-[15px] text-slate-600 sm:text-sm">Type the exam code your teacher gave you.</p>
      <form onSubmit={go} className="card mt-7 space-y-4 p-6">
        <input className="input text-center font-mono text-2xl uppercase tracking-[0.3em]" autoFocus autoComplete="off" spellCheck={false} maxLength={12}
          placeholder="CODE" aria-label="Exam code" value={code} onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} />
        {err && <p role="alert" className="text-sm text-rose-600">{err}</p>}
        {signedOut && (
          <div role="alert" className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
            Sign in with your student account first.
            <Link href={`/login?as=student&next=${encodeURIComponent(back)}`} className="btn btn-primary mt-2 w-full no-underline">Sign in and come back</Link>
          </div>
        )}
        <button className="btn btn-primary w-full" disabled={busy}>{busy ? "Finding your exam…" : "Go to my exam"}</button>
      </form>
      <p className="mt-6 text-center text-xs text-slate-500">Your answers save as you go. If your connection drops, keep working: they are kept on this device.</p>
    </main>
  );
}
