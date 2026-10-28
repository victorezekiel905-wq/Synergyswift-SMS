"use client";
import { useState } from "react";
import Link from "next/link";

/** After signing up: the account waits for its email to be confirmed (or for an admin to confirm it). */
export default function PendingConfirm({ email, status }: { email: string; status: "sent" | "waiting" }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function resend() {
    setBusy(true);
    const r = await fetch("/api/auth/email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "resend", email }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    setMsg(j.message ?? j.error ?? "Please try again in a minute.");
  }
  return (
    <div className="card mt-7 space-y-4 p-6 text-[15px] text-slate-700 sm:text-sm">
      {status === "sent" ? (
        <>
          <p className="font-semibold text-slate-900">Check your inbox</p>
          <p>We sent a link to <b>{email}</b>. Open it and press <i>Confirm my email</i>, then you can sign in. Look in spam or promotions if it is not there in a few minutes.</p>
          <button type="button" className="btn btn-outline w-full" disabled={busy} onClick={resend}>{busy ? "Sending…" : "Send the email again"}</button>
        </>
      ) : (
        <>
          <p className="font-semibold text-slate-900">Your account is waiting to be confirmed</p>
          <p>An administrator confirms new accounts. You can sign in with <b>{email}</b> once yours is confirmed.</p>
        </>
      )}
      {msg && <p className="text-slate-600">{msg}</p>}
      <Link href="/login" className="block text-center font-medium text-brand-600">Go to sign in</Link>
    </div>
  );
}
