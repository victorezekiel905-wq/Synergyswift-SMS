"use client";
import { useState } from "react";

/** Sign in with a 6-digit code sent by SMS. Calls `onSignedIn` once the session is set. */
export default function PhoneLogin({ onSignedIn }: { onSignedIn: () => Promise<void> }) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const post = async (body: Record<string, unknown>) => {
    setBusy(true); setMsg(null);
    const r = await fetch("/api/auth/phone", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    return { ok: r.ok, j };
  };
  return sent ? (
    <form className="space-y-4" onSubmit={async e => {
      e.preventDefault();
      const r = await post({ action: "verify", phone, code });
      if (!r.ok) { setMsg({ ok: false, text: r.j.error ?? "That did not work." }); return; }
      setBusy(true);
      await onSignedIn();
    }}>
      <p className="text-sm text-slate-700">Enter the 6-digit code sent to {phone}.</p>
      <input className="input text-center font-mono text-lg tracking-[0.3em]" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus
        value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ""))} aria-label="Code from SMS" />
      {msg && <p className={`text-sm ${msg.ok ? "text-emerald-700" : "text-rose-600"}`}>{msg.text}</p>}
      <button className="btn btn-primary w-full" disabled={busy || code.length !== 6}>{busy ? "Checking…" : "Sign in"}</button>
      <button type="button" className="w-full text-center text-xs text-slate-500" onClick={() => { setSent(false); setCode(""); setMsg(null); }}>Use a different number</button>
    </form>
  ) : (
    <form className="space-y-4" onSubmit={async e => {
      e.preventDefault();
      const r = await post({ action: "send", phone });
      if (!r.ok) { setMsg({ ok: false, text: r.j.error ?? "Could not send a code." }); return; }
      setSent(true);
      setMsg({ ok: true, text: r.j.message });
    }}>
      <div>
        <label className="label" htmlFor="phone-login">Phone number</label>
        <input id="phone-login" className="input" type="tel" autoComplete="tel" placeholder="0803 123 4567" required value={phone} onChange={e => setPhone(e.target.value)} />
      </div>
      {msg && <p className="text-sm text-rose-600">{msg.text}</p>}
      <button className="btn btn-primary w-full" disabled={busy}>{busy ? "Sending…" : "Text me a code"}</button>
    </form>
  );
}
