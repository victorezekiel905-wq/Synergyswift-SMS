"use client";
import { useState } from "react";
import { useApi, send, Alert, Empty, Modal, Field, Badge, fmtDate, localDate } from "@/components/ui";
import { ChecklistCard, type Checklist } from "@/components/hr/Checklists";

type Personal = Record<string, string | null>;
type Doc = { id: string; kind: string; title: string; mime: string | null; size_bytes: number | null; visible_to_staff: boolean; created_at: string };
type Contract = { id: string; kind: string; position: string | null; starts_on: string; ends_on: string | null; probation_ends_on: string | null; notice_days: number | null; salary_note: string | null; notes: string | null; document_id: string | null; status: string; accepted_at: string | null };
type Qual = { id: string; kind: string; title: string; institution: string | null; awarded_on: string | null; expires_on: string | null; reference_no: string | null; document_id: string | null; verified_at: string | null };
type Balance = { leave_type: string; paid: boolean; entitlement: number | null; carried: number; taken: number; pending: number; remaining: number | null };
type Profile = { staff: { id: string; staff_no: string; full_name: string; email: string | null; phone: string | null; department: string | null; position: string | null; employment_type: string; hire_date: string | null;
    status: string; user_id: string | null; line_manager_id: string | null; probation_ends_on: string | null; exit_date: string | null; exit_reason: string | null; manager: { full_name: string } | null };
  personal: Personal | null; documents: Doc[]; contracts: Contract[]; qualifications: Qual[]; checklists: Checklist[]; balances: Balance[]; gaps: string[];
  can_edit: boolean; is_self: boolean; is_admin: boolean };

const DOC_KINDS: Record<string, string> = { cv: "CV", id: "ID", offer_letter: "Offer letter", contract: "Contract", certificate: "Certificate", reference: "Reference", medical: "Medical", appraisal: "Appraisal", exit: "Exit", other: "Other" };
const SELF_KINDS = ["cv", "id", "certificate", "medical", "other"];
const CONTRACT_KINDS: Record<string, string> = { permanent: "Permanent", fixed_term: "Fixed term", probation: "Probation", part_time: "Part time", consultancy: "Consultancy", internship: "Internship" };
const QUAL_KINDS: Record<string, string> = { degree: "Degree", diploma: "Diploma", certificate: "Certificate", professional: "Professional", licence: "Licence (e.g. TRCN)", other: "Other" };

/** A staff member's HR record: personal and statutory details, documents, contracts, qualifications, leave balances and checklists. */
export function StaffRecord({ staffId }: { staffId?: string }) {
  const { data, error, reload } = useApi<Profile>(`/api/hr/people?view=profile${staffId ? `&staff=${staffId}` : ""}`, [staffId]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (error) return <Alert tone="amber">{error}</Alert>;
  if (!data) return null;
  const s = data.staff, editPersonal = data.can_edit || data.is_self;
  const done = (r: { ok: boolean; error: string | null }, text: string) => { setMsg({ ok: r.ok, text: r.ok ? text : r.error ?? "Failed" }); if (r.ok) reload(); };
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="mr-auto">
          <h2 className="text-lg font-semibold">{s.full_name} <span className="text-sm font-normal text-slate-500">{s.staff_no}</span></h2>
          <p className="text-sm text-slate-600">{[s.position, s.department].filter(Boolean).join(", ")}{s.manager ? ` · reports to ${s.manager.full_name}` : ""}{s.hire_date ? ` · since ${fmtDate(s.hire_date)}` : ""}</p>
          {s.probation_ends_on && <p className="text-sm text-amber-700">On probation until {fmtDate(s.probation_ends_on)}</p>}
          {s.status === "exited" && <p className="text-sm text-rose-700">Left {fmtDate(s.exit_date)}{s.exit_reason ? `: ${s.exit_reason}` : ""}</p>}
        </div>
        {data.can_edit && !data.is_self && <HrActions profile={data} onDone={done} />}
      </div>
      {data.gaps.length > 0 && <Alert tone="amber">Missing from this record: {data.gaps.join(", ")}.</Alert>}
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}

      <section className="card p-4">
        <h3 className="mb-2 font-semibold">Leave this year</h3>
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-1">Type</th><th className="py-1 text-right">Allowed</th><th className="py-1 text-right">Carried in</th><th className="py-1 text-right">Taken</th><th className="py-1 text-right">Waiting</th><th className="py-1 text-right">Left</th></tr></thead>
          <tbody>{data.balances.filter(b => b.taken || b.pending || ["annual", "sick"].includes(b.leave_type)).map(b => (
            <tr key={b.leave_type} className="border-t border-slate-100"><td className="py-1 capitalize">{b.leave_type}{!b.paid && <span className="text-xs text-slate-500"> (unpaid)</span>}</td>
              <td className="py-1 text-right tabular-nums">{b.entitlement ?? "—"}</td><td className="py-1 text-right tabular-nums">{b.carried || ""}</td><td className="py-1 text-right tabular-nums">{b.taken}</td>
              <td className="py-1 text-right tabular-nums">{b.pending || ""}</td><td className="py-1 text-right font-semibold tabular-nums">{b.remaining ?? "—"}</td></tr>))}</tbody></table></div>
      </section>

      {data.checklists.filter(c => !c.completed_at).map(c => <ChecklistCard key={c.id} list={{ ...c, staff_name: s.full_name }} canManage={data.can_edit} onChange={reload} selfStaff={data.is_self} />)}

      <PersonalDetails personal={data.personal} staffId={s.id} editable={editPersonal} onSaved={() => { setMsg({ ok: true, text: "Details saved." }); reload(); }} />
      <Documents docs={data.documents} staffId={s.id} hr={data.can_edit} isSelf={data.is_self} onChange={reload} />
      <Contracts list={data.contracts} docs={data.documents} staffId={s.id} hr={data.can_edit} isSelf={data.is_self} onChange={reload} />
      <Qualifications list={data.qualifications} docs={data.documents} staffId={s.id} hr={data.can_edit} isSelf={data.is_self} onChange={reload} />
    </div>
  );
}

function HrActions({ profile, onDone }: { profile: Profile; onDone: (r: { ok: boolean; error: string | null }, text: string) => void }) {
  const s = profile.staff;
  const [off, setOff] = useState(false);
  const [f, setF] = useState({ exit_date: localDate(), exit_reason: "Resigned", disable_login: profile.is_admin });
  const openOn = profile.checklists.some(c => c.kind === "onboarding" && !c.completed_at), openOff = profile.checklists.some(c => c.kind === "offboarding" && !c.completed_at);
  return (
    <div className="flex flex-wrap gap-2">
      {s.probation_ends_on && <>
        <button className="btn btn-outline" onClick={async () => { if (confirm(`Confirm ${s.full_name} in post?`)) onDone(await send("/api/hr/people", { action: "probation", staff_id: s.id, outcome: "confirmed" }), "Confirmed in post."); }}>Confirm in post</button>
        <button className="btn btn-ghost" onClick={async () => { const d = prompt("Extend probation to (YYYY-MM-DD)"); if (d) onDone(await send("/api/hr/people", { action: "probation", staff_id: s.id, outcome: "extended", until: d }), "Probation extended."); }}>Extend probation</button>
      </>}
      {s.status !== "exited" && !openOn && <button className="btn btn-ghost" onClick={async () => onDone(await send("/api/hr/people", { action: "start_checklist", staff_id: s.id, kind: "onboarding" }), "Onboarding started.")}>Start onboarding</button>}
      {s.status !== "exited" && !openOff && <button className="btn btn-ghost" onClick={async () => { if (confirm(`Start offboarding for ${s.full_name}?`)) onDone(await send("/api/hr/people", { action: "start_checklist", staff_id: s.id, kind: "offboarding" }), "Offboarding started."); }}>Start offboarding</button>}
      {s.status !== "exited" && <button className="btn btn-ghost text-rose-700" onClick={() => setOff(true)}>Record leaving</button>}
      <Modal open={off} onClose={() => setOff(false)} title={`${s.full_name} is leaving`}>
        <form className="space-y-3" onSubmit={async e => { e.preventDefault(); const r = await send("/api/hr/people", { action: "finish_offboarding", staff_id: s.id, ...f }); if (r.ok) setOff(false); onDone(r, "Recorded as left."); }}>
          {openOff && <Alert tone="amber">The offboarding checklist is not finished yet.</Alert>}
          <Field label="Last day"><input className="input" type="date" required value={f.exit_date} onChange={e => setF({ ...f, exit_date: e.target.value })} /></Field>
          <Field label="Reason"><input className="input" list="exit-reasons" required value={f.exit_reason} onChange={e => setF({ ...f, exit_reason: e.target.value })} /></Field>
          <datalist id="exit-reasons">{["Resigned", "Contract ended", "Retired", "Dismissed", "Redundancy", "Relocated", "Deceased"].map(r => <option key={r} value={r} />)}</datalist>
          {s.user_id && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.disable_login} disabled={!profile.is_admin} onChange={e => setF({ ...f, disable_login: e.target.checked })} />Disable their login{!profile.is_admin && " (an admin does this)"}</label>}
          <p className="text-xs text-slate-500">Their active contract ends on this date and they drop out of payroll from the next run.</p>
          <button className="btn btn-primary w-full">Save</button>
        </form>
      </Modal>
    </div>
  );
}

const PFIELDS: [string, string, string?][] = [
  ["date_of_birth", "Date of birth", "date"], ["gender", "Gender"], ["marital_status", "Marital status"], ["nationality", "Nationality"], ["state_of_origin", "State of origin"],
  ["address", "Home address"], ["nin", "NIN (11 digits)"], ["tin", "Tax ID (TIN)"], ["pfa_name", "Pension fund administrator"], ["rsa_pin", "RSA PIN (PEN…)"], ["nhf_number", "NHF number"],
  ["next_of_kin_name", "Next of kin"], ["next_of_kin_relation", "Relationship"], ["next_of_kin_phone", "Next of kin phone", "tel"],
  ["emergency_contact_name", "Emergency contact"], ["emergency_contact_phone", "Emergency phone", "tel"], ["medical_notes", "Medical notes (allergies, conditions)"]
];

function PersonalDetails({ personal, staffId, editable, onSaved }: { personal: Personal | null; staffId: string; editable: boolean; onSaved: () => void }) {
  const [edit, setEdit] = useState<Personal | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const p = personal ?? {};
  return (
    <section className="card p-4">
      <div className="mb-2 flex items-center"><h3 className="mr-auto font-semibold">Personal and statutory details</h3>{editable && <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setEdit({ ...p })}>Edit</button>}</div>
      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
        {PFIELDS.map(([k, label]) => <div key={k} className="flex justify-between gap-2 border-b border-slate-50 py-0.5"><dt className="text-slate-500">{label.replace(/ \(.*\)$/, "")}</dt><dd className="text-right">{k === "date_of_birth" ? fmtDate(p[k]) : p[k] || "—"}</dd></div>)}
      </dl>
      <Modal open={Boolean(edit)} onClose={() => { setEdit(null); setErr(null); }} title="Personal and statutory details" wide>
        {edit && <form className="grid gap-3 sm:grid-cols-3" onSubmit={async e => {
          e.preventDefault();
          const body: Record<string, unknown> = { action: "save_personal", staff_id: staffId };
          for (const [k] of PFIELDS) body[k] = edit[k] || null;
          const r = await send("/api/hr/people", body);
          if (!r.ok) return setErr(r.error);
          setEdit(null); setErr(null); onSaved();
        }}>
          {PFIELDS.map(([k, label, type]) => (
            <div key={k} className={k === "address" || k === "medical_notes" ? "sm:col-span-3" : ""}>
              <Field label={label}>{k === "gender" ? (
                <select className="input" value={edit[k] ?? ""} onChange={e => setEdit({ ...edit, [k]: e.target.value })}><option value="">—</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option></select>
              ) : <input className="input" type={type ?? "text"} value={edit[k] ?? ""} onChange={e => setEdit({ ...edit, [k]: e.target.value })}
                  {...(k === "nin" ? { inputMode: "numeric" as const, pattern: "\\d{11}" } : k === "rsa_pin" ? { pattern: "[Pp][Ee][Nn]\\d{12}" } : {})} />}</Field>
            </div>))}
          <p className="text-xs text-slate-500 sm:col-span-3">Only you and HR can see these details. Pension, tax and NHF numbers are used for payroll remittances.</p>
          {err && <div className="sm:col-span-3"><Alert>{err}</Alert></div>}
          <button className="btn btn-primary sm:col-span-3">Save</button>
        </form>}
      </Modal>
    </section>
  );
}

function Documents({ docs, staffId, hr, isSelf, onChange }: { docs: Doc[]; staffId: string; hr: boolean; isSelf: boolean; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const kinds = hr ? Object.keys(DOC_KINDS) : SELF_KINDS;
  return (
    <section className="card p-4">
      <div className="mb-2 flex items-center"><h3 className="mr-auto font-semibold">Documents</h3>{(hr || isSelf) && <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setOpen(true)}>+ Upload</button>}</div>
      {!docs.length ? <Empty>No documents.</Empty> : (
        <ul className="divide-y divide-slate-100 text-sm">{docs.map(d => (
          <li key={d.id} className="flex flex-wrap items-center gap-2 py-1.5">
            <Badge>{DOC_KINDS[d.kind] ?? d.kind}</Badge><a className="text-brand-700 underline" href={`/api/hr/documents?id=${d.id}`} target="_blank" rel="noreferrer">{d.title}</a>
            <span className="text-xs text-slate-400">{fmtDate(d.created_at)}{d.size_bytes ? ` · ${Math.ceil(d.size_bytes / 1024)} KB` : ""}</span>
            {hr && !d.visible_to_staff && <Badge tone="amber">HR only</Badge>}
            {hr && <span className="ml-auto flex gap-1">
              <button className="text-xs text-slate-500" onClick={async () => { await send("/api/hr/people", { action: "document_visibility", id: d.id, visible: !d.visible_to_staff }); onChange(); }}>{d.visible_to_staff ? "Hide from staff" : "Show to staff"}</button>
              <button className="text-xs text-rose-600" onClick={async () => { if (confirm("Delete this document?")) { await send("/api/hr/people", { action: "delete_document", id: d.id }); onChange(); } }}>Delete</button></span>}
          </li>))}</ul>
      )}
      <Modal open={open} onClose={() => { setOpen(false); setErr(null); }} title="Upload a document">
        <form className="space-y-3" onSubmit={async e => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          fd.set("staff_id", staffId);
          const r = await fetch("/api/hr/documents", { method: "POST", body: fd });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) return setErr(j.error ?? "Upload failed");
          setOpen(false); setErr(null); onChange();
        }}>
          <Field label="Kind"><select className="input" name="kind">{kinds.map(k => <option key={k} value={k}>{DOC_KINDS[k]}</option>)}</select></Field>
          <Field label="Title"><input className="input" name="title" maxLength={160} placeholder="e.g. B.Ed certificate" /></Field>
          <Field label="File (PDF, Word or image, up to 10 MB)"><input className="input" type="file" name="file" required accept="application/pdf,image/jpeg,image/png,image/webp,application/vnd.openxmlformats-officedocument.wordprocessingml.document" /></Field>
          {hr && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="visible_to_staff" value="false" />Keep from the staff member (e.g. references)</label>}
          {err && <Alert>{err}</Alert>}
          <button className="btn btn-primary w-full">Upload</button>
        </form>
      </Modal>
    </section>
  );
}

function Contracts({ list, docs, staffId, hr, isSelf, onChange }: { list: Contract[]; docs: Doc[]; staffId: string; hr: boolean; isSelf: boolean; onChange: () => void }) {
  const [edit, setEdit] = useState<Partial<Contract> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (!hr && !list.length) return null;
  return (
    <section className="card p-4">
      <div className="mb-2 flex items-center"><h3 className="mr-auto font-semibold">Contracts</h3>{hr && <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setEdit({ kind: "permanent", starts_on: localDate(), status: "active" })}>+ Contract</button>}</div>
      {!list.length ? <Empty>No contract on file.</Empty> : (
        <ul className="divide-y divide-slate-100 text-sm">{list.map(c => (
          <li key={c.id} className="flex flex-wrap items-center gap-2 py-2">
            <Badge tone={c.status === "active" ? "green" : c.status === "draft" ? "amber" : "slate"}>{c.status}</Badge>
            <span className="font-medium">{CONTRACT_KINDS[c.kind]}</span>{c.position && <span>· {c.position}</span>}
            <span className="text-slate-500">{fmtDate(c.starts_on)} – {c.ends_on ? fmtDate(c.ends_on) : "open-ended"}</span>
            {c.notice_days != null && <span className="text-xs text-slate-500">{c.notice_days} days’ notice</span>}
            {c.document_id && <a className="text-xs text-brand-700 underline" href={`/api/hr/documents?id=${c.document_id}`} target="_blank" rel="noreferrer">document</a>}
            {c.accepted_at ? <span className="text-xs text-emerald-700">accepted {fmtDate(c.accepted_at)}</span> : c.status === "active" && <span className="text-xs text-amber-700">not yet accepted</span>}
            <span className="ml-auto flex gap-1">
              {isSelf && c.status === "active" && !c.accepted_at && <button className="btn btn-primary px-2 py-1 text-xs" onClick={async () => { if (confirm("I have read this contract and accept it.")) { await send("/api/hr/people", { action: "accept_contract", id: c.id }); onChange(); } }}>Accept</button>}
              {hr && c.status === "active" && !c.accepted_at && <button className="btn btn-outline px-2 py-1 text-xs" onClick={async () => { const r = await send("/api/esign", { action: "from_contract", contract_id: c.id }); alert(r.ok ? "Sent for e-signature. It is marked accepted once signed." : r.error); }}>Send for e-signature</button>}
              {hr && <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setEdit(c)}>Edit</button>}
            </span>
          </li>))}</ul>
      )}
      <Modal open={Boolean(edit)} onClose={() => { setEdit(null); setErr(null); }} title={edit?.id ? "Edit contract" : "New contract"} wide>
        {edit && <form className="grid gap-3 sm:grid-cols-3" onSubmit={async e => {
          e.preventDefault();
          const r = await send("/api/hr/people", { action: "save_contract", id: edit.id, staff_id: staffId, kind: edit.kind, position: edit.position || null, starts_on: edit.starts_on, ends_on: edit.ends_on || null,
            probation_ends_on: edit.probation_ends_on || null, notice_days: edit.notice_days === null || edit.notice_days === undefined || (edit.notice_days as unknown) === "" ? null : Number(edit.notice_days),
            salary_note: edit.salary_note || null, notes: edit.notes || null, document_id: edit.document_id || null, status: edit.status });
          if (!r.ok) return setErr(r.error);
          setEdit(null); setErr(null); onChange();
        }}>
          <Field label="Kind"><select className="input" value={edit.kind} onChange={e => setEdit({ ...edit, kind: e.target.value })}>{Object.entries(CONTRACT_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Position"><input className="input" value={edit.position ?? ""} onChange={e => setEdit({ ...edit, position: e.target.value })} /></Field>
          <Field label="Status"><select className="input" value={edit.status} onChange={e => setEdit({ ...edit, status: e.target.value })}><option value="draft">Draft</option><option value="active">Active</option><option value="ended">Ended</option></select></Field>
          <Field label="Starts"><input className="input" type="date" required value={edit.starts_on ?? ""} onChange={e => setEdit({ ...edit, starts_on: e.target.value })} /></Field>
          <Field label="Ends (blank if open-ended)"><input className="input" type="date" value={edit.ends_on ?? ""} onChange={e => setEdit({ ...edit, ends_on: e.target.value })} /></Field>
          <Field label="Probation ends"><input className="input" type="date" value={edit.probation_ends_on ?? ""} onChange={e => setEdit({ ...edit, probation_ends_on: e.target.value })} /></Field>
          <Field label="Notice (days)"><input className="input" type="number" min={0} max={365} value={edit.notice_days ?? ""} onChange={e => setEdit({ ...edit, notice_days: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
          <Field label="Pay (summary)"><input className="input" maxLength={300} placeholder="e.g. Grade 7 step 2" value={edit.salary_note ?? ""} onChange={e => setEdit({ ...edit, salary_note: e.target.value })} /></Field>
          <Field label="Signed copy"><select className="input" value={edit.document_id ?? ""} onChange={e => setEdit({ ...edit, document_id: e.target.value || null })}><option value="">— upload under Documents first —</option>{docs.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}</select></Field>
          <div className="sm:col-span-3"><Field label="Notes"><textarea className="input" rows={2} maxLength={1000} value={edit.notes ?? ""} onChange={e => setEdit({ ...edit, notes: e.target.value })} /></Field></div>
          <p className="text-xs text-slate-500 sm:col-span-3">Saving an active contract ends any other active one and asks the staff member to accept it.</p>
          {err && <div className="sm:col-span-3"><Alert>{err}</Alert></div>}
          <button className="btn btn-primary sm:col-span-3">Save</button>
        </form>}
      </Modal>
    </section>
  );
}

function Qualifications({ list, docs, staffId, hr, isSelf, onChange }: { list: Qual[]; docs: Doc[]; staffId: string; hr: boolean; isSelf: boolean; onChange: () => void }) {
  const [edit, setEdit] = useState<Partial<Qual> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const today = localDate();
  return (
    <section className="card p-4">
      <div className="mb-2 flex items-center"><h3 className="mr-auto font-semibold">Qualifications and licences</h3>{(hr || isSelf) && <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setEdit({ kind: "degree" })}>+ Add</button>}</div>
      {!list.length ? <Empty>None recorded.</Empty> : (
        <ul className="divide-y divide-slate-100 text-sm">{list.map(q => (
          <li key={q.id} className="flex flex-wrap items-center gap-2 py-1.5">
            <span className="font-medium">{q.title}</span><span className="text-slate-500">{[QUAL_KINDS[q.kind], q.institution, q.awarded_on?.slice(0, 4), q.reference_no].filter(Boolean).join(" · ")}</span>
            {q.expires_on && <Badge tone={q.expires_on < today ? "red" : "slate"}>{q.expires_on < today ? "expired" : "expires"} {fmtDate(q.expires_on)}</Badge>}
            {q.verified_at ? <Badge tone="green">verified</Badge> : <Badge tone="amber">not verified</Badge>}
            {q.document_id && <a className="text-xs text-brand-700 underline" href={`/api/hr/documents?id=${q.document_id}`} target="_blank" rel="noreferrer">certificate</a>}
            <span className="ml-auto flex gap-1">
              {hr && <button className="btn btn-ghost px-2 py-1 text-xs" onClick={async () => { await send("/api/hr/people", { action: "verify_qualification", id: q.id, verified: !q.verified_at }); onChange(); }}>{q.verified_at ? "Unverify" : "Verify"}</button>}
              {(hr || !q.verified_at) && <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setEdit(q)}>Edit</button>}
              {(hr || !q.verified_at) && <button className="btn btn-ghost px-2 py-1 text-xs text-rose-600" onClick={async () => { if (confirm("Remove this qualification?")) { const r = await send("/api/hr/people", { action: "delete_qualification", id: q.id }); if (!r.ok) alert(r.error); onChange(); } }}>Remove</button>}
            </span>
          </li>))}</ul>
      )}
      <Modal open={Boolean(edit)} onClose={() => { setEdit(null); setErr(null); }} title={edit?.id ? "Edit qualification" : "Add a qualification"} wide>
        {edit && <form className="grid gap-3 sm:grid-cols-3" onSubmit={async e => {
          e.preventDefault();
          const r = await send("/api/hr/people", { action: "save_qualification", id: edit.id, staff_id: staffId, kind: edit.kind, title: edit.title, institution: edit.institution || null,
            awarded_on: edit.awarded_on || null, expires_on: edit.expires_on || null, reference_no: edit.reference_no || null, document_id: edit.document_id || null });
          if (!r.ok) return setErr(r.error);
          setEdit(null); setErr(null); onChange();
        }}>
          <Field label="Kind"><select className="input" value={edit.kind} onChange={e => setEdit({ ...edit, kind: e.target.value })}>{Object.entries(QUAL_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <div className="sm:col-span-2"><Field label="Title"><input className="input" required maxLength={160} placeholder="e.g. B.Ed Mathematics" value={edit.title ?? ""} onChange={e => setEdit({ ...edit, title: e.target.value })} /></Field></div>
          <Field label="Institution or body"><input className="input" value={edit.institution ?? ""} onChange={e => setEdit({ ...edit, institution: e.target.value })} /></Field>
          <Field label="Awarded"><input className="input" type="date" value={edit.awarded_on ?? ""} onChange={e => setEdit({ ...edit, awarded_on: e.target.value })} /></Field>
          <Field label="Expires (licences)"><input className="input" type="date" value={edit.expires_on ?? ""} onChange={e => setEdit({ ...edit, expires_on: e.target.value })} /></Field>
          <Field label="Registration number"><input className="input" placeholder="e.g. TRCN number" value={edit.reference_no ?? ""} onChange={e => setEdit({ ...edit, reference_no: e.target.value })} /></Field>
          <div className="sm:col-span-2"><Field label="Certificate"><select className="input" value={edit.document_id ?? ""} onChange={e => setEdit({ ...edit, document_id: e.target.value || null })}><option value="">— upload under Documents first —</option>{docs.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}</select></Field></div>
          {!hr && <p className="text-xs text-slate-500 sm:col-span-3">HR checks the certificate and marks it verified.</p>}
          {err && <div className="sm:col-span-3"><Alert>{err}</Alert></div>}
          <button className="btn btn-primary sm:col-span-3">Save</button>
        </form>}
      </Modal>
    </section>
  );
}
