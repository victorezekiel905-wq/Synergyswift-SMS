"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { signInEmail, isUsernameEmail } from "@/lib/login-name";
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

type Who = "staff" | "parent" | "student";
const WHO: Record<Who, { tab: string; title: string; lead: string; field: string; join: string }> = {
  staff: { tab: "Staff", title: "Staff sign in", lead: "Teachers, administrators and every member of staff.", field: "Email", join: "New staff? Make your account with the sign-up code from your school" },
  parent: { tab: "Parent", title: "Parent sign in", lead: "See your children's results, fees, attendance and messages.", field: "Email", join: "" },
  student: { tab: "Student", title: "Student sign in", lead: "Your class, lessons, homework, exams, results and progress.", field: "Username", join: "" }
};
/** Which tab an account belongs on. */
const whoFor = (role?: string | null): Who | null => !role ? null : role === "parent" ? "parent" : role === "student" ? "student" : "staff";

export default function LoginPage() {
  const router = useRouter();
  const [who, setWho] = useState<Who>("staff");
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
  const [info, setInfo] = useState<string | null>(null);
  const [unconfirmed, setUnconfirmed] = useState(false);
  useEffect(() => {
    const as = new URLSearchParams(window.location.search).get("as");
    if (as === "staff" || as === "parent" || as === "student") setWho(as);
    else { try { const saved = localStorage.getItem("ss-login-as"); if (saved === "parent" || saved === "student") setWho(saved); } catch { /* storage off */ } }
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
    // Each account signs in from its own tab: a parent on the Staff tab is told where to go.
    const actual = j.platform || j.group ? "staff" : whoFor(j.role);
    // Back from an email link the person has already shown who they are: no wrong-tab stop.
    const fromLink = new URLSearchParams(window.location.search).get("finish") === "1";
    if (actual && actual !== who && !fromLink) {
      await sb.auth.signOut();
      setErr(`This is a ${WHO[actual].tab.toLowerCase()} account. Choose "${WHO[actual].tab}" above and sign in there.`);
      return;
    }
    try { localStorage.setItem("ss-login-as", who); } catch { /* storage off */ }
    const after = new URLSearchParams(window.location.search).get("next");
    router.push(j.next && j.next !== "/dashboard" ? j.next : after && after.startsWith("/") && !after.startsWith("//") ? after : "/dashboard");
    router.refresh();
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const sb = createClient();
    setInfo(null); setUnconfirmed(false);
    const { error } = await sb.auth.signInWithPassword({ email: signInEmail(email), password });
    if (error) {
      setBusy(false);
      if (/not confirmed/i.test(error.message)) { setUnconfirmed(true); setErr("This account is not confirmed yet. Open the link we emailed you, or wait for your administrator to confirm it."); return; }
      setErr(error.message); return;
    }
    const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
      const { data: f } = await sb.auth.mfa.listFactors();
      const totp = f?.totp?.[0];
      if (totp) { setFactorId(totp.id); setBusy(false); return; }
    }
    await finish();
  }

  /** Sign-in emails from Synergy Swift: a password reset link, or the confirmation link again. */
  async function mail(action: "reset" | "resend") {
    if (!email.trim()) { setErr("Enter your email address first."); return; }
    const to = signInEmail(email);
    if (isUsernameEmail(to)) { setErr("Ask your teacher for a new starting password. They can reset it on the class page."); return; }
    setErr(null); setInfo(null);
    const r = await fetch("/api/auth/email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, email: to }) });
    const j = await r.json().catch(() => ({}));
    if (r.ok) setInfo(j.message); else setErr(j.error ?? "Please try again in a minute.");
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
      <Link href="/" className="flex items-center gap-2.5 self-start"><Monogram /><span className="text-[15px] font-semibold tracking-tight">Synergy Swift</span></Link>
      <h1 className="mt-14 font-serif text-[30px] font-semibold leading-tight tracking-[-0.01em]">{WHO[who].title}</h1>
      <p className="mt-2 text-[15px] text-slate-600 sm:text-sm">{WHO[who].lead}</p>
      <nav aria-label="I am" className="mt-6 grid grid-cols-3 gap-1 rounded-lg border border-slate-200 bg-white p-1" role="tablist">
        {(["staff", "parent", "student"] as Who[]).map(w => (
          <button key={w} type="button" role="tab" aria-selected={who === w} onClick={() => { setWho(w); setErr(null); setInfo(null); }}
            className={"rounded-md py-2 text-sm font-semibold transition-colors " + (who === w ? "bg-navy text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900")}>{WHO[w].tab}</button>
        ))}
      </nav>
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
                <label className="label">{WHO[who].field}</label>
                <input className="input" type="text" inputMode="email" autoCapitalize="none" spellCheck={false} autoComplete="username" required value={email} placeholder={WHO[who].field} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div>
                <label className="label">Password</label>
                <input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              {err && <p className="text-sm text-rose-600">{err}</p>}
              {info && <p role="status" className="text-sm text-emerald-700">{info}</p>}
              <button className="btn btn-primary w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
              <div className="flex flex-wrap justify-between gap-2 text-xs">
                <button type="button" className="font-medium text-brand-700 hover:underline" onClick={() => mail("reset")}>Forgot password?</button>
                {unconfirmed && <button type="button" className="font-medium text-brand-700 hover:underline" onClick={() => mail("resend")}>Send the confirmation email again</button>}
              </div>
              {who === "staff" && <p className="text-center text-xs leading-relaxed text-slate-500">Got a one-time password from the school? Sign in with it above; you will choose your own password next.</p>}
              {who === "staff" && <Link href="/join?as=staff" className="btn btn-outline w-full no-underline">{WHO.staff.join}</Link>}
              {who === "parent" && <Link href="/signup" className="btn btn-outline w-full no-underline">New parent? Make your account</Link>}
              {who === "parent" && <p className="text-center text-xs leading-relaxed text-slate-500">No code is needed to sign up. On your page, add each child with the child&apos;s code from the school.</p>}
              {who === "student" && <Link href="/join?as=student" className="btn btn-outline w-full no-underline">New student? Sign up with your code</Link>}
              {who === "student" && <p className="text-center text-xs leading-relaxed text-slate-500">Your school gives you a sign-up code. You choose your own username and password and go straight to your student page.</p>}
              {who === "staff" && <p className="text-center text-xs text-slate-500">New school with an onboarding code? <Link href="/onboard" className="font-medium text-brand-700 hover:underline">Onboard your school</Link></p>}
            </form>
            )}
          </>
        )}
      </div>
    </main>
  );
}
