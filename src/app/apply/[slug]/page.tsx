"use client";
import { use, useState } from "react";
import { useApi, send, money } from "@/components/ui";

type Info = { school: { name: string; logo_url: string | null; brand_color: string | null; address: string | null; phone: string | null; email: string | null };
  intro: string | null; application_fee: number; currency: string; levels: string[] };

/** Public admissions form for one school. */
export default function ApplyPage(props: { params: Promise<{ slug: string }> }) {
  const { slug } = use(props.params);
  const { data, error } = useApi<Info>(`/api/apply/${slug}`);
  const blank = { first_name: "", last_name: "", other_names: "", gender: "", date_of_birth: "", applying_for: "", previous_school: "",
    guardian_name: "", guardian_phone: "", guardian_email: "", guardian_relation: "mother", address: "", notes: "", website: "" };
  const [f, setF] = useState(blank);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ application_no: string; tracking_token: string } | null>(null);
  const bind = (k: keyof typeof blank) => ({ value: f[k], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value }) });

  if (error) return <main className="mx-auto max-w-xl p-6"><p className="rounded-lg bg-slate-100 p-4">{error}</p></main>;
  if (!data) return <main className="p-10 text-center text-sm text-slate-500">Loading…</main>;
  const color = data.school.brand_color ?? "#1d5ddb";

  if (done) return (
    <main className="mx-auto max-w-xl p-6 text-center">
      <h1 className="text-2xl font-bold" style={{ color }}>Application received</h1>
      <p className="mt-2">Your application number is <b className="font-mono">{done.application_no}</b>. We have sent a confirmation to your WhatsApp and email.</p>
      <a className="btn mt-4 text-white" style={{ background: color }} href={`/apply/track/${done.tracking_token}`}>Track your application</a>
    </main>
  );

  return (
    <main className="mx-auto max-w-2xl bg-white p-4 sm:p-8">
      <header className="mb-5 flex items-center gap-3 border-b-4 pb-3" style={{ borderColor: color }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {data.school.logo_url && <img src={data.school.logo_url} alt="" className="h-14 w-14 object-contain" />}
        <div><h1 className="text-xl font-bold" style={{ color }}>{data.school.name}: admissions</h1><p className="text-xs text-slate-600">{data.school.address}{data.school.phone ? ` · ${data.school.phone}` : ""}</p></div>
      </header>
      {data.intro && <p className="mb-4 whitespace-pre-wrap text-sm">{data.intro}</p>}
      {data.application_fee > 0 && <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm">Application fee: <b>{money(data.application_fee, data.currency)}</b>. The school will tell you how to pay.</p>}
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={async e => {
        e.preventDefault();
        setBusy(true); setErr(null);
        const r = await send<{ application_no: string; tracking_token: string }>(`/api/apply/${slug}`, { ...f, gender: f.gender || null, date_of_birth: f.date_of_birth || null,
          guardian_email: f.guardian_email || null, other_names: f.other_names || null, previous_school: f.previous_school || null, address: f.address || null, notes: f.notes || null, consent });
        setBusy(false);
        if (!r.ok) return setErr(r.error);
        setDone(r.data);
      }}>
        <h2 className="font-semibold sm:col-span-2">About the child</h2>
        <label className="block"><span className="label">First name</span><input className="input" required {...bind("first_name")} /></label>
        <label className="block"><span className="label">Last name</span><input className="input" required {...bind("last_name")} /></label>
        <label className="block"><span className="label">Other names</span><input className="input" {...bind("other_names")} /></label>
        <label className="block"><span className="label">Gender</span><select className="input" {...bind("gender")}><option value="">—</option><option value="female">Female</option><option value="male">Male</option></select></label>
        <label className="block"><span className="label">Date of birth</span><input className="input" type="date" {...bind("date_of_birth")} /></label>
        <label className="block"><span className="label">Class applying for</span>{data.levels.length ? <select className="input" required {...bind("applying_for")}><option value="">—</option>{data.levels.map(l => <option key={l}>{l}</option>)}</select> : <input className="input" required {...bind("applying_for")} />}</label>
        <label className="block sm:col-span-2"><span className="label">Current / previous school</span><input className="input" {...bind("previous_school")} /></label>
        <h2 className="pt-2 font-semibold sm:col-span-2">Parent or guardian</h2>
        <label className="block"><span className="label">Full name</span><input className="input" required {...bind("guardian_name")} /></label>
        <label className="block"><span className="label">Relationship</span><select className="input" {...bind("guardian_relation")}><option>mother</option><option>father</option><option>guardian</option><option>other</option></select></label>
        <label className="block"><span className="label">WhatsApp / phone</span><input className="input" required {...bind("guardian_phone")} /></label>
        <label className="block"><span className="label">Email</span><input className="input" type="email" {...bind("guardian_email")} /></label>
        <label className="block sm:col-span-2"><span className="label">Home address</span><input className="input" {...bind("address")} /></label>
        <label className="block sm:col-span-2"><span className="label">Anything we should know? (health, support needs)</span><textarea className="input h-20" {...bind("notes")} /></label>
        <input className="hidden" tabIndex={-1} autoComplete="off" aria-hidden="true" {...bind("website")} />
        <label className="flex items-start gap-2 text-sm sm:col-span-2"><input type="checkbox" className="mt-1" checked={consent} onChange={e => setConsent(e.target.checked)} required />
          I confirm this information is correct and agree that the school may use it to process this application and contact me by WhatsApp, SMS and email.</label>
        {err && <p role="alert" className="text-sm text-rose-600 sm:col-span-2">{err}</p>}
        <button className="btn py-3 text-white sm:col-span-2" style={{ background: color }} disabled={busy}>{busy ? "Sending…" : "Submit application"}</button>
      </form>
    </main>
  );
}
