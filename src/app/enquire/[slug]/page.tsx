"use client";
import { use, useEffect, useState } from "react";
import { useApi, send } from "@/components/ui";

type Info = { school: { name: string; logo_url: string | null; brand_color: string | null; phone: string | null; email: string | null; address: string | null }; levels: string[]; applications_open: boolean; whatsapp: string | null };

/** Public enquiry form. Works on its own or embedded in the school's website (?embed=1). Campaign tags and referral codes in the link are kept. */
export default function EnquirePage(props: { params: Promise<{ slug: string }> }) {
  const { slug } = use(props.params);
  const { data, error } = useApi<Info>(`/api/enquire/${slug}`);
  const blank = { parent_name: "", phone: "", email: "", child_name: "", child_dob: "", applying_for: "", intake: "", message: "", how_heard: "", website: "" };
  const [f, setF] = useState(blank);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [embed, setEmbed] = useState(false);
  const [ref, setRef] = useState<string | null>(null);
  useEffect(() => { const q = new URLSearchParams(window.location.search); setEmbed(q.get("embed") === "1"); setRef(q.get("ref")); }, []);
  const bind = (k: keyof typeof blank) => ({ value: f[k], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value }) });

  if (error) return <main className="mx-auto max-w-xl p-6"><p className="rounded-lg bg-slate-100 p-4">{error}</p></main>;
  if (!data) return <main className="p-10 text-center text-sm text-slate-500">Loading…</main>;
  const color = data.school.brand_color ?? "#1d5ddb";
  if (done) return (
    <main className="mx-auto max-w-xl p-6 text-center">
      <h1 className="text-2xl font-bold" style={{ color }}>Thank you</h1>
      <p className="mt-2">We have received your enquiry and will contact you shortly.</p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <a className="btn text-white" style={{ background: color }} href={`/visit/${slug}${ref ? `?ref=${ref}` : ""}`} target={embed ? "_top" : undefined}>Book a school tour</a>
        {data.applications_open && <a className="btn btn-outline" href={`/apply/${slug}${ref ? `?ref=${ref}` : ""}`} target={embed ? "_top" : undefined}>Apply online</a>}
      </div>
    </main>
  );
  return (
    <main className={"mx-auto max-w-2xl bg-white " + (embed ? "p-2" : "p-4 sm:p-8")}>
      {!embed && (
        <header className="mb-5 flex items-center gap-3 border-b-4 pb-3" style={{ borderColor: color }}>
          {data.school.logo_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.school.logo_url} alt="" className="h-14 w-14 object-contain" />
          )}
          <div><h1 className="text-xl font-bold" style={{ color }}>{data.school.name}</h1><p className="text-sm text-slate-600">Ask about admission. We usually reply the same day.</p></div>
        </header>
      )}
      {data.whatsapp && <a className="mb-4 flex items-center justify-center gap-2 rounded-lg bg-emerald-600 py-2 font-semibold text-white" href={`https://wa.me/${data.whatsapp}?text=${encodeURIComponent(`Hello ${data.school.name}, I would like to know more about admission.`)}`} target="_blank" rel="noreferrer">Chat with us on WhatsApp</a>}
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={async e => {
        e.preventDefault();
        setBusy(true); setErr(null);
        const q = new URLSearchParams(window.location.search);
        const r = await send(`/api/enquire/${slug}`, { ...f, email: f.email || null, child_dob: f.child_dob || null, consent, utm: Object.fromEntries([...q].filter(([k]) => k.startsWith("utm_"))),
          ref: q.get("ref"), referrer: document.referrer || null });
        setBusy(false);
        if (!r.ok) return setErr(r.error);
        setDone(true);
      }}>
        <label className="block"><span className="label">Your name</span><input className="input" required {...bind("parent_name")} autoComplete="name" /></label>
        <label className="block"><span className="label">WhatsApp / phone</span><input className="input" required inputMode="tel" {...bind("phone")} autoComplete="tel" /></label>
        <label className="block"><span className="label">Email (optional)</span><input className="input" type="email" {...bind("email")} autoComplete="email" /></label>
        <label className="block"><span className="label">Child&apos;s name</span><input className="input" {...bind("child_name")} /></label>
        <label className="block"><span className="label">Class you are interested in</span>{data.levels.length ? <select className="input" {...bind("applying_for")}><option value="">—</option>{data.levels.map(l => <option key={l}>{l}</option>)}</select> : <input className="input" {...bind("applying_for")} />}</label>
        <label className="block"><span className="label">Child&apos;s date of birth</span><input className="input" type="date" {...bind("child_dob")} /></label>
        <label className="block"><span className="label">When would they start?</span><input className="input" {...bind("intake")} placeholder="e.g. September 2027" /></label>
        <label className="block"><span className="label">How did you hear about us?</span><select className="input" {...bind("how_heard")}><option value="">—</option><option value="friend">A friend or parent</option><option value="facebook">Facebook</option><option value="instagram">Instagram</option><option value="whatsapp">WhatsApp</option><option value="walk">Passed by the school</option><option value="radio">Radio / TV</option><option value="other">Other</option></select></label>
        <label className="block sm:col-span-2"><span className="label">Your question (optional)</span><textarea className="input h-20" {...bind("message")} /></label>
        <input className="hidden" tabIndex={-1} autoComplete="off" aria-hidden="true" {...bind("website")} />
        <label className="flex items-start gap-2 text-sm sm:col-span-2"><input type="checkbox" className="mt-1" checked={consent} onChange={e => setConsent(e.target.checked)} required />
          I agree that {data.school.name} may contact me by WhatsApp, phone, SMS or email about admission. My details are used only for this.</label>
        {err && <p role="alert" className="text-sm text-rose-600 sm:col-span-2">{err}</p>}
        <button className="btn py-3 text-white sm:col-span-2" style={{ background: color }} disabled={busy}>{busy ? "Sending…" : "Send enquiry"}</button>
      </form>
    </main>
  );
}
