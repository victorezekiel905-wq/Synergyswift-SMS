"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import SsoButtons, { ssoEnabled } from "@/components/auth/SsoButtons";
import PhoneLogin from "@/components/auth/PhoneLogin";
import { Monogram } from "@/components/AppShell";

// Why someone was sent back to sign in (?error=…).
const REASONS: Record<string, string> = {
  idle: "You were signed out after a period of inactivity.",
  session_expired: "Your session reached the time limit your school set. Please sign in again.",
  sso_required: "Your school requires you to sign in with your school Google or Microsoft account.",
  missing_oauth_code: "Single sign-on did not finish. Please try again."
};

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Second step for accounts with an authenticator app.
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [mode, setMode] = useState<"email" | "phone">("email");
  const [phoneOk, setPhoneOk] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    const e = new URLSearchParams(window.location.search).get("error");
    if (e) setNotice(REASONS[e] ?? e);
    // Back from Google or Microsoft: check the second factor, then finish setting up.
    if (new URLSearchParams(window.location.search).get("finish") === "1") { setBusy(true); afterPhone(); }
    fetch("/api/auth/phone").then(r => r.json()).then(j => setPhoneOk(Boolean(j.available))).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // After a phone-code sign-in: ask for the second factor if the account has one.
  async function afterPhone() {
    const sb = createClient();
    const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
      const { data: f } = await sb.auth.mfa.listFactors();
      const totp = f?.totp?.[0];
      if (totp) { setFactorId(totp.id); setBusy(false); return; }
    }
    setBusy(true);
    await finish();
  }

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
    const after = new URLSearchParams(window.location.search).get("next");
    router.push(j.next && j.next !== "/dashboard" ? j.next : after && after.startsWith("/") && !after.startsWith("//") ? after : "/dashboard");
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
    <main className="mx-auto flex min-h-screen max-w-[400px] flex-col px-5 py-10 sm:py-16">
      <Link href="/" className="flex items-center gap-2.5 self-start"><Monogram /><span className="text-[15px] font-semibold tracking-tight">EduClass Fusion</span></Link>
      <h1 className="mt-14 font-serif text-[30px] font-semibold leading-tight tracking-[-0.01em]">Sign in</h1>
      <p className="mt-2 text-[15px] text-slate-600 sm:text-sm">Use the account your school set up for you.</p>
      {notice && <p role="status" className="mt-5 rounded-md border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm text-amber-950">{notice}</p>}
      <div className="card mt-7 space-y-5 p-6">
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
            {ssoEnabled && <div className="flex items-center gap-3 text-xs text-slate-400"><span className="h-px flex-1 bg-slate-200" />or<span className="h-px flex-1 bg-slate-200" /></div>}
            {phoneOk && (
              <div className="grid grid-cols-2 gap-1 rounded-md bg-slate-100 p-1 text-sm" role="tablist" aria-label="Sign in with">
                {(["email", "phone"] as const).map(m => <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
                  className={"rounded py-1.5 transition-colors " + (mode === m ? "bg-white font-medium text-slate-900 ring-1 ring-slate-200" : "text-slate-600 hover:text-slate-900")}>{m === "email" ? "Email" : "Phone"}</button>)}
              </div>
            )}
            {mode === "phone" && phoneOk ? <PhoneLogin onSignedIn={afterPhone} /> : (
            <form onSubmit={onSubmit} className="space-y-4">
              <div>
                <label className="label">Email</label>
                <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div>
                <label className="label">Password</label>
                <input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              {err && <p className="text-sm text-rose-600">{err}</p>}
              <button className="btn btn-primary w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
              <p className="text-center text-xs leading-relaxed text-slate-500">
                Staff and parents get an invitation from their school.{" "}
                <Link href="/student/join" className="font-medium text-brand-700 hover:underline">Students: join a class</Link>
              </p>
            </form>
            )}
          </>
        )}
      </div>
    </main>
  );
}
