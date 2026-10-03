"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import SsoButtons from "@/components/auth/SsoButtons";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Second step for accounts with an authenticator app.
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");

  async function finish() {
    const sb = createClient();
    // Resolve where this account belongs (tenant profile, platform console, or not yet invited).
    const r = await fetch("/api/auth/setup", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok && !j.already) {
      if (["not_provisioned", "suspended", "paused", "deactivated"].includes(j.code)) await sb.auth.signOut();
      setErr(j.error ?? "profile setup failed");
      return;
    }
    router.push(j.next ?? "/dashboard");
    router.refresh();
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const sb = createClient();
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) { setBusy(false); setErr(error.message); return; }
    const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
      const { data: f } = await sb.auth.mfa.listFactors();
      const totp = f?.totp?.[0];
      if (totp) { setFactorId(totp.id); setBusy(false); return; }
    }
    await finish();
  }

  async function onCode(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    setBusy(true); setErr(null);
    const { error } = await createClient().auth.mfa.challengeAndVerify({ factorId, code: code.replace(/\s/g, "") });
    if (error) { setBusy(false); setErr("That code did not work. Try the newest code from your authenticator app."); return; }
    await finish();
  }

  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <h1 className="text-2xl font-semibold">Welcome back</h1>
      <p className="mt-1 text-sm text-slate-600">Sign in to your school workspace.</p>
      <div className="card mt-8 space-y-4 p-6">
        {factorId ? (
          <form onSubmit={onCode} className="space-y-4">
            <p className="text-sm text-slate-700">Enter the 6-digit code from your authenticator app.</p>
            <input className="input text-center font-mono text-lg tracking-[0.3em]" inputMode="numeric" autoComplete="one-time-code" maxLength={7} autoFocus
              value={code} onChange={e => setCode(e.target.value.replace(/[^\d ]/g, ""))} aria-label="Authentication code" />
            {err && <p className="text-sm text-rose-600">{err}</p>}
            <button className="btn btn-primary w-full" disabled={busy || code.replace(/\s/g, "").length !== 6}>{busy ? "Checking…" : "Verify"}</button>
            <button type="button" className="w-full text-center text-xs text-slate-500" onClick={async () => { await createClient().auth.signOut(); setFactorId(null); setCode(""); }}>Use a different account</button>
          </form>
        ) : (
          <>
            <SsoButtons />
            <div className="flex items-center gap-3 text-[11px] text-slate-400"><span className="h-px flex-1 bg-slate-200" />or use email<span className="h-px flex-1 bg-slate-200" /></div>
            <form onSubmit={onSubmit} className="space-y-4">
              <div>
                <label className="label">Email</label>
                <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div>
                <label className="label">Password</label>
                <input className="input" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              {err && <p className="text-sm text-rose-600">{err}</p>}
              <button className="btn btn-primary w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
              <p className="text-center text-xs text-slate-500">
                Staff and parents receive an invitation from their school ·{" "}
                <Link href="/student/join" className="font-medium text-brand-600">Join as student</Link>
              </p>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
