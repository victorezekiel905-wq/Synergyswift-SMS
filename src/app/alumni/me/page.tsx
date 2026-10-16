"use client";
import { useState } from "react";
import { useApi, send, fmtDate } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import AlumniForm, { EMPTY_ALUMNI, type AlumniFields } from "@/components/community/AlumniForm";

type News = { id: string; subject: string; body: string; blocks: { heading?: string | null; text?: string | null; link_url?: string | null; link_label?: string | null }[]; sent_at: string };
type Data = { profile: Partial<AlumniFields>; school: { school_name: string | null; logo_url: string | null; brand_color: string | null; phone: string | null; email: string | null } | null; news: News[] };

/** Signed-in alumni: their details and the school's alumni news. */
export default function AlumniHome() {
  const { data, error } = useApi<Data>("/api/alumni/me");
  const [saved, setSaved] = useState(false);
  const signOut = async () => { await createClient().auth.signOut(); window.location.href = "/login"; };
  if (error) return <main className="mx-auto max-w-xl p-6"><p className="rounded-lg bg-slate-100 p-4">{error}</p><button className="btn btn-outline mt-4" onClick={signOut}>Sign out</button></main>;
  if (!data) return <main className="p-10 text-center text-sm text-slate-500">Loading…</main>;
  const color = data.school?.brand_color ?? "#2f4f8f";
  const initial = Object.fromEntries(Object.entries({ ...EMPTY_ALUMNI, ...data.profile }).map(([k, v]) => [k, v ?? (k === "graduation_year" ? null : (EMPTY_ALUMNI as any)[k])])) as AlumniFields;
  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <header className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {data.school?.logo_url && <img src={data.school.logo_url} alt="" className="h-12 w-12 rounded" />}
        <div className="flex-1"><p className="font-semibold" style={{ color }}>{data.school?.school_name}</p><h1 className="text-[26px] font-serif font-semibold tracking-[-0.01em]">Alumni</h1></div>
        <button className="btn btn-ghost text-xs" onClick={signOut}>Sign out</button>
      </header>
      <section>
        <h2 className="mb-2 font-semibold">News for alumni</h2>
        {!data.news.length ? <p className="text-sm text-slate-500">Nothing yet. News and reunion invitations will appear here and in your email.</p> : (
          <ul className="space-y-3">{data.news.map(n => (
            <li key={n.id} className="card p-4 text-sm">
              <p className="text-xs text-slate-500">{fmtDate(n.sent_at)}</p>
              <h3 className="font-semibold">{n.subject}</h3>
              {n.body && <p className="mt-1 whitespace-pre-wrap">{n.body}</p>}
              {n.blocks.filter(x => x.heading || x.text).map((x, i) => (
                <div key={i} className="mt-2 border-t border-slate-100 pt-2">{x.heading && <p className="font-medium">{x.heading}</p>}{x.text && <p className="whitespace-pre-wrap">{x.text}</p>}
                  {x.link_url && /^https:\/\//.test(x.link_url) && <a className="text-brand-700" href={x.link_url} target="_blank" rel="noreferrer">{x.link_label || "Read more"} →</a>}</div>
              ))}
            </li>
          ))}</ul>
        )}
      </section>
      <section>
        <h2 className="mb-2 font-semibold">Your details</h2>
        {saved && <p className="mb-2 rounded bg-emerald-50 p-2 text-sm text-emerald-900" role="status">Saved.</p>}
        <AlumniForm initial={initial} color={color} submitLabel="Save" consentRequired={false} onSubmit={async f => {
          const r = await send("/api/alumni/me", { ...f, phone: f.phone || null });
          if (r.ok) { setSaved(true); return null; }
          return r.error;
        }} />
      </section>
    </main>
  );
}
