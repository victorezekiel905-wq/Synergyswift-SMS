"use client";
import { use, useEffect, useState } from "react";

type School = { name: string; logo_url: string | null; brand_color: string | null };

/** The public result checker (phase 14l): admission number and the PIN from a scratch card. */
export default function ResultChecker(props: { params: Promise<{ school: string }> }) {
  const { school: slug } = use(props.params);
  const [school, setSchool] = useState<School | null>(null);
  const [missing, setMissing] = useState(false);
  const [no, setNo] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    fetch(`/api/results/check?school=${encodeURIComponent(slug)}`).then(r => r.ok ? r.json() : Promise.reject()).then(j => setSchool(j.school)).catch(() => setMissing(true));
  }, [slug]);
  const color = school?.brand_color ?? "#2f4f8f";
  async function check(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const r = await fetch("/api/results/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ school: slug, admission_no: no, pin }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setErr(j.error ?? "Could not check. Please try again.");
    window.location.assign(j.url);
  }
  if (missing) return <main className="mx-auto max-w-md p-6"><h1 className="text-xl font-semibold">Page not found</h1></main>;
  return (
    <main className="mx-auto max-w-md p-6">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {school?.logo_url && <img src={school.logo_url} alt="" className="mb-3 h-12 w-auto" />}
      <p className="text-sm font-semibold" style={{ color }}>{school?.name ?? ""}</p>
      <h1 className="font-serif text-[26px] font-semibold tracking-[-0.01em]">Check a result</h1>
      <p className="mt-1 text-sm text-slate-600">Enter the student&apos;s admission number and the PIN under the scratch panel on your result card.</p>
      <form className="mt-5 space-y-3" onSubmit={check}>
        <label className="block"><span className="label">Admission number</span>
          <input className="input" value={no} onChange={e => setNo(e.target.value)} autoComplete="off" required /></label>
        <label className="block"><span className="label">PIN</span>
          <input className="input font-mono tracking-widest" value={pin} onChange={e => setPin(e.target.value)} inputMode="numeric" autoComplete="off" placeholder="1234-5678-9012" required /></label>
        {err && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert">{err}</p>}
        <button className="btn btn-primary w-full justify-center py-3" disabled={busy} style={{ background: color }}>{busy ? "Checking…" : "Show the result"}</button>
      </form>
      <p className="mt-4 text-xs text-slate-500">Each PIN works for one student, a set number of times. Keep your card safe.</p>
    </main>
  );
}
