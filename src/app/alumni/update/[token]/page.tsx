"use client";
import { use, useState } from "react";
import { useApi, send } from "@/components/ui";
import AlumniForm, { EMPTY_ALUMNI, type AlumniFields } from "@/components/community/AlumniForm";

/** An alumnus keeps their details up to date from a private link. */
export default function AlumniUpdatePage(props: { params: Promise<{ token: string }> }) {
  const { token } = use(props.params);
  const { data, error } = useApi<{ profile: Partial<AlumniFields>; school: { name: string; logo_url: string | null; brand_color: string | null } }>(`/api/alumni/update/${token}`);
  const [saved, setSaved] = useState(false);
  if (error) return <main className="mx-auto max-w-xl p-6"><p className="rounded-lg bg-slate-100 p-4">{error}</p></main>;
  if (!data) return <main className="p-10 text-center text-sm text-slate-500">Loading…</main>;
  const color = data.school.brand_color ?? "#2f4f8f";
  const initial = Object.fromEntries(Object.entries({ ...EMPTY_ALUMNI, ...data.profile }).map(([k, v]) => [k, v ?? (k === "graduation_year" ? null : (EMPTY_ALUMNI as any)[k])])) as AlumniFields;
  return (
    <main className="mx-auto max-w-xl p-6">
      <header className="mb-4 flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {data.school.logo_url && <img src={data.school.logo_url} alt="" className="h-12 w-12 rounded" />}
        <div><p className="font-semibold" style={{ color }}>{data.school.name}</p><h1 className="text-[26px] font-serif font-semibold tracking-[-0.01em]">Your alumni details</h1></div>
      </header>
      {saved && <p className="mb-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900" role="status">Saved. Thank you for keeping in touch.</p>}
      <AlumniForm initial={initial} color={color} submitLabel="Save my details" consentRequired={false} onSubmit={async f => {
        const r = await send(`/api/alumni/update/${token}`, { ...f, phone: f.phone || null });
        if (r.ok) { setSaved(true); return null; }
        return r.error;
      }} />
    </main>
  );
}
