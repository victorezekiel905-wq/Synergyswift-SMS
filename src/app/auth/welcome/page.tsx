"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Landing page for invitation and magic links. Supabase returns the session in
 * the URL fragment (#access_token=…); we store it, then ask invited users to
 * choose a password so they can sign in normally next time.
 */
export default function WelcomePage() {
  const router = useRouter();
  const [state, setState] = useState<"loading" | "password" | "error">("loading");
  const [err, setErr] = useState<string | null>(null);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [next, setNext] = useState("/dashboard");

  useEffect(() => {
    const url = new URL(window.location.href);
    const n = url.searchParams.get("next");
    if (n && n.startsWith("/") && !n.startsWith("//")) setNext(n);
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const sb = createClient();
    (async () => {
      const errDesc = hash.get("error_description") || url.searchParams.get("error_description");
      if (errDesc) { setErr(errDesc); setState("error"); return; }
      const at = hash.get("access_token"), rt = hash.get("refresh_token");
      if (at && rt) {
        const { error } = await sb.auth.setSession({ access_token: at, refresh_token: rt });
        if (error) { setErr(error.message); setState("error"); return; }
        history.replaceState(null, "", url.pathname + url.search);
      } else {
        const code = url.searchParams.get("code");
        if (code) {
          const { error } = await sb.auth.exchangeCodeForSession(code);
          if (error) { setErr(error.message); setState("error"); return; }
        }
      }
      const { data } = await sb.auth.getUser();
      if (!data.user) { setErr("This link has expired. Ask your school to resend the invitation."); setState("error"); return; }
      setState(hash.get("type") === "invite" || hash.get("type") === "recovery" ? "password" : "password");
    })();
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (pw.length < 8) return setErr("Use at least 8 characters.");
    if (pw !== pw2) return setErr("The passwords do not match.");
    setBusy(true); setErr(null);
    const { error } = await createClient().auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return setErr(error.message);
    await fetch("/api/auth/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => null);
    router.replace(next);
  }

  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <h1 className="text-2xl font-semibold">Welcome</h1>
      {state === "loading" && <p className="mt-4 text-sm text-slate-600">Signing you in…</p>}
      {state === "error" && <p role="alert" className="mt-4 rounded-md bg-rose-50 p-3 text-sm text-rose-700">{err}</p>}
      {state === "password" && (
        <form onSubmit={save} className="card mt-6 space-y-4 p-6">
          <p className="text-sm text-slate-600">Choose a password for your account.</p>
          <label className="block"><span className="label">New password</span><input className="input" type="password" autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} required /></label>
          <label className="block"><span className="label">Confirm password</span><input className="input" type="password" autoComplete="new-password" value={pw2} onChange={e => setPw2(e.target.value)} required /></label>
          {err && <p role="alert" className="text-sm text-rose-600">{err}</p>}
          <button className="btn btn-primary w-full" disabled={busy}>{busy ? "Saving…" : "Save and continue"}</button>
          <button type="button" className="btn btn-ghost w-full text-xs" onClick={() => router.replace(next)}>Skip for now</button>
        </form>
      )}
    </main>
  );
}
