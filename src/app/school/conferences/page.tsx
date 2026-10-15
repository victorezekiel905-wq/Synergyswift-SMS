"use client";
import { useState } from "react";
import { useApi, send, Page, PageHeader, Alert, Empty, Badge, Field, Loading, Modal, fmtDate, fmtTime } from "@/components/ui";
import { ClassPicker } from "@/components/learning/ContentLibrary";

type Conf = { id: string; title: string; date: string; starts_at: string; ends_at: string; slot_minutes: number; status: string; class_group_ids: string[]; staff_user_ids: string[]; slots: number; booked: number };
type Slot = { id: string; staff_user_id: string; starts_at: string; ends_at: string; guardian_id: string | null; note: string | null; student: string | null; class_name: string | null;
  guardians: { full_name: string; phone: string | null } | null; users: { full_name: string } | null };

/** Parent-teacher evenings: one form creates every teacher's appointments; parents book in their portal. */
export default function ConferencesPage() {
  const { data, reload } = useApi<{ admin: boolean; items: Conf[] }>("/api/conferences");
  const { data: structure } = useApi<{ class_groups: { id: string; name: string }[] }>("/api/school/structure");
  const [f, setF] = useState({ title: "Parent–teacher evening", date: "", start: "16:00", end: "19:00", slot_minutes: 10, gap_minutes: 0, location: "", class_group_ids: [] as string[] });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const act = async (b: Record<string, unknown>, ok: string) => { const r = await send<any>("/api/conferences", b); setMsg({ ok: r.ok, text: r.ok ? ok : r.error ?? "failed" }); if (r.ok) reload(); return r; };
  return (
    <Page wide>
      <PageHeader eyebrow="Communication" title="Parent–teacher evenings" subtitle="Set the evening once: every teacher of the chosen classes gets appointment slots, parents are told and book with each teacher in their portal, and no parent can be booked in two places at once." />
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      {!data ? <Loading /> : (
        <div className="space-y-4 text-sm">
          {data.admin && (
            <form className="card grid gap-2 p-4 sm:grid-cols-4" onSubmit={async e => { e.preventDefault(); setBusy(true);
              const r = await act({ action: "create", ...f, location: f.location || null }, "Created.");
              setBusy(false);
              if (r.ok) setMsg({ ok: true, text: `Created ${r.data.appointments} appointments for ${r.data.teachers} teachers; ${r.data.messages} messages sent to parents.` }); }}>
              <h2 className="font-semibold sm:col-span-4">New evening</h2>
              <div className="sm:col-span-2"><Field label="Title"><input className="input" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} required minLength={2} /></Field></div>
              <Field label="Date"><input className="input" type="date" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} required /></Field>
              <Field label="Where"><input className="input" value={f.location} onChange={e => setF({ ...f, location: e.target.value })} placeholder="Main hall" /></Field>
              <Field label="From"><input className="input" type="time" value={f.start} onChange={e => setF({ ...f, start: e.target.value })} required /></Field>
              <Field label="To"><input className="input" type="time" value={f.end} onChange={e => setF({ ...f, end: e.target.value })} required /></Field>
              <Field label="Minutes each"><input className="input" type="number" min={5} max={60} value={f.slot_minutes} onChange={e => setF({ ...f, slot_minutes: Number(e.target.value) })} /></Field>
              <Field label="Gap between"><input className="input" type="number" min={0} max={30} value={f.gap_minutes} onChange={e => setF({ ...f, gap_minutes: Number(e.target.value) })} /></Field>
              <div className="sm:col-span-4"><Field label="Classes (their teachers take part and their parents are invited)"><ClassPicker classes={structure?.class_groups ?? []} value={f.class_group_ids} onChange={v => setF({ ...f, class_group_ids: v })} /></Field></div>
              <div className="sm:col-span-4"><button className="btn btn-primary" disabled={busy || !f.class_group_ids.length}>{busy ? "Creating…" : "Create and invite parents"}</button></div>
            </form>
          )}
          {!data.items.length ? <Empty>No evenings yet.</Empty> : <ul className="grid gap-2 sm:grid-cols-2">{data.items.map(c => (
            <li key={c.id} className="card space-y-1 p-3">
              <div className="flex items-center gap-2"><b className="mr-auto">{c.title}</b><Badge tone={c.status === "open" ? "green" : c.status === "cancelled" ? "red" : "slate"}>{c.status}</Badge></div>
              <p className="text-xs text-slate-500">{fmtDate(c.date)} · {c.starts_at.slice(0, 5)}–{c.ends_at.slice(0, 5)} · {c.slot_minutes} min · {c.staff_user_ids.length} teachers · {c.booked} of {c.slots} booked</p>
              <div className="flex gap-3 text-xs"><button className="text-brand-700" onClick={() => setOpen(c.id)}>{data.admin ? "Schedule" : "My schedule"}</button>
                {data.admin && c.status === "open" && <button className="text-slate-600" onClick={() => act({ action: "close", id: c.id }, "Booking closed.")}>Close booking</button>}
                {data.admin && c.status !== "cancelled" && <button className="text-rose-600" onClick={() => { const reason = prompt("Why is it cancelled? (sent to parents who booked)"); if (reason !== null) void act({ action: "cancel", id: c.id, reason }, "Cancelled; parents who booked were told."); }}>Cancel</button>}</div>
            </li>))}</ul>}
        </div>
      )}
      <Modal open={Boolean(open)} onClose={() => setOpen(null)} title="Schedule" wide>{open && <Schedule id={open} />}</Modal>
    </Page>
  );
}

function Schedule({ id }: { id: string }) {
  const { data } = useApi<{ conference: { title: string }; slots: Slot[] }>(`/api/conferences?id=${id}`);
  if (!data) return <Loading />;
  const byTeacher = new Map<string, Slot[]>();
  for (const s of data.slots) byTeacher.set(s.users?.full_name ?? "Teacher", [...(byTeacher.get(s.users?.full_name ?? "Teacher") ?? []), s]);
  return (
    <div className="space-y-4 text-sm">
      <button className="btn btn-ghost text-xs" onClick={() => window.print()}>Print</button>
      {[...byTeacher.entries()].map(([t, slots]) => (
        <section key={t} className="break-inside-avoid"><h3 className="font-semibold">{t} <span className="text-xs font-normal text-slate-500">{slots.filter(s => s.guardian_id).length} booked</span></h3>
          <table className="w-full text-xs"><tbody className="divide-y divide-slate-100">{slots.map(s => (
            <tr key={s.id}><td className="w-20 p-1">{fmtTime(s.starts_at)}</td><td className="p-1">{s.guardian_id ? <>{s.guardians?.full_name} about <b>{s.student}</b> {s.class_name ? `(${s.class_name})` : ""}{s.guardians?.phone ? ` · ${s.guardians.phone}` : ""}{s.note ? ` · “${s.note}”` : ""}</> : <span className="text-slate-400">free</span>}</td></tr>))}</tbody></table>
        </section>))}
    </div>
  );
}
