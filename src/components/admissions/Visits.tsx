"use client";
import { useState } from "react";
import { useApi, send, Alert, Empty, Modal, Field, Badge, Loading, fmtDate } from "@/components/ui";

type Booking = { id: string; lead_id: string | null; name: string; email: string | null; phone: string | null; party_size: number; status: string; created_at: string };
type Ev = { id: string; kind: string; title: string; starts_at: string; ends_at: string | null; capacity: number; location: string | null; details: string | null; published: boolean; admission_bookings: Booking[] };
const KIND: Record<string, string> = { tour: "School tour", open_day: "Open day", assessment: "Assessment", interview: "Interview" };

/** Tours, open days, assessment and interview sessions: capacity, public booking, attendance. */
export default function Visits({ onOpenLead }: { onOpenLead: (id: string) => void }) {
  const [past, setPast] = useState(false);
  const { data, error, reload } = useApi<{ events: Ev[]; booking_url: string | null }>(`/api/crm/events${past ? "?past=1" : ""}`, [past]);
  const [edit, setEdit] = useState<Partial<Ev> | null>(null);
  const [booking, setBooking] = useState<Ev | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const act = async (body: Record<string, unknown>, ok: string) => { const r = await send("/api/crm/events", body); setMsg({ ok: r.ok, text: r.ok ? ok : r.error ?? "failed" }); if (r.ok) reload(); return r.ok; };
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn btn-primary" onClick={() => setEdit({ kind: "tour", capacity: 10, published: true })}>+ New session</button>
        <button className="btn btn-ghost" onClick={() => setPast(p => !p)}>{past ? "Upcoming" : "Past sessions"}</button>
        {data.booking_url && <span className="ml-auto text-xs text-slate-600">Public booking page: <a className="font-medium text-brand-700 underline" href={data.booking_url} target="_blank" rel="noreferrer">{data.booking_url}</a></span>}
      </div>
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      {!data.events.length ? <Empty>No {past ? "past" : "upcoming"} sessions. Add tours or an open day; families book them online.</Empty> : (
        <div className="grid gap-3 lg:grid-cols-2">
          {data.events.map(e => {
            const active = e.admission_bookings.filter(b => b.status !== "cancelled");
            const taken = active.reduce((a, b) => a + b.party_size, 0);
            return (
              <section key={e.id} className="card p-4">
                <div className="flex flex-wrap items-start gap-2">
                  <div className="flex-1"><p className="font-semibold">{e.title}</p><p className="text-xs text-slate-500">{KIND[e.kind]} · {fmtDate(e.starts_at, true)}{e.location ? ` · ${e.location}` : ""}</p></div>
                  <Badge tone={taken >= e.capacity ? "red" : "green"}>{taken}/{e.capacity}</Badge>{!e.published && <Badge>not public</Badge>}
                </div>
                <ul className="mt-2 divide-y divide-slate-100 text-sm">{active.map(b => (
                  <li key={b.id} className="flex flex-wrap items-center gap-2 py-1">
                    <button className="font-medium text-brand-700 hover:underline" disabled={!b.lead_id} onClick={() => b.lead_id && onOpenLead(b.lead_id)}>{b.name}</button>
                    <span className="text-xs text-slate-500">{b.phone}{b.party_size > 1 ? ` · ${b.party_size} people` : ""}</span>
                    <select className="ml-auto rounded border border-slate-200 text-xs" value={b.status} aria-label={`Attendance for ${b.name}`} onChange={ev => act({ action: "booking_status", booking_id: b.id, status: ev.target.value }, "Updated.")}>
                      {["booked", "attended", "no_show", "cancelled"].map(s => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
                    </select>
                  </li>))}
                  {!active.length && <li className="py-1 text-xs text-slate-500">No bookings yet.</li>}
                </ul>
                <div className="mt-2 flex flex-wrap gap-1">
                  <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setBooking(e)}>+ Book a family</button>
                  <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setEdit(e)}>Edit</button>
                  <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => { const w = prompt("Repeat weekly for how many more weeks?", "4"); if (w) act({ action: "repeat", id: e.id, weeks: Number(w) }, `Added ${w} more weekly sessions.`); }}>Repeat weekly</button>
                  <button className="btn btn-ghost px-2 py-1 text-xs text-rose-600" onClick={() => confirm(`Delete ${e.title}? Families booked on it are not told.`) && act({ action: "delete", id: e.id }, "Deleted.")}>Delete</button>
                </div>
              </section>
            );
          })}
        </div>
      )}
      <Modal open={Boolean(edit)} onClose={() => setEdit(null)} title={edit?.id ? "Edit session" : "New session"} wide>
        {edit && <EventForm ev={edit} onSave={async body => { if (await act({ action: "save", ...body }, "Saved.")) setEdit(null); }} />}
      </Modal>
      <Modal open={Boolean(booking)} onClose={() => setBooking(null)} title={`Book a family: ${booking?.title ?? ""}`}>
        {booking && <BookForm onSave={async body => { if (await act({ action: "add_booking", event_id: booking.id, ...body }, "Booked.")) setBooking(null); }} />}
      </Modal>
    </div>
  );
}

function EventForm({ ev, onSave }: { ev: Partial<Ev>; onSave: (b: Record<string, unknown>) => void }) {
  const local = (v?: string | null) => (v ? new Date(new Date(v).getTime() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : "");
  const [f, setF] = useState({ kind: ev.kind ?? "tour", title: ev.title ?? "", starts: local(ev.starts_at), ends: local(ev.ends_at), capacity: String(ev.capacity ?? 10), location: ev.location ?? "", details: ev.details ?? "", published: ev.published !== false });
  return (
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={e => { e.preventDefault(); onSave({ id: ev.id, kind: f.kind, title: f.title || ({ tour: "School tour", open_day: "Open day", assessment: "Entrance assessment", interview: "Interviews" } as Record<string, string>)[f.kind],
      starts_at: new Date(f.starts).toISOString(), ends_at: f.ends ? new Date(f.ends).toISOString() : null, capacity: Number(f.capacity), location: f.location || null, details: f.details || null, published: f.published }); }}>
      <Field label="Type"><select className="input" value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })}><option value="tour">School tour</option><option value="open_day">Open day</option><option value="assessment">Assessment session</option><option value="interview">Interview session</option></select></Field>
      <Field label="Title"><input className="input" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} placeholder="School tour" /></Field>
      <Field label="Starts"><input className="input" type="datetime-local" required value={f.starts} onChange={e => setF({ ...f, starts: e.target.value })} /></Field>
      <Field label="Ends"><input className="input" type="datetime-local" value={f.ends} onChange={e => setF({ ...f, ends: e.target.value })} /></Field>
      <Field label="Places (people)"><input className="input" type="number" min={1} value={f.capacity} onChange={e => setF({ ...f, capacity: e.target.value })} /></Field>
      <Field label="Where"><input className="input" value={f.location} onChange={e => setF({ ...f, location: e.target.value })} placeholder="Main reception" /></Field>
      <div className="sm:col-span-2"><Field label="Details for families"><textarea className="input h-16" value={f.details} onChange={e => setF({ ...f, details: e.target.value })} /></Field></div>
      <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={f.published} onChange={e => setF({ ...f, published: e.target.checked })} /> Families can book this online (tours and open days)</label>
      <div className="flex justify-end sm:col-span-2"><button className="btn btn-primary">Save</button></div>
    </form>
  );
}

function BookForm({ onSave }: { onSave: (b: Record<string, unknown>) => void }) {
  const [f, setF] = useState({ name: "", phone: "", email: "", party_size: "1" });
  return (
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={e => { e.preventDefault(); onSave({ name: f.name, phone: f.phone || null, email: f.email || null, party_size: Number(f.party_size) }); }}>
      <Field label="Parent's name"><input className="input" required value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
      <Field label="Phone"><input className="input" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} /></Field>
      <Field label="Email"><input className="input" type="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></Field>
      <Field label="People"><input className="input" type="number" min={1} max={20} value={f.party_size} onChange={e => setF({ ...f, party_size: e.target.value })} /></Field>
      <div className="flex justify-end sm:col-span-2"><button className="btn btn-primary">Book</button></div>
    </form>
  );
}
