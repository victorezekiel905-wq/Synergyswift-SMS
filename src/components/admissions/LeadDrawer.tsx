"use client";
import { useEffect, useState } from "react";
import { useApi, send, Alert, Badge, Field, Modal, Loading, fmtDate, Icon } from "@/components/ui";
import { STAGE_LABEL, SOURCE_LABEL, SOURCES, type Stage } from "@/lib/crm";
import { LostForm, scoreTone } from "./Pipeline";

type Activity = { id: string; kind: string; body: string | null; due_at: string | null; done_at: string | null; created_at: string; meta: Record<string, any>; actor: { full_name: string } | null };
type Detail = {
  lead: { id: string; stage: Stage; parent_name: string; email: string | null; phone: string | null; child_name: string | null; child_dob: string | null; applying_for: string | null; intake: string | null;
    source: string; utm: Record<string, string>; referral_code: string | null; referred_by_name: string | null; owner_id: string | null; owner_name: string | null; score: number; notes: string | null;
    lost_reason: string | null; application_id: string | null; next_follow_up_at: string | null; created_at: string };
  activities: Activity[];
  bookings: { id: string; status: string; party_size: number; admission_events: { title: string; kind: string; starts_at: string } | null }[];
  application: { id: string; application_no: string; status: string; tracking_token: string; fee_paid: boolean; assessment_score: number | null;
    application_documents: { id: string }[]; entrance_attempts: { status: string; total_score: number | null; max_score: number | null; exams: { title: string } | null }[] } | null;
};

const KIND_ICON: Record<string, "note" | "phone" | "mail" | "chat" | "people" | "repeat" | "check"> = { note: "note", call: "phone", email: "mail", sms: "chat", whatsapp: "chat", meeting: "people", stage: "repeat", task: "check" };

/** Everything about one family: details, score, timeline, tasks, messages, visits and application. */
export default function LeadDrawer({ id, onClose, onChanged, staff, openApplication }: {
  id: string; onClose: () => void; onChanged: () => void; staff: { id: string; full_name: string }[]; openApplication: (applicationId: string) => void;
}) {
  const { data, error, reload } = useApi<Detail>(`/api/crm/leads?id=${id}`, [id]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [tab, setTab] = useState<"log" | "message" | "task">("log");
  const [log, setLog] = useState({ kind: "call", body: "" });
  const [m, setM] = useState({ channel: "whatsapp", subject: "", body: "" });
  const [task, setTask] = useState({ body: "", due: "", assigned_to: "" });
  const [edit, setEdit] = useState<Record<string, string> | null>(null);
  const [lost, setLost] = useState(false);
  const [startApp, setStartApp] = useState(false);
  useEffect(() => { setMsg(null); setEdit(null); }, [id]);

  async function act(body: Record<string, unknown>, ok: string) {
    const r = await send("/api/crm/leads", { id, ...body });
    setMsg({ ok: r.ok, text: r.ok ? ok : r.error ?? "failed" });
    if (r.ok) { reload(); onChanged(); }
    return r;
  }
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  const l = data.lead;
  const tasks = data.activities.filter(a => a.kind === "task");
  const timeline = data.activities.filter(a => a.kind !== "task");
  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="blue">{STAGE_LABEL[l.stage]}</Badge>
        <Badge tone={scoreTone(l.score)}>score {l.score}</Badge>
        <span className="text-xs text-slate-500">{SOURCE_LABEL[l.source as keyof typeof SOURCE_LABEL] ?? l.source}{l.utm?.utm_campaign ? ` · campaign ${l.utm.utm_campaign}` : ""}{l.referred_by_name ? ` · referred by ${l.referred_by_name}` : ""} · since {fmtDate(l.created_at)}</span>
        <span className="ml-auto flex gap-1">
          {!l.application_id && !["enrolled", "lost"].includes(l.stage) && <button className="btn btn-primary px-3 py-1 text-xs" onClick={() => setStartApp(true)}>Start application</button>}
          {l.application_id && <button className="btn btn-outline px-3 py-1 text-xs" onClick={() => openApplication(l.application_id!)}>Open application</button>}
          {l.stage !== "lost" && l.stage !== "enrolled" && <button className="btn btn-ghost px-3 py-1 text-xs text-rose-600" onClick={() => setLost(true)}>Lost</button>}
          {l.stage === "lost" && <button className="btn btn-ghost px-3 py-1 text-xs" onClick={() => act({ action: "stage", stage: l.application_id ? "applied" : "enquiry" }, "Reopened.")}>Reopen</button>}
        </span>
      </div>
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}

      {edit ? (
        <form className="grid gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-3" onSubmit={async e => { e.preventDefault(); const r = await act({ action: "update", ...edit }, "Saved."); if (r.ok) setEdit(null); }}>
          {(["parent_name", "phone", "email", "child_name", "child_dob", "applying_for", "intake"] as const).map(k => (
            <Field key={k} label={k.replace("_", " ").replace("dob", "date of birth")}><input className="input" type={k === "child_dob" ? "date" : k === "email" ? "email" : "text"} value={edit[k] ?? ""} onChange={e => setEdit({ ...edit, [k]: e.target.value })} /></Field>
          ))}
          <Field label="Source"><select className="input" value={edit.source} onChange={e => setEdit({ ...edit, source: e.target.value })}>{SOURCES.map(s => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}</select></Field>
          <Field label="Owner"><select className="input" value={edit.owner_id ?? ""} onChange={e => setEdit({ ...edit, owner_id: e.target.value })}><option value="">—</option>{staff.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select></Field>
          <div className="sm:col-span-3"><Field label="Notes"><textarea className="input h-20" value={edit.notes ?? ""} onChange={e => setEdit({ ...edit, notes: e.target.value })} /></Field></div>
          <div className="flex justify-end gap-2 sm:col-span-3"><button type="button" className="btn btn-ghost" onClick={() => setEdit(null)}>Cancel</button><button className="btn btn-primary">Save</button></div>
        </form>
      ) : (
        <div className="grid gap-1 rounded-lg bg-slate-50 p-3 sm:grid-cols-2">
          <p><b>Parent:</b> {l.parent_name}</p>
          <p><b>Contact:</b> {l.phone ? <a className="text-brand-700 hover:underline" href={`tel:${l.phone}`}>{l.phone}</a> : "—"}{l.phone && <> · <a className="text-brand-700 hover:underline" href={`https://wa.me/${l.phone.replace(/[^\d]/g, "")}`} target="_blank" rel="noreferrer">WhatsApp</a></>}{l.email ? ` · ${l.email}` : ""}</p>
          <p><b>Child:</b> {l.child_name ?? "—"}{l.child_dob ? ` (born ${fmtDate(l.child_dob)})` : ""}</p>
          <p><b>Class wanted:</b> {l.applying_for ?? "—"}{l.intake ? ` · ${l.intake}` : ""}</p>
          <p><b>Owner:</b> {l.owner_name ?? "unassigned"}</p>
          <p><b>Next follow-up:</b> {l.next_follow_up_at ? fmtDate(l.next_follow_up_at, true) : "—"}</p>
          {l.notes && <p className="whitespace-pre-wrap sm:col-span-2"><b>Notes:</b> {l.notes}</p>}
          {l.lost_reason && <p className="text-rose-700 sm:col-span-2"><b>Lost:</b> {l.lost_reason}</p>}
          <button className="justify-self-start text-xs text-brand-700 hover:underline" onClick={() => setEdit({ parent_name: l.parent_name, phone: l.phone ?? "", email: l.email ?? "", child_name: l.child_name ?? "", child_dob: l.child_dob ?? "",
            applying_for: l.applying_for ?? "", intake: l.intake ?? "", source: l.source, owner_id: l.owner_id ?? "", notes: l.notes ?? "" })}>Edit details</button>
        </div>
      )}

      {data.application && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p><b>Application {data.application.application_no}</b> · {data.application.status} · fee {data.application.fee_paid ? "paid" : "unpaid"} · {data.application.application_documents.length} documents
            {data.application.entrance_attempts.map((e, i) => <span key={i}> · {e.exams?.title}: {e.status === "assigned" ? "not started" : e.total_score !== null ? `${e.total_score}/${e.max_score}` : e.status}</span>)}</p>
        </div>
      )}

      <section className="rounded-lg border border-slate-200 p-3">
        <div className="mb-2 flex gap-1 text-xs">
          {(["log", "message", "task"] as const).map(t => <button key={t} className={"rounded px-2 py-1 " + (tab === t ? "bg-brand-600 text-white" : "bg-slate-100")} onClick={() => setTab(t)}>{t === "log" ? "Log a call or note" : t === "message" ? "Send a message" : "Add a task"}</button>)}
        </div>
        {tab === "log" && (
          <form className="flex flex-wrap gap-2" onSubmit={async e => { e.preventDefault(); const r = await act({ action: "log", ...log }, "Logged."); if (r.ok) setLog({ ...log, body: "" }); }}>
            <select className="input w-32" value={log.kind} onChange={e => setLog({ ...log, kind: e.target.value })} aria-label="Type">{["call", "meeting", "note", "whatsapp", "email", "sms"].map(k => <option key={k}>{k}</option>)}</select>
            <input className="input min-w-[220px] flex-1" required placeholder="What was said or agreed" value={log.body} onChange={e => setLog({ ...log, body: e.target.value })} aria-label="Details" />
            <button className="btn btn-primary">Log</button>
          </form>
        )}
        {tab === "message" && (
          <form className="space-y-2" onSubmit={async e => { e.preventDefault(); const r = await act({ action: "message", ...m }, "Message sent."); if (r.ok) setM({ ...m, subject: "", body: "" }); }}>
            <div className="flex gap-2">
              <select className="input w-36" value={m.channel} onChange={e => setM({ ...m, channel: e.target.value })} aria-label="Channel"><option value="whatsapp">WhatsApp</option><option value="sms">SMS</option><option value="email">Email</option></select>
              {m.channel === "email" && <input className="input flex-1" placeholder="Subject" value={m.subject} onChange={e => setM({ ...m, subject: e.target.value })} aria-label="Subject" />}
            </div>
            <textarea className="input h-20" required value={m.body} onChange={e => setM({ ...m, body: e.target.value })} aria-label="Message" placeholder={`Hello ${l.parent_name.split(" ")[0]}, …`} />
            <div className="flex justify-end"><button className="btn btn-primary">Send</button></div>
          </form>
        )}
        {tab === "task" && (
          <form className="flex flex-wrap gap-2" onSubmit={async e => { e.preventDefault(); const r = await act({ action: "task", body: task.body, due_at: new Date(task.due).toISOString(), assigned_to: task.assigned_to || null }, "Task added."); if (r.ok) setTask({ body: "", due: "", assigned_to: "" }); }}>
            <input className="input min-w-[200px] flex-1" required placeholder="e.g. Call back about fees" value={task.body} onChange={e => setTask({ ...task, body: e.target.value })} aria-label="Task" />
            <input className="input w-48" type="datetime-local" required value={task.due} onChange={e => setTask({ ...task, due: e.target.value })} aria-label="Due" />
            <select className="input w-40" value={task.assigned_to} onChange={e => setTask({ ...task, assigned_to: e.target.value })} aria-label="For"><option value="">Me</option>{staff.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select>
            <button className="btn btn-primary">Add</button>
          </form>
        )}
      </section>

      {tasks.length > 0 && (
        <section>
          <h3 className="mb-1 font-semibold">Tasks</h3>
          <ul className="space-y-1">{tasks.map(t => (
            <li key={t.id} className={"flex items-center gap-2 rounded px-2 py-1 " + (t.done_at ? "text-slate-400 line-through" : t.due_at && new Date(t.due_at) < new Date() ? "bg-rose-50" : "bg-slate-50")}>
              <input type="checkbox" checked={Boolean(t.done_at)} onChange={e => act({ action: "task_done", task_id: t.id, done: e.target.checked }, e.target.checked ? "Task done." : "Task reopened.")} aria-label="Done" />
              <span className="flex-1">{t.body}</span><span className="text-xs">{t.due_at ? fmtDate(t.due_at, true) : ""}</span>
            </li>
          ))}</ul>
        </section>
      )}

      {data.bookings.length > 0 && (
        <section>
          <h3 className="mb-1 font-semibold">Visits</h3>
          <ul className="space-y-1">{data.bookings.map(b => <li key={b.id} className="flex gap-2"><span>{b.admission_events?.title}</span><span className="text-slate-500">{b.admission_events ? fmtDate(b.admission_events.starts_at, true) : ""}</span><Badge tone={b.status === "attended" ? "green" : b.status === "booked" ? "blue" : "slate"}>{b.status.replace("_", " ")}</Badge></li>)}</ul>
        </section>
      )}

      <section>
        <h3 className="mb-1 font-semibold">Timeline</h3>
        <ol className="space-y-1.5">{timeline.map(a => (
          <li key={a.id} className="flex gap-2">
            <span aria-hidden className="grid w-5 place-items-center pt-0.5 text-slate-400">{KIND_ICON[a.kind] ? <Icon name={KIND_ICON[a.kind]} className="h-3.5 w-3.5" /> : <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />}</span>
            <div className="flex-1"><p className="whitespace-pre-wrap">{a.kind === "stage" ? `Moved from ${STAGE_LABEL[a.meta?.from as Stage] ?? a.meta?.from} to ${STAGE_LABEL[a.meta?.to as Stage] ?? a.meta?.to}${a.body ? `: ${a.body}` : ""}` : a.body}</p>
              <p className="text-[11px] text-slate-500">{fmtDate(a.created_at, true)}{a.actor?.full_name ? ` · ${a.actor.full_name}` : a.meta?.automatic ? " · automatic follow-up" : ""}</p></div>
          </li>
        ))}</ol>
      </section>

      <div className="flex justify-end"><button className="btn btn-ghost" onClick={onClose}>Close</button></div>
      <Modal open={lost} onClose={() => setLost(false)} title="Why did the family not go ahead?">
        {lost && <LostForm onSave={async reason => { setLost(false); await act({ action: "stage", stage: "lost", note: reason }, "Marked as lost."); }} />}
      </Modal>
      <Modal open={startApp} onClose={() => setStartApp(false)} title="Start an application" wide>
        {startApp && <StartApplication lead={l} onDone={async body => { const r = await act({ action: "start_application", ...body }, "Application started. Send the family the tracking link to upload documents and pay."); if (r.ok) setStartApp(false); }} />}
      </Modal>
    </div>
  );
}

function StartApplication({ lead, onDone }: { lead: Detail["lead"]; onDone: (b: Record<string, unknown>) => void }) {
  const [first, ...rest] = String(lead.child_name ?? "").split(" ");
  const [f, setF] = useState({ first_name: first ?? "", last_name: rest.join(" ") || lead.parent_name.split(" ").slice(-1)[0], applying_for: lead.applying_for ?? "", gender: "" });
  return (
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={e => { e.preventDefault(); onDone({ ...f, gender: f.gender || null }); }}>
      <Field label="Child's first name"><input className="input" required value={f.first_name} onChange={e => setF({ ...f, first_name: e.target.value })} /></Field>
      <Field label="Last name"><input className="input" required value={f.last_name} onChange={e => setF({ ...f, last_name: e.target.value })} /></Field>
      <Field label="Class applying for"><input className="input" required value={f.applying_for} onChange={e => setF({ ...f, applying_for: e.target.value })} /></Field>
      <Field label="Gender"><select className="input" value={f.gender} onChange={e => setF({ ...f, gender: e.target.value })}><option value="">—</option><option value="female">Female</option><option value="male">Male</option></select></Field>
      <p className="text-xs text-slate-500 sm:col-span-2">The parent&apos;s details, source and campaign come from the enquiry.</p>
      <div className="flex justify-end sm:col-span-2"><button className="btn btn-primary">Create application</button></div>
    </form>
  );
}
