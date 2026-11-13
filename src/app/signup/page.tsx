"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Monogram } from "@/components/AppShell";
import { passwordsMatch, isCodeShape, cleanCode, formatCode } from "@/lib/sign-up-codes";

/**
 * Parents make their own account here: name, email and a password. No code is needed.
 * They land on their page and add each child with that child's code from the school.
 * (Schools start at /onboard; students and staff sign up with their code at /join.)
 */
export default function ParentSignupPage() {
  const [f, setF] = useState({ name: "", email: "", pw: "", pw2: "", code: "" });
  // A link from the school's email can carry the code (?code=…).
  useEffect(() => { const c = new URLSearchParams(window.location.search).get("code"); if (c) setF(x => ({ ...x, code: formatCode(c) })); }, []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const mismatch = passwordsMatch(f.pw, f.pw2);
    if (mismatch) { setErr(mismatch); return; }
    if (f.code.trim() && !isCodeShape(f.code)) { setErr("A sign-up code has 8 letters and numbers, like ABCD-EFGH. Or leave it empty."); return; }
    setBusy(true); setErr(null);
    const post = (url: string, body: unknown) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    // With a code from the school (the parent's own sign-up code, or a child's code): the account is
    // made with it, so the school's records and the children are there at once.
    if (f.code.trim()) {
      const c = await post("/api/auth/code", { action: "check", code: cleanCode(f.code) });
      const cj = await c.json().catch(() => ({}));
      if (!c.ok) { setBusy(false); setErr(cj.error ?? "That code is not right."); return; }
      if (!["guardian", "parent_link"].includes(cj.kind)) { setBusy(false); setErr("That is not a parent's code. Use the code the school gave you as a parent, or your child's code, or leave the box empty."); return; }
      const k = await post("/api/auth/code", { action: "claim", code: cleanCode(f.code), email: f.email, password: f.pw, password2: f.pw2, full_name: f.name });
      const kj = await k.json().catch(() => ({}));
      if (!k.ok) { setBusy(false); setErr(kj.error ?? "Please try again."); return; }
      const { error } = await createClient().auth.signInWithPassword({ email: kj.email, password: f.pw });
      try { localStorage.setItem("ss-login-as", "parent"); } catch { /* storage off */ }
      window.location.assign(error ? "/login?as=parent" : "/parent");
      return;
    }
    const r = await post("/api/auth/parent-signup", { full_name: f.name, email: f.email, password: f.pw, password2: f.pw2 });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setBusy(false); setErr(j.error ?? "Please try again."); return; }
    // Signed straight in, onto the parent page.
    const { error } = await createClient().auth.signInWithPassword({ email: j.email, password: f.pw });
    try { localStorage.setItem("ss-login-as", "parent"); } catch { /* storage off */ }
    window.location.assign(error ? "/login?as=parent" : "/parent");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-[420px] flex-col px-5 py-10 sm:py-16">
      <Link href="/" className="flex items-center gap-2.5 self-start"><Monogram /><span className="text-[15px] font-semibold tracking-tight">Synergy Swift</span></Link>
      <h1 className="mt-14 font-serif text-[30px] font-semibold leading-tight tracking-[-0.01em]">Make your parent account</h1>
      <p className="mt-2 text-[15px] text-slate-600 sm:text-sm">Sign up with or without a code from the school. Without one, add each child with the child&apos;s code once you are in, to see their results, attendance and fees.</p>
      <form onSubmit={create} className="card mt-7 space-y-4 p-6">
        <div><label className="label" htmlFor="name">Your full name</label>
          <input id="name" className="input" autoComplete="name" required value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></div>
        <div><label className="label" htmlFor="email">Email (you sign in with it)</label>
          <input id="email" className="input" type="email" autoComplete="email" autoCapitalize="none" required value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></div>
        <div><label className="label" htmlFor="pw">Password</label>
          <input id="pw" className="input" type="password" autoComplete="new-password" required value={f.pw} onChange={e => setF({ ...f, pw: e.target.value })} />
          <p className="mt-1 text-xs text-slate-500">Use at least 8 characters.</p></div>
        <div><label className="label" htmlFor="pw2">Type the password again</label>
          <input id="pw2" className="input" type="password" autoComplete="new-password" required value={f.pw2} onChange={e => setF({ ...f, pw2: e.target.value })}
            aria-invalid={Boolean(f.pw2) && f.pw2 !== f.pw} />
          {f.pw2 && f.pw2 !== f.pw && <p className="mt-1 text-xs text-rose-600">The two passwords are not the same yet.</p>}</div>
        <div><label className="label" htmlFor="code">Sign-up code <span className="font-normal text-slate-500">(optional)</span></label>
          <input id="code" className="input text-center font-mono uppercase tracking-[0.2em]" placeholder="ABCD-EFGH" maxLength={9} autoComplete="off" spellCheck={false}
            value={f.code} onChange={e => setF({ ...f, code: formatCode(e.target.value) })} />
          <p className="mt-1 text-xs text-slate-500">Got a code from the school, or your child&apos;s code? Type it and your children show at once. No code? Leave it empty and add your children later.</p></div>
        {err && <p className="text-sm text-rose-600" role="alert">{err}</p>}
        <button className="btn btn-primary w-full" disabled={busy || !f.pw || f.pw !== f.pw2}>{busy ? "Making your account…" : "Make my account"}</button>
      </form>
      <p className="mt-6 text-center text-xs text-slate-500">Already have an account? <Link href="/login?as=parent" className="font-medium text-brand-700">Sign in</Link>. Setting up a school? <Link href="/onboard" className="font-medium text-brand-700">Onboard your school</Link>.</p>
    </main>
  );
}
