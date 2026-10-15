"use client";
import { useState } from "react";
import { useApi, send, Page, PageHeader, Alert, Empty, Field, Badge, Loading, fmtDate, localDate } from "@/components/ui";
import { ROOM_KIND } from "@/components/timetable/TimetableSetup";

type Item = { id?: string; room_id: string; title: string; start?: string; end?: string; starts_at?: string; ends_at?: string; status?: string; users?: { full_name: string } | null };
type Data = { date: string; rooms: { id: string; name: string; kind: string; capacity: number | null; bookable: boolean; needs_approval: boolean }[];
  bookings: Item[]; lessons: Item[]; mine: { id: string; title: string; starts_at: string; ends_at: string; status: string; rooms: { name: string } | null }[];
  pending: { id: string; title: string; starts_at: string; ends_at: string; rooms: { name: string } | null; users: { full_name: string } | null }[]; admin: boolean };
const HOURS = Array.from({ length: 12 }, (_, i) => 7 + i);   // 07:00 to 18:00
const t = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** Book labs, halls and ICT suites around the timetable; see the day for every room. */
export default function RoomsPage() {
  const [date, setDate] = useState(localDate());
  const { data, reload } = useApi<Data>(`/api/rooms?date=${date}`, [date]);
  const { data: structure } = useApi<{ class_groups: { id: string; name: string }[] }>("/api/school/structure");
  const [f, setF] = useState({ room_id: "", title: "", start: "10:00", end: "11:00", class_group_id: "", repeat_weeks: 0 });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const act = async (b: Record<string, unknown>, ok: string) => { const r = await send<any>("/api/rooms", b); setMsg({ ok: r.ok, text: r.ok ? ok : r.error ?? "failed" }); if (r.ok) reload(); return r; };
  const pos = (iso: string) => { const d = new Date(iso); return Math.max(0, Math.min(100, ((d.getHours() + d.getMinutes() / 60 - 7) / 12) * 100)); };
  return (
    <Page wide>
      <PageHeader eyebrow="Facilities" title="Rooms & booking" subtitle="Book laboratories, halls, ICT suites and other rooms. Timetabled lessons are shown and cannot be double-booked; some rooms need an admin's approval." />
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      {!data ? <Loading /> : !data.rooms.length ? <Empty>No rooms yet. Admins add them under Timetable → Rooms.</Empty> : (
        <div className="space-y-4 text-sm">
          {data.admin && data.pending.length > 0 && (
            <section className="card space-y-1 p-4"><h2 className="font-semibold">Waiting for approval</h2>
              {data.pending.map(p => <div key={p.id} className="flex flex-wrap items-center gap-2"><span className="mr-auto"><b>{p.rooms?.name}</b>: {p.title} · {fmtDate(p.starts_at, true)}–{t(p.ends_at)} · {p.users?.full_name}</span>
                <button className="btn btn-primary px-2 py-1 text-xs" onClick={() => act({ action: "decide", id: p.id, approve: true }, "Approved.")}>Approve</button>
                <button className="btn btn-outline px-2 py-1 text-xs" onClick={() => act({ action: "decide", id: p.id, approve: false }, "Declined.")}>Decline</button></div>)}
            </section>
          )}
          <section className="card space-y-2 p-4">
            <div className="flex items-center gap-2"><h2 className="mr-auto font-semibold">The day</h2><input className="input w-auto" type="date" value={date} onChange={e => setDate(e.target.value)} aria-label="Date" /></div>
            <div className="overflow-x-auto"><div className="min-w-[640px]">
              <div className="ml-36 flex text-[10px] text-slate-400">{HOURS.map(h => <span key={h} className="flex-1">{String(h).padStart(2, "0")}:00</span>)}</div>
              {data.rooms.map(r => (
                <div key={r.id} className="flex items-center border-t border-slate-100 py-1">
                  <span className="w-36 shrink-0 pr-2"><b>{r.name}</b><span className="block text-[10px] text-slate-500">{ROOM_KIND[r.kind]}{r.capacity ? ` · ${r.capacity}` : ""}{!r.bookable ? " · not bookable" : ""}</span></span>
                  <div className="relative h-8 flex-1 rounded bg-slate-50">
                    {[...data.lessons.filter(l => l.room_id === r.id).map(l => ({ ...l, s: l.start!, e: l.end!, tone: "bg-slate-300 text-slate-800", label: `Lesson: ${l.title}` })),
                      ...data.bookings.filter(b => b.room_id === r.id).map(b => ({ ...b, s: b.starts_at!, e: b.ends_at!, tone: b.status === "pending" ? "bg-amber-200 text-amber-900" : "bg-brand-500 text-white", label: `${b.title}${b.users ? ` (${b.users.full_name})` : ""}${b.status === "pending" ? " · waiting" : ""}` }))]
                      .map((x, i) => <div key={i} title={`${x.label} ${t(x.s)}–${t(x.e)}`} className={`absolute top-0.5 bottom-0.5 overflow-hidden truncate rounded px-1 text-[10px] leading-7 ${x.tone}`} style={{ left: `${pos(x.s)}%`, width: `${Math.max(1, pos(x.e) - pos(x.s))}%` }}>{x.label}</div>)}
                  </div>
                </div>))}
            </div></div>
          </section>
          <form className="card grid gap-2 p-4 sm:grid-cols-6" onSubmit={async e => {
            e.preventDefault();
            const r = await act({ action: "book", ...f, date, class_group_id: f.class_group_id || null }, "Booked.");
            if (r.ok) setMsg({ ok: true, text: `${r.data.pending ? "Requested; an admin will approve it." : "Booked."}${r.data.booked > 1 ? ` ${r.data.booked} weeks.` : ""}${r.data.failed.length ? ` Not booked: ${r.data.failed.join("; ")}.` : ""}` });
          }}>
            <h2 className="font-semibold sm:col-span-6">Book a room on {fmtDate(date)}</h2>
            <Field label="Room"><select className="input" value={f.room_id} onChange={e => setF({ ...f, room_id: e.target.value })} required><option value="">Choose…</option>{data.rooms.filter(r => r.bookable).map(r => <option key={r.id} value={r.id}>{r.name}{r.needs_approval ? " (approval)" : ""}</option>)}</select></Field>
            <div className="sm:col-span-2"><Field label="What for"><input className="input" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} required minLength={2} maxLength={160} placeholder="JSS2 practical" /></Field></div>
            <Field label="From"><input className="input" type="time" value={f.start} onChange={e => setF({ ...f, start: e.target.value })} required /></Field>
            <Field label="To"><input className="input" type="time" value={f.end} onChange={e => setF({ ...f, end: e.target.value })} required /></Field>
            <Field label="Repeat weekly"><select className="input" value={f.repeat_weeks} onChange={e => setF({ ...f, repeat_weeks: Number(e.target.value) })}><option value={0}>No</option>{[1, 3, 5, 9, 11].map(n => <option key={n} value={n}>{n + 1} weeks</option>)}</select></Field>
            <Field label="Class (optional)"><select className="input" value={f.class_group_id} onChange={e => setF({ ...f, class_group_id: e.target.value })}><option value="">—</option>{(structure?.class_groups ?? []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
            <div className="flex items-end sm:col-span-5"><button className="btn btn-primary">Book</button></div>
          </form>
          <section className="card space-y-1 p-4"><h2 className="font-semibold">My bookings</h2>
            {!data.mine.length ? <Empty>None coming up.</Empty> : data.mine.map(m => (
              <div key={m.id} className="flex flex-wrap items-center gap-2"><span className="mr-auto"><b>{m.rooms?.name}</b>: {m.title} · {fmtDate(m.starts_at, true)}–{t(m.ends_at)}</span>
                <Badge tone={m.status === "confirmed" ? "green" : m.status === "pending" ? "amber" : "red"}>{m.status === "pending" ? "waiting" : m.status}</Badge>
                {m.status !== "declined" && <button className="text-xs text-rose-600" onClick={() => act({ action: "cancel", id: m.id }, "Cancelled.")}>Cancel</button>}</div>))}
          </section>
        </div>
      )}
    </Page>
  );
}
