"use client";
import { use, useState } from "react";
import { useApi, fmtDate } from "@/components/ui";

type Data = { school: { name: string; logo_url: string | null; brand_color: string | null }; open: boolean;
  job: { title: string; department: string | null; employment_type: string; location: string | null; description: string; requirements: string | null; salary_range: string | null; closes_on: string | null } };

const TYPE: Record<string, string> = { full_time: "Full time", part_time: "Part time", contract: "Contract", volunteer: "Volunteer" };

/** One job, and the form to apply with a CV. */
export default function JobPage(props: { params: Promise<{ slug: string; token: string }> }) {
  const { slug, token } = use(props.params);
  const { data, error } = useApi<Data>(`/api/careers/${slug}/${token}`);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [track, setTrack] = useState<string | null>(null);
  if (error) return <main className="mx-auto max-w-xl p-6"><p className="rounded-lg bg-slate-100 p-4">{error}</p><p className="mt-3 text-sm"><a className="underline" href={`/careers/${slug}`}>All vacancies</a></p></main>;
  if (!data) return <main className="p-10 text-center text-sm text-slate-500">Loading…</main>;
  const color = data.school.brand_color ?? "#2f4f8f";
  const j = data.job;
  return (
    <main className="mx-auto max-w-3xl bg-white p-4 sm:p-8">
      <header className="mb-5 flex items-center gap-3 border-b-4 pb-3" style={{ borderColor: color }}>
        {data.school.logo_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={data.school.logo_url} alt="" className="h-12 w-12 object-contain" />
        )}
        <div><p className="text-sm text-slate-600"><a className="underline" href={`/careers/${slug}`}>{data.school.name} careers</a></p><h1 className="text-[26px] font-serif font-semibold tracking-[-0.01em]" style={{ color }}>{j.title}</h1>
          <p className="text-sm text-slate-600">{[j.department, TYPE[j.employment_type], j.location, j.salary_range].filter(Boolean).join(" · ")}</p></div>
      </header>
      <section className="space-y-4">
        <div className="whitespace-pre-wrap text-slate-800">{j.description}</div>
        {j.requirements && <div><h2 className="mb-1 font-semibold">What we are looking for</h2><div className="whitespace-pre-wrap text-slate-800">{j.requirements}</div></div>}
        {j.closes_on && <p className="text-sm text-slate-600">Closing date: <b>{fmtDate(j.closes_on)}</b></p>}
      </section>
      {track ? (
        <section className="mt-8 rounded-xl bg-emerald-50 p-5 text-emerald-900">
          <h2 className="text-lg font-semibold">Application sent</h2>
          <p className="mt-1">Thank you. We have emailed you a copy. You can check how your application is going at any time:</p>
          <a className="mt-2 inline-block underline" href={track}>See your application</a>
        </section>
      ) : !data.open ? (
        <p className="mt-8 rounded-lg bg-slate-100 p-4">Applications for this job have closed.</p>
      ) : (
        <form className="mt-8 grid gap-3 rounded-xl border border-slate-200 p-5 sm:grid-cols-2" onSubmit={async e => {
          e.preventDefault();
          setBusy(true); setErr(null);
          const fd = new FormData(e.currentTarget);
          const q = new URLSearchParams(window.location.search);
          if (q.get("utm_source") || q.get("source")) fd.set("source", (q.get("utm_source") || q.get("source"))!.slice(0, 40));
          const r = await fetch(`/api/careers/${slug}/${token}`, { method: "POST", body: fd });
          const out = await r.json().catch(() => ({}));
          setBusy(false);
          if (!r.ok) return setErr(out.error ?? "Could not send your application.");
          setTrack(out.track ?? null);
        }}>
          <h2 className="text-lg font-semibold sm:col-span-2">Apply</h2>
          <label className="block"><span className="label">Full name</span><input className="input" name="full_name" required minLength={2} maxLength={120} autoComplete="name" /></label>
          <label className="block"><span className="label">Email</span><input className="input" name="email" type="email" required autoComplete="email" /></label>
          <label className="block"><span className="label">Phone</span><input className="input" name="phone" type="tel" required minLength={7} maxLength={30} autoComplete="tel" /></label>
          <label className="block"><span className="label">CV (PDF or Word, up to 5 MB)</span><input className="input" name="cv" type="file" required accept="application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" /></label>
          <label className="block sm:col-span-2"><span className="label">Cover letter (why you, why us)</span><textarea className="input" name="cover_letter" rows={6} maxLength={6000} /></label>
          <input className="hidden" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" />
          <label className="flex items-start gap-2 text-sm sm:col-span-2"><input type="checkbox" name="consent" required className="mt-1" /><span>I agree to {data.school.name} keeping my application and CV to consider me for this and similar posts.</span></label>
          {err && <p className="rounded bg-rose-50 p-2 text-sm text-rose-800 sm:col-span-2">{err}</p>}
          <button className="btn text-white sm:col-span-2" style={{ background: color }} disabled={busy}>{busy ? "Sending…" : "Send application"}</button>
        </form>
      )}
    </main>
  );
}
