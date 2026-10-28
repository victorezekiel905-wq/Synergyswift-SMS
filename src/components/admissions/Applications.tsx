"use client";
import { useEffect, useState } from "react";
import { ApplicantSummaryPanel } from "./AiOffice";
import { useApi, send, Alert, Empty, Modal, Field, Badge, Stat, fmtDate, money } from "@/components/ui";

const STATUSES = ["new", "reviewing", "assessment", "interview", "waitlisted", "offered", "accepted", "enrolled", "rejected", "withdrawn", "declined", "expired"] as const;
export type App = {
  id: string; application_no: string; status: string; first_name: string; last_name: string; gender: string | null; date_of_birth: string | null; applying_for: string;
  previous_school: string | null; guardian_name: string; guardian_phone: string; guardian_email: string | null; notes: string | null; source: string; assessment_at: string | null;
  assessment_score: number | null; interview_at: string | null; interview_notes: string | null; interview_score: number | null; decision_note: string | null; fee_paid: boolean; created_at: string;
  student_id: string | null; lead_id: string | null; waitlist_position: number | null; ai_summary?: string | null; tracking_token: string; acceptance_fee: number; acceptance_paid: boolean;
  offer_letter: { subject: string; body: string; expires_on: string } | null; offer_accepted_at: string | null; offer_signer_name: string | null; offer_expires_on: string | null;
  application_documents: { id: string; kind: string; name: string; size: number; uploaded_at: string }[];
  admission_payments: { kind: string; amount: number; status: string; paid_at: string | null }[];
  entrance_attempts: { id: string; exam_id: string; status: string; total_score: number | null; max_score: number | null; submitted_at: string | null; token: string; exams: { title: string } | null }[];
};
export type AppsData = { applications: App[]; funnel: Record<string, number>; total: number; conversion: { offer_rate: number | null; yield: number | null };
  seats: { level: string; seats: number; left: number }[]; exams: { id: string; title: string; status: string; duration_minutes: number }[];
  ai?: boolean;
  settings: { admissions_open?: boolean; application_fee?: number; admissions_intro?: string | null; currency?: string; public_slug: string | null; acceptance_fee?: number; offer_valid_days?: number } };

export const statusTone = (s: string) => (s === "enrolled" ? "green" : ["rejected", "withdrawn", "declined", "expired"].includes(s) ? "red" : ["offered", "accepted"].includes(s) ? "blue" : s === "waitlisted" ? "violet" : "amber") as "green" | "red" | "blue" | "violet" | "amber";

export default function Applications({ openId, admin, onOpenLead }: { openId?: string | null; admin: boolean; onOpenLead: (leadId: string) => void }) {
  const [status, setStatus] = useState("");
  const { data, error, reload } = useApi<AppsData>(`/api/admissions${status ? `?status=${status}` : ""}`, [status]);
  const [open, setOpen] = useState<App | null>(null);
  const [walkIn, setWalkIn] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [assign, setAssign] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { if (openId && data) { const a = data.applications.find(x => x.id === openId); if (a) setOpen(a); } }, [openId, data]);
  useEffect(() => { if (open && data) { const fresh = data.applications.find(x => x.id === open.id); if (fresh && fresh !== open) setOpen(fresh); } }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const currency = data?.settings.currency ?? "NGN";
  return (
    <div className="space-y-4">
      {data && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Stat label="Applications" value={data.total} /><Stat label="In progress" value={(data.funnel.new ?? 0) + (data.funnel.reviewing ?? 0) + (data.funnel.assessment ?? 0) + (data.funnel.interview ?? 0)} />
          <Stat label="Offers made" value={(data.funnel.offered ?? 0) + (data.funnel.accepted ?? 0) + (data.funnel.enrolled ?? 0)} /><Stat label="Enrolled" value={data.funnel.enrolled ?? 0} tone="good" />
          <Stat label="Yield (offer → enrolled)" value={data.conversion.yield === null ? "—" : `${data.conversion.yield}%`} />
        </div>
      )}
      {data && data.seats.length > 0 && (
        <div className="flex flex-wrap gap-2 text-xs">{data.seats.map(s => <span key={s.level} className={"rounded-full border px-3 py-1 " + (s.left === 0 ? "border-rose-300 bg-rose-50 text-rose-700" : "border-slate-200")}>{s.level}: {s.left} of {s.seats} places left</span>)}</div>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <button className={"btn px-3 py-1 text-xs " + (!status ? "btn-primary" : "btn-ghost border border-slate-200")} onClick={() => setStatus("")}>All</button>
        {STATUSES.map(s => <button key={s} className={"btn px-3 py-1 text-xs " + (status === s ? "btn-primary" : "btn-ghost border border-slate-200")} onClick={() => setStatus(s)}>{s} ({data?.funnel[s] ?? 0})</button>)}
        <span className="ml-auto flex gap-2">
          {picked.size > 0 && <button className="btn btn-outline" onClick={() => setAssign(true)}>Entrance test for {picked.size}</button>}
          <button className="btn btn-outline" onClick={() => setWalkIn(true)}>+ Walk-in application</button>
          <a className="btn btn-ghost" href="/api/admissions?format=csv">CSV</a>
        </span>
      </div>
      {error && <Alert>{error}</Alert>}
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      {!data?.applications.length ? <Empty>No applications here.</Empty> : (
        <div className="card overflow-x-auto"><table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-[13px] text-slate-500"><tr><th className="p-2" /><th className="p-2">Application</th><th className="p-2">Child</th><th className="p-2">For</th><th className="p-2">Parent</th><th className="p-2">Progress</th><th className="p-2">Status</th><th className="p-2">Received</th></tr></thead>
          <tbody>{data.applications.map(a => (
            <tr key={a.id} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50" onClick={() => setOpen(a)}>
              <td className="p-2" onClick={e => e.stopPropagation()}><input type="checkbox" aria-label={`Select ${a.first_name}`} checked={picked.has(a.id)} onChange={e => { const n = new Set(picked); if (e.target.checked) n.add(a.id); else n.delete(a.id); setPicked(n); }} /></td>
              <td className="p-2 font-mono text-xs">{a.application_no}<div className="font-sans text-slate-400">{a.source.replace("_", " ")}</div></td><td className="p-2 font-medium">{a.first_name} {a.last_name}</td><td className="p-2">{a.applying_for}</td>
              <td className="p-2">{a.guardian_name}<div className="text-xs text-slate-500">{a.guardian_phone}</div></td>
              <td className="p-2 text-xs text-slate-600">{a.application_documents.length} docs · fee {a.fee_paid ? "✓" : "✗"}{a.assessment_score !== null ? ` · test ${a.assessment_score}` : ""}{a.interview_score !== null ? ` · interview ${a.interview_score}` : ""}</td>
              <td className="p-2"><Badge tone={statusTone(a.status)}>{a.status}{a.status === "waitlisted" && a.waitlist_position ? ` #${a.waitlist_position}` : ""}</Badge></td>
              <td className="p-2 text-xs">{fmtDate(a.created_at)}</td></tr>))}</tbody></table></div>
      )}
      {admin && data && <AdmissionSettings data={data} reload={reload} />}
      <Modal open={Boolean(open)} onClose={() => setOpen(null)} title={open ? `${open.first_name} ${open.last_name} · ${open.application_no}` : ""} wide>
        {open && data && <AppDetail app={open} data={data} currency={currency} onChanged={reload} onOpenLead={onOpenLead} />}
      </Modal>
      <Modal open={walkIn} onClose={() => setWalkIn(false)} title="Walk-in application" wide><WalkIn onDone={() => { setWalkIn(false); reload(); }} /></Modal>
      <Modal open={assign} onClose={() => setAssign(false)} title="Send an online entrance test">
        {assign && data && <AssignEntrance exams={data.exams} ids={[...picked]} onDone={text => { setAssign(false); setPicked(new Set()); setMsg({ ok: true, text }); reload(); }} />}
      </Modal>
    </div>
  );
}

function AssignEntrance({ exams, ids, onDone }: { exams: AppsData["exams"]; ids: string[]; onDone: (text: string) => void }) {
  const [f, setF] = useState({ exam_id: exams[0]?.id ?? "", opens: "", closes: "" });
  const [err, setErr] = useState<string | null>(null);
  if (!exams.length) return <Empty>Create the entrance test under Secure exams first (any exam can be used; its questions, timing and marking apply).</Empty>;
  return (
    <form className="space-y-3" onSubmit={async e => {
      e.preventDefault();
      const r = await send<{ assigned: number; messages_queued: number }>("/api/admissions", { action: "assign_entrance", ids, exam_id: f.exam_id, opens_at: f.opens ? new Date(f.opens).toISOString() : null, closes_at: f.closes ? new Date(f.closes).toISOString() : null });
      if (!r.ok) return setErr(r.error);
      onDone(`Entrance test sent to ${r.data.assigned} families (${r.data.messages_queued} messages).`);
    }}>
      <Field label="Test"><select className="input" value={f.exam_id} onChange={e => setF({ ...f, exam_id: e.target.value })}>{exams.map(x => <option key={x.id} value={x.id}>{x.title} ({x.duration_minutes} min)</option>)}</select></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Opens (optional)"><input className="input" type="datetime-local" value={f.opens} onChange={e => setF({ ...f, opens: e.target.value })} /></Field>
        <Field label="Closes (optional)"><input className="input" type="datetime-local" value={f.closes} onChange={e => setF({ ...f, closes: e.target.value })} /></Field>
      </div>
      <p className="text-xs text-slate-500">Each family gets a private link by WhatsApp and email. The child takes the test without an account; the score lands on the application.</p>
      {err && <Alert>{err}</Alert>}
      <div className="flex justify-end"><button className="btn btn-primary">Send the test</button></div>
    </form>
  );
}

function AppDetail({ app, data, currency, onChanged, onOpenLead }: { app: App; data: AppsData; currency: string; onChanged: () => void; onOpenLead: (id: string) => void }) {
  const { data: structure } = useApi<{ class_groups: { id: string; name: string }[]; staff: { id: string; full_name: string }[] }>("/api/school/structure");
  const toLocal = (v: string | null) => (v ? new Date(new Date(v).getTime() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : "");
  const [f, setF] = useState({ status: app.status, note: "", assessment_at: toLocal(app.assessment_at), score: app.assessment_score?.toString() ?? "", admission_no: "", class_group_id: "",
    interview_at: toLocal(app.interview_at), interviewer_id: "", interview_notes: app.interview_notes ?? "", interview_score: app.interview_score?.toString() ?? "",
    offer_fee: String(app.acceptance_fee || data.settings.acceptance_fee || 0), offer_expires: "", offer_note: "", waitlist: app.waitlist_position?.toString() ?? "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v });
  const act = async (body: Record<string, unknown>, ok: string) => {
    const r = await send<any>("/api/admissions", { id: app.id, ...body });
    setMsg({ ok: r.ok, text: r.ok ? ok + (r.data?.offer_link ? ` Offer link: ${r.data.offer_link}` : "") : r.error ?? "failed" });
    if (r.ok) onChanged();
    return r;
  };
  const fee = Number(data.settings.application_fee ?? 0);
  const trackLink = typeof window !== "undefined" ? `${window.location.origin}/apply/track/${app.tracking_token}` : "";
  const closed = ["enrolled", "rejected", "withdrawn", "declined", "expired"].includes(app.status);
  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center gap-2"><Badge tone={statusTone(app.status)}>{app.status}</Badge>
        {app.lead_id && <button className="text-xs text-brand-700 hover:underline" onClick={() => onOpenLead(app.lead_id!)}>Open the family&apos;s enquiry and timeline</button>}
        <button className="ml-auto text-xs text-brand-700 hover:underline" onClick={() => { navigator.clipboard?.writeText(trackLink); setMsg({ ok: true, text: "Family's application link copied." }); }}>Copy the family&apos;s link</button></div>
      <div className="grid gap-2 sm:grid-cols-2">
        <p><b>Applying for:</b> {app.applying_for}</p><p><b>Date of birth:</b> {app.date_of_birth ? fmtDate(app.date_of_birth) : "—"}</p>
        <p><b>Previous school:</b> {app.previous_school ?? "—"}</p><p><b>Parent:</b> {app.guardian_name} · {app.guardian_phone} · {app.guardian_email ?? "no email"}</p>
        <p><b>Application fee:</b> {fee ? `${money(fee, currency)} ` : "none "}{fee > 0 && <Badge tone={app.fee_paid ? "green" : "amber"}>{app.fee_paid ? "paid" : "unpaid"}</Badge>}
          {fee > 0 && <button className="ml-2 text-xs text-brand-700 hover:underline" onClick={() => act({ action: "fee", fee_paid: !app.fee_paid, fee_reference: app.fee_paid ? null : prompt("Payment reference (teller, transfer id)") }, "Fee status updated.")}>{app.fee_paid ? "mark unpaid" : "mark paid"}</button>}</p>
        {app.notes && <p className="sm:col-span-2"><b>Notes from the family:</b> {app.notes}</p>}
      </div>
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      {data.ai && <ApplicantSummaryPanel key={app.id} appId={app.id} saved={app.ai_summary ?? null} onChanged={onChanged} />}

      <section className="rounded-lg border border-slate-200 p-3">
        <h3 className="mb-2 font-semibold">Documents</h3>
        {!app.application_documents.length ? <p className="text-slate-500">None uploaded yet. The family uploads them from their application link.</p> : (
          <ul className="space-y-1">{app.application_documents.map(d => (
            <li key={d.id} className="flex items-center gap-2"><Badge>{d.kind.replace("_", " ")}</Badge><span className="flex-1 truncate">{d.name}</span><span className="text-xs text-slate-500">{Math.round(d.size / 1024)} KB · {fmtDate(d.uploaded_at)}</span>
              <button className="btn btn-ghost px-2 py-1 text-xs" onClick={async () => { const r = await send<{ url: string }>("/api/admissions", { action: "document_url", doc_id: d.id }); if (r.ok) window.open(r.data.url, "_blank", "noopener"); else setMsg({ ok: false, text: r.error ?? "failed" }); }}>Open</button></li>
          ))}</ul>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 p-3">
        <h3 className="mb-2 font-semibold">Assessment and interview</h3>
        {app.entrance_attempts.map(e => <p key={e.id} className="mb-1">Online test <b>{e.exams?.title}</b>: {e.status === "assigned" ? "sent, not started" : e.status === "in_progress" ? "in progress" : `${e.total_score}/${e.max_score}${e.status === "submitted" ? " so far; some answers need marking by hand, so enter the final score below" : ""}`}</p>)}
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Assessment score (%)"><input className="input w-28" type="number" min={0} value={f.score} onChange={e => set("score", e.target.value)} /></Field>
          <button className="btn btn-outline" onClick={() => act({ action: "score", assessment_score: Number(f.score) }, "Score saved.")}>Save score</button>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <Field label="Interview"><input className="input" type="datetime-local" value={f.interview_at} onChange={e => set("interview_at", e.target.value)} /></Field>
          <Field label="Interviewer"><select className="input" value={f.interviewer_id} onChange={e => set("interviewer_id", e.target.value)}><option value="">—</option>{(structure?.staff ?? []).map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select></Field>
          <Field label="Interview score (0–100)"><input className="input" type="number" min={0} max={100} value={f.interview_score} onChange={e => set("interview_score", e.target.value)} /></Field>
          <div className="sm:col-span-3"><Field label="Interview notes"><textarea className="input h-16" value={f.interview_notes} onChange={e => set("interview_notes", e.target.value)} /></Field></div>
        </div>
        <button className="btn btn-outline mt-1" onClick={() => act({ action: "interview", interview_at: f.interview_at ? new Date(f.interview_at).toISOString() : null, interviewer_id: f.interviewer_id || null,
          interview_notes: f.interview_notes || null, interview_score: f.interview_score === "" ? null : Number(f.interview_score) }, "Interview saved.")}>Save interview</button>
      </section>

      {!closed && (
        <section className="rounded-lg border border-slate-200 p-3">
          <h3 className="mb-2 font-semibold">Status</h3>
          <div className="grid gap-2 sm:grid-cols-3">
            <Field label="Status"><select className="input" value={f.status} onChange={e => set("status", e.target.value)}>{STATUSES.filter(s => !["enrolled", "offered", "accepted", "expired", "declined"].includes(s)).map(s => <option key={s}>{s}</option>)}</select></Field>
            {f.status === "assessment" && <Field label="Assessment date"><input className="input" type="datetime-local" value={f.assessment_at} onChange={e => set("assessment_at", e.target.value)} /></Field>}
            <div className="sm:col-span-3"><Field label="Message to the family (optional)" hint={f.status === "waitlisted" ? "The school's waiting-list letter is sent." : f.status === "rejected" ? "The school's regret letter is sent." : undefined}>
              <input className="input" value={f.note} onChange={e => set("note", e.target.value)} placeholder="e.g. Please bring the birth certificate and last report card" /></Field></div>
          </div>
          <button className="btn btn-primary mt-2" onClick={() => act({ action: "status", status: f.status, note: f.note || null, assessment_at: f.assessment_at ? new Date(f.assessment_at).toISOString() : undefined }, "Updated; the family has been told.")}>Save and tell the family</button>
          {app.status === "waitlisted" && (
            <div className="mt-3 flex items-end gap-2"><Field label="Waiting-list position"><input className="input w-24" type="number" min={1} value={f.waitlist} onChange={e => set("waitlist", e.target.value)} /></Field>
              <button className="btn btn-outline" onClick={() => act({ action: "waitlist", position: f.waitlist ? Number(f.waitlist) : null }, "Position saved.")}>Save</button></div>
          )}
        </section>
      )}

      {!closed && app.status !== "accepted" && (
        <section className="rounded-lg border border-amber-300 bg-amber-50 p-3">
          <h3 className="mb-2 font-semibold">{app.status === "offered" ? "Offer sent" : "Make an offer"}</h3>
          {app.status === "offered" && app.offer_letter && <p className="mb-2">Sent; expires {app.offer_expires_on ? fmtDate(app.offer_expires_on) : "—"}. <a className="text-brand-700 underline" href={`/apply/track/${app.tracking_token}/offer`} target="_blank" rel="noreferrer">View the letter</a>. Re-sending replaces it.</p>}
          <div className="grid gap-2 sm:grid-cols-3">
            <Field label={`Acceptance fee (${currency})`}><input className="input" type="number" min={0} value={f.offer_fee} onChange={e => set("offer_fee", e.target.value)} /></Field>
            <Field label="Accept by" hint={`Default: ${data.settings.offer_valid_days ?? 14} days`}><input className="input" type="date" value={f.offer_expires} onChange={e => set("offer_expires", e.target.value)} /></Field>
            <Field label="Extra line (optional)"><input className="input" value={f.offer_note} onChange={e => set("offer_note", e.target.value)} /></Field>
          </div>
          <button className="btn btn-primary mt-2" onClick={async () => {
            const body = { action: "offer", acceptance_fee: Number(f.offer_fee || 0), expires_on: f.offer_expires || null, note: f.offer_note || null };
            const r = await act(body, "Offer letter sent to the family.");
            if (!r.ok && r.error?.includes("is full") && confirm(`${r.error}\n\nOffer anyway?`)) await act({ ...body, force: true }, "Offer letter sent to the family.");
          }}>{app.status === "offered" ? "Re-send offer" : "Send offer letter"}</button>
          <p className="mt-1 text-xs text-slate-600">The letter comes from your template (Setup), with the child&apos;s details filled in. The family signs it online{Number(f.offer_fee) > 0 ? " and pays the acceptance fee" : ""}.</p>
        </section>
      )}

      {["accepted", "offered"].includes(app.status) && (
        <section className="rounded-lg border border-emerald-300 bg-emerald-50 p-3">
          <h3 className="mb-2 font-semibold">Enrol</h3>
          {app.offer_accepted_at && <p className="mb-1">Offer signed by <b>{app.offer_signer_name}</b> on {fmtDate(app.offer_accepted_at, true)}.</p>}
          {Number(app.acceptance_fee) > 0 && <p className="mb-2">Acceptance fee {money(app.acceptance_fee, currency)}: <Badge tone={app.acceptance_paid ? "green" : "amber"}>{app.acceptance_paid ? "paid" : "unpaid"}</Badge>
            <button className="ml-2 text-xs text-brand-700 hover:underline" onClick={() => act({ action: "acceptance_paid", paid: !app.acceptance_paid }, "Updated.")}>{app.acceptance_paid ? "mark unpaid" : "mark paid"}</button></p>}
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Admission number"><input className="input" value={f.admission_no} onChange={e => set("admission_no", e.target.value)} /></Field>
            <Field label="Class"><select className="input" value={f.class_group_id} onChange={e => set("class_group_id", e.target.value)}><option value="">—</option>{(structure?.class_groups ?? []).map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>
            <button className="btn btn-primary" disabled={!f.admission_no} onClick={() => {
              if (Number(app.acceptance_fee) > 0 && !app.acceptance_paid && !confirm("The acceptance fee is not paid. Enrol anyway?")) return;
              act({ action: "enroll", admission_no: f.admission_no, class_group_id: f.class_group_id || null }, "Enrolled. The student and parent records have been created.");
            }}>Enrol student</button>
          </div>
          <p className="mt-1 text-xs text-slate-600">Creates the student record and links the parent (reusing an existing parent record for siblings). Documents stay on the application, linked to the student.</p>
        </section>
      )}
      {app.student_id && <a className="btn btn-outline" href={`/school/students/${app.student_id}`}>Open student record</a>}
    </div>
  );
}

function WalkIn({ onDone }: { onDone: () => void }) {
  const blank = { first_name: "", last_name: "", gender: "", date_of_birth: "", applying_for: "", guardian_name: "", guardian_phone: "", guardian_email: "", previous_school: "", source: "walk_in" };
  const [f, setF] = useState(blank);
  const [err, setErr] = useState<string | null>(null);
  const bind = (k: keyof typeof blank) => ({ value: f[k], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value }) });
  return (
    <form className="grid gap-3 sm:grid-cols-3" onSubmit={async e => {
      e.preventDefault();
      const r = await send("/api/admissions", { action: "walk_in", ...f, gender: f.gender || null, date_of_birth: f.date_of_birth || null, guardian_email: f.guardian_email || null, previous_school: f.previous_school || null });
      if (!r.ok) return setErr(r.error);
      onDone();
    }}>
      <Field label="Child's first name"><input className="input" required {...bind("first_name")} /></Field>
      <Field label="Last name"><input className="input" required {...bind("last_name")} /></Field>
      <Field label="Gender"><select className="input" {...bind("gender")}><option value="">—</option><option value="female">Female</option><option value="male">Male</option></select></Field>
      <Field label="Date of birth"><input className="input" type="date" {...bind("date_of_birth")} /></Field>
      <Field label="Applying for (class)"><input className="input" required {...bind("applying_for")} placeholder="JSS1" /></Field>
      <Field label="Previous school"><input className="input" {...bind("previous_school")} /></Field>
      <Field label="Parent name"><input className="input" required {...bind("guardian_name")} /></Field>
      <Field label="Parent phone / WhatsApp"><input className="input" required {...bind("guardian_phone")} /></Field>
      <Field label="Parent email"><input className="input" type="email" {...bind("guardian_email")} /></Field>
      <Field label="Source"><select className="input" {...bind("source")}><option value="walk_in">Walk-in</option><option value="phone">Phone call</option><option value="referral">Referral</option><option value="agent">Agent</option></select></Field>
      {err && <div className="sm:col-span-3"><Alert>{err}</Alert></div>}
      <div className="flex justify-end sm:col-span-3"><button className="btn btn-primary">Create application</button></div>
    </form>
  );
}

function AdmissionSettings({ data, reload }: { data: AppsData; reload: () => void }) {
  const s = data.settings;
  const [f, setF] = useState({ admissions_open: Boolean(s.admissions_open), application_fee: String(s.application_fee ?? 0), admissions_intro: s.admissions_intro ?? "", public_slug: s.public_slug ?? "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [show, setShow] = useState(false);
  if (!show) return <button className="btn btn-ghost text-xs" onClick={() => setShow(true)}>Application form settings</button>;
  return (
    <form className="card max-w-2xl space-y-3 p-5" onSubmit={async e => {
      e.preventDefault();
      const r = await send("/api/admissions", { action: "settings", admissions_open: f.admissions_open, application_fee: Number(f.application_fee || 0), admissions_intro: f.admissions_intro || null, public_slug: f.public_slug || null });
      setMsg({ ok: r.ok, text: r.ok ? `Saved.${r.data.apply_url ? ` Your admissions page: ${r.data.apply_url}` : ""}` : r.error ?? "failed" }); if (r.ok) reload();
    }}>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.admissions_open} onChange={e => setF({ ...f, admissions_open: e.target.checked })} /> Applications are open (the application form is public only while this is on; enquiries and visit booking always work)</label>
      <Field label="Web address" hint="Lowercase letters, numbers and dashes, e.g. green-hills-academy"><input className="input" value={f.public_slug} onChange={e => setF({ ...f, public_slug: e.target.value.toLowerCase() })} /></Field>
      <Field label="Application fee (0 = free)" hint="Paid online from the family's application page when online payment is set up, or marked paid here."><input className="input" type="number" min={0} value={f.application_fee} onChange={e => setF({ ...f, application_fee: e.target.value })} /></Field>
      <Field label="Welcome text on the application form"><textarea className="input h-28" value={f.admissions_intro} onChange={e => setF({ ...f, admissions_intro: e.target.value })} /></Field>
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      <div className="flex gap-2"><button className="btn btn-primary">Save</button><button type="button" className="btn btn-ghost" onClick={() => setShow(false)}>Close</button></div>
    </form>
  );
}
