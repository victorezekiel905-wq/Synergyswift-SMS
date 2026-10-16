"use client";
import { useState } from "react";
import { useApi, send, Alert, Empty, Modal, Field, Badge, Stat, fmtDate, fmtTime } from "@/components/ui";
import PeoplePicker, { type Person } from "@/components/comms/PeoplePicker";
import { CONCERN_CATEGORIES, MOODS } from "@/lib/welfare";

const SEV_TONE: Record<string, "red" | "amber" | "slate" | "blue"> = { critical: "red", high: "red", medium: "amber", low: "slate" };
const STATUS: Record<string, string> = { new: "New", acknowledged: "Acknowledged", investigating: "Investigating", referred: "Referred outside school", monitoring: "Monitoring", closed: "Closed" };
const localNow = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

/** Report a concern (anyone) and, for the safeguarding team, the list, each concern's chronology and its handling. */
export function Safeguarding({ initial }: { initial?: string | null }) {
  const { data, error, reload } = useApi<{ dsl: boolean; me: string; team: { id: string; full_name: string }[]; concerns: any[] }>("/api/pastoral?view=concerns");
  const [open, setOpen] = useState<string | null>(initial ?? null);
  const [report, setReport] = useState(false);
  const [filter, setFilter] = useState<"open" | "all">("open");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return null;
  const rows = data.concerns.filter(c => filter === "all" || c.status !== "closed");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn btn-primary" onClick={() => setReport(true)}>Report a concern</button>
        <p className="text-sm text-slate-600">If a child is in immediate danger, act first (call the head or emergency services), then record it here.</p>
      </div>
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      {data.dsl ? <>
        <div className="flex gap-1 text-sm">{(["open", "all"] as const).map(f => <button key={f} className={"rounded px-3 py-1 " + (filter === f ? "bg-brand-600 text-white" : "bg-slate-100")} onClick={() => setFilter(f)}>{f === "open" ? "Open" : "All"}</button>)}</div>
        {!rows.length ? <Empty>No open concerns.</Empty> : (
          <div className="card overflow-x-auto"><table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-2">Reported</th><th className="p-2">Student</th><th className="p-2">Concern</th><th className="p-2">Status</th><th className="p-2">With</th></tr></thead>
            <tbody>{rows.map(c => (
              <tr key={c.id} className={"cursor-pointer border-t border-slate-100 hover:bg-slate-50 " + (c.status === "new" ? "bg-rose-50" : "")} onClick={() => setOpen(c.id)}>
                <td className="p-2 text-xs">{fmtDate(c.created_at)} {fmtTime(c.created_at)}<div className="text-slate-400">{c.reporter_name}</div></td>
                <td className="p-2">{c.student}<div className="text-xs text-slate-400">{c.class}</div></td>
                <td className="p-2">{CONCERN_CATEGORIES[c.category] ?? c.category} <Badge tone={SEV_TONE[c.severity]}>{c.severity}</Badge></td>
                <td className="p-2"><Badge tone={c.status === "new" ? "red" : c.status === "closed" ? "green" : "blue"}>{STATUS[c.status]}</Badge>{c.escalated_at && <Badge tone="red">escalated</Badge>}</td>
                <td className="p-2 text-xs">{c.assigned_name ?? "—"}</td></tr>))}</tbody></table></div>
        )}
      </> : (
        <section><h2 className="mb-2 font-semibold">Concerns I have reported</h2>
          {!data.concerns.length ? <Empty>None. The safeguarding team handles what you report; you will not see their notes.</Empty> : (
            <ul className="space-y-1 text-sm">{data.concerns.map(c => <li key={c.id}>{fmtDate(c.created_at)} · {c.student} · {CONCERN_CATEGORIES[c.category]} <Badge>{STATUS[c.status]}</Badge></li>)}</ul>)}
        </section>
      )}
      <ReportConcern open={report} onClose={() => setReport(false)} onDone={() => { setReport(false); setMsg({ ok: true, text: "Thank you. The safeguarding team has been alerted." }); reload(); }} />
      {data.dsl && <ConcernDetail id={open} team={data.team} onClose={() => { setOpen(null); reload(); }} />}
    </div>
  );
}

export function ReportConcern({ open, onClose, onDone, student }: { open: boolean; onClose: () => void; onDone: () => void; student?: Person | null }) {
  const [who, setWho] = useState<Person[]>(student ? [student] : []);
  const [f, setF] = useState({ category: "physical", severity: "medium", description: "", observed_at: localNow(), location: "", immediate_action: "" });
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal open={open} onClose={onClose} title="Report a safeguarding concern" wide>
      <form className="space-y-3" onSubmit={async e => {
        e.preventDefault();
        if (!who.length) return setErr("choose the student");
        const r = await send("/api/pastoral", { action: "report_concern", student_id: who[0].id, ...f, location: f.location || null, immediate_action: f.immediate_action || null });
        if (!r.ok) return setErr(r.error);
        setErr(null); setWho([]); setF({ ...f, description: "", location: "", immediate_action: "" }); onDone();
      }}>
        <Field label="Student"><PeoplePicker types={["Student"]} value={who} onChange={v => setWho(v.slice(-1))} placeholder="Search the student" /></Field>
        <div className="grid gap-2 sm:grid-cols-3">
          <Field label="Kind of concern"><select className="input" value={f.category} onChange={e => setF({ ...f, category: e.target.value })}>{Object.entries(CONCERN_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="How urgent"><select className="input" value={f.severity} onChange={e => setF({ ...f, severity: e.target.value })}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical: risk of harm today</option></select></Field>
          <Field label="When"><input className="input" type="datetime-local" value={f.observed_at} onChange={e => setF({ ...f, observed_at: e.target.value })} /></Field>
        </div>
        <Field label="What you saw or were told (the child's own words if you can; facts, not opinions)"><textarea className="input" rows={6} required minLength={10} value={f.description} onChange={e => setF({ ...f, description: e.target.value })} /></Field>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Where"><input className="input" value={f.location} onChange={e => setF({ ...f, location: e.target.value })} /></Field>
          <Field label="What you did straight away"><input className="input" value={f.immediate_action} onChange={e => setF({ ...f, immediate_action: e.target.value })} /></Field>
        </div>
        <p className="text-xs text-slate-500">Do not promise the child to keep it secret, and do not investigate yourself. Only the safeguarding team sees this report; your words are kept exactly as written.</p>
        {err && <Alert>{err}</Alert>}
        <button className="btn btn-primary w-full">Send to the safeguarding team</button>
      </form>
    </Modal>
  );
}

function ConcernDetail({ id, team, onClose }: { id: string | null; team: { id: string; full_name: string }[]; onClose: () => void }) {
  const { data, error, reload } = useApi<any>(id ? `/api/pastoral?view=concern&id=${id}` : null, [id]);
  const [note, setNote] = useState({ kind: "note", detail: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const c = data?.concern;
  const update = async (patch: object, ok: string) => { const r = await send("/api/pastoral", { action: "concern_update", id, ...patch }); setMsg({ ok: r.ok, text: r.ok ? ok : r.error ?? "" }); reload(); };
  return (
    <Modal open={Boolean(id)} onClose={() => { setMsg(null); onClose(); }} title={c ? `Concern: ${c.student}` : "Concern"} wide>
      {error && <Alert>{error}</Alert>}
      {c && <div className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center gap-2"><Badge tone={SEV_TONE[c.severity]}>{c.severity}</Badge><span>{CONCERN_CATEGORIES[c.category]}</span><Badge tone={c.status === "new" ? "red" : "blue"}>{STATUS[c.status]}</Badge>
          <span className="text-slate-500">{c.class} · reported by {c.reporter_name} on {fmtDate(c.created_at)} {fmtTime(c.created_at)}</span></div>
        {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
        <section className="rounded bg-slate-50 p-3"><p className="whitespace-pre-wrap">{c.description}</p>
          {c.location && <p className="mt-1 text-xs text-slate-500">Where: {c.location}</p>}{c.immediate_action && <p className="text-xs text-slate-500">Done at once: {c.immediate_action}</p>}</section>
        <div className="grid gap-2 sm:grid-cols-3">
          <Field label="Status"><select className="input" value={c.status} onChange={e => {
            if (e.target.value === "closed") { const o = prompt("Outcome (required to close)", c.outcome ?? ""); if (o) update({ status: "closed", outcome: o }, "Closed."); }
            else update({ status: e.target.value }, "Updated.");
          }}>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Handled by"><select className="input" value={c.assigned_to ?? ""} onChange={e => update({ assigned_to: e.target.value || null }, "Assigned.")}><option value="">—</option>{team.map(t => <option key={t.id} value={t.id}>{t.full_name}</option>)}</select></Field>
          <Field label="Severity"><select className="input" value={c.severity} onChange={e => update({ severity: e.target.value }, "Updated.")}>{["low", "medium", "high", "critical"].map(s => <option key={s}>{s}</option>)}</select></Field>
          <Field label="Parents informed"><select className="input" value={c.parents_informed ?? ""} onChange={e => update({ parents_informed: e.target.value || null }, "Updated.")}><option value="">Not recorded</option><option value="yes">Yes</option><option value="no">Not yet</option><option value="not_appropriate">Not appropriate (risk)</option></select></Field>
          <Field label="Referred to (agency)"><input className="input" defaultValue={c.external_agency ?? ""} placeholder="e.g. police, social welfare, hospital" onBlur={e => e.target.value !== (c.external_agency ?? "") && update({ external_agency: e.target.value || null }, "Referral recorded.")} /></Field>
          <Field label="Their reference"><input className="input" defaultValue={c.external_ref ?? ""} onBlur={e => e.target.value !== (c.external_ref ?? "") && update({ external_ref: e.target.value || null }, "Saved.")} /></Field>
        </div>
        {c.status === "new" && <button className="btn btn-primary" onClick={() => update({ status: "acknowledged" }, "Acknowledged.")}>Acknowledge</button>}
        <section>
          <h3 className="mb-1 font-semibold">Chronology</h3>
          <ul className="space-y-1">{data.chronology.map((a: any) => <li key={a.id} className="border-l-2 border-slate-200 pl-2"><span className="text-xs text-slate-500">{fmtDate(a.at)} {fmtTime(a.at)} · {a.by} · {a.kind.replace("_", " ")}</span><p className="whitespace-pre-wrap">{a.detail}</p></li>)}</ul>
          <form className="mt-2 flex flex-wrap items-end gap-2" onSubmit={async e => {
            e.preventDefault();
            const r = await send("/api/pastoral", { action: "concern_note", id, ...note });
            setMsg({ ok: r.ok, text: r.ok ? "Added to the chronology." : r.error ?? "" });
            if (r.ok) { setNote({ ...note, detail: "" }); reload(); }
          }}>
            <select className="input w-auto" value={note.kind} onChange={e => setNote({ ...note, kind: e.target.value })}><option value="note">Note</option><option value="contacted_parent">Spoke to parent</option><option value="meeting">Meeting</option><option value="referred">Referral</option></select>
            <input className="input min-w-[16rem] flex-1" required minLength={2} value={note.detail} onChange={e => setNote({ ...note, detail: e.target.value })} placeholder="What happened (entries cannot be changed)" />
            <button className="btn btn-outline">Add</button>
          </form>
        </section>
        {data.earlier.length > 0 && <section><h3 className="mb-1 font-semibold">Earlier concerns about this student</h3><ul className="text-xs">{data.earlier.map((e: any) => <li key={e.id}>{fmtDate(e.created_at)} · {CONCERN_CATEGORIES[e.category]} · {e.severity} · {STATUS[e.status]}</li>)}</ul></section>}
        {c.outcome && <p><b>Outcome:</b> {c.outcome}</p>}
        <details className="text-xs text-slate-500"><summary>Who has opened this record</summary>{data.opened_by.map((o: any, i: number) => <p key={i}>{o.name} · {fmtDate(o.at)} {fmtTime(o.at)}</p>)}</details>
      </div>}
    </Modal>
  );
}

/** Counselling: referrals from staff, cases and session notes (counsellors only), and referring a student (anyone). */
export function Counselling() {
  const refs = useApi<{ counsellor: boolean; referrals: any[] }>("/api/pastoral?view=referrals");
  const cases = useApi<{ counsellor: boolean; me: string; cases: any[] }>("/api/pastoral?view=cases");
  const [refer, setRefer] = useState(false);
  const [openCase, setOpenCase] = useState<string | null>(null);
  const [newCase, setNewCase] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const counsellor = Boolean(refs.data?.counsellor);
  const pending = (refs.data?.referrals ?? []).filter(r => r.status === "new");
  const decide = async (id: string, accept: boolean) => { const r = await send<{ case_id: string | null }>("/api/pastoral", { action: "referral_decide", id, accept }); setMsg({ ok: r.ok, text: r.ok ? (accept ? "Case opened." : "Declined.") : r.error ?? "" }); refs.reload(); cases.reload(); if (r.ok && r.data.case_id) setOpenCase(r.data.case_id); };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2"><button className="btn btn-primary" onClick={() => setRefer(true)}>Refer a student</button>{counsellor && <button className="btn btn-outline" onClick={() => setNewCase(true)}>Open a case</button>}</div>
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      {counsellor && pending.length > 0 && <section className="card p-4"><h2 className="mb-2 font-semibold">Referrals waiting ({pending.length})</h2>
        <ul className="space-y-2 text-sm">{pending.map(r => <li key={r.id} className="rounded border border-slate-200 p-2"><div className="flex flex-wrap items-center gap-2"><b>{r.student}</b><span className="text-xs text-slate-500">{r.class} · from {r.referrer} · {fmtDate(r.created_at)}</span>
          <Badge tone={r.urgency === "urgent" ? "red" : r.urgency === "soon" ? "amber" : "slate"}>{r.urgency}</Badge>
          <span className="ml-auto flex gap-1"><button className="btn btn-primary px-2 py-1 text-xs" onClick={() => decide(r.id, true)}>Take on</button><button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => decide(r.id, false)}>Decline</button></span></div>
          <p className="mt-1">{r.reason}</p></li>)}</ul></section>}
      {counsellor ? (
        <section><h2 className="mb-2 font-semibold">Cases</h2>
          {!cases.data?.cases.length ? <Empty>No cases.</Empty> : (
            <div className="card overflow-x-auto"><table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-2">Student</th><th className="p-2">About</th><th className="p-2">Risk</th><th className="p-2">Sessions</th><th className="p-2">Next</th><th className="p-2">Status</th></tr></thead>
              <tbody>{cases.data.cases.map(c => <tr key={c.id} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50" onClick={() => setOpenCase(c.id)}>
                <td className="p-2">{c.student}<div className="text-xs text-slate-400">{c.class}</div></td><td className="p-2 capitalize">{c.category}</td>
                <td className="p-2"><Badge tone={c.risk_level === "high" ? "red" : c.risk_level === "medium" ? "amber" : "slate"}>{c.risk_level}</Badge>{c.shared_with_dsl && <Badge tone="violet">shared</Badge>}</td>
                <td className="p-2">{c.sessions}{c.last_session ? <span className="text-xs text-slate-400"> · last {fmtDate(c.last_session)}</span> : null}</td>
                <td className="p-2 text-xs">{c.next_session ? `${fmtDate(c.next_session)} ${fmtTime(c.next_session)}` : ""}</td><td className="p-2"><Badge tone={c.status === "open" ? "blue" : "green"}>{c.status}</Badge></td></tr>)}</tbody></table></div>
          )}
        </section>
      ) : (
        <section><h2 className="mb-2 font-semibold">My referrals</h2>
          {!(refs.data?.referrals ?? []).length ? <Empty>None. Counselling notes are private to the counsellors; you will see whether a referral was taken on.</Empty> : (
            <ul className="space-y-1 text-sm">{refs.data!.referrals.map(r => <li key={r.id}>{fmtDate(r.created_at)} · {r.student} <Badge tone={r.status === "accepted" ? "green" : r.status === "declined" ? "slate" : "amber"}>{r.status === "new" ? "waiting" : r.status}</Badge></li>)}</ul>)}
        </section>
      )}
      <Modal open={refer} onClose={() => setRefer(false)} title="Refer a student to counselling"><ReferForm onDone={t => { setRefer(false); setMsg({ ok: true, text: t }); refs.reload(); }} /></Modal>
      <Modal open={newCase} onClose={() => setNewCase(false)} title="Open a counselling case"><NewCase onDone={id => { setNewCase(false); cases.reload(); setOpenCase(id); }} /></Modal>
      <CaseDetail id={openCase} onClose={() => { setOpenCase(null); cases.reload(); }} />
    </div>
  );
}

function ReferForm({ onDone }: { onDone: (t: string) => void }) {
  const [who, setWho] = useState<Person[]>([]);
  const [f, setF] = useState({ reason: "", urgency: "routine" });
  const [err, setErr] = useState<string | null>(null);
  return (
    <form className="space-y-3" onSubmit={async e => {
      e.preventDefault();
      if (!who.length) return setErr("choose the student");
      const r = await send("/api/pastoral", { action: "refer", student_id: who[0].id, ...f });
      if (!r.ok) return setErr(r.error);
      onDone("Referred. A counsellor will pick it up.");
    }}>
      <Field label="Student"><PeoplePicker types={["Student"]} value={who} onChange={v => setWho(v.slice(-1))} placeholder="Search the student" /></Field>
      <Field label="Why (what you have noticed)"><textarea className="input" rows={4} required minLength={3} value={f.reason} onChange={e => setF({ ...f, reason: e.target.value })} /></Field>
      <Field label="How soon"><select className="input" value={f.urgency} onChange={e => setF({ ...f, urgency: e.target.value })}><option value="routine">Routine</option><option value="soon">This week</option><option value="urgent">Urgent (today)</option></select></Field>
      <p className="text-xs text-slate-500">If you think the child may be at risk of harm, report a safeguarding concern instead.</p>
      {err && <Alert>{err}</Alert>}
      <button className="btn btn-primary w-full">Refer</button>
    </form>
  );
}

function NewCase({ onDone }: { onDone: (id: string) => void }) {
  const [who, setWho] = useState<Person[]>([]);
  const [f, setF] = useState({ category: "emotional", source: "self", summary: "", risk_level: "low", shared_with_dsl: false });
  const [err, setErr] = useState<string | null>(null);
  return (
    <form className="space-y-3" onSubmit={async e => {
      e.preventDefault();
      if (!who.length) return setErr("choose the student");
      const r = await send<{ id: string }>("/api/pastoral", { action: "open_case", student_id: who[0].id, ...f, summary: f.summary || null });
      if (!r.ok) return setErr(r.error);
      onDone(r.data.id);
    }}>
      <Field label="Student"><PeoplePicker types={["Student"]} value={who} onChange={v => setWho(v.slice(-1))} placeholder="Search the student" /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="About"><select className="input" value={f.category} onChange={e => setF({ ...f, category: e.target.value })}>{["academic", "emotional", "family", "peer", "bereavement", "behaviour", "career", "health", "other"].map(c => <option key={c}>{c}</option>)}</select></Field>
        <Field label="Came via"><select className="input" value={f.source} onChange={e => setF({ ...f, source: e.target.value })}>{["self", "teacher", "parent", "safeguarding", "other"].map(c => <option key={c}>{c}</option>)}</select></Field>
        <Field label="Risk"><select className="input" value={f.risk_level} onChange={e => setF({ ...f, risk_level: e.target.value })}><option>low</option><option>medium</option><option>high</option></select></Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={f.shared_with_dsl} onChange={e => setF({ ...f, shared_with_dsl: e.target.checked })} />Share with the safeguarding team</label>
      </div>
      <Field label="Summary"><textarea className="input" rows={3} value={f.summary} onChange={e => setF({ ...f, summary: e.target.value })} /></Field>
      {err && <Alert>{err}</Alert>}
      <button className="btn btn-primary w-full">Open case</button>
    </form>
  );
}

function CaseDetail({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data, reload } = useApi<any>(id ? `/api/pastoral?view=case&id=${id}` : null, [id]);
  const [s, setS] = useState({ held_at: localNow(), duration_min: "40", mode: "in_person", notes: "", actions: "", next_session_at: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const c = data?.case;
  return (
    <Modal open={Boolean(id)} onClose={() => { setMsg(null); onClose(); }} title={c ? `Counselling: ${c.student}` : "Case"} wide>
      {c && <div className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center gap-2"><span className="capitalize">{c.category}</span><Badge tone={c.risk_level === "high" ? "red" : c.risk_level === "medium" ? "amber" : "slate"}>{c.risk_level} risk</Badge>
          <Badge tone={c.status === "open" ? "blue" : "green"}>{c.status}</Badge><span className="text-slate-500">{c.class} · opened {fmtDate(c.opened_at)}</span></div>
        {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
        {data.counsellor && <form className="grid gap-2 sm:grid-cols-3" onSubmit={async e => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const r = await send("/api/pastoral", { action: "update_case", id, summary: String(fd.get("summary") || "") || null, risk_level: String(fd.get("risk")), shared_with_dsl: fd.get("shared") === "on", status: String(fd.get("status")) });
          setMsg({ ok: r.ok, text: r.ok ? "Saved." : r.error ?? "" }); reload();
        }}>
          <div className="sm:col-span-3"><Field label="Summary"><textarea className="input" name="summary" rows={2} defaultValue={c.summary ?? ""} /></Field></div>
          <Field label="Risk"><select className="input" name="risk" defaultValue={c.risk_level}><option>low</option><option>medium</option><option>high</option></select></Field>
          <Field label="Status"><select className="input" name="status" defaultValue={c.status}><option value="open">Open</option><option value="closed">Closed</option></select></Field>
          <label className="flex items-center gap-2 self-end pb-2"><input type="checkbox" name="shared" defaultChecked={c.shared_with_dsl} />Share with safeguarding team</label>
          <button className="btn btn-outline sm:col-span-3">Save case</button>
        </form>}
        <section>
          <h3 className="mb-1 font-semibold">Sessions</h3>
          {!data.sessions.length ? <p className="text-slate-500">None yet.</p> : <ul className="space-y-2">{data.sessions.map((x: any) => <li key={x.id} className="rounded bg-slate-50 p-2">
            <p className="text-xs text-slate-500">{fmtDate(x.held_at)} {fmtTime(x.held_at)} · {x.mode.replace("_", " ")}{x.duration_min ? ` · ${x.duration_min} min` : ""}</p>
            {x.notes && <p className="whitespace-pre-wrap">{x.notes}</p>}{x.actions && <p className="text-xs"><b>Actions:</b> {x.actions}</p>}
            {x.next_session_at && <p className="text-xs text-slate-500">Next: {fmtDate(x.next_session_at)} {fmtTime(x.next_session_at)}</p>}</li>)}</ul>}
        </section>
        {data.counsellor && c.status === "open" && <form className="space-y-2 rounded border border-slate-200 p-3" onSubmit={async e => {
          e.preventDefault();
          const r = await send("/api/pastoral", { action: "add_session", case_id: id, held_at: s.held_at, duration_min: s.duration_min ? Number(s.duration_min) : null, mode: s.mode,
            notes: s.notes || null, actions: s.actions || null, next_session_at: s.next_session_at || null });
          setMsg({ ok: r.ok, text: r.ok ? "Session recorded." : r.error ?? "" });
          if (r.ok) { setS({ ...s, notes: "", actions: "", next_session_at: "" }); reload(); }
        }}>
          <h3 className="font-semibold">Record a session</h3>
          <div className="grid gap-2 sm:grid-cols-3">
            <Field label="When"><input className="input" type="datetime-local" value={s.held_at} onChange={e => setS({ ...s, held_at: e.target.value })} /></Field>
            <Field label="Minutes"><input className="input" type="number" min={1} value={s.duration_min} onChange={e => setS({ ...s, duration_min: e.target.value })} /></Field>
            <Field label="How"><select className="input" value={s.mode} onChange={e => setS({ ...s, mode: e.target.value })}><option value="in_person">In person</option><option value="group">Group</option><option value="phone">Phone</option><option value="online">Online</option></select></Field>
          </div>
          <Field label="Notes (confidential)"><textarea className="input" rows={4} value={s.notes} onChange={e => setS({ ...s, notes: e.target.value })} /></Field>
          <Field label="Agreed actions"><input className="input" value={s.actions} onChange={e => setS({ ...s, actions: e.target.value })} /></Field>
          <Field label="Next session"><input className="input" type="datetime-local" value={s.next_session_at} onChange={e => setS({ ...s, next_session_at: e.target.value })} /></Field>
          <p className="text-xs text-slate-500">Notes can be corrected by you on the day only. If you learn the child is at risk, report a safeguarding concern as well.</p>
          <button className="btn btn-primary">Save session</button>
        </form>}
      </div>}
    </Modal>
  );
}

/** Wellbeing: who needs following up, and the mood across the school or a class. */
export function Wellbeing({ admin }: { admin: boolean }) {
  const [cls, setCls] = useState("");
  const { data, error, reload } = useApi<any>(`/api/pastoral?view=wellbeing${cls ? `&class=${cls}` : ""}`, [cls]);
  const ov = useApi<any>("/api/pastoral?view=overview");
  const [msg, setMsg] = useState<string | null>(null);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return null;
  const st = ov.data?.settings;
  const maxCount = Math.max(1, ...data.trend.map((t: any) => t.count));
  return (
    <div className="space-y-4">
      {!st?.wellbeing_checkins && <Alert tone="amber">Student check-ins are switched off.{admin ? " Switch them on under Settings." : " An admin can switch them on."}</Alert>}
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Class"><select className="input" value={cls} onChange={e => setCls(e.target.value)}><option value="">Everyone I can see</option>{data.classes.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Check-ins (14 days)" value={data.summary.count} /><Stat label="Average mood" value={data.summary.average ?? "—"} hint="1 very low · 5 great" />
        <Stat label="To follow up" value={data.summary.to_follow_up} tone={data.summary.to_follow_up ? "warn" : "good"} /><Stat label="Most said" value={data.summary.feelings[0]?.feeling ?? "—"} />
      </div>
      <section className="card p-4">
        <h2 className="mb-2 text-sm font-semibold">Average mood by day</h2>
        <div className="flex h-28 items-end gap-1" role="img" aria-label="Average mood each day">{data.trend.map((t: any) => (
          <div key={t.date} className="flex flex-1 flex-col items-center justify-end" title={`${fmtDate(t.date)}: ${t.average ?? "no check-ins"} (${t.count})`}>
            <div className={"w-full rounded-t " + (t.average === null ? "bg-slate-100" : t.average < 2.5 ? "bg-rose-400" : t.average < 3.5 ? "bg-amber-400" : "bg-emerald-500")} style={{ height: `${t.average ? (t.average / 5) * 100 : 4}%`, opacity: 0.4 + 0.6 * (t.count / maxCount) }} />
          </div>))}</div>
        <div className="mt-1 flex justify-between text-xs text-slate-500"><span>{fmtDate(data.trend[0]?.date)}</span><span>{fmtDate(data.trend[data.trend.length - 1]?.date)}</span></div>
        {data.summary.feelings.length > 0 && <p className="mt-2 text-xs text-slate-600">Feelings named most: {data.summary.feelings.map((f: any) => `${f.feeling} (${f.count})`).join(", ")}</p>}
      </section>
      {msg && <Alert tone="green">{msg}</Alert>}
      <section><h2 className="mb-2 font-semibold">Needs a conversation</h2>
        {!data.follow_up.length ? <Empty>Nobody at the moment.</Empty> : <ul className="space-y-2">{data.follow_up.map((c: any) => (
          <li key={c.id} className={"card p-3 text-sm " + (c.followed_up_at ? "opacity-60" : "")}>
            <div className="flex flex-wrap items-center gap-2"><b>{c.student}</b><span className="text-xs text-slate-500">{c.class} · {fmtDate(c.created_at)} {fmtTime(c.created_at)}</span>
              <Badge tone={c.mood <= 2 ? "red" : "amber"}>{MOODS[c.mood]}</Badge>{c.wants_to_talk && <Badge tone="violet">wants to talk</Badge>}<span className="text-xs text-rose-700">{c.reason}</span>
              {!c.followed_up_at && <button className="btn btn-primary ml-auto px-2 py-1 text-xs" onClick={async () => { const n = prompt("What you did (optional)"); const r = await send("/api/pastoral", { action: "follow_up", id: c.id, note: n || null }); setMsg(r.ok ? "Marked as followed up." : r.error); reload(); }}>Followed up</button>}</div>
            {c.feelings.length > 0 && <p className="text-xs text-slate-600">Feels: {c.feelings.join(", ")}</p>}
            {c.note && <p className="mt-1">“{c.note}”</p>}
            {c.followed_up_at && <p className="text-xs text-emerald-700">Followed up {fmtDate(c.followed_up_at)}{c.follow_up_note ? `: ${c.follow_up_note}` : ""}</p>}
          </li>))}</ul>}
      </section>
    </div>
  );
}

export function PastoralSettings({ settings, onSaved }: { settings: { wellbeing_checkins: boolean; wellbeing_anonymous: boolean; safeguarding_escalate_hours: number } | null; onSaved: () => void }) {
  const [f, setF] = useState(settings ?? { wellbeing_checkins: false, wellbeing_anonymous: false, safeguarding_escalate_hours: 4 });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <form className="card max-w-xl space-y-3 p-5" onSubmit={async e => {
      e.preventDefault();
      const r = await send("/api/pastoral", { action: "settings", ...f, safeguarding_escalate_hours: Number(f.safeguarding_escalate_hours) });
      setMsg({ ok: r.ok, text: r.ok ? "Saved." : r.error ?? "" }); if (r.ok) onSaved();
    }}>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.wellbeing_checkins} onChange={e => setF({ ...f, wellbeing_checkins: e.target.checked })} />Students can check in each day (how they feel, and “I’d like to talk to someone”)</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.wellbeing_anonymous} onChange={e => setF({ ...f, wellbeing_anonymous: e.target.checked })} />Students may check in without their name (counted in the class mood only)</label>
      <Field label="Escalate an unacknowledged safeguarding concern to the head after (hours)" hint="Critical concerns escalate after one hour, high ones after half this time."><input className="input w-24" type="number" min={1} max={72} value={f.safeguarding_escalate_hours} onChange={e => setF({ ...f, safeguarding_escalate_hours: Number(e.target.value) })} /></Field>
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      <button className="btn btn-primary">Save</button>
    </form>
  );
}
