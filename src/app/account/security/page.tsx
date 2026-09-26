"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Page, PageHeader, Alert, Field, Badge, fmtDate } from "@/components/ui";
import { NotificationsToggle } from "@/components/parent/FamilyConnect";

type Factor = { id: string; friendly_name?: string; factor_type: string; status: string; created_at: string };

/**
 * Two-factor sign-in with an authenticator app (Google Authenticator,
 * Microsoft Authenticator, Authy, 1Password…). Required for platform admins,
 * and for school staff when their school turns it on.
 */
export default function AccountSecurityPage() {
  const router = useRouter();
  const [factors, setFactors] = useState<Factor[]>([]);
  const [level, setLevel] = useState<{ current: string | null; next: string | null }>({ current: null, next: null });
  const [enrolling, setEnrolling] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [required, setRequired] = useState<string | null>(null);

  const load = useCallback(async () => {
    const sb = createClient();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) { router.replace("/login"); return; }
    const [{ data: f }, { data: aal }] = await Promise.all([sb.auth.mfa.listFactors(), sb.auth.mfa.getAuthenticatorAssuranceLevel()]);
    setFactors(((f?.all ?? []) as Factor[]).filter(x => x.status === "verified" && x.factor_type === "totp"));
    setLevel({ current: aal?.currentLevel ?? null, next: aal?.nextLevel ?? null });
  }, [router]);

  useEffect(() => {
    setRequired(new URLSearchParams(window.location.search).get("required"));
    load();
  }, [load]);

  const verified = factors.length > 0;
  const sessionVerified = level.current === "aal2";

  async function continueOn() {
    const r = await fetch("/api/auth/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const j = await r.json().catch(() => ({}));
    router.push(j.next && !j.mfa ? j.next : "/dashboard");
    router.refresh();
  }

  async function startEnrol() {
    setBusy(true); setMsg(null);
    const sb = createClient();
    // Clear any half-finished setup first, so the new QR code is the only one.
    const { data: f } = await sb.auth.mfa.listFactors();
    for (const x of (f?.all ?? []) as Factor[]) if (x.status === "unverified") await sb.auth.mfa.unenroll({ factorId: x.id });
    const { data, error } = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: `Authenticator ${new Date().toISOString().slice(0, 16)}` });
    setBusy(false);
    if (error || !data) { setMsg({ ok: false, text: error?.message ?? "could not start setup" }); return; }
    setEnrolling({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  }

  async function verify(factorId: string) {
    setBusy(true); setMsg(null);
    const { error } = await createClient().auth.mfa.challengeAndVerify({ factorId, code: code.replace(/\s/g, "") });
    setBusy(false);
    if (error) { setMsg({ ok: false, text: "That code did not work. Check the time on your phone and try the newest code." }); return; }
    setCode(""); setEnrolling(null);
    setMsg({ ok: true, text: "Two-factor sign-in is on for this session." });
    await load();
    if (required) await continueOn();
  }

  async function remove(id: string) {
    if (!confirm("Remove this authenticator? If your school requires two-factor sign-in, you will lose access until you add another.")) return;
    const { error } = await createClient().auth.mfa.unenroll({ factorId: id });
    setMsg({ ok: !error, text: error ? error.message : "Authenticator removed." });
    load();
  }

  const codeInput = (
    <Field label="6-digit code from your authenticator app">
      <input className="input max-w-[12rem] text-center font-mono text-lg tracking-[0.3em]" inputMode="numeric" autoComplete="one-time-code" maxLength={7}
        value={code} onChange={e => setCode(e.target.value.replace(/[^\d ]/g, ""))} aria-label="Authentication code" />
    </Field>
  );

  return (
    <Page>
      <PageHeader eyebrow="Account" title="Account security"
        subtitle="Two-factor sign-in stops anyone who learns your password from getting in. You enter a code from an app on your phone as well as your password." />
      {required && !sessionVerified && (
        <div className="mb-4"><Alert tone="amber">
          {required === "platform"
            ? "Platform administrators must use two-factor sign-in. Set it up below to open the platform console."
            : "Your school requires two-factor sign-in for your role. Set it up below to continue."}
        </Alert></div>
      )}
      {msg && <div className="mb-4"><Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert></div>}

      <section className="card space-y-4 p-5">
        <div className="flex items-center gap-2">
          <h2 className="mr-auto font-semibold">Authenticator app</h2>
          <Badge tone={verified ? "green" : "slate"}>{verified ? "On" : "Off"}</Badge>
          {verified && <Badge tone={sessionVerified ? "green" : "amber"}>{sessionVerified ? "This session verified" : "This session not verified"}</Badge>}
        </div>

        {verified && !sessionVerified && !enrolling && (
          <form className="space-y-3" onSubmit={e => { e.preventDefault(); verify(factors[0].id); }}>
            <p className="text-sm text-slate-600">Enter the current code to verify this session.</p>
            {codeInput}
            <button className="btn btn-primary" disabled={busy || code.replace(/\s/g, "").length !== 6}>Verify</button>
          </form>
        )}

        {verified && (
          <ul className="divide-y divide-slate-100 text-sm">{factors.map(f => (
            <li key={f.id} className="flex items-center justify-between py-2">
              <span>{f.friendly_name ?? "Authenticator"} <span className="text-xs text-slate-500">added {fmtDate(f.created_at)}</span></span>
              {sessionVerified && <button className="text-xs text-rose-600" onClick={() => remove(f.id)}>Remove</button>}
            </li>))}</ul>
        )}

        {!enrolling && (!verified || sessionVerified) && (
          <button className="btn btn-primary" onClick={startEnrol} disabled={busy}>{verified ? "Add another authenticator" : "Set up two-factor sign-in"}</button>
        )}

        {enrolling && (
          <form className="grid gap-4 sm:grid-cols-[auto,1fr]" onSubmit={e => { e.preventDefault(); verify(enrolling.id); }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={enrolling.qr} alt="QR code to scan with your authenticator app" className="h-44 w-44 rounded border border-slate-200 bg-white p-2" />
            <div className="space-y-3 text-sm">
              <ol className="list-decimal space-y-1 pl-5 text-slate-700">
                <li>Open your authenticator app and add an account.</li>
                <li>Scan the QR code, or type this key: <code className="break-all rounded bg-slate-100 px-1 font-mono text-xs">{enrolling.secret}</code></li>
                <li>Enter the 6-digit code the app shows.</li>
              </ol>
              {codeInput}
              <div className="flex gap-2">
                <button className="btn btn-primary" disabled={busy || code.replace(/\s/g, "").length !== 6}>Turn on</button>
                <button type="button" className="btn btn-ghost" onClick={() => { setEnrolling(null); setCode(""); }}>Cancel</button>
              </div>
            </div>
          </form>
        )}
      </section>

      <section className="card mt-4 space-y-2 p-5">
        <h2 className="font-semibold">Notifications</h2>
        <p className="text-sm text-slate-600">Get parent messages and cover duties on this phone or computer. Without it, they come by email.</p>
        <NotificationsToggle />
      </section>

      {sessionVerified && required && (
        <div className="mt-4"><button className="btn btn-primary" onClick={continueOn}>Continue</button></div>
      )}
    </Page>
  );
}
