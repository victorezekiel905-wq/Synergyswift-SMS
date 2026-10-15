"use client";
import { use, useEffect, useState } from "react";
import RichText from "@/components/content/RichText";

type Data = { title: string; body: string; kind: string; requires_ack: boolean; sent_at: string | null; school: string; acknowledged_at: string | null };

/** A notice opened from a WhatsApp, SMS or email link; opening it counts as read, and the button confirms it. */
export default function NoticeLink(props: { params: Promise<{ token: string }> }) {
  const { token } = use(props.params);
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch(`/api/n/${token}`, { cache: "no-store" }).then(async r => { const j = await r.json(); if (r.ok) setData(j); else setErr(j.error); }).catch(() => setErr("Could not load this notice."));
  }, [token]);
  if (err) return <main className="mx-auto max-w-xl p-6"><p className="rounded-lg bg-rose-50 p-4 text-rose-800">{err}</p></main>;
  if (!data) return <main className="p-10 text-center text-sm text-slate-500">Loading…</main>;
  const urgent = data.kind === "emergency";
  return (
    <main className="mx-auto max-w-2xl space-y-4 p-4">
      <p className="text-sm font-semibold text-slate-500">{data.school}</p>
      <article className={"rounded-xl border bg-white p-5 shadow-sm " + (urgent ? "border-rose-300" : "border-slate-200")}>
        {urgent && <p className="mb-2 inline-block rounded bg-rose-600 px-2 py-0.5 text-xs font-bold uppercase text-white">Urgent</p>}
        <h1 className="mb-1 text-xl font-semibold">{data.title}</h1>
        {data.sent_at && <p className="mb-3 text-xs text-slate-500">{new Date(data.sent_at).toLocaleString()}</p>}
        <RichText text={data.body} />
      </article>
      {data.requires_ack && (data.acknowledged_at
        ? <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">Thank you. The school knows you have {urgent ? "received" : "read"} this.</p>
        : <button className={"btn w-full " + (urgent ? "bg-rose-600 text-white hover:bg-rose-700" : "btn-primary")} disabled={busy} onClick={async () => {
            setBusy(true);
            const r = await fetch(`/api/n/${token}`, { method: "POST" });
            const j = await r.json().catch(() => ({}));
            setBusy(false);
            if (r.ok) setData({ ...data, acknowledged_at: j.acknowledged_at ?? new Date().toISOString() }); else setErr(j.error ?? "Could not confirm.");
          }}>{urgent ? "I received this" : "I have read this"}</button>)}
    </main>
  );
}
