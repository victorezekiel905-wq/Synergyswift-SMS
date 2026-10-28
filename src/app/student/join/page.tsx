"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { Monogram } from "@/components/AppShell";
import PendingConfirm from "@/components/auth/PendingConfirm";

export default function StudentJoin() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<"signup" | "login">("signup");
  const [pending, setPending] = useState<"sent" | "waiting" | null>(null);

  useEffect(() => {
    createClient().auth.getUser().then(({ data }: { data: { user: unknown } | null }) => {
      if (data?.user) setMode("login");
    });
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const sb = createClient();
    if (mode === "signup") {
      // Synergy Swift makes the account and sends the confirmation email itself.
      const reg = await fetch("/api/auth/register", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ as: "student", email, password, full_name: fullName, join_code: code.trim().toUpperCase() })
      });
      const rj = await reg.json().catch(() => ({}));
      if (!reg.ok) { setBusy(false); setErr(rj.error ?? "We couldn't create the account. Please try again."); return; }
      if (rj.status !== "confirmed") { setBusy(false); setPending(rj.status); return; }
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) { setBusy(false); setErr(error.message); return; }
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) { setBusy(false); setErr(error.message); return; }
    }

    // Put the student in the class's school (and the class), then on to their day.
    const setup = await fetch("/api/auth/setup", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "student", full_name: fullName, join_code: code.trim().toUpperCase() })
    });
    const setupJson = await setup.json().catch(() => ({}));
    setBusy(false);
    if (!setup.ok && !setupJson.already) { setErr(setupJson.error ?? "No class has that code. Check it with your teacher."); return; }
    router.push("/student");
    router.refresh();
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-[400px] flex-col px-5 py-10 sm:py-16">
      <Link href="/" className="flex items-center gap-2.5 self-start"><Monogram /><span className="text-[15px] font-semibold tracking-tight">Synergy Swift</span></Link>
      <h1 className="mt-14 font-serif text-[30px] font-semibold leading-tight tracking-[-0.01em]">Student account</h1>
      <p className="mt-2 text-[15px] text-slate-600 sm:text-sm">Make your account with the six-character class code from your teacher. In a lesson right now? <Link href="/live/join" className="font-medium text-brand-700">Join as a guest</Link> instead, no account needed.</p>
      {pending ? <PendingConfirm email={email} status={pending} /> : (
      <form onSubmit={onSubmit} className="card mt-7 space-y-5 p-6">
        <div>
          <label className="label">Class code</label>
          <input className="input uppercase" required maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} />
        </div>
        {mode === "signup" && (
          <div>
            <label className="label">Your name</label>
            <input className="input" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
        )}
        <div>
          <label className="label">Email</label>
          <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="label">Password</label>
          <input className="input" type="password" required minLength={mode === "signup" ? 8 : 1} value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {err && <p className="text-sm text-rose-600">{err}</p>}
        <button className="btn btn-primary w-full" disabled={busy}>{busy ? "One moment…" : mode === "signup" ? "Create my account" : "Sign in and join the class"}</button>
        <button type="button" onClick={() => setMode(mode === "signup" ? "login" : "signup")} className="btn btn-ghost w-full text-xs">
          {mode === "signup" ? "Already have an account? Sign in instead" : "First time here? Create a student account"}
        </button>
      </form>
      )}
    </main>
  );
}
