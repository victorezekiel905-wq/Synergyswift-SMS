"use client";
import { useState } from "react";
import { useApi, send, Page, PageHeader, Tabs, Alert, Empty, Modal, Field, Badge, Stat, fmtDate, money, rolesOf, type Me } from "@/components/ui";

const STAGES = ["new", "reviewing", "assessment", "interview", "offered", "accepted", "enrolled", "rejected", "withdrawn"] as const;
type App = { id: string; application_no: string; status: string; first_name: string; last_name: string; gender: string | null; date_of_birth: string | null; applying_for: string;
  previous_school: string | null; guardian_name: string; guardian_phone: string; guardian_email: string | null; notes: string | null; source: string; assessment_at: string | null;
  assessment_score: number | null; interview_at: string | null; decision_note: string | null; fee_paid: boolean; created_at: string; student_id: string | null };
type Data = { applications: App[]; funnel: Record<string, number>; total: number; conversion: { offer_rate: number | null; yield: number | null };
  settings: { admissions_open?: boolean; application_fee?: number; admissions_intro?: string | null; currency?: string; public_slug: string | null } };

export default function AdmissionsPage() {
  const { data: me } = useApi<Me>("/api/me");
  const admin = ["school_admin", "principal", "platform_admin"].some(r => rolesOf(me).has(r));
  const [stage, setStage] = useState("");
  const { data, error, reload } = useApi<Data>(`/api/admissions${stage ? `?status=${stage}` : ""}`, [stage]);
  const [tab, setTab] = useState<"pipeline" | "settings">("pipeline");
  const [open, setOpen] = useState<App | null>(null);
  const [walkIn, setWalkIn] = useState(false);
  const applyUrl = data?.settings.public_slug && typeof window !== "undefined" ? `${window.location.origin}/apply/${data.settings.public_slug}` : null;
  return (
    <Page wide>
      <PageHeader eyebrow="Growth" title="Admissions"
        subtitle="Online applications from your own admissions page, a clear pipeline from enquiry to enrolment, automatic updates to families, and one-click enrolment."
        actions={<><button className="btn btn-ghost border border-slate-200" onClick={() => setWalkIn(true)}>+ Walk-in application</button><a className="btn btn-ghost" href="/api/admissions?format=csv">CSV</a></>} />
      {error && <Alert>{error}</Alert>}
      {data && (
        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5">
          <Stat label="Applications" value={data.total} /><Stat label="In progress" value={(data.funnel.new ?? 0) + (data.funnel.reviewing ?? 0) + (data.funnel.assessment ?? 0) + (data.funnel.interview ?? 0)} />
          <Stat label="Offers made" value={(data.funnel.offered ?? 0) + (data.funnel.accepted ?? 0) + (data.funnel.enrolled ?? 0)} /><Stat label="Enrolled" value={data.funnel.enrolled ?? 0} tone="good" />
          <Stat label="Yield (offer → enrolled)" value={data.conversion.yield === null ? "—" : `${data.conversion.yield}%`} />
        </div>
      )}
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "pipeline", label: "Pipeline" }, ...(admin ? [{ id: "settings" as const, label: "Admissions page" }] : [])]} />
      {tab === "pipeline" && (
        <>
          <div className="mb-3 flex flex-wrap gap-1.5">
            <button className={"btn px-3 py-1 text-xs " + (!stage ? "btn-primary" : "btn-ghost border border-slate-200")} onClick={() => setStage("")}>All</button>
            {STAGES.map(s => <button key={s} className={"btn px-3 py-1 text-xs " + (stage === s ? "btn-primary" : "btn-ghost border border-slate-200")} onClick={() => setStage(s)}>{s} ({data?.funnel[s] ?? 0})</button>)}
          </div>
          {!data?.applications.length ? <Empty>No applications here. {applyUrl ? "Share your admissions link to receive online applications." : ""}</Empty> : (
            <div className="card overflow-x-auto"><table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-2">Application</th><th className="p-2">Child</th><th className="p-2">For</th><th className="p-2">Parent</th><th className="p-2">Status</th><th className="p-2">Received</th></tr></thead>
              <tbody>{data.applications.map(a => (
                <tr key={a.id} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50" onClick={() => setOpen(a)}>
                  <td className="p-2 font-mono text-xs">{a.application_no}<div className="font-sans text-slate-400">{a.source.replace("_", " ")}</div></td><td className="p-2 font-medium">{a.first_name} {a.last_name}</td><td className="p-2">{a.applying_for}</td>
                  <td className="p-2">{a.guardian_name}<div className="text-xs text-slate-500">{a.guardian_phone}</div></td>
                  <td className="p-2"><Badge tone={a.status === "enrolled" ? "green" : a.status === "rejected" || a.status === "withdrawn" ? "red" : ["offered", "accepted"].includes(a.status) ? "blue" : "amber"}>{a.status}</Badge></td>
                  <td className="p-2 text-xs">{fmtDate(a.created_at)}</td></tr>))}</tbody></table></div>
          )}
        </>
      )}
      {tab === "settings" && data && <AdmissionSettings data={data} applyUrl={applyUrl} reload={reload} />}
      <Modal open={Boolean(open)} onClose={() => setOpen(null)} title={open ? `${open.first_name} ${open.last_name}` : ""} wide>{open && <AppDetail app={open} currency={data?.settings.currency ?? "NGN"} fee={Number(data?.settings.application_fee ?? 0)} onDone={() => { setOpen(null); reload(); }} />}</Modal>
      <Modal open={walkIn} onClose={() => setWalkIn(false)} title="Walk-in application" wide><WalkIn onDone={() => { setWalkIn(false); reload(); }} /></Modal>
    </Page>
  );
}

function AppDetail({ app, currency, fee, onDone }: { app: App; currency: string; fee: number; onDone: () => void }) {
  const { data: structure } = useApi<{ class_groups: { id: string; name: string }[] }>("/api/school/structure");
  const [f, setF] = useState({ status: app.status, note: "", assessment_at: "", interview_at: "", score: app.assessment_score?.toString() ?? "", admission_no: "", class_group_id: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const act = async (body: Record<string, unknown>, ok: string) => { const r = await send("/api/admissions", body); setMsg({ ok: r.ok, text: r.ok ? ok : r.error ?? "failed" }); return r.ok; };
  return (
    <div className="space-y-4 text-sm">
      <div className="grid gap-2 sm:grid-cols-2">
        <p><b>Application:</b> {app.application_no}</p><p><b>Applying for:</b> {app.applying_for}</p>
        <p><b>Date of birth:</b> {app.date_of_birth ? fmtDate(app.date_of_birth) : "—"}</p><p><b>Previous school:</b> {app.previous_school ?? "—"}</p>
        <p><b>Parent:</b> {app.guardian_name} · {app.guardian_phone} · {app.guardian_email ?? "no email"}</p>
        <p><b>Application fee:</b> {fee ? `${money(fee, currency)} ` : "none "}{fee > 0 && <Badge tone={app.fee_paid ? "green" : "amber"}>{app.fee_paid ? "paid" : "unpaid"}</Badge>}</p>
        {app.notes && <p className="sm:col-span-2"><b>Notes:</b> {app.notes}</p>}
      </div>
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      {app.status !== "enrolled" && (
        <section className="rounded-lg border border-slate-200 p-3">
          <h3 className="mb-2 font-semibold">Move to the next stage</h3>
          <div className="grid gap-2 sm:grid-cols-3">
            <Field label="Status"><select className="input" value={f.status} onChange={e => setF({ ...f, status: e.target.value })}>{STAGES.filter(s => s !== "enrolled").map(s => <option key={s}>{s}</option>)}</select></Field>
            {f.status === "assessment" && <Field label="Assessment date"><input className="input" type="datetime-local" value={f.assessment_at} onChange={e => setF({ ...f, assessment_at: e.target.value })} /></Field>}
            {f.status === "interview" && <Field label="Interview date"><input className="input" type="datetime-local" value={f.interview_at} onChange={e => setF({ ...f, interview_at: e.target.value })} /></Field>}
            <div className="sm:col-span-3"><Field label="Message to the family (optional)"><input className="input" value={f.note} onChange={e => setF({ ...f, note: e.target.value })} placeholder="e.g. Please bring the birth certificate and last report card" /></Field></div>
          </div>
          <button className="btn btn-primary mt-2" onClick={async () => { if (await act({ action: "status", id: app.id, status: f.status, note: f.note || null,
            assessment_at: f.assessment_at ? new Date(f.assessment_at).toISOString() : undefined, interview_at: f.interview_at ? new Date(f.interview_at).toISOString() : undefined }, "Updated; the family has been told.")) onDone(); }}>Save and tell the family</button>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <Field label="Entrance assessment score"><input className="input w-32" type="number" min={0} value={f.score} onChange={e => setF({ ...f, score: e.target.value })} /></Field>
            <button className="btn btn-ghost border border-slate-200" onClick={() => act({ action: "score", id: app.id, assessment_score: Number(f.score) }, "Score saved.")}>Save score</button>
            {fee > 0 && <button className="btn btn-ghost border border-slate-200" onClick={() => act({ action: "fee", id: app.id, fee_paid: !app.fee_paid, fee_reference: app.fee_paid ? null : prompt("Payment reference (teller, transfer id)") }, "Fee status updated.")}>{app.fee_paid ? "Mark fee unpaid" : "Mark fee paid"}</button>}
          </div>
        </section>
      )}
      {["offered", "accepted"].includes(app.status) && (
        <section className="rounded-lg border border-emerald-300 bg-emerald-50 p-3">
          <h3 className="mb-2 font-semibold">Enrol</h3>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Admission number"><input className="input" value={f.admission_no} onChange={e => setF({ ...f, admission_no: e.target.value })} /></Field>
            <Field label="Class"><select className="input" value={f.class_group_id} onChange={e => setF({ ...f, class_group_id: e.target.value })}><option value="">—</option>{(structure?.class_groups ?? []).map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>
            <button className="btn btn-primary" disabled={!f.admission_no} onClick={async () => { if (await act({ action: "enroll", id: app.id, admission_no: f.admission_no, class_group_id: f.class_group_id || null }, "Enrolled. The student and parent records have been created.")) onDone(); }}>Enrol student</button>
          </div>
          <p className="mt-1 text-xs text-slate-600">Creates the student record and links the parent (reusing an existing parent record for siblings).</p>
        </section>
      )}
      {app.student_id && <a className="btn btn-ghost border border-slate-200" href={`/school/students/${app.student_id}`}>Open student record</a>}
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
      <Field label="Source"><select className="input" {...bind("source")}><option value="walk_in">Walk-in</option><option value="referral">Referral</option><option value="agent">Agent</option></select></Field>
      {err && <div className="sm:col-span-3"><Alert>{err}</Alert></div>}
      <div className="flex justify-end sm:col-span-3"><button className="btn btn-primary">Create application</button></div>
    </form>
  );
}

function AdmissionSettings({ data, applyUrl, reload }: { data: Data; applyUrl: string | null; reload: () => void }) {
  const s = data.settings;
  const [f, setF] = useState({ admissions_open: Boolean(s.admissions_open), application_fee: String(s.application_fee ?? 0), admissions_intro: s.admissions_intro ?? "", public_slug: s.public_slug ?? "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <form className="card max-w-2xl space-y-3 p-5" onSubmit={async e => {
      e.preventDefault();
      const r = await send("/api/admissions", { action: "settings", admissions_open: f.admissions_open, application_fee: Number(f.application_fee || 0), admissions_intro: f.admissions_intro || null, public_slug: f.public_slug || null });
      setMsg({ ok: r.ok, text: r.ok ? `Saved.${r.data.apply_url ? ` Your admissions page: ${r.data.apply_url}` : ""}` : r.error ?? "failed" }); if (r.ok) reload();
    }}>
      {applyUrl && <Alert tone="blue">Admissions page: <a className="font-semibold underline" href={applyUrl} target="_blank" rel="noreferrer">{applyUrl}</a>. Put it on your website, social media and WhatsApp status.</Alert>}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.admissions_open} onChange={e => setF({ ...f, admissions_open: e.target.checked })} /> Admissions are open (the page is public only while this is on)</label>
      <Field label="Web address" hint="Lowercase letters, numbers and dashes, e.g. green-hills-academy"><input className="input" value={f.public_slug} onChange={e => setF({ ...f, public_slug: e.target.value.toLowerCase() })} /></Field>
      <Field label="Application fee (0 = free)" hint="Families are told the fee; the bursary marks it paid on the application."><input className="input" type="number" min={0} value={f.application_fee} onChange={e => setF({ ...f, application_fee: e.target.value })} /></Field>
      <Field label="Welcome text on the admissions page"><textarea className="input h-28" value={f.admissions_intro} onChange={e => setF({ ...f, admissions_intro: e.target.value })} /></Field>
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      <button className="btn btn-primary">Save</button>
    </form>
  );
}
