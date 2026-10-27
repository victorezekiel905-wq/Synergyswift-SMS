"use client";
import { use, useEffect, useState } from "react";

type Data = { school: { name: string; logo_url: string | null; brand_color: string | null }; campaign: { title: string; purpose: string | null; goal: number | null; ends_on: string | null; cover_url: string | null; open: boolean };
  raised: number | null; donors: number | null; currency: string; online: boolean; recent: { name: string; message: string | null; at: string }[] };
const fmt = (n: number, cur: string) => new Intl.NumberFormat("en-NG", { style: "currency", currency: cur, maximumFractionDigits: 0 }).format(n);
const AMOUNTS = [5000, 10000, 25000, 50000, 100000];

/** The public giving page for a school appeal (phase 14g-2). */
export default function Give(props: { params: Promise<{ school: string; campaign: string }> }) {
  const { school, campaign } = use(props.params);
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({ name: "", email: "", phone: "", amount: "10000", anonymous: false, message: "", website: "" });
  const [busy, setBusy] = useState(false);
  const [thanks, setThanks] = useState<string | null>(null);
  useEffect(() => {
    const g = new URLSearchParams(window.location.search).get("gift");
    if (g) setThanks(g === "success" ? "Thank you! Your gift has been received. A receipt is on its way." : g === "failed" ? "The payment did not go through. Please try again." : "We are confirming your payment; it may take a minute.");
    fetch(`/api/give/${school}/${campaign}`).then(async r => { const j = await r.json(); if (!r.ok) setErr(j.error ?? "Not found"); else setD(j); }).catch(() => setErr("Could not load the appeal."));
  }, [school, campaign]);
  if (err) return <main className="mx-auto max-w-xl p-6"><p className="rounded-lg bg-slate-100 p-4">This appeal is not available.</p></main>;
  if (!d) return <main className="p-10 text-center text-sm text-slate-500">Loading…</main>;
  const color = d.school.brand_color ?? "#2f4f8f";
  const pct = d.raised !== null && d.campaign.goal ? Math.min(100, Math.round((d.raised / d.campaign.goal) * 100)) : null;

  async function give(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const r = await fetch(`/api/give/${school}/${campaign}`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...f, amount: Number(f.amount), phone: f.phone || null, message: f.message || null }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setBusy(false); setThanks(null); return alert(j.error ?? "Could not start the payment."); }
    window.location.href = j.url;
  }

  return (
    <main className="min-h-screen bg-canvas">
      <div className="mx-auto max-w-3xl px-5 py-10">
        <p className="text-sm font-semibold" style={{ color }}>{d.school.name}</p>
        <h1 className="mt-1 text-[32px] font-serif font-semibold leading-tight tracking-[-0.01em]">{d.campaign.title}</h1>
        {thanks && <p role="status" className="mt-4 rounded-lg bg-emerald-50 p-3 text-emerald-900">{thanks}</p>}
        <div className="mt-6 grid gap-8 md:grid-cols-[1.2fr_1fr]">
          <section>
            {d.raised !== null && (
              <div className="card p-4">
                <p className="text-3xl font-semibold tabular-nums">{fmt(d.raised, d.currency)}</p>
                <p className="text-sm text-slate-600">raised{d.campaign.goal ? ` of ${fmt(d.campaign.goal, d.currency)}` : ""}{d.donors ? ` from ${d.donors} donor${d.donors === 1 ? "" : "s"}` : ""}</p>
                {pct !== null && <div className="mt-3 h-3 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} /></div>}
                {d.campaign.ends_on && <p className="mt-2 text-xs text-slate-500">Until {new Date(`${d.campaign.ends_on}T12:00:00Z`).toLocaleDateString("en-GB", { dateStyle: "long" })}</p>}
              </div>
            )}
            {d.campaign.purpose && <p className="mt-4 whitespace-pre-wrap text-slate-700">{d.campaign.purpose}</p>}
            {d.recent.length > 0 && <div className="mt-6"><h2 className="font-semibold">Recent supporters</h2>
              <ul className="mt-2 space-y-2 text-sm">{d.recent.map((r, i) => <li key={i}><b>{r.name}</b>{r.message ? <span className="text-slate-600">: “{r.message}”</span> : null}</li>)}</ul></div>}
          </section>
          <section className="card p-5">
            {!d.campaign.open ? <p>This appeal has closed. Thank you for thinking of us.</p> : !d.online ? <p className="text-sm">Online giving isn&apos;t switched on yet. Please contact the school to give.</p> : (
              <form onSubmit={give} className="space-y-3">
                <h2 className="text-lg font-semibold">Give</h2>
                <div className="flex flex-wrap gap-2">{AMOUNTS.map(a => (
                  <button key={a} type="button" onClick={() => setF({ ...f, amount: String(a) })} className={"rounded-full border px-3 py-1.5 text-sm " + (Number(f.amount) === a ? "text-white" : "border-slate-300")}
                    style={Number(f.amount) === a ? { background: color, borderColor: color } : undefined}>{fmt(a, d.currency)}</button>))}</div>
                <label className="block"><span className="label">Amount</span><input className="input" type="number" min={100} required value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} /></label>
                <label className="block"><span className="label">Your name</span><input className="input" required value={f.name} onChange={e => setF({ ...f, name: e.target.value })} autoComplete="name" /></label>
                <label className="block"><span className="label">Email (for your receipt)</span><input className="input" type="email" required value={f.email} onChange={e => setF({ ...f, email: e.target.value })} autoComplete="email" /></label>
                <label className="block"><span className="label">Phone (optional)</span><input className="input" type="tel" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} autoComplete="tel" /></label>
                <label className="block"><span className="label">A message (optional)</span><input className="input" value={f.message} onChange={e => setF({ ...f, message: e.target.value })} maxLength={300} /></label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.anonymous} onChange={e => setF({ ...f, anonymous: e.target.checked })} />Give anonymously</label>
                <input tabIndex={-1} autoComplete="off" className="hidden" aria-hidden value={f.website} onChange={e => setF({ ...f, website: e.target.value })} />
                <button className="btn w-full py-3 text-white" style={{ background: color }} disabled={busy}>{busy ? "Opening payment…" : `Give ${Number(f.amount) ? fmt(Number(f.amount), d.currency) : ""}`}</button>
                <p className="text-xs text-slate-500">Card, bank transfer or USSD through the school&apos;s payment provider.</p>
              </form>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
