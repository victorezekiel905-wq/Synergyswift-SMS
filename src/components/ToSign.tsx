"use client";
import { useApi, fmtDate } from "@/components/ui";

type Item = { id: string; link: string; title: string; kind: string; due_on: string | null; child: string | null };

/** Forms and contracts waiting for this person's signature. */
export default function ToSign({ title = "Waiting for your signature" }: { title?: string }) {
  const { data } = useApi<{ to_sign: Item[] }>("/api/esign?mine=1");
  if (!data?.to_sign?.length) return null;
  return (
    <section className="card mb-5 border-amber-200 bg-amber-50/60 p-4">
      <h2 className="mb-2 font-semibold">{title}</h2>
      <ul className="space-y-1.5 text-sm">{data.to_sign.map(i => (
        <li key={i.id} className="flex flex-wrap items-center gap-2">
          <span className="flex-1"><b>{i.title}</b>{i.child ? ` · ${i.child}` : ""}{i.due_on ? <span className="text-xs text-slate-500"> · by {fmtDate(i.due_on)}</span> : null}</span>
          <a className="btn btn-primary px-3 py-1 text-xs" href={i.link}>Read and sign</a>
        </li>))}</ul>
    </section>
  );
}
