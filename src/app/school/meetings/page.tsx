"use client";
import { useState } from "react";
import { useApi, send, Page, PageHeader, Alert, Empty, Field, Badge, fmtDate, fmtTime, rolesOf, type Me } from "@/components/ui";

type Slot = { id: string; starts_at: string; ends_at: string; location: string | null; guardian_id: string | null; note: string | null;
  guardians: { full_name: string; phone: string | null } | null; students: { first_name: string; last_name: string; class_groups: { name: string } | null } | null; users: { full_name: string } | null };

export default function MeetingsPage() {
  const { data: me } = useApi<Me>("/api/me");
  const admin = ["school_admin", "principal", "platform_admin"].some(r => rolesOf(me).has(r));
  const [all, setAll] = useState(false);
  const { data, error, reload } = useApi<Slot[]>(`/api/meetings${all ? "?all=1" : ""}`, [all]);
  const [f, setF] = useState({ date: "", from: "15:00", to: "17:00", minutes: 10, location: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const byDay = new Map<string, Slot[]>();
  for (const s of data ?? []) { const d = s.starts_at.slice(0, 10); byDay.set(d, [...(byDay.get(d) ?? []), s]); }
  return (
    <Page wide>
      <PageHeader eyebrow="Parents" title="Parent–teacher meetings"
        subtitle="Publish your available times; parents of the students you teach book a slot from their portal. You both get a confirmation." />
      <form className="card mb-5 flex flex-wrap items-end gap-2 p-4" onSubmit={async e => {
        e.preventDefault();
        const r = await send("/api/meetings", { action: "create_slots", date: f.date, from: f.from, to: f.to, minutes: Number(f.minutes), location: f.location || null, tz_offset_minutes: new Date(`${f.date}T12:00`).getTimezoneOffset() });
        setMsg({ ok: r.ok, text: r.ok ? `${r.data.created} slots published.` : r.error ?? "failed" }); if (r.ok) reload();
      }}>
        <Field label="Date"><input className="input" type="date" required value={f.date} onChange={e => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="From"><input className="input" type="time" required value={f.from} onChange={e => setF({ ...f, from: e.target.value })} /></Field>
        <Field label="To"><input className="input" type="time" required value={f.to} onChange={e => setF({ ...f, to: e.target.value })} /></Field>
        <Field label="Minutes each"><input className="input w-24" type="number" min={5} max={120} value={f.minutes} onChange={e => setF({ ...f, minutes: Number(e.target.value) })} /></Field>
        <Field label="Room or video link"><input className="input" value={f.location} onChange={e => setF({ ...f, location: e.target.value })} /></Field>
        <button className="btn btn-primary">Publish slots</button>
        {admin && <label className="ml-auto flex items-center gap-2 text-sm"><input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} /> Show all teachers</label>}
      </form>
      {msg && <div className="mb-3"><Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert></div>}
      {error && <Alert>{error}</Alert>}
      {!byDay.size ? <Empty>No upcoming slots.</Empty> : [...byDay.entries()].map(([day, slots]) => (
        <section key={day} className="mb-4">
          <h2 className="mb-2 font-semibold">{fmtDate(day)}</h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{slots.map(s => (
            <div key={s.id} className={"rounded-lg border p-3 text-sm " + (s.guardian_id ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-white")}>
              <div className="flex items-center justify-between"><b className="tabular-nums">{fmtTime(s.starts_at)}–{fmtTime(s.ends_at)}</b>{s.guardian_id ? <Badge tone="green">booked</Badge> : <Badge>free</Badge>}</div>
              {all && <p className="text-xs text-slate-500">{s.users?.full_name}</p>}
              {s.guardian_id ? <p className="mt-1">{s.guardians?.full_name} about <b>{s.students?.first_name}</b> ({s.students?.class_groups?.name}){s.guardians?.phone ? ` · ${s.guardians.phone}` : ""}{s.note ? <span className="block text-xs text-slate-500">{s.note}</span> : null}</p>
                : <button className="mt-1 text-xs text-rose-600" onClick={async () => { await send("/api/meetings", { action: "delete_slot", id: s.id }); reload(); }}>Remove</button>}
            </div>))}</div>
        </section>
      ))}
    </Page>
  );
}
