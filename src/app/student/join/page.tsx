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

    // Bootstrap the student profile into the class's tenant, then find the session.
    const setup = await fetch("/api/auth/setup", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "student", full_name: fullName, join_code: code.trim().toUpperCase() })
    });
    const setupJson = await setup.json().catch(() => ({}));
    if (!setup.ok && !setupJson.already) { setBusy(false); setErr(setupJson.error ?? "class not found"); return; }

    const r = await fetch("/api/class-sessions/lookup", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ join_code: code.trim().toUpperCase() })
    });
    setBusy(false);
    if (!r.ok) { const j = await r.json().catch(() => ({})); setErr(j.error ?? "No live session found for that code."); return; }
    const j = await r.json();
    if (!j.id) { setErr("No live session found for that code."); return; }
    router.push(`/student/live/${j.id}`);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-[400px] flex-col px-5 py-10 sm:py-16">
      <Link href="/" className="flex items-center gap-2.5 self-start"><Monogram /><span className="text-[15px] font-semibold tracking-tight">Synergy Swift</span></Link>
      <h1 className="mt-14 font-serif text-[30px] font-semibold leading-tight tracking-[-0.01em]">Join a class</h1>
      <p className="mt-2 text-[15px] text-slate-600 sm:text-sm">Enter the six-character code your teacher shows you.</p>
      {pending ? <PendingConfirm email={email} status={pending} /> : (
      <form onSubmit={onSubmit} className="card mt-7 space-y-5 p-6">
        <div>
          <label className="label">Join code</label>
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
        <button className="btn btn-primary w-full" disabled={busy}>{busy ? "Joining…" : mode === "signup" ? "Sign up + join" : "Sign in + join"}</button>
        <button type="button" onClick={() => setMode(mode === "signup" ? "login" : "signup")} className="btn btn-ghost w-full text-xs">
          {mode === "signup" ? "Already have an account? Sign in instead" : "First time here? Create a student account"}
        </button>
      </form>
      )}
    </main>
  );
}
