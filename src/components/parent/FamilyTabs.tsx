"use client";
import { useState } from "react";
import { send, Alert, Badge, Empty, Tabs, Field, fmtDate, fmtTime, money } from "@/components/ui";

export type Extras = {
  currency: string;
  invoices: { id: string; student_id: string; invoice_no: string; title: string; status: string; total: number; amount_paid: number; due_date: string | null; pay_token: string }[];
  events: { id: string; title: string; description: string | null; kind: string; starts_at: string; location: string | null; class_group_ids: string[]; requires_consent: boolean; fee: number; respond_by: string | null;
    responses: { student_id: string; consent: boolean; invoice_id: string | null }[] }[];
  homework: { id: string; class_group_id: string; title: string; due_at: string; subjects: { name: string } | null; submissions: { student_id: string; submitted_at: string; score: number | null; late: boolean }[] }[];
  behaviour: { student_id: string; kind: string; points: number; note: string | null; occurred_at: string; behaviour_categories: { name: string } | null }[];
  attendance: { student_id: string; status: string }[];
  exeats: { id: string; student_id: string; reason: string; leave_at: string; return_by: string; status: string; decision_note: string | null }[];
  bookings: { id: string; starts_at: string; location: string | null; student_id: string; users: { full_name: string } | null }[];
  slots: { id: string; starts_at: string; ends_at: string; location: string | null; staff_user_id: string; users: { full_name: string } | null }[];
  transport: { student_id: string; stop_name: string | null; transport_routes: { name: string; vehicle: string | null; driver_name: string | null; driver_phone: string | null } | null }[];
  hostel: { student_id: string; bed_label: string | null; hostel_rooms: { name: string; hostels: { name: string } | null } | null }[];
};
type Child = { id: string; name: string; class_group_id?: string | null };
type Tab = "fees" | "events" | "meetings" | "learning" | "boarding";

/** Extra parent-portal tabs: fees, events and consent, meetings, learning, boarding. */
export default function FamilyTabs({ extras, kids, token, onChange }: { extras: Extras; kids: Child[]; token?: string; onChange: () => void }) {
  const boarding = extras.hostel.length > 0;
  const tabs: { id: Tab; label: string }[] = [
    { id: "fees", label: `Fees${extras.invoices.some(i => i.status !== "paid") ? " •" : ""}` },
    { id: "events", label: "Events" }, { id: "meetings", label: "Meetings" }, { id: "learning", label: "Learning" },
    ...(boarding ? [{ id: "boarding" as const, label: "Boarding" }] : [])
  ];
  const [tab, setTab] = useState<Tab>("fees");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const name = (sid: string) => kids.find(k => k.id === sid)?.name.split(" ")[0] ?? "";
  const act = async (body: Record<string, unknown>, ok: string) => {
    const r = await send("/api/family", { ...body, token });
    setMsg({ ok: r.ok, text: r.ok ? ok : r.error ?? "failed" });
    if (r.ok) onChange();
    return r;
  };

  return (
    <section id="events" className="card mt-5 p-4">
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
      {msg && <div className="mb-3"><Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert></div>}

      {tab === "fees" && (!extras.invoices.length ? <Empty>No invoices.</Empty> : (
        <ul className="space-y-2">{extras.invoices.map(i => {
          const bal = Number(i.total) - Number(i.amount_paid);
          return (
            <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-3 text-sm">
              <span><b>{name(i.student_id)}</b>: {i.title} <span className="font-mono text-xs text-slate-400">{i.invoice_no}</span><br />
                <span className="text-xs text-slate-500">Total {money(i.total, extras.currency)} · paid {money(i.amount_paid, extras.currency)}{i.due_date ? ` · due ${fmtDate(i.due_date)}` : ""}</span></span>
              {bal > 0 ? <a className="btn btn-primary px-3 py-1 text-xs" href={`/pay/${i.pay_token}`}>Pay {money(bal, extras.currency)}</a> : <a className="text-xs text-brand-700 underline" href={`/pay/${i.pay_token}`}>Receipts</a>}
            </li>
          );
        })}</ul>
      ))}

      {tab === "events" && (!extras.events.length ? <Empty>No upcoming events.</Empty> : (
        <ul className="space-y-3">{extras.events.map(e => {
          const eligible = kids.filter(k => !e.class_group_ids.length || (k.class_group_id && e.class_group_ids.includes(k.class_group_id)));
          if (!eligible.length) return null;
          return (
            <li key={e.id} className="rounded-lg border border-slate-200 p-3 text-sm">
              <p className="font-semibold">{e.title} <Badge tone="violet">{e.kind}</Badge></p>
              <p className="text-xs text-slate-500">{fmtDate(e.starts_at, true)}{e.location ? ` · ${e.location}` : ""}{e.fee > 0 ? ` · ${money(e.fee, extras.currency)}` : ""}{e.respond_by ? ` · reply by ${fmtDate(e.respond_by)}` : ""}</p>
              {e.description && <p className="mt-1 whitespace-pre-wrap">{e.description}</p>}
              {e.requires_consent && eligible.map(k => {
                const r = e.responses.find(x => x.student_id === k.id);
                return (
                  <div key={k.id} className="mt-2 flex flex-wrap items-center gap-2">
                    <span>{k.name.split(" ")[0]}:</span>
                    {r ? <Badge tone={r.consent ? "green" : "red"}>{r.consent ? "going" : "not going"}</Badge> : <Badge tone="amber">awaiting your answer</Badge>}
                    <button className="btn btn-primary px-2 py-1 text-xs" onClick={async () => { const x = await act({ action: "event", student_id: k.id, event_id: e.id, consent: true }, "Consent given."); if (x.ok && x.data.pay_token) window.location.href = `/pay/${x.data.pay_token}`; }}>{e.fee > 0 ? "Consent and pay" : "I consent"}</button>
                    <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => act({ action: "event", student_id: k.id, event_id: e.id, consent: false }, "Recorded.")}>Decline</button>
                  </div>
                );
              })}
            </li>
          );
        })}</ul>
      ))}

      {tab === "meetings" && (
        <div className="space-y-4 text-sm">
          {extras.bookings.length > 0 && (
            <div><h3 className="mb-1 font-semibold">Your bookings</h3>
              <ul className="space-y-1">{extras.bookings.map(b => <li key={b.id} className="flex items-center justify-between rounded bg-emerald-50 px-3 py-2">
                <span>{fmtDate(b.starts_at)} {fmtTime(b.starts_at)} with {b.users?.full_name} about {name(b.student_id)}{b.location ? ` · ${b.location}` : ""}</span>
                <button className="text-xs text-rose-600" onClick={() => act({ action: "cancel_booking", slot_id: b.id }, "Booking cancelled.")}>Cancel</button></li>)}</ul></div>
          )}
          <MeetingPicker extras={extras} kids={kids} onBook={(slot, sid) => act({ action: "book", slot_id: slot, student_id: sid }, "Booked. A confirmation is on its way.")} />
        </div>
      )}

      {tab === "learning" && (
        <div className="space-y-5 text-sm">
          {kids.map(k => {
            const att = extras.attendance.filter(a => a.student_id === k.id);
            const present = att.filter(a => a.status === "present" || a.status === "late").length;
            const hw = extras.homework.filter(h => h.class_group_id === k.class_group_id);
            const beh = extras.behaviour.filter(b => b.student_id === k.id);
            return (
              <div key={k.id}>
                <h3 className="mb-1 font-semibold">{k.name}</h3>
                <p className="text-xs text-slate-600">Attendance (30 days): <b>{att.length ? `${Math.round((present / att.length) * 100)}%` : "—"}</b> · behaviour points: <b>{beh.reduce((a, b) => a + b.points, 0)}</b></p>
                {hw.length > 0 && <ul className="mt-1 space-y-0.5">{hw.map(h => { const s = h.submissions.find(x => x.student_id === k.id); return (
                  <li key={h.id} className="flex justify-between"><span>{h.subjects?.name}: {h.title} <span className="text-xs text-slate-400">due {fmtDate(h.due_at)}</span></span>
                    {s ? <Badge tone="green">{s.score !== null ? `marked ${s.score}` : "handed in"}</Badge> : new Date(h.due_at) < new Date() ? <Badge tone="red">missing</Badge> : <Badge tone="amber">to do</Badge>}</li>); })}</ul>}
                {beh.length > 0 && <ul className="mt-1 space-y-0.5 text-xs">{beh.slice(0, 6).map((b, i) => <li key={i}><Badge tone={b.kind === "positive" ? "green" : "red"}>{b.points > 0 ? `+${b.points}` : b.points}</Badge> {b.behaviour_categories?.name}{b.note ? `: ${b.note}` : ""} · {fmtDate(b.occurred_at)}</li>)}</ul>}
                {extras.transport.filter(t => t.student_id === k.id).map((t, i) => <p key={i} className="mt-1 text-xs">Bus: {t.transport_routes?.name} ({t.stop_name ?? "—"}) · driver {t.transport_routes?.driver_name} {t.transport_routes?.driver_phone}</p>)}
              </div>
            );
          })}
        </div>
      )}

      {tab === "boarding" && <Boarding extras={extras} kids={kids} name={name} onRequest={b => act({ action: "exeat", ...b }, "Exeat requested. The house staff will reply shortly.")} />}
    </section>
  );
}

function MeetingPicker({ extras, kids, onBook }: { extras: Extras; kids: Child[]; onBook: (slotId: string, studentId: string) => void }) {
  const [sid, setSid] = useState(kids[0]?.id ?? "");
  const byTeacher = new Map<string, Extras["slots"]>();
  for (const s of extras.slots) byTeacher.set(s.users?.full_name ?? "Teacher", [...(byTeacher.get(s.users?.full_name ?? "Teacher") ?? []), s]);
  if (!extras.slots.length) return <Empty>No meeting times are open right now. Teachers publish them before consultation days.</Empty>;
  return (
    <div>
      {kids.length > 1 && <Field label="About"><select className="input mb-2 w-auto" value={sid} onChange={e => setSid(e.target.value)}>{kids.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}</select></Field>}
      {[...byTeacher.entries()].map(([t, slots]) => (
        <div key={t} className="mb-3"><p className="font-medium">{t}</p>
          <div className="mt-1 flex flex-wrap gap-1.5">{slots.map(s => <button key={s.id} className="rounded border border-slate-200 px-2 py-1 text-xs hover:border-brand-400" onClick={() => onBook(s.id, sid)}>{fmtDate(s.starts_at)} {fmtTime(s.starts_at)}</button>)}</div>
        </div>
      ))}
    </div>
  );
}

function Boarding({ extras, kids, name, onRequest }: { extras: Extras; kids: Child[]; name: (id: string) => string; onRequest: (b: Record<string, unknown>) => void }) {
  const boarders = kids.filter(k => extras.hostel.some(h => h.student_id === k.id));
  const [f, setF] = useState({ student_id: boarders[0]?.id ?? "", reason: "", leave: "", ret: "", collector: "" });
  return (
    <div className="space-y-4 text-sm">
      {extras.hostel.map(h => <p key={h.student_id}>{name(h.student_id)}: {h.hostel_rooms?.hostels?.name}, room {h.hostel_rooms?.name}{h.bed_label ? `, bed ${h.bed_label}` : ""}</p>)}
      {extras.exeats.length > 0 && <ul className="space-y-1">{extras.exeats.map(e => <li key={e.id} className="rounded bg-slate-50 px-3 py-2">{name(e.student_id)}: {e.reason} ({fmtDate(e.leave_at)} → {fmtDate(e.return_by)}) <Badge tone={e.status === "approved" || e.status === "returned" ? "green" : e.status === "rejected" ? "red" : "amber"}>{e.status}</Badge>{e.decision_note ? ` ${e.decision_note}` : ""}</li>)}</ul>}
      <form className="grid gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-2" onSubmit={e => { e.preventDefault(); onRequest({ student_id: f.student_id, reason: f.reason, leave_at: new Date(f.leave).toISOString(), return_by: new Date(f.ret).toISOString(), collector: f.collector || null }); }}>
        <p className="font-semibold sm:col-span-2">Request an exeat</p>
        {boarders.length > 1 && <select className="input sm:col-span-2" value={f.student_id} onChange={e => setF({ ...f, student_id: e.target.value })} aria-label="Child">{boarders.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}</select>}
        <input className="input sm:col-span-2" placeholder="Reason" required value={f.reason} onChange={e => setF({ ...f, reason: e.target.value })} aria-label="Reason" />
        <label className="block"><span className="label">Leaving</span><input className="input" type="datetime-local" required value={f.leave} onChange={e => setF({ ...f, leave: e.target.value })} /></label>
        <label className="block"><span className="label">Back by</span><input className="input" type="datetime-local" required value={f.ret} onChange={e => setF({ ...f, ret: e.target.value })} /></label>
        <input className="input sm:col-span-2" placeholder="Who will collect (if not you)" value={f.collector} onChange={e => setF({ ...f, collector: e.target.value })} aria-label="Collector" />
        <button className="btn btn-primary sm:col-span-2">Send request</button>
      </form>
    </div>
  );
}
