"use client";
import { useEffect, useState } from "react";
import { send, Alert, Badge, Empty, Tabs, Field, fmtDate, fmtTime, money } from "@/components/ui";
import { ParentMessages, ParentWallet, ParentBus } from "./FamilyConnect";
import { ReenrolCard, SurveyPrompt, SupportTab, ConsentCard, type SupportData } from "./Support";
import Records, { type RecordsData } from "./Records";

export type Extras = {
  currency: string;
  invoices: { id: string; student_id: string; invoice_no: string; title: string; status: string; total: number; amount_paid: number; due_date: string | null; pay_token: string }[];
  events: { id: string; title: string; description: string | null; kind: string; starts_at: string; location: string | null; class_group_ids: string[]; requires_consent: boolean; fee: number; respond_by: string | null;
    departs_at?: string | null; returns_at?: string | null; meeting_point?: string | null;
    responses: { student_id: string; consent: boolean; invoice_id: string | null }[]; roster?: { student_id: string; status: string; departed_at: string | null; returned_at: string | null }[] }[];
  clubs?: { student_id: string; status: string; role: string; cc_groups: { name: string; meets: string | null; location: string | null } | null }[];
  competition_results?: { id: string; student_id: string; event: string | null; position: number | null; award: string | null; score: string | null; competitions: { title: string; held_on: string; level: string } }[];
  homework: { id: string; class_group_id: string; title: string; due_at: string; subjects: { name: string } | null; submissions: { student_id: string; submitted_at: string; score: number | null; late: boolean }[] }[];
  behaviour: { student_id: string; kind: string; points: number; note: string | null; occurred_at: string; behaviour_categories: { name: string } | null }[];
  attendance: { student_id: string; status: string }[];
  exeats: { id: string; student_id: string; kind?: string; reason: string; leave_at: string; return_by: string; status: string; decision_note: string | null; requested_by?: string; collector_name?: string | null }[];
  boarding_notes?: { id: string; student_id: string; kind: string; note: string; created_at: string }[];
  menus?: { on_date: string; meal: string; items: string; alternatives: string | null }[];
  absences?: { id: string; student_id: string; kind: string; starts_on: string; ends_on: string; reason: string; status: string; decision_note: string | null }[];
  notices?: { receipt_id: string; id: string; kind: string; title: string; body: string; requires_ack: boolean; sent_at: string; read_at: string | null; acknowledged_at: string | null }[];
  bookings: { id: string; starts_at: string; ends_at?: string; location: string | null; student_id: string; users: { full_name: string } | null }[];
  slots: { id: string; starts_at: string; ends_at: string; location: string | null; staff_user_id: string; conference_id?: string | null; users: { full_name: string } | null; pt_conferences?: { title: string } | null }[];
  transport: { student_id: string; stop_name: string | null; transport_routes: { name: string; vehicle: string | null; driver_name: string | null; driver_phone: string | null } | null }[];
  hostel: { student_id: string; bed_label: string | null; hostel_rooms: { name: string; hostels: { name: string } | null } | null }[];
  support?: SupportData;
  records?: RecordsData | null;
};
type Child = { id: string; name: string; class_group_id?: string | null };
type Tab = "notices" | "messages" | "fees" | "wallet" | "bus" | "events" | "meetings" | "learning" | "boarding" | "support" | "records";

/** Extra parent-portal tabs: fees, events and consent, meetings, learning, boarding. */
export default function FamilyTabs({ extras, kids, token, onChange }: { extras: Extras; kids: Child[]; token?: string; onChange: () => void }) {
  const boarding = extras.hostel.length > 0;
  const unreadNotices = (extras.notices ?? []).filter(n => !n.read_at).length;
  const tabs: { id: Tab; label: string }[] = [
    ...((extras.notices ?? []).length ? [{ id: "notices" as const, label: `Notices${unreadNotices ? ` (${unreadNotices})` : ""}` }] : []),
    { id: "messages", label: "Messages" },
    { id: "fees", label: `Fees${extras.invoices.some(i => i.status !== "paid") ? " •" : ""}` },
    { id: "wallet", label: "Wallet" },
    ...(extras.transport.length ? [{ id: "bus" as const, label: "Bus" }] : []),
    { id: "events", label: "Events" }, { id: "meetings", label: "Meetings" }, { id: "learning", label: "Learning" },
    ...(boarding ? [{ id: "boarding" as const, label: "Boarding" }] : []),
    ...(extras.records ? [{ id: "records" as const, label: `Records${extras.records.plans.some(p => !p.parent_agreed_at) ? " •" : ""}` }] : []),
    ...(extras.support ? [{ id: "support" as const, label: `Help & feedback${extras.support.tickets.some(t => t.status === "waiting") ? " •" : ""}` }] : [])
  ];
  const [tab, setTab] = useState<Tab>("fees");
  // Links in notifications open the right tab (#messages, #wallet, #bus).
  useEffect(() => {
    const h = window.location.hash.slice(1) as Tab;
    if (["notices", "messages", "wallet", "bus", "events", "support", "records", "meetings"].includes(h)) { setTab(h); setTimeout(() => document.getElementById("events")?.scrollIntoView({ behavior: "smooth" }), 300); }
  }, []);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const name = (sid: string) => kids.find(k => k.id === sid)?.name.split(" ")[0] ?? "";
  const act = async (body: Record<string, unknown>, ok: string) => {
    const r = await send("/api/family", { ...body, token });
    setMsg({ ok: r.ok, text: r.ok ? ok : r.error ?? "failed" });
    if (r.ok) onChange();
    return r;
  };

  return (
    <>
    {extras.support?.reenrolment && <div className="mt-5"><ReenrolCard data={extras.support.reenrolment} token={token} onChange={onChange} /></div>}
    {extras.support && <SurveyPrompt surveys={extras.support.surveys} />}
    {extras.support?.consent && <ConsentCard data={extras.support.consent} token={token} onChange={onChange} />}
    <section id="events" className="card mt-5 p-4">
      <Tabs value={tab} onChange={setTab} tabs={tabs} />
      {msg?.text && <div className="mb-3"><Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert></div>}

      {tab === "fees" && extras.invoices.length > 0 && <FamilyStatement token={token} currency={extras.currency} />}
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

      {tab === "events" && <ChildActivities extras={extras} kids={kids} />}
      {tab === "events" && (!extras.events.length ? <Empty>No upcoming events.</Empty> : (
        <ul className="space-y-3">{extras.events.map(e => {
          const eligible = kids.filter(k => !e.class_group_ids.length || (k.class_group_id && e.class_group_ids.includes(k.class_group_id)));
          if (!eligible.length) return null;
          return (
            <li key={e.id} className="rounded-lg border border-slate-200 p-3 text-sm">
              <p className="font-semibold">{e.title} <Badge tone="violet">{e.kind}</Badge></p>
              <p className="text-xs text-slate-500">{fmtDate(e.starts_at, true)}{e.location ? ` · ${e.location}` : ""}{e.fee > 0 ? ` · ${money(e.fee, extras.currency)}` : ""}{e.respond_by ? ` · reply by ${fmtDate(e.respond_by)}` : ""}</p>
              {e.description && <p className="mt-1 whitespace-pre-wrap">{e.description}</p>}
              {(e.departs_at || e.returns_at) && <p className="mt-1 text-xs">{e.departs_at ? `Leaves ${fmtDate(e.departs_at, true)}${e.meeting_point ? ` from ${e.meeting_point}` : ""}` : ""}{e.returns_at ? ` · back about ${fmtDate(e.returns_at, true)}` : ""}</p>}
              {(e.roster ?? []).map(r => {
                const k = kids.find(x => x.id === r.student_id);
                if (!k || !["departed", "returned"].includes(r.status)) return null;
                return <p key={r.student_id} className="mt-1"><Badge tone={r.status === "returned" ? "green" : "blue"}>{k.name.split(" ")[0]} {r.status === "returned" ? `back at school ${fmtTime(r.returned_at)}` : `left with the group ${fmtTime(r.departed_at)}`}</Badge></p>;
              })}
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
          <AbsenceRequests extras={extras} kids={kids} name={name} act={act} />
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

      {tab === "notices" && <FamilyNotices extras={extras} act={act} />}
      {tab === "messages" && <ParentMessages token={token} />}
      {tab === "wallet" && <ParentWallet token={token} kids={kids} />}
      {tab === "bus" && <ParentBus token={token} kids={kids} />}
      {tab === "boarding" && <Boarding extras={extras} kids={kids} name={name} onRequest={b => act({ action: "exeat", ...b }, "Exeat requested. The house staff will reply shortly.")}
        onConsent={(id, approve) => act({ action: "exeat_consent", id, approve }, approve ? "Thank you. The boarding house has your agreement." : "Declined. The boarding house has been told.")} />}
      {tab === "support" && extras.support && <SupportTab data={extras.support} kids={kids} token={token} onChange={onChange} />}
      {tab === "records" && extras.records && <Records data={extras.records} kids={kids} token={token} onChange={onChange} />}
    </section>
    </>
  );
}

const ABSENCE_KIND: Record<string, string> = { sick: "Illness", medical: "Medical or dental appointment", family: "Family matter", religious: "Religious observance", bereavement: "Bereavement", travel: "Travel", other: "Other" };

/** Tell the school a child will be (or was) away, and see whether it was agreed. */
function AbsenceRequests({ extras, kids, name, act }: { extras: Extras; kids: Child[]; name: (id: string) => string; act: (b: Record<string, unknown>, ok: string) => Promise<{ ok: boolean }> }) {
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ student_id: kids[0]?.id ?? "", kind: "sick", starts_on: today, ends_on: today, reason: "" });
  const [open, setOpen] = useState(false);
  const list = extras.absences ?? [];
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="flex items-center gap-2"><h3 className="mr-auto font-semibold">Absences</h3>
        <button className="btn btn-outline px-2 py-1 text-xs" onClick={() => setOpen(!open)}>{open ? "Close" : "Tell the school about an absence"}</button></div>
      {open && (
        <form className="mt-2 grid gap-2 sm:grid-cols-4" onSubmit={async e => { e.preventDefault(); const r = await act({ action: "absence", ...f }, "Sent. The class teacher will reply here."); if (r.ok) { setOpen(false); setF({ ...f, reason: "" }); } }}>
          {kids.length > 1 && <Field label="Child"><select className="input" value={f.student_id} onChange={e => setF({ ...f, student_id: e.target.value })}>{kids.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}</select></Field>}
          <Field label="Reason"><select className="input" value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })}>{Object.entries(ABSENCE_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="From"><input className="input" type="date" value={f.starts_on} onChange={e => setF({ ...f, starts_on: e.target.value, ends_on: e.target.value > f.ends_on ? e.target.value : f.ends_on })} required /></Field>
          <Field label="To"><input className="input" type="date" value={f.ends_on} min={f.starts_on} onChange={e => setF({ ...f, ends_on: e.target.value })} required /></Field>
          <div className="sm:col-span-4"><Field label="Details for the school"><textarea className="input min-h-16" value={f.reason} onChange={e => setF({ ...f, reason: e.target.value })} required minLength={3} maxLength={1000} /></Field></div>
          <div className="sm:col-span-4"><button className="btn btn-primary">Send</button></div>
        </form>
      )}
      {list.length > 0 && <ul className="mt-2 space-y-1">{list.map(a => (
        <li key={a.id} className="flex flex-wrap items-center gap-2">
          <span>{name(a.student_id)}: {ABSENCE_KIND[a.kind]}, {fmtDate(a.starts_on)}{a.ends_on !== a.starts_on ? ` to ${fmtDate(a.ends_on)}` : ""}</span>
          <Badge tone={a.status === "approved" ? "green" : a.status === "declined" ? "red" : a.status === "pending" ? "amber" : "slate"}>{a.status === "pending" ? "waiting" : a.status === "approved" ? "agreed" : a.status === "declined" ? "not agreed" : "cancelled"}</Badge>
          {a.decision_note && <span className="text-xs text-slate-600">{a.decision_note}</span>}
          {a.status === "pending" && <button className="text-xs text-rose-600" onClick={() => act({ action: "cancel_absence", id: a.id }, "Cancelled.")}>Cancel</button>}
        </li>))}</ul>}
    </div>
  );
}

function MeetingPicker({ extras, kids, onBook }: { extras: Extras; kids: Child[]; onBook: (slotId: string, studentId: string) => void }) {
  const [sid, setSid] = useState(kids[0]?.id ?? "");
  if (!extras.slots.length) return <Empty>No meeting times are open right now. Teachers publish them before consultation days.</Empty>;
  // Parent-teacher evenings first, then other open times; within each, by teacher.
  const groups = new Map<string, Map<string, Extras["slots"]>>();
  for (const s of extras.slots) {
    const g = s.pt_conferences?.title ?? "Other times";
    const byTeacher = groups.get(g) ?? new Map();
    const t = s.users?.full_name ?? "Teacher";
    byTeacher.set(t, [...(byTeacher.get(t) ?? []), s]);
    groups.set(g, byTeacher);
  }
  // Times that clash with an appointment already booked are greyed out.
  const clash = (s: Extras["slots"][number]) => extras.bookings.some(b => { const bs = Date.parse(b.starts_at); return bs < Date.parse(s.ends_at) && Date.parse(s.starts_at) < bs + (Date.parse(s.ends_at) - Date.parse(s.starts_at)); });
  return (
    <div>
      {kids.length > 1 && <Field label="About"><select className="input mb-2 w-auto" value={sid} onChange={e => setSid(e.target.value)}>{kids.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}</select></Field>}
      {[...groups.entries()].map(([g, byTeacher]) => (
        <div key={g} className="mb-4"><h3 className="mb-1 font-semibold">{g}</h3>
          {[...byTeacher.entries()].map(([t, slots]) => (
            <div key={t} className="mb-3"><p className="font-medium">{t}</p>
              <div className="mt-1 flex flex-wrap gap-1.5">{slots.map(s => (
                <button key={s.id} disabled={clash(s)} title={clash(s) ? "You have another appointment then" : undefined} className="rounded border border-slate-200 px-2 py-1 text-xs hover:border-brand-400 disabled:opacity-40" onClick={() => onBook(s.id, sid)}>{fmtDate(s.starts_at)} {fmtTime(s.starts_at)}</button>))}</div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Each child's statement of account for the last year (invoices, payments, running balance). */
function FamilyStatement({ token, currency }: { token?: string; currency: string }) {
  const [data, setData] = useState<{ statements: { student: { name: string }; opening: number; closing: number; lines: { date: string; ref: string; description: string; debit: number; credit: number; balance: number }[] }[] } | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-3">
      <button className="text-xs text-brand-700 underline" onClick={async () => { setOpen(!open); if (!data) { const r = await send<any>("/api/family", { action: "statement", token }); if (r.ok) setData(r.data); } }}>{open ? "Hide statement of account" : "Statement of account (last 12 months)"}</button>
      {open && data && data.statements.map((s, i) => (
        <div key={i} className="mt-2 overflow-x-auto rounded border border-slate-200 p-2 text-xs">
          <p className="font-semibold">{s.student.name}</p>
          <table className="w-full"><tbody>
            <tr><td colSpan={4} className="py-0.5">Brought forward</td><td className="text-right tabular-nums">{money(s.opening, currency)}</td></tr>
            {s.lines.map((l, j) => <tr key={j} className="border-t border-slate-100"><td className="py-0.5">{fmtDate(l.date)}</td><td className="font-mono">{l.ref}</td><td>{l.description}</td>
              <td className="text-right tabular-nums">{l.debit ? money(l.debit, currency) : `−${money(l.credit, currency)}`}</td><td className="text-right tabular-nums">{money(l.balance, currency)}</td></tr>)}
            <tr className="border-t-2 border-slate-300 font-semibold"><td colSpan={4} className="py-0.5">Balance now</td><td className="text-right tabular-nums">{money(s.closing, currency)}</td></tr>
          </tbody></table>
        </div>))}
    </div>
  );
}

function FamilyNotices({ extras, act }: { extras: Extras; act: (b: Record<string, unknown>, ok: string) => Promise<{ ok: boolean }> }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <ul className="divide-y divide-slate-100 text-sm">{(extras.notices ?? []).map(n => (
      <li key={n.receipt_id} className="py-2">
        <button className="flex w-full items-center gap-2 text-left" onClick={() => { setOpen(open === n.receipt_id ? null : n.receipt_id); if (!n.read_at) void act({ action: "notice_read", receipt_id: n.receipt_id }, ""); }}>
          {!n.read_at && <span className="h-2 w-2 shrink-0 rounded-full bg-brand-600" aria-label="unread" />}
          <span className={"mr-auto " + (n.read_at ? "" : "font-semibold")}>{n.title}</span>
          {n.kind !== "announcement" && <Badge tone={n.kind === "emergency" ? "red" : "violet"}>{n.kind}</Badge>}<span className="text-xs text-slate-500">{fmtDate(n.sent_at)}</span>
        </button>
        {open === n.receipt_id && <div className="mt-2 space-y-2"><p className="whitespace-pre-wrap">{n.body}</p>
          {(n.requires_ack || n.kind === "emergency") && (n.acknowledged_at ? <p className="text-xs text-emerald-700">You confirmed this on {fmtDate(n.acknowledged_at, true)}.</p>
            : <button className="btn btn-primary px-2 py-1 text-xs" onClick={() => act({ action: "notice_read", receipt_id: n.receipt_id, ack: true }, "Thank you. The school knows you have read this.")}>{n.kind === "emergency" ? "I received this" : "I have read this"}</button>)}</div>}
      </li>))}</ul>
  );
}

function Boarding({ extras, kids, name, onRequest, onConsent }: { extras: Extras; kids: Child[]; name: (id: string) => string; onRequest: (b: Record<string, unknown>) => void; onConsent: (id: string, approve: boolean) => void }) {
  const boarders = kids.filter(k => extras.hostel.some(h => h.student_id === k.id));
  const [f, setF] = useState({ student_id: boarders[0]?.id ?? "", reason: "", leave: "", ret: "", collector: "" });
  return (
    <div className="space-y-4 text-sm">
      {extras.hostel.map(h => <p key={h.student_id}>{name(h.student_id)}: {h.hostel_rooms?.hostels?.name}, room {h.hostel_rooms?.name}{h.bed_label ? `, bed ${h.bed_label}` : ""}</p>)}
      {extras.exeats.filter(e => e.status === "awaiting_parent").map(e => (
        <div key={e.id} className="rounded-lg border border-amber-300 bg-amber-50 p-3">
          <p className="font-semibold">Please agree: {name(e.student_id)}{e.requested_by === "student" ? " has asked to leave" : " is due to leave"}</p>
          <p>{e.reason} · {fmtDate(e.leave_at, true)} → {fmtDate(e.return_by, true)}{e.collector_name ? ` · collected by ${e.collector_name}` : ""}</p>
          <div className="mt-2 flex gap-2"><button className="btn btn-primary" onClick={() => onConsent(e.id, true)}>I agree</button><button className="btn btn-ghost text-rose-700" onClick={() => onConsent(e.id, false)}>Decline</button></div>
        </div>))}
      {(extras.boarding_notes ?? []).length > 0 && <div><p className="font-semibold">From the boarding house</p><ul className="space-y-1">{extras.boarding_notes!.map(n => <li key={n.id} className="rounded bg-slate-50 px-3 py-2">{fmtDate(n.created_at)} · {name(n.student_id)}: {n.note}</li>)}</ul></div>}
      {(extras.menus ?? []).length > 0 && <details><summary className="cursor-pointer font-semibold">This week’s menu</summary><ul className="mt-1 space-y-0.5">{extras.menus!.map((m, i) => <li key={i}>{fmtDate(m.on_date)} · <span className="capitalize">{m.meal}</span>: {m.items}{m.alternatives ? ` (or ${m.alternatives})` : ""}</li>)}</ul></details>}
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

/** Each child's clubs and teams, and competition results this past year. */
function ChildActivities({ extras, kids }: { extras: Extras; kids: Child[] }) {
  const clubs = extras.clubs ?? [], results = extras.competition_results ?? [];
  if (!clubs.length && !results.length) return null;
  return (
    <div className="mb-4 grid gap-3 sm:grid-cols-2">{kids.map(k => {
      const c = clubs.filter(x => x.student_id === k.id), r = results.filter(x => x.student_id === k.id);
      if (!c.length && !r.length) return null;
      return (
        <div key={k.id} className="rounded-lg border border-slate-200 p-3 text-sm">
          <p className="font-semibold">{k.name.split(" ")[0]}&apos;s clubs &amp; teams</p>
          {!c.length ? <p className="text-slate-500">None yet.</p> : <ul className="mt-1 space-y-0.5">{c.map((x, i) => (
            <li key={i}>{x.cc_groups?.name}{x.cc_groups?.meets ? <span className="text-slate-500"> · {x.cc_groups.meets}</span> : null} {x.status === "requested" ? <Badge tone="amber">asked to join</Badge> : x.role !== "member" ? <Badge tone="violet">{x.role.replace("_", "-")}</Badge> : null}</li>))}</ul>}
          {r.length > 0 && <><p className="mt-2 font-medium">Competitions</p><ul className="space-y-0.5">{r.map(x => (
            <li key={x.id}>{x.competitions.title}{x.event ? `: ${x.event}` : ""} <span className="text-slate-500">({fmtDate(x.competitions.held_on)})</span> {x.award ? <Badge tone="green">{x.award}</Badge> : x.position ? <Badge tone={x.position <= 3 ? "green" : "slate"}>position {x.position}</Badge> : null}</li>))}</ul></>}
        </div>
      );
    })}</div>
  );
}
