"use client";
import { use, useState } from "react";
import { useApi, send } from "@/components/ui";
import AlumniForm, { EMPTY_ALUMNI } from "@/components/community/AlumniForm";

/** Public alumni sign-up for former students. */
export default function AlumniJoinPage(props: { params: Promise<{ slug: string }> }) {
  const { slug } = use(props.params);
  const { data, error } = useApi<{ school: { name: string; logo_url: string | null; brand_color: string | null } }>(`/api/alumni/join/${slug}`);
  const [done, setDone] = useState(false);
  if (error) return <main className="mx-auto max-w-xl p-6"><p className="rounded-lg bg-slate-100 p-4">{error}</p></main>;
  if (!data) return <main className="p-10 text-center text-sm text-slate-500">Loading…</main>;
  const color = data.school.brand_color ?? "#1d5ddb";
  return (
    <main className="mx-auto max-w-xl p-6">
      <header className="mb-4 flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {data.school.logo_url && <img src={data.school.logo_url} alt="" className="h-12 w-12 rounded" />}
        <div><p className="font-semibold" style={{ color }}>{data.school.name}</p><h1 className="text-2xl font-bold">Alumni network</h1></div>
      </header>
      {done ? <p className="rounded-lg bg-emerald-50 p-4 text-emerald-900">Thank you for joining. The school will confirm your details and keep you posted on alumni news and events.</p> : <>
        <p className="mb-4 text-slate-600">Studied here? Join the alumni network to hear about reunions and events, and to help current students with mentoring and careers talks.</p>
        <AlumniForm initial={EMPTY_ALUMNI} color={color} submitLabel="Join" consentRequired onSubmit={async f => {
          const r = await send(`/api/alumni/join/${slug}`, { ...f, phone: f.phone || null, consent: f.consent_contact, website: "" });
          if (r.ok) { setDone(true); return null; }
          return r.error;
        }} />
      </>}
    </main>
  );
}
