"use client";
import { use, useEffect, useState } from "react";
import { PortfolioView, type Achievement, type Work, type Cert } from "@/components/portfolio/Portfolio";

type Data = { kind: "student" | "staff"; school: { name: string; logo_url: string | null; brand_color: string | null }; name: string; class_name?: string | null; position?: string | null;
  single: boolean; expires_at: string; achievements: Achievement[]; work: Work[]; certificates: Cert[] };

/** A shared portfolio dashboard (phase 14o), opened from a private link. */
export default function SharedPortfolio(props: { params: Promise<{ token: string }> }) {
  const { token } = use(props.params);
  const [data, setData] = useState<Data | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => { fetch(`/api/p/${token}`).then(r => r.ok ? r.json() : Promise.reject()).then(setData).catch(() => setMissing(true)); }, [token]);
  if (missing) return <main className="mx-auto max-w-md p-8 text-center"><h1 className="text-xl font-semibold">This link is not available</h1><p className="mt-2 text-slate-600">It may have expired or been stopped.</p></main>;
  if (!data) return <main className="p-8 text-center text-slate-500">Loading…</main>;
  const color = data.school.brand_color ?? "#2f4f8f";
  const total = data.achievements.length;
  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b-4 bg-white" style={{ borderColor: color }}>
        <div className="mx-auto flex max-w-5xl items-center gap-4 p-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {data.school.logo_url && <img src={data.school.logo_url} alt="" className="h-14 w-14 object-contain" />}
          <div className="mr-auto">
            <p className="text-sm font-semibold" style={{ color }}>{data.school.name}</p>
            <h1 className="font-serif text-[28px] font-semibold tracking-[-0.01em]">{data.name}</h1>
            <p className="text-sm text-slate-600">{data.kind === "student" ? (data.single ? "An achievement" : `Student portfolio${data.class_name ? ` · ${data.class_name}` : ""}`) : (data.single ? "An achievement" : `Staff portfolio${data.position ? ` · ${data.position}` : ""}`)}</p>
          </div>
          {!data.single && <div className="text-right text-sm"><p className="text-3xl font-semibold tabular-nums">{total}</p><p className="text-slate-500">achievement{total === 1 ? "" : "s"}</p></div>}
        </div>
      </header>
      <div className="mx-auto max-w-5xl p-6"><PortfolioView achievements={data.achievements} work={data.work} certificates={data.certificates} /></div>
      <footer className="mx-auto max-w-5xl px-6 pb-8 text-xs text-slate-500">Shared through Synergy Swift. Achievements added by the student are shown once the school has verified them. This link works until {new Date(data.expires_at).toLocaleDateString(undefined, { dateStyle: "long" })}.</footer>
    </main>
  );
}
