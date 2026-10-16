"use client";
import { useState } from "react";
import { useApi, send, Alert, Empty, Field, Badge, Loading } from "@/components/ui";

export const ROOM_KIND: Record<string, string> = { classroom: "Classroom", lab: "Laboratory", ict: "ICT suite", hall: "Hall", library: "Library", sports: "Sports", music: "Music room", art: "Art room", other: "Other" };
type Room = { id: string; name: string; kind: string; capacity: number | null; bookable: boolean; needs_approval: boolean; notes: string | null; active: boolean };
type Period = { id: string; name: string; starts_at: string; is_break: boolean };
const DAYS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Rooms (classrooms, labs, ICT suites, halls) and each class's home room. */
export function Rooms() {
  const { data, reload } = useApi<{ rooms: Room[]; classes: { id: string; name: string; home_room_id: string | null }[] }>("/api/timetable");
  const [edit, setEdit] = useState<Partial<Room> | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const act = async (b: Record<string, unknown>, ok: string) => { const r = await send("/api/timetable", b); setMsg({ ok: r.ok, text: r.ok ? ok : r.error ?? "failed" }); if (r.ok) reload(); return r.ok; };
  if (!data) return <Loading />;
  const f = edit;
  return (
    <div className="space-y-4 text-sm">
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      <section className="card space-y-2 p-4">
        <div className="flex items-center"><h2 className="mr-auto font-semibold">Rooms</h2><button className="btn btn-outline px-2 py-1 text-xs" onClick={() => setEdit({ kind: "classroom", bookable: true, needs_approval: false, active: true })}>+ Add room</button></div>
        <p className="text-slate-600">The generator puts subjects that need a laboratory or the ICT suite in one, and other lessons in the class&apos;s home room. Bookable rooms can be reserved under Rooms &amp; booking.</p>
        {!data.rooms.length ? <Empty>No rooms yet.</Empty> : <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{data.rooms.map(r => (
          <li key={r.id} className={"rounded border border-slate-200 p-2 " + (r.active ? "" : "opacity-50")}>
            <div className="flex items-center gap-2"><b className="mr-auto">{r.name}</b><Badge tone="blue">{ROOM_KIND[r.kind]}</Badge><button className="text-xs text-brand-700" onClick={() => setEdit(r)}>Edit</button></div>
            <p className="text-xs text-slate-500">{r.capacity ? `${r.capacity} places · ` : ""}{r.bookable ? (r.needs_approval ? "bookable with approval" : "bookable") : "not bookable"}</p>
          </li>))}</ul>}
        {f && (
          <form className="grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-4" onSubmit={async e => { e.preventDefault(); if (await act({ action: "save_room", id: f.id ?? null, name: f.name, kind: f.kind, capacity: f.capacity || null, bookable: f.bookable, needs_approval: f.needs_approval, notes: f.notes || null, active: f.active }, "Room saved.")) setEdit(null); }}>
            <Field label="Name"><input className="input" value={f.name ?? ""} onChange={e => setEdit({ ...f, name: e.target.value })} required maxLength={40} placeholder="Chemistry lab" /></Field>
            <Field label="Kind"><select className="input" value={f.kind} onChange={e => setEdit({ ...f, kind: e.target.value })}>{Object.entries(ROOM_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            <Field label="Places"><input className="input" type="number" min={1} value={f.capacity ?? ""} onChange={e => setEdit({ ...f, capacity: e.target.value ? Number(e.target.value) : null })} /></Field>
            <div className="space-y-1 pt-5">
              <label className="flex items-center gap-1"><input type="checkbox" checked={Boolean(f.bookable)} onChange={e => setEdit({ ...f, bookable: e.target.checked })} />Bookable</label>
              <label className="flex items-center gap-1"><input type="checkbox" checked={Boolean(f.needs_approval)} onChange={e => setEdit({ ...f, needs_approval: e.target.checked })} />Bookings need approval</label>
              <label className="flex items-center gap-1"><input type="checkbox" checked={f.active !== false} onChange={e => setEdit({ ...f, active: e.target.checked })} />In use</label>
            </div>
            <div className="flex gap-2 sm:col-span-4"><button className="btn btn-primary">Save</button><button type="button" className="btn btn-ghost" onClick={() => setEdit(null)}>Cancel</button>
              {f.id && <button type="button" className="btn btn-ghost text-rose-600" onClick={async () => { if (confirm("Delete this room? Lessons and bookings in it lose their room.") && await act({ action: "delete_room", id: f.id }, "Deleted.")) setEdit(null); }}>Delete</button>}</div>
          </form>
        )}
      </section>
      {data.rooms.length > 0 && (
        <section className="card space-y-2 p-4">
          <h2 className="font-semibold">Home rooms</h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{data.classes.map(c => (
            <label key={c.id} className="flex items-center gap-2"><span className="w-28">{c.name}</span>
              <select className="input" value={c.home_room_id ?? ""} onChange={e => act({ action: "home_room", class_group_id: c.id, room_id: e.target.value || null }, `${c.name} home room saved.`)}>
                <option value="">—</option>{data.rooms.filter(r => r.active).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>))}</div>
        </section>
      )}
    </div>
  );
}

/** Periods a teacher cannot teach (part-time days, duties). Teachers set their own; admins anyone's. */
export function Availability({ admin, me }: { admin: boolean; me: string | null }) {
  const { data, reload } = useApi<{ periods: Period[]; unavailable: { user_id: string; day: number; period_id: string }[] }>("/api/timetable");
  const { data: structure } = useApi<{ staff: { id: string; full_name: string; role: string; extra_roles: string[] | null }[] }>(admin ? "/api/school/structure" : null);
  const [who, setWho] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);
  const user = admin ? who : me;
  if (!data) return <Loading />;
  const teachers = (structure?.staff ?? []).filter(s => s.role === "teacher" || (s.extra_roles ?? []).includes("teacher") || ["school_admin", "principal"].includes(s.role));
  const off = new Set(data.unavailable.filter(u => u.user_id === user).map(u => `${u.day}|${u.period_id}`));
  const days = [1, 2, 3, 4, 5];
  return (
    <div className="space-y-3 text-sm">
      <p className="text-slate-600">Tick the periods when {admin ? "this teacher" : "you"} cannot teach. The timetable generator keeps them free.</p>
      {admin && <select className="input w-auto" value={who} onChange={e => setWho(e.target.value)} aria-label="Teacher"><option value="">Choose a teacher</option>{teachers.map(t => <option key={t.id} value={t.id}>{t.full_name}</option>)}</select>}
      {err && <Alert>{err}</Alert>}
      {user && (
        <div className="card overflow-x-auto"><table className="w-full text-sm">
          <thead className="bg-slate-50 text-[13px] text-slate-500"><tr><th className="p-2 text-left">Period</th>{days.map(d => <th key={d} className="p-2">{DAYS[d]}</th>)}</tr></thead>
          <tbody>{data.periods.filter(p => !p.is_break).map(p => (
            <tr key={p.id} className="border-t border-slate-100"><td className="p-2 text-xs"><b>{p.name}</b> {p.starts_at.slice(0, 5)}</td>
              {days.map(d => { const k = `${d}|${p.id}`; return (
                <td key={d} className="p-1 text-center"><label className={"inline-flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-xs " + (off.has(k) ? "bg-rose-100 text-rose-700" : "bg-emerald-50 text-emerald-700")}>
                  <input type="checkbox" className="sr-only" checked={off.has(k)} onChange={async e => { setErr(null); const r = await send("/api/timetable", { action: "availability", user_id: user, day: d, period_id: p.id, unavailable: e.target.checked }); if (!r.ok) setErr(r.error); reload(); }} />
                  {off.has(k) ? "Not free" : "Free"}</label></td>); })}</tr>))}</tbody></table></div>
      )}
    </div>
  );
}
