"use client";
import { use, useState } from "react";
import { useApi, send, fmtDate } from "@/components/ui";

type Data = { school: { name: string; logo_url: string | null; brand_color: string | null }; timezone: string; name: string; title: string; applied_on: string; stage: string; can_withdraw: boolean;
  interviews: { at: string; duration_min: number; mode: string; location: string | null }[] };

/** A candidate checks their application and any interview, and can withdraw. */
export default function TrackApplication(props: { params: Promise<{ token: string }> }) {
  const { token } = use(props.params);
  const { data, error, reload } = useApi<Data>(`/api/careers/track/${token}`);
  const [msg, setMsg] = useState<string | null>(null);
  if (error) return <main className="mx-auto max-w-xl p-6"><p className="rounded-lg bg-slate-100 p-4">This link is not valid.</p></main>;
  if (!data) return <main className="p-10 text-center text-sm text-slate-500">Loading…</main>;
  const color = data.school.brand_color ?? "#1d5ddb";
  const at = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: data.timezone, weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  return (
    <main className="mx-auto max-w-xl bg-white p-4 sm:p-8">
      <header className="mb-5 border-b-4 pb-3" style={{ borderColor: color }}><p className="text-sm text-slate-600">{data.school.name}</p><h1 className="text-xl font-bold" style={{ color }}>{data.title}</h1></header>
      <p>Hello {data.name}. You applied on {fmtDate(data.applied_on)}.</p>
      <p className="mt-3 text-lg">Status: <b>{data.stage}</b></p>
      {data.interviews.map((i, k) => (
        <div key={k} className="mt-4 rounded-lg bg-slate-50 p-4">
          <p className="font-semibold">Interview</p>
          <p>{at(i.at)} ({i.duration_min} minutes)</p>
          <p className="text-sm text-slate-600">{i.mode === "video" ? `By video${i.location ? `: ${i.location}` : ""}` : i.mode === "phone" ? "By phone; the school will call you" : `In person${i.location ? ` at ${i.location}` : ""}`}</p>
        </div>))}
      {msg && <p className="mt-4 rounded bg-slate-100 p-3">{msg}</p>}
      {data.can_withdraw && <button className="btn btn-ghost mt-6 text-rose-700" onClick={async () => {
        if (!confirm("Withdraw your application? This cannot be undone.")) return;
        const r = await send(`/api/careers/track/${token}`, { action: "withdraw" });
        setMsg(r.ok ? "Your application has been withdrawn." : r.error); reload();
      }}>Withdraw my application</button>}
    </main>
  );
}
