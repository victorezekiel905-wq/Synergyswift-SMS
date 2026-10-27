"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Monogram } from "@/components/AppShell";

export default function SignupPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"teacher" | "student">("teacher");
  const [tenantName, setTenantName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const sb = createClient();
    const { data, error } = await sb.auth.signUp({
      email, password,
      options: { data: { full_name: fullName } }
    });
    if (error) { setBusy(false); setErr(error.message); return; }

    if (!data.user) {
      // Email confirmation required before the session exists.
      setBusy(false); setConfirming(true);
      return;
    }

    const body = role === "student"
      ? { role: "student", full_name: fullName, join_code: joinCode.trim().toUpperCase() }
      : { role: "teacher", full_name: fullName, tenant_name: tenantName.trim() || "My School" };

    const r = await fetch("/api/auth/setup", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok && !j.already) { setErr(j.error ?? "setup failed"); return; }
    router.push(j.next ?? "/dashboard");
    router.refresh();
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-[420px] flex-col px-5 py-10 sm:py-16">
      <Link href="/" className="flex items-center gap-2.5 self-start"><Monogram /><span className="text-[15px] font-semibold tracking-tight">Synergy Swift</span></Link>
      <h1 className="mt-14 font-serif text-[30px] font-semibold leading-tight tracking-[-0.01em]">Set up your school</h1>
      <p className="mt-2 text-[15px] text-slate-600 sm:text-sm">Create the first admin account. Your school’s records are kept separate from every other school’s.</p>

      <form onSubmit={onSubmit} className="card mt-7 space-y-5 p-6">
        <div>
          <label className="label">I am a…</label>
          <select className="input" value={role} onChange={(e) => setRole(e.target.value as "teacher" | "student")}>
            <option value="teacher">Teacher / school admin</option>
            <option value="student">Student</option>
          </select>
        </div>
        <div>
          <label className="label">Full name</label>
          <input className="input" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </div>
        <div>
          <label className="label">Email</label>
          <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="label">Password</label>
          <input className="input" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>

        {role === "teacher" ? (
          <div>
            <label className="label">School / tenant name</label>
            <input className="input" placeholder="e.g. Lincoln High" value={tenantName} onChange={(e) => setTenantName(e.target.value)} />
          </div>
        ) : (
          <div>
            <label className="label">Class join code (from your teacher)</label>
            <input className="input uppercase" placeholder="ABC123" maxLength={6} value={joinCode} onChange={(e) => setJoinCode(e.target.value)} />
          </div>
        )}

        {err && <p className="text-sm text-rose-600">{err}</p>}
        {confirming && (
          <p className="text-sm text-amber-700">Confirm your email address first — then sign in and you will land in your workspace.</p>
        )}
        <button className="btn btn-primary w-full" disabled={busy}>
          {busy ? "Creating…" : role === "teacher" ? "Create school account" : "Create student account"}
        </button>
        <p className="text-center text-xs text-slate-500">
          Already registered? <Link href="/login" className="font-medium text-brand-600">Sign in</Link>
        </p>
      </form>
    </main>
  );
}
