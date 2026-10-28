"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Monogram } from "@/components/AppShell";
import PendingConfirm from "@/components/auth/PendingConfirm";

export default function SignupPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"teacher" | "student">("teacher");
  const [tenantName, setTenantName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [schoolCode, setSchoolCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState<"sent" | "waiting" | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    // The account is made by Synergy Swift, which sends the confirmation email itself.
    const reg = await fetch("/api/auth/register", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(role === "teacher"
        ? { as: "school", email, password, full_name: fullName, school_name: tenantName.trim(), school_code: schoolCode.trim() }
        : { as: "student", email, password, full_name: fullName, join_code: joinCode.trim().toUpperCase() })
    });
    const rj = await reg.json().catch(() => ({}));
    if (!reg.ok) { setBusy(false); setErr(rj.error ?? "We couldn't create the account. Please try again."); return; }
    if (rj.status !== "confirmed") { setBusy(false); setPending(rj.status); return; }
    const { error } = await createClient().auth.signInWithPassword({ email, password });
    if (error) { setBusy(false); setErr(error.message); return; }

    const body = role === "student"
      ? { role: "student", full_name: fullName, join_code: joinCode.trim().toUpperCase() }
      : { role: "teacher", full_name: fullName, tenant_name: tenantName.trim(), school_code: schoolCode.trim() };

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
      <p className="mt-2 text-[15px] text-slate-600 sm:text-sm">Create the first admin account with the school code Synergy Swift gave you. Each code works once. Staff joining an existing school: ask your school administrator for an invitation instead.</p>

      {pending ? <PendingConfirm email={email} status={pending} /> : (
      <form onSubmit={onSubmit} className="card mt-7 space-y-5 p-6">
        <div>
          <label className="label">I am a…</label>
          <select className="input" value={role} onChange={(e) => setRole(e.target.value as "teacher" | "student")}>
            <option value="teacher">Setting up a new school</option>
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
          <input className="input" type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>

        {role === "teacher" ? (
          <div>
            <label className="label">School name</label>
            <input className="input" required placeholder="e.g. Greenfield College" value={tenantName} onChange={(e) => setTenantName(e.target.value)} />
            <label className="label mt-4">School code</label>
            <input className="input font-mono uppercase tracking-wider" required placeholder="SSC-XXXX-XXXX-XXXX" maxLength={20} autoComplete="off"
              value={schoolCode} onChange={(e) => setSchoolCode(e.target.value)} />
            <p className="mt-1.5 text-xs text-slate-500">From Synergy Swift. No code yet? <Link href="/demo" className="font-medium text-brand-600">Book a demo</Link> and we will send one.</p>
          </div>
        ) : (
          <div>
            <label className="label">Class join code (from your teacher)</label>
            <input className="input uppercase" required placeholder="ABC123" maxLength={6} value={joinCode} onChange={(e) => setJoinCode(e.target.value)} />
          </div>
        )}

        {err && <p className="text-sm text-rose-600">{err}</p>}
        <button className="btn btn-primary w-full" disabled={busy}>
          {busy ? "Creating…" : role === "teacher" ? "Create school account" : "Create student account"}
        </button>
        <p className="text-center text-xs text-slate-500">
          Already registered? <Link href="/login" className="font-medium text-brand-600">Sign in</Link>
        </p>
      </form>
      )}
    </main>
  );
}
