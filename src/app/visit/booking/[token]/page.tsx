"use client";
import { use, useState } from "react";
import { useApi, send } from "@/components/ui";

type Data = { booking: { name: string; party_size: number; status: string; event: { title: string; starts_at: string; location: string | null; details: string | null } }; school: { name: string; logo_url: string | null; brand_color: string | null; phone: string | null; address: string | null } };

/** A family's own visit booking: details, calendar file, cancel. */
export default function BookingPage(props: { params: Promise<{ token: string }> }) {
  const { token } = use(props.params);
  const { data, error, reload } = useApi<Data>(`/api/visit/booking/${token}`);
  const [msg, setMsg] = useState<string | null>(null);
  if (error) return <main className="mx-auto max-w-xl p-6"><p className="rounded-lg bg-slate-100 p-4">{error}</p></main>;
  if (!data) return <main className="p-10 text-center text-sm text-slate-500">Loading…</main>;
  const color = data.school.brand_color ?? "#1d5ddb";
  const b = data.booking;
  return (
    <main className="mx-auto max-w-xl p-6">
      <p className="text-sm font-semibold" style={{ color }}>{data.school.name}</p>
      <h1 className="text-2xl font-bold">{b.event.title}</h1>
      <p className="mt-1">{new Date(b.event.starts_at).toLocaleString(undefined, { dateStyle: "full", timeStyle: "short" })}</p>
      {b.event.location && <p className="text-slate-600">{b.event.location}</p>}
      {b.event.details && <p className="mt-2 text-sm">{b.event.details}</p>}
      <p className="mt-3 text-sm">Booked for {b.name}{b.party_size > 1 ? ` and ${b.party_size - 1} more` : ""}. Status: <b>{b.status.replace("_", " ")}</b></p>
      {msg && <p className="mt-3 rounded bg-slate-100 p-2 text-sm" role="status">{msg}</p>}
      {b.status === "booked" && (
        <div className="mt-4 flex flex-wrap gap-2">
          <a className="btn text-white" style={{ background: color }} href={`/api/visit/booking/${token}/ics`}>Add to calendar</a>
          <button className="btn btn-outline" onClick={async () => { if (!confirm("Cancel this booking?")) return; const r = await send(`/api/visit/booking/${token}`, {}); setMsg(r.ok ? "Your booking has been cancelled." : r.error); reload(); }}>Cancel booking</button>
        </div>
      )}
      <p className="mt-6 text-xs text-slate-500">Questions? {data.school.phone ?? ""} {data.school.address ?? ""}</p>
    </main>
  );
}
