"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Monogram } from "@/components/AppShell";
import { cleanCode, formatCode, isCodeShape, passwordsMatch } from "@/lib/sign-up-codes";

type Who = "staff" | "parent" | "student";
type Check = { kind: string; as: Who; school: string; name: string | null; child: string | null; role: string; rules: string; needs_name: boolean };

const ROLE_WORDS: Record<string, string> = { school_admin: "school administrator", it_admin: "IT administrator", hr_manager: "HR manager", qa_officer: "quality assurance officer" };
const roleWord = (r: string) => ROLE_WORDS[r] ?? r.replace(/_/g, " ");

export default function JoinPage() {
  return <Suspense fallback={null}><Join /></Suspense>;
}

/**
 * Making an account with a sign-up code from the school (migration 9600): the code first,
 * so the person sees it is theirs, then their email (the username) and a password typed twice.
 */
function Join() {
  const router = useRouter();
  const params = useSearchParams();
  const as = (params.get("as") as Who | null) ?? null;
  const [code, setCode] = useState(formatCode(params.get("code") ?? ""));
  const [info, setInfo] = useState<Check | null>(null);
  const [f, setF] = useState({ name: "", email: "", pw: "", pw2: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (isCodeShape(code) && params.get("code")) void check(); /* a link with the code in it */ }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function check(e?: React.FormEvent) {
    e?.preventDefault();
    if (!isCodeShape(code)) { setErr("A sign-up code has 8 letters and numbers, like ABCD-EFGH."); return; }
    setBusy(true); setErr(null);
    const r = await fetch("/api/auth/code", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "check", code: cleanCode(code) }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setErr(j.error ?? "Please try again."); return; }
    setInfo(j);
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const mismatch = passwordsMatch(f.pw, f.pw2);
    if (mismatch) { setErr(mismatch); return; }
    setBusy(true); setErr(null);
    const r = await fetch("/api/auth/code", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "claim", code: cleanCode(code), email: f.email, password: f.pw, password2: f.pw2, full_name: f.name || null }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setBusy(false); setErr(j.error ?? "Please try again."); return; }
    // Signed straight in, onto the dashboard for their role.
    const sb = createClient();
    const { error } = await sb.auth.signInWithPassword({ email: j.email, password: f.pw });
    if (error) { setBusy(false); router.push(`/login?as=${info?.as ?? "staff"}`); return; }
    await fetch("/api/auth/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => null);
    try { localStorage.setItem("ss-login-as", info?.as ?? "staff"); } catch { /* storage off */ }
    router.push(j.next ?? "/dashboard");
    router.refresh();
  }

  const title = info ? (info.kind === "parent_link" ? "Make your parent account" : `Make your ${info.as} account`) : "Make your account";
  return (
    <main className="mx-auto flex min-h-screen max-w-[420px] flex-col px-5 py-10 sm:py-16">
      <Link href="/" className="flex items-center gap-2.5 self-start"><Monogram /><span className="text-[15px] font-semibold tracking-tight">Synergy Swift</span></Link>
      <h1 className="mt-14 font-serif text-[30px] font-semibold leading-tight tracking-[-0.01em]">{title}</h1>
      <p className="mt-2 text-[15px] text-slate-600 sm:text-sm">
        {as === "student" ? "Type the sign-up code your school gave you, then choose a username and a password. You go straight to your own student page."
          : as === "parent" ? "Use the sign-up code the school sent you, or your child's code. Your email becomes your username."
          : "Use the sign-up code your school gave you. Your email becomes your username."}
      </p>
      {as === "parent" && !info && <p className="mt-2 text-sm text-slate-600">No code? <Link href="/signup" className="font-medium text-brand-700">Make your parent account without one</Link>, then add your child on your page.</p>}

      {!info ? (
        <form onSubmit={check} className="card mt-7 space-y-4 p-6">
          <div>
            <label className="label" htmlFor="code">Sign-up code</label>
            <input id="code" className="input text-center font-mono text-xl uppercase tracking-[0.25em]" autoFocus autoComplete="one-time-code" spellCheck={false} maxLength={9}
              placeholder="ABCD-EFGH" value={code} onChange={e => setCode(formatCode(e.target.value))} required />
          </div>
          {err && <p className="text-sm text-rose-600" role="alert">{err}</p>}
          <button className="btn btn-primary w-full" disabled={busy}>{busy ? "Checking…" : "Continue"}</button>
        </form>
      ) : (
        <form onSubmit={create} className="card mt-7 space-y-4 p-6">
          <div className="rounded-md bg-slate-50 p-3 text-sm text-slate-700">
            {info.kind === "parent_link"
              ? <>Parent code for <b>{info.child ?? "your child"}</b> at <b>{info.school}</b>.</>
              : <>{info.name ? <>Hello <b>{info.name}</b>. </> : null}This makes your <b>{info.as === "staff" ? roleWord(info.role) : info.as}</b> account at <b>{info.school}</b>.</>}
            <button type="button" className="ml-1 text-brand-700 underline" onClick={() => { setInfo(null); setErr(null); }}>Not you?</button>
          </div>
          {info.needs_name && (
            <div><label className="label" htmlFor="name">Your full name</label>
              <input id="name" className="input" autoComplete="name" required value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></div>
          )}
          {info.as === "student" ? (
            <div><label className="label" htmlFor="email">Choose a username</label>
              <input id="email" className="input" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} required maxLength={254} placeholder="for example ada.obi7"
                value={f.email} onChange={e => setF({ ...f, email: e.target.value.toLowerCase().replace(/\s/g, "") })} />
              <p className="mt-1 text-xs text-slate-500">Small letters, numbers and dots. You sign in with it on the Student tab, so write it down. (You can type an email address instead.)</p></div>
          ) : (
            <div><label className="label" htmlFor="email">Email (your username)</label>
              <input id="email" className="input" type="email" autoComplete="email" required value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></div>
          )}
          <div><label className="label" htmlFor="pw">Password</label>
            <input id="pw" className="input" type="password" autoComplete="new-password" required value={f.pw} onChange={e => setF({ ...f, pw: e.target.value })} />
            <p className="mt-1 text-xs text-slate-500">Use {info.rules}.</p></div>
          <div><label className="label" htmlFor="pw2">Type the password again</label>
            <input id="pw2" className="input" type="password" autoComplete="new-password" required value={f.pw2} onChange={e => setF({ ...f, pw2: e.target.value })}
              aria-invalid={Boolean(f.pw2) && f.pw2 !== f.pw} />
            {f.pw2 && f.pw2 !== f.pw && <p className="mt-1 text-xs text-rose-600">The two passwords are not the same yet.</p>}
            {f.pw2 && f.pw2 === f.pw && <p className="mt-1 text-xs text-emerald-700">The passwords match.</p>}</div>
          {err && <p className="text-sm text-rose-600" role="alert">{err}</p>}
          <button className="btn btn-primary w-full" disabled={busy || !f.pw || f.pw !== f.pw2}>{busy ? "Making your account…" : "Make my account"}</button>
        </form>
      )}
      <p className="mt-6 text-center text-xs text-slate-500">Already have an account? <Link href={`/login${as ? `?as=${as}` : ""}`} className="font-medium text-brand-700">Sign in</Link>.{as !== "student" && as !== "parent" ? " Got a one-time password from the school? Sign in with it." : ""}</p>
    </main>
  );
}
