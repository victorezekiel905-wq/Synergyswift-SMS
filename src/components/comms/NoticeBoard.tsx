"use client";
import { useEffect, useState } from "react";
import { useApi, send, Badge, Empty, fmtDate } from "@/components/ui";
import RichText from "@/components/content/RichText";

type Item = { receipt_id: string; id: string; kind: string; title: string; body: string; requires_ack: boolean; sent_at: string; expires_at: string | null; pinned: boolean; read_at: string | null; acknowledged_at: string | null };

/** Notices for the signed-in person (staff, students, parents): newest first, unread marked. */
export default function NoticeBoard({ limit = 6 }: { limit?: number }) {
  const { data, reload } = useApi<{ items: Item[]; unread: number }>("/api/notices/mine");
  const [open, setOpen] = useState<string | null>(null);
  if (!data) return null;
  const now = Date.now();
  const items = data.items.filter(i => !i.expires_at || Date.parse(i.expires_at) > now || !i.read_at).sort((a, b) => Number(b.pinned) - Number(a.pinned)).slice(0, limit);
  const mark = async (i: Item, ack = false) => { if (!i.read_at || (ack && !i.acknowledged_at)) { await send("/api/notices/mine", { receipt_id: i.receipt_id, ack }); reload(); } };
  return (
    <section className="card mb-6 space-y-2 p-4 text-sm">
      <h2 className="flex items-center gap-2 font-semibold">Notices {data.unread > 0 && <Badge tone="red">{data.unread} new</Badge>}</h2>
      {!items.length ? <Empty>No notices.</Empty> : <ul className="divide-y divide-slate-100">{items.map(i => (
        <li key={i.receipt_id} className="py-2">
          <button className="flex w-full items-center gap-2 text-left" onClick={() => { setOpen(open === i.receipt_id ? null : i.receipt_id); void mark(i); }}>
            {!i.read_at && <span className="h-2 w-2 shrink-0 rounded-full bg-brand-600" aria-label="unread" />}
            <span className={"mr-auto " + (i.read_at ? "" : "font-semibold")}>{i.title}</span>
            {i.kind !== "announcement" && <Badge tone={i.kind === "emergency" ? "red" : "violet"}>{i.kind}</Badge>}
            <span className="text-xs text-slate-500">{fmtDate(i.sent_at)}</span>
          </button>
          {open === i.receipt_id && <div className="mt-2 space-y-2"><RichText text={i.body} />
            {(i.requires_ack || i.kind === "emergency") && (i.acknowledged_at ? <p className="text-xs text-emerald-700">You confirmed this on {fmtDate(i.acknowledged_at, true)}.</p>
              : <button className="btn btn-primary px-2 py-1 text-xs" onClick={() => mark(i, true)}>{i.kind === "emergency" ? "I received this" : "I have read this"}</button>)}</div>}
        </li>))}</ul>}
    </section>
  );
}

/** A red bar on every page until the person confirms an emergency alert. */
export function EmergencyBanner() {
  const [e, setE] = useState<Item | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let off = false;
    const load = async () => {
      const r = await fetch("/api/notices/mine", { cache: "no-store" }).then(x => (x.ok ? x.json() : null)).catch(() => null);
      if (!off) setE(r?.emergency ?? null);
    };
    void load();
    const t = window.setInterval(load, 120_000);
    return () => { off = true; window.clearInterval(t); };
  }, []);
  if (!e) return null;
  return (
    <div className="bg-rose-600 px-4 py-2 text-sm text-white print:hidden" role="alert">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2">
        <b className="mr-auto">URGENT: {e.title}</b>
        <button className="underline" onClick={() => setOpen(!open)}>{open ? "Hide" : "Read"}</button>
        <button className="rounded bg-white px-2 py-0.5 font-semibold text-rose-700" onClick={async () => { await send("/api/notices/mine", { receipt_id: e.receipt_id, ack: true }); setE(null); }}>I received this</button>
      </div>
      {open && <div className="mx-auto mt-2 max-w-6xl rounded bg-white/95 p-3 text-slate-900"><RichText text={e.body} /></div>}
    </div>
  );
}
