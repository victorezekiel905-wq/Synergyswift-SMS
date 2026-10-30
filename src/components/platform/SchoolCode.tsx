"use client";
import { useEffect, useState } from "react";
import { send, Alert } from "@/components/ui";

export type MadeCodeData = { code: string; expires_at: string; label: string; forSchool?: boolean };

/** Minutes and seconds left on a new code. */
export function Countdown({ until }: { until: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const left = Math.max(0, Math.floor((Date.parse(until) - now) / 1000));
  if (!left) return <span className="font-medium text-rose-700">It has expired.</span>;
  return <span>It expires in <b className="tabular-nums">{Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}</b>.</span>;
}

/** A code just made: shown once, with ways to pass it on. */
export function MadeCode({ made }: { made: MadeCodeData }) {
  const [copied, setCopied] = useState<string | null>(null);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const shareText = made.forSchool
    ? `Your Synergy Swift onboarding code for ${made.label}: ${made.code}\nCreate your administrator account at ${origin}/onboard within 20 minutes. It works once.`
    : `Your Synergy Swift onboarding code: ${made.code}\nOnboard your school at ${origin}/onboard within 20 minutes. It works once.`;
  const copy = (text: string, what: string) => {
    navigator.clipboard?.writeText(text).then(() => setCopied(what), () => setCopied(null));
  };
  return (
    <section className="card border-brand-300 p-5">
      <p className="text-sm text-slate-600">Code for <b>{made.label}</b>{made.forSchool ? ": whoever signs up with it becomes this school's administrator" : ""}. <Countdown until={made.expires_at} /> Copy it now: it is not shown again.</p>
      <p className="mt-3 select-all font-mono text-2xl font-semibold tracking-wider">{made.code}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-primary" onClick={() => copy(made.code, "code")}>Copy code</button>
        <button type="button" className="btn btn-outline" onClick={() => copy(shareText, "message")}>Copy message for the school</button>
        <a className="btn btn-outline no-underline" href={`https://wa.me/?text=${encodeURIComponent(shareText)}`} target="_blank" rel="noreferrer">Send on WhatsApp</a>
        {copied && <span className="text-xs text-emerald-700" role="status">{copied === "code" ? "Code copied." : "Message copied."}</span>}
      </div>
    </section>
  );
}

/** On a school's page: make a one-time code that makes its holder this school's administrator. */
export function MakeCodeForSchool({ tenantId, schoolName }: { tenantId: string; schoolName: string }) {
  const [made, setMade] = useState<MadeCodeData | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function make() {
    setBusy(true); setErr(null);
    const r = await send<{ code: string; expires_at: string }>("/api/platform/school-codes", { action: "create", tenant_id: tenantId });
    setBusy(false);
    if (!r.ok) return setErr(r.error ?? "The code couldn't be made.");
    setMade({ code: r.data.code, expires_at: r.data.expires_at, label: schoolName, forSchool: true });
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-slate-600">Give the school a one-time code. They sign up at <b>/onboard</b> with their own name, email and password, and become its administrator. No email is needed from you. A code lasts 20 minutes, so make it when they are ready.</p>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={make}>{busy ? "Making…" : made ? "Make another code" : "Make an onboarding code"}</button>
      </div>
      {err && <Alert>{err}</Alert>}
      {made && <MadeCode made={made} />}
    </div>
  );
}
