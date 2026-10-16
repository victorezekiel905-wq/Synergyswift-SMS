"use client";
import { useState } from "react";
import { useApi, send, Alert, Empty, Modal, Field, Badge, fmtDate, fmtTime } from "@/components/ui";
import PeoplePicker, { type Person } from "@/components/comms/PeoplePicker";

type Incident = { id: string; occurred_at: string; location: string | null; severity: string; description: string; action_taken: string | null; status: string; outcome: string | null; reported_by: string;
  behaviour_categories: { name: string } | null; students: { id: string; role: string; name: string; class: string | null }[] };
type Session = { id: string; kind: string; starts_at: string; duration_min: number; location: string | null; supervisor_id: string | null; capacity: number | null };
type Det = { id: string; student_id: string; session_id: string | null; reason: string; status: string; parent_notified_at: string | null; name: string; class: string | null; incident_id: string | null };
type Data = { me: string; admin: boolean; staff: { id: string; full_name: string }[]; incidents: Incident[]; sessions: Session[]; detentions: Det[] };

const ROLE: Record<string, string> = { responsible: "Responsible", involved: "Involved", affected: "Affected", witness: "Witness" };
const KIND: Record<string, string> = { detention: "Detention", isolation: "Isolation", community_service: "Community service" };
const now = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

/** Incidents: what happened, where, and who was involved in what way. */
export function Incidents({ categories }: { categories: { id: string; name: string; kind: string }[] }) {
  const { data, error, reload } = useApi<Data>("/api/behaviour/discipline");
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState<(Person & { role: string })[]>([]);
  const [f, setF] = useState({ occurred_at: now(), location: "", category_id: "", severity: "minor", description: "", action_taken: "", record_points: true });
  const [detain, setDetain] = useState<Incident | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return null;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2"><button className="btn btn-primary" onClick={() => setOpen(true)}>+ Log an incident</button><p className="text-sm text-slate-500">For anything more than a quick point: fights, damage, bullying, with everyone involved.</p></div>
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      {!data.incidents.length ? <Empty>No incidents logged.</Empty> : data.incidents.map(i => (
        <section key={i.id} className="card space-y-1 p-4 text-sm">
          <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{fmtDate(i.occurred_at)} {fmtTime(i.occurred_at)}</span>{i.location && <span className="text-slate-500">{i.location}</span>}
            <Badge tone={i.severity === "serious" ? "red" : i.severity === "moderate" ? "amber" : "slate"}>{i.severity}</Badge>{i.behaviour_categories && <Badge>{i.behaviour_categories.name}</Badge>}
            <Badge tone={i.status === "resolved" ? "green" : "blue"}>{i.status}</Badge>
            <span className="ml-auto flex gap-1">
              {i.status === "open" && <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setDetain(i)}>Set detention</button>}
              {i.status === "open" && (i.reported_by === data.me || data.admin) && <button className="btn btn-ghost px-2 py-1 text-xs" onClick={async () => { const o = prompt("Outcome"); if (o) { const r = await send("/api/behaviour/discipline", { action: "resolve_incident", id: i.id, outcome: o }); setMsg({ ok: r.ok, text: r.ok ? "Resolved." : r.error ?? "" }); reload(); } }}>Resolve</button>}
            </span></div>
          <p>{i.description}</p>
          <p className="text-xs">{i.students.map(s => <span key={s.id} className="mr-2"><b>{s.name}</b> <span className="text-slate-500">({ROLE[s.role]}{s.class ? `, ${s.class}` : ""})</span></span>)}</p>
          {i.action_taken && <p className="text-xs text-slate-600">Action: {i.action_taken}</p>}
          {i.outcome && <p className="text-xs text-emerald-700">Outcome: {i.outcome}</p>}
        </section>))}
      <Modal open={open} onClose={() => setOpen(false)} title="Log an incident" wide>
        <form className="space-y-3" onSubmit={async e => {
          e.preventDefault();
          const r = await send("/api/behaviour/discipline", { action: "add_incident", ...f, category_id: f.category_id || null, location: f.location || null, action_taken: f.action_taken || null,
            students: people.map(p => ({ student_id: p.id, role: p.role })) });
          setMsg({ ok: r.ok, text: r.ok ? "Incident logged." : r.error ?? "" });
          if (r.ok) { setOpen(false); setPeople([]); setF({ ...f, description: "", action_taken: "", location: "" }); reload(); }
        }}>
          <div className="grid gap-2 sm:grid-cols-3">
            <Field label="When"><input className="input" type="datetime-local" required value={f.occurred_at} onChange={e => setF({ ...f, occurred_at: e.target.value })} /></Field>
            <Field label="Where"><input className="input" value={f.location} onChange={e => setF({ ...f, location: e.target.value })} /></Field>
            <Field label="How serious"><select className="input" value={f.severity} onChange={e => setF({ ...f, severity: e.target.value })}><option value="minor">Minor</option><option value="moderate">Moderate</option><option value="serious">Serious</option></select></Field>
          </div>
          <Field label="Category"><select className="input" value={f.category_id} onChange={e => setF({ ...f, category_id: e.target.value })}><option value="">—</option>{categories.filter(c => c.kind === "negative").map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          <Field label="Students involved"><PeoplePicker types={["Student"]} value={people} onChange={v => setPeople(v.map(p => ({ ...p, role: (people.find(x => x.id === p.id)?.role) ?? "responsible" })))} placeholder="Search students" /></Field>
          {people.length > 0 && <div className="grid gap-1 sm:grid-cols-2">{people.map(p => (
            <label key={p.id} className="flex items-center gap-2 text-sm"><span className="flex-1">{p.title}</span>
              <select className="input w-36 py-1" value={p.role} onChange={e => setPeople(people.map(x => x.id === p.id ? { ...x, role: e.target.value } : x))}>{Object.entries(ROLE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>))}</div>}
          <Field label="What happened"><textarea className="input" rows={4} required minLength={3} value={f.description} onChange={e => setF({ ...f, description: e.target.value })} /></Field>
          <Field label="Action taken straight away"><input className="input" value={f.action_taken} onChange={e => setF({ ...f, action_taken: e.target.value })} /></Field>
          {f.category_id && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.record_points} onChange={e => setF({ ...f, record_points: e.target.checked })} />Record the category’s points for those responsible</label>}
          <p className="text-xs text-slate-500">If a child may be at risk of harm, also report a safeguarding concern under Pastoral care.</p>
          <button className="btn btn-primary w-full" disabled={!people.length}>Save</button>
        </form>
      </Modal>
      <SetDetention open={Boolean(detain)} onClose={() => setDetain(null)} sessions={data.sessions} preset={detain ? { incident_id: detain.id, people: detain.students.filter(s => s.role === "responsible").map(s => ({ type: "Student" as const, id: s.id, title: s.name })), reason: detain.description.slice(0, 200) } : null}
        onDone={t => { setDetain(null); setMsg({ ok: true, text: t }); reload(); }} />
    </div>
  );
}

function SetDetention({ open, onClose, sessions, preset, onDone }: { open: boolean; onClose: () => void; sessions: Session[]; preset: { incident_id?: string; people: Person[]; reason: string } | null; onDone: (t: string) => void }) {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [session, setSession] = useState("");
  const [notify, setNotify] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const list = people ?? preset?.people ?? [];
  const upcoming = sessions.filter(s => s.starts_at >= new Date().toISOString());
  return (
    <Modal open={open} onClose={() => { setPeople(null); setReason(null); setErr(null); onClose(); }} title="Set a detention">
      <form className="space-y-3" onSubmit={async e => {
        e.preventDefault();
        const r = await send<{ created: number; parents_told: number }>("/api/behaviour/discipline", { action: "set_detention", student_ids: list.map(p => p.id), reason: reason ?? preset?.reason ?? "", session_id: session || null,
          incident_id: preset?.incident_id ?? null, notify_parent: notify });
        if (!r.ok) return setErr(r.error);
        setPeople(null); setReason(null); setErr(null);
        onDone(`${r.data.created} detention(s) set${r.data.parents_told ? `; ${r.data.parents_told} famil${r.data.parents_told === 1 ? "y" : "ies"} told` : ""}.`);
      }}>
        <Field label="Students"><PeoplePicker types={["Student"]} value={list} onChange={setPeople} placeholder="Search students" /></Field>
        <Field label="Reason"><input className="input" required value={reason ?? preset?.reason ?? ""} onChange={e => setReason(e.target.value)} /></Field>
        <Field label="Session"><select className="input" value={session} onChange={e => setSession(e.target.value)}><option value="">Not yet scheduled</option>{upcoming.map(s => <option key={s.id} value={s.id}>{KIND[s.kind]} · {fmtDate(s.starts_at)} {fmtTime(s.starts_at)}{s.location ? ` · ${s.location}` : ""}</option>)}</select></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={notify} onChange={e => setNotify(e.target.checked)} />Tell the parents the date and time</label>
        {err && <Alert>{err}</Alert>}
        <button className="btn btn-primary w-full" disabled={!list.length}>Set</button>
      </form>
    </Modal>
  );
}

/** Detention sessions and who is in them: served, missed, waiting for a session. */
export function Detentions() {
  const { data, error, reload } = useApi<Data>("/api/behaviour/discipline");
  const [edit, setEdit] = useState<any | null>(null);
  const [set, setSet] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pick, setPick] = useState<string[]>([]);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return null;
  const waiting = data.detentions.filter(d => !d.session_id && d.status === "scheduled");
  const call = async (body: object, ok: string) => { const r = await send("/api/behaviour/discipline", body); setMsg({ ok: r.ok, text: r.ok ? ok : r.error ?? "" }); reload(); return r; };
  const name = (id: string | null) => data.staff.find(s => s.id === id)?.full_name;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2"><button className="btn btn-primary" onClick={() => setEdit({ kind: "detention", starts_at: now(), duration_min: 45 })}>+ Session</button><button className="btn btn-outline" onClick={() => setSet(true)}>Set a detention</button></div>
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      {waiting.length > 0 && <section className="card p-4">
        <h2 className="mb-2 font-semibold">Waiting for a session ({waiting.length})</h2>
        <ul className="space-y-1 text-sm">{waiting.map(d => <li key={d.id} className="flex items-center gap-2"><input type="checkbox" checked={pick.includes(d.id)} onChange={e => setPick(e.target.checked ? [...pick, d.id] : pick.filter(x => x !== d.id))} aria-label={d.name} />
          <b>{d.name}</b><span className="text-xs text-slate-500">{d.class}</span><span className="text-slate-600">{d.reason}</span></li>)}</ul>
        {pick.length > 0 && <div className="mt-2 flex items-center gap-2"><select className="input w-auto" id="assign-session" defaultValue="">{<option value="" disabled>Choose a session…</option>}{data.sessions.filter(s => s.starts_at >= new Date().toISOString()).map(s => <option key={s.id} value={s.id}>{KIND[s.kind]} · {fmtDate(s.starts_at)} {fmtTime(s.starts_at)}</option>)}</select>
          <button className="btn btn-primary" onClick={async () => { const v = (document.getElementById("assign-session") as HTMLSelectElement).value; if (v) { await call({ action: "assign", ids: pick, session_id: v, notify_parent: true }, "Scheduled; parents told."); setPick([]); } }}>Schedule</button></div>}
      </section>}
      {!data.sessions.length ? <Empty>No sessions in the last two weeks or ahead.</Empty> : data.sessions.map(s => {
        const ds = data.detentions.filter(d => d.session_id === s.id && d.status !== "cancelled");
        return (
          <section key={s.id} className="card p-4 text-sm">
            <div className="mb-2 flex flex-wrap items-center gap-2"><span className="font-semibold">{KIND[s.kind]} · {fmtDate(s.starts_at)} {fmtTime(s.starts_at)}</span>
              <span className="text-slate-500">{s.duration_min} min{s.location ? ` · ${s.location}` : ""}{name(s.supervisor_id) ? ` · ${name(s.supervisor_id)}` : ""}</span>
              <Badge>{ds.length}{s.capacity ? `/${s.capacity}` : ""}</Badge>
              <span className="ml-auto flex gap-1"><button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setEdit({ ...s, starts_at: new Date(new Date(s.starts_at).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) })}>Edit</button>
                {!ds.length && <button className="btn btn-ghost px-2 py-1 text-xs text-rose-600" onClick={() => call({ action: "delete_session", id: s.id }, "Deleted.")}>Delete</button>}</span></div>
            {!ds.length ? <p className="text-slate-500">Nobody in this session.</p> : <ul className="divide-y divide-slate-100">{ds.map(d => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 py-1.5"><b>{d.name}</b><span className="text-xs text-slate-500">{d.class}</span><span className="text-slate-600">{d.reason}</span>
                {d.parent_notified_at && <span className="text-xs text-slate-400">parents told</span>}
                <span className="ml-auto flex gap-1">{d.status === "scheduled" ? <>
                  <button className="btn btn-primary px-2 py-1 text-xs" onClick={() => call({ action: "mark", id: d.id, status: "served" }, "Marked served.")}>Served</button>
                  <button className="btn btn-ghost px-2 py-1 text-xs text-rose-600" onClick={() => call({ action: "mark", id: d.id, status: "missed" }, "Marked missed.")}>Missed</button>
                  <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => call({ action: "mark", id: d.id, status: "cancelled" }, "Cancelled.")}>Cancel</button></> :
                  <Badge tone={d.status === "served" ? "green" : d.status === "missed" ? "red" : "slate"}>{d.status}</Badge>}</span></li>))}</ul>}
          </section>
        );
      })}
      <Modal open={Boolean(edit)} onClose={() => setEdit(null)} title={edit?.id ? "Edit session" : "New session"}>
        {edit && <form className="space-y-3" onSubmit={async e => {
          e.preventDefault();
          const r = await call({ action: "save_session", id: edit.id, kind: edit.kind, starts_at: edit.starts_at, duration_min: Number(edit.duration_min), location: edit.location || null, supervisor_id: edit.supervisor_id || null, capacity: edit.capacity ? Number(edit.capacity) : null }, "Saved.");
          if (r.ok) setEdit(null);
        }}>
          <Field label="Kind"><select className="input" value={edit.kind} onChange={e => setEdit({ ...edit, kind: e.target.value })}>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Starts"><input className="input" type="datetime-local" required value={edit.starts_at} onChange={e => setEdit({ ...edit, starts_at: e.target.value })} /></Field>
            <Field label="Minutes"><input className="input" type="number" min={5} max={480} value={edit.duration_min} onChange={e => setEdit({ ...edit, duration_min: e.target.value })} /></Field>
            <Field label="Room"><input className="input" value={edit.location ?? ""} onChange={e => setEdit({ ...edit, location: e.target.value })} /></Field>
            <Field label="Places"><input className="input" type="number" min={1} value={edit.capacity ?? ""} onChange={e => setEdit({ ...edit, capacity: e.target.value })} /></Field>
          </div>
          <Field label="Supervising"><select className="input" value={edit.supervisor_id ?? ""} onChange={e => setEdit({ ...edit, supervisor_id: e.target.value })}><option value="">—</option>{data.staff.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select></Field>
          <button className="btn btn-primary w-full">Save</button>
        </form>}
      </Modal>
      <SetDetention open={set} onClose={() => setSet(false)} sessions={data.sessions} preset={null} onDone={t => { setSet(false); setMsg({ ok: true, text: t }); reload(); }} />
    </div>
  );
}
