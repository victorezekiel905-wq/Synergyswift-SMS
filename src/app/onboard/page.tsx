"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Wordmark } from "@/components/site/SiteChrome";
import PendingConfirm from "@/components/auth/PendingConfirm";

const STEPS = ["Your onboarding code", "Your school and you", "Confirm your email"];

/** "SSC7KQMH3XD" → "SSC-7KQM-H3XD": the code as people expect to see it, whatever they type or paste. */
function formatCode(raw: string): string {
  let s = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (s.startsWith("SSC")) s = s.slice(3);
  s = s.slice(0, 12);
  return s ? ["SSC", ...(s.match(/.{1,4}/g) ?? [])].join("-") : "";
}

/**
 * Onboard your school: a one-time code from Synergy Swift (it lasts 20 minutes
 * and works once), then the school's name and the first admin account.
 */
export default function OnboardPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [code, setCode] = useState("");
  const [expires, setExpires] = useState<string | null>(null);
  const [f, setF] = useState({ school_name: "", full_name: "", email: "", password: "" });
  const [pending, setPending] = useState<"sent" | "waiting" | null>(null);
  // The code is for a school Synergy Swift already set up: its name is shown, not asked for.
  const [fixed, setFixed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (step !== 1) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [step]);
  const left = expires ? Math.max(0, Math.floor((Date.parse(expires) - now) / 1000)) : 0;

  async function check(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const r = await fetch("/api/auth/school-code", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setErr(j.error ?? "That code didn't work. Please try again.");
    setExpires(j.expires_at); setNow(Date.now());
    setFixed(Boolean(j.fixed));
    setF(v => ({ ...v, school_name: j.fixed ? j.school : v.school_name || j.school || "" }));
    setStep(1);
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!left) { setErr("Your code has expired. Ask Synergy Swift for a new one."); return; }
    setBusy(true); setErr(null);
    const r = await fetch("/api/auth/register", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ as: "school", school_code: code, school_name: f.school_name.trim(), full_name: f.full_name.trim(), email: f.email.trim(), password: f.password, terms_accepted_at: new Date().toISOString() })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setBusy(false); setErr(j.error ?? "We couldn't create the school. Please try again."); return; }
    if (j.status !== "confirmed") { setBusy(false); setPending(j.status); setStep(2); return; }
    // The project confirms accounts by itself: sign in and create the school now.
    const { error } = await createClient().auth.signInWithPassword({ email: f.email.trim(), password: f.password });
    if (error) { setBusy(false); setErr(error.message); return; }
    const s = await fetch("/api/auth/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ full_name: f.full_name.trim(), tenant_name: f.school_name.trim() }) });
    const sj = await s.json().catch(() => ({}));
    setBusy(false);
    if (!s.ok && !sj.already) { setErr(sj.error ?? "The school couldn't be set up. Sign in to try again."); return; }
    router.push(sj.next ?? "/school");
    router.refresh();
  }

  return (
    <div className="grid min-h-screen bg-white lg:grid-cols-[minmax(340px,0.85fr)_1.15fr]">
      <aside className="flex flex-col justify-between bg-navy px-5 py-6 text-white sm:px-10 lg:py-12">
        <Link href="/" aria-label="Synergy Swift home" className="no-underline"><Wordmark onDark /></Link>
        <div className="mt-8 lg:my-0">
          <p className="flex items-center gap-3 text-[13px] text-brass-300"><span aria-hidden className="h-px w-6 bg-current" />Onboard your school</p>
          <h1 className="mt-3 font-serif text-[24px] font-semibold leading-[1.12] tracking-[-0.015em] sm:text-[36px] lg:mt-4">Five minutes from code to classroom.</h1>
          <p className="mt-2 font-mono text-[12px] text-white/60 lg:hidden">Step {step + 1} of 3 · {STEPS[step]}</p>
          <ol className="mt-10 hidden space-y-5 lg:block">
            {STEPS.map((s, i) => (
              <li key={s} className="flex items-center gap-4" aria-current={i === step ? "step" : undefined}>
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border font-mono text-[12px] ${i < step ? "border-brass-300 bg-brass-300 text-navy" : i === step ? "border-white text-white" : "border-white/25 text-white/45"}`}>
                  {i < step ? <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2" /></svg> : `0${i + 1}`}
                </span>
                <span className={i === step ? "font-medium text-white" : i < step ? "text-white/80" : "text-white/45"}>{s}</span>
              </li>
            ))}
          </ol>
        </div>
        <p className="hidden text-[12.5px] leading-relaxed text-white/55 lg:block">No code yet? Codes come from Synergy Swift. <Link href="/demo" className="text-white underline decoration-white/40 underline-offset-2">Book a walk-through</Link> and we will send one when your school is ready to start.</p>
      </aside>

      <main className="flex items-center px-5 py-10 sm:px-10 lg:px-16">
        <div className="mx-auto w-full max-w-[440px]">
          {step === 0 && (
            <form onSubmit={check}>
              <p className="font-mono text-[12px] text-brass-700">Step 01</p>
              <h2 className="mt-2 font-serif text-[26px] font-semibold tracking-[-0.01em] text-navy">Enter your onboarding code</h2>
              <p className="mt-2 text-[14.5px] leading-relaxed text-slate-600">Synergy Swift gave you a code for your school. It works once and lasts 20 minutes from when it was made.</p>
              <label htmlFor="ob-code" className="label mt-7">Onboarding code</label>
              <input id="ob-code" className="input h-12 text-center font-mono text-lg tracking-[0.12em]" required autoFocus autoComplete="off" spellCheck={false}
                placeholder="SSC-XXXX-XXXX-XXXX" value={code} onChange={e => setCode(formatCode(e.target.value))} maxLength={18} aria-describedby={err ? "ob-err" : undefined} />
              {err && <p id="ob-err" className="mt-3 text-sm text-rose-700">{err}</p>}
              <button className="btn mt-6 h-11 w-full bg-navy text-[15px] text-white hover:bg-brand-900" disabled={busy || code.length < 18}>{busy ? "Checking…" : "Continue"}</button>
              <p className="mt-6 text-center text-[13px] text-slate-500">Already set up? <Link href="/login" className="font-medium text-navy">Sign in</Link></p>
              <p className="mt-3 text-center text-[13px] text-slate-500 lg:hidden">No code yet? <Link href="/demo" className="font-medium text-navy">Book a walk-through</Link></p>
            </form>
          )}

          {step === 1 && (
            <form onSubmit={create}>
              <div className="flex items-center justify-between">
                <p className="font-mono text-[12px] text-brass-700">Step 02</p>
                <p className={`rounded-full px-2.5 py-1 font-mono text-[12px] tabular-nums ring-1 ring-inset ${left > 120 ? "text-slate-600 ring-slate-200" : "bg-amber-50 text-amber-800 ring-amber-200"}`} aria-live="polite">
                  {left ? `Code good for ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` : "Code expired"}
                </p>
              </div>
              <h2 className="mt-2 font-serif text-[26px] font-semibold tracking-[-0.01em] text-navy">{fixed ? "Your account" : "Your school and you"}</h2>
              <p className="mt-2 text-[14.5px] leading-relaxed text-slate-600">{fixed
                ? <>This code is for <b className="text-navy">{f.school_name}</b>. You will be its administrator: set up classes, staff and students once you are in.</>
                : <>You will be the school&apos;s first administrator. You can invite your staff once you are in.</>}</p>
              <div className="mt-7 space-y-4">
                {!fixed && <div><label htmlFor="ob-school" className="label">School name</label>
                  <input id="ob-school" className="input" required minLength={2} maxLength={120} placeholder="e.g. Greenfield College, Ibadan" value={f.school_name} onChange={e => setF({ ...f, school_name: e.target.value })} /></div>}
                <div><label htmlFor="ob-name" className="label">Your full name</label>
                  <input id="ob-name" className="input" required maxLength={120} autoComplete="name" value={f.full_name} onChange={e => setF({ ...f, full_name: e.target.value })} /></div>
                <div><label htmlFor="ob-email" className="label">Your email</label>
                  <input id="ob-email" className="input" type="email" required autoComplete="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></div>
                <div><label htmlFor="ob-pw" className="label">Choose a password</label>
                  <input id="ob-pw" className="input" type="password" required minLength={8} maxLength={72} autoComplete="new-password" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} />
                  <p className="mt-1.5 text-xs text-slate-500">At least 8 characters.</p></div>
              </div>
              {err && <p className="mt-4 text-sm text-rose-700">{err}</p>}
              <button className="btn mt-6 h-11 w-full bg-navy text-[15px] text-white hover:bg-brand-900" disabled={busy || !left}>{busy ? (fixed ? "Creating your account…" : "Creating your school…") : (fixed ? "Create my account" : "Create the school")}</button>
              <p className="mt-4 text-center text-[12.5px] leading-relaxed text-slate-500">By creating the school you agree to the Synergy Swift Terms of Service and Privacy Notice.</p>
              <button type="button" className="mt-3 w-full text-center text-[13px] text-slate-500 hover:text-navy" onClick={() => { setStep(0); setErr(null); }}>Use a different code</button>
            </form>
          )}

          {step === 2 && pending && (
            <div>
              <p className="font-mono text-[12px] text-brass-700">Step 03</p>
              <h2 className="mt-2 font-serif text-[26px] font-semibold tracking-[-0.01em] text-navy">Confirm your email</h2>
              <p className="mt-2 text-[14.5px] leading-relaxed text-slate-600">{fixed
                ? <>Your code is used and your account for <b>{f.school_name}</b> is ready. You become its administrator the first time you sign in.</>
                : <>Your code is used and <b>{f.school_name}</b> is reserved for you. The school opens the first time you sign in.</>}</p>
              <PendingConfirm email={f.email.trim()} status={pending} />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
