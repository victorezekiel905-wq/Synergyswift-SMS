"use client";
import { use, useEffect, useState } from "react";

type School = { name: string; logo_url: string | null; brand_color: string | null };
type Result = { child: string; level: string; result: string | null; waiting: string | null; score: number | null };

/** Entrance results checker: application number and the child's surname. */
export default function ResultsChecker(props: { params: Promise<{ slug: string }> }) {
  const { slug } = use(props.params);
  const [school, setSchool] = useState<School | null>(null);
  const [no, setNo] = useState("");
  const [surname, setSurname] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<Result | null>(null);
  useEffect(() => { fetch(`/api/apply/results/${slug}`).then(r => r.json()).then(j => setSchool(j.school ?? null)).catch(() => {}); }, [slug]);
  const color = school?.brand_color ?? "#2f4f8f";

  async function check(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null); setRes(null);
    const r = await fetch(`/api/apply/results/${slug}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ application_no: no, surname }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setErr(j.error ?? "Could not check. Please try again.");
    setRes(j);
  }

  return (
    <main className="mx-auto max-w-md p-6">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {school?.logo_url && <img src={school.logo_url} alt="" className="mb-3 h-12 w-auto" />}
      <p className="text-sm font-semibold" style={{ color }}>{school?.name ?? ""}</p>
      <h1 className="text-[26px] font-serif font-semibold tracking-[-0.01em]">Check entrance results</h1>
      <p className="mt-1 text-sm text-slate-600">Use the application number from your messages and the child&apos;s surname.</p>
      <form className="mt-5 space-y-3" onSubmit={check}>
        <label className="block"><span className="label">Application number</span>
          <input className="input" value={no} onChange={e => setNo(e.target.value)} placeholder="APP-2026-000123" autoComplete="off" required /></label>
        <label className="block"><span className="label">Child&apos;s surname</span>
          <input className="input" value={surname} onChange={e => setSurname(e.target.value)} autoComplete="family-name" required /></label>
        <button className="btn w-full py-3 text-white" style={{ background: color }} disabled={busy}>{busy ? "Checking…" : "Check result"}</button>
      </form>
      {err && <p role="alert" className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-900">{err}</p>}
      {res && (
        <section role="status" className="mt-5 rounded-lg border-2 p-4" style={{ borderColor: color }}>
          <p className="text-sm text-slate-600">{res.child} · {res.level}</p>
          <p className="mt-1 text-lg font-semibold">{res.result ?? res.waiting}</p>
          {res.score !== null && <p className="mt-1 text-sm">Entrance score: <b>{res.score}</b> out of 100</p>}
        </section>
      )}
    </main>
  );
}
