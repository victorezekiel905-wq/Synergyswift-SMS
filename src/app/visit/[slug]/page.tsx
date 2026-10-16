"use client";
import { use, useState } from "react";
import { useApi, send } from "@/components/ui";

type Ev = { id: string; kind: string; title: string; starts_at: string; ends_at: string | null; location: string | null; details: string | null; seats_left: number };
type Info = { school: { name: string; logo_url: string | null; brand_color: string | null; address: string | null; phone: string | null }; events: Ev[] };

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

/** Public booking page for school tours and open days. */
export default function VisitPage(props: { params: Promise<{ slug: string }> }) {
  const { slug } = use(props.params);
  const { data, error, reload } = useApi<Info>(`/api/visit/${slug}`);
  const [pick, setPick] = useState<Ev | null>(null);
  const [f, setF] = useState({ name: "", phone: "", email: "", party_size: "2", child_name: "", applying_for: "", website: "" });
  const [consent, setConsent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  if (error) return <main className="mx-auto max-w-xl p-6"><p className="rounded-lg bg-slate-100 p-4">{error}</p></main>;
  if (!data) return <main className="p-10 text-center text-sm text-slate-500">Loading…</main>;
  const color = data.school.brand_color ?? "#2f4f8f";
  if (done) return (
    <main className="mx-auto max-w-xl p-6 text-center">
      <h1 className="text-[26px] font-serif font-semibold tracking-[-0.01em]" style={{ color }}>You are booked</h1>
      <p className="mt-2">We have sent the details to your WhatsApp and email, with a reminder the day before.</p>
      <div className="mt-4 flex justify-center gap-2"><a className="btn text-white" style={{ background: color }} href={`/api/visit/booking/${done}/ics`}>Add to calendar</a><a className="btn btn-outline" href={`/visit/booking/${done}`}>View booking</a></div>
    </main>
  );
  return (
    <main className="mx-auto max-w-2xl bg-white p-4 sm:p-8">
      <header className="mb-5 flex items-center gap-3 border-b-4 pb-3" style={{ borderColor: color }}>
        {data.school.logo_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={data.school.logo_url} alt="" className="h-14 w-14 object-contain" />
        )}
        <div><h1 className="text-[22px] font-serif font-semibold tracking-[-0.01em]" style={{ color }}>Visit {data.school.name}</h1><p className="text-sm text-slate-600">{data.school.address}</p></div>
      </header>
      {!data.events.length ? <p className="rounded-lg bg-slate-50 p-4">No tours are open for booking right now. Please call {data.school.phone ?? "the school"} to arrange a visit.</p> : (
        <ul className="space-y-2">{data.events.map(e => (
          <li key={e.id}><button disabled={!e.seats_left} onClick={() => { setPick(e); setErr(null); }} className={"w-full rounded-lg border p-3 text-left " + (pick?.id === e.id ? "border-2" : "border-slate-200") + (!e.seats_left ? " opacity-50" : " hover:border-slate-400")} style={pick?.id === e.id ? { borderColor: color } : undefined}>
            <p className="font-semibold">{e.title}</p><p className="text-sm">{when(e.starts_at)}{e.location ? ` · ${e.location}` : ""}</p>
            <p className="text-xs text-slate-500">{e.seats_left ? `${e.seats_left} places left` : "Full"}{e.details ? ` · ${e.details}` : ""}</p>
          </button></li>
        ))}</ul>
      )}
      {pick && (
        <form className="mt-5 grid gap-3 sm:grid-cols-2" onSubmit={async ev => {
          ev.preventDefault();
          setBusy(true); setErr(null);
          const q = new URLSearchParams(window.location.search);
          const r = await send<{ token: string }>(`/api/visit/${slug}`, { event_id: pick.id, name: f.name, phone: f.phone, email: f.email || null, party_size: Number(f.party_size), child_name: f.child_name || null,
            applying_for: f.applying_for || null, consent, utm: Object.fromEntries([...q].filter(([k]) => k.startsWith("utm_"))), ref: q.get("ref"), website: f.website });
          setBusy(false);
          if (!r.ok) { setErr(r.error); reload(); return; }
          setDone(r.data.token);
        }}>
          <h2 className="font-semibold sm:col-span-2">Book: {pick.title}, {when(pick.starts_at)}</h2>
          <label className="block"><span className="label">Your name</span><input className="input" required value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></label>
          <label className="block"><span className="label">WhatsApp / phone</span><input className="input" required inputMode="tel" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} /></label>
          <label className="block"><span className="label">Email (optional)</span><input className="input" type="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></label>
          <label className="block"><span className="label">How many people?</span><select className="input" value={f.party_size} onChange={e => setF({ ...f, party_size: e.target.value })}>{[1, 2, 3, 4, 5, 6].map(n => <option key={n}>{n}</option>)}</select></label>
          <label className="block"><span className="label">Child&apos;s name (optional)</span><input className="input" value={f.child_name} onChange={e => setF({ ...f, child_name: e.target.value })} /></label>
          <label className="block"><span className="label">Class you are interested in</span><input className="input" value={f.applying_for} onChange={e => setF({ ...f, applying_for: e.target.value })} /></label>
          <input className="hidden" tabIndex={-1} autoComplete="off" aria-hidden="true" value={f.website} onChange={e => setF({ ...f, website: e.target.value })} />
          <label className="flex items-start gap-2 text-sm sm:col-span-2"><input type="checkbox" className="mt-1" checked={consent} onChange={e => setConsent(e.target.checked)} required /> I agree that the school may contact me about this visit and about admission.</label>
          {err && <p role="alert" className="text-sm text-rose-600 sm:col-span-2">{err}</p>}
          <button className="btn py-3 text-white sm:col-span-2" style={{ background: color }} disabled={busy}>{busy ? "Booking…" : "Book my visit"}</button>
        </form>
      )}
    </main>
  );
}
