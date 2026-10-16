"use client";
import { useState } from "react";
import { useApi, send, Page, PageHeader, Tabs, Alert, Empty, Field, Badge, Modal, fmtDate, fmtTime, localDate, rolesOf, type Me } from "@/components/ui";

type Visit = { id: string; complaint: string; temperature: number | null; pulse: number | null; blood_pressure: string | null; treatment: string | null; outcome: string; at: string; left_at: string | null;
  follow_up_on: string | null; parent_notified: boolean; students: { first_name: string; last_name: string; admission_no: string; class_groups: { name: string } | null } };
type AlertRow = { student_id: string; allergies: string | null; allergy_severity: string | null; has_epipen: boolean; conditions: string | null; medications: string | null; care_plan: string | null;
  blood_group: string | null; genotype: string | null; students: { first_name: string; last_name: string; class_groups: { name: string } | null } };
type Tab = "sickbay" | "medication" | "alerts" | "immunisations" | "profile";

const SEVERITY_TONE: Record<string, "red" | "amber" | "slate"> = { anaphylaxis: "red", severe: "red", moderate: "amber", mild: "slate" };

export default function HealthPage() {
  const { data: me } = useApi<Me>("/api/me");
  const canEdit = ["nurse", "hostel_warden", "school_admin", "principal", "platform_admin"].some(r => rolesOf(me).has(r));
  const { data, error, reload } = useApi<{ visits: Visit[]; alerts: AlertRow[] }>("/api/health");
  const [tab, setTab] = useState<Tab>("sickbay");
  return (
    <Page wide>
      <PageHeader eyebrow="Welfare" title="Health & sick bay" subtitle="Sick-bay visits with parents told at once, the day's medication round with a signed log, immunisations, and allergies and care plans visible to the child's teachers." />
      {error && <Alert>{error}</Alert>}
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "sickbay", label: "Sick bay" }, { id: "medication", label: "Medication" }, { id: "alerts", label: `Allergies & conditions${data?.alerts.length ? ` (${data.alerts.length})` : ""}` },
        { id: "immunisations", label: "Immunisations" }, { id: "profile", label: "Medical records" }]} />
      {tab === "sickbay" && <SickBay visits={data?.visits ?? []} reload={reload} canEdit={canEdit} />}
      {tab === "medication" && <Medication canEdit={canEdit} />}
      {tab === "alerts" && (!data?.alerts.length ? <Empty>No allergies or conditions recorded.</Empty> : (
        <div className="card overflow-x-auto"><table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-2">Student</th><th className="p-2">Allergies</th><th className="p-2">Conditions</th><th className="p-2">Medication</th><th className="p-2">Care plan</th><th className="p-2">Blood / genotype</th></tr></thead>
          <tbody>{data.alerts.map(a => <tr key={a.student_id} className="border-t border-slate-100 align-top"><td className="p-2">{a.students.first_name} {a.students.last_name}<div className="text-xs text-slate-400">{a.students.class_groups?.name}</div></td>
            <td className="p-2"><span className="font-medium text-rose-700">{a.allergies}</span>{a.allergy_severity && a.allergy_severity !== "none" && <Badge tone={SEVERITY_TONE[a.allergy_severity] ?? "slate"}>{a.allergy_severity}</Badge>}{a.has_epipen && <Badge tone="red">EpiPen</Badge>}</td>
            <td className="p-2">{a.conditions}</td><td className="p-2">{a.medications}</td><td className="max-w-xs p-2 text-xs">{a.care_plan}</td><td className="p-2">{[a.blood_group, a.genotype].filter(Boolean).join(" / ")}</td></tr>)}</tbody></table></div>
      ))}
      {tab === "immunisations" && <ImmunisationsDue />}
      {tab === "profile" && <Profile canEdit={canEdit} />}
    </Page>
  );
}

function StudentPicker({ onPick }: { onPick: (s: { id: string; name: string }) => void }) {
  const [q, setQ] = useState("");
  const { data } = useApi<{ id: string; first_name: string; last_name: string; admission_no: string; class_groups: { name: string } | null }[]>(q.length >= 2 ? `/api/sims/students?q=${encodeURIComponent(q)}&limit=10` : null, [q]);
  return (
    <div className="relative">
      <input className="input" placeholder="Search student name or admission no" value={q} onChange={e => setQ(e.target.value)} aria-label="Find student" />
      {q.length >= 2 && (data ?? []).length > 0 && (
        <ul className="absolute z-10 mt-1 w-full rounded-md border border-slate-200 bg-white shadow">{data!.map(s => (
          <li key={s.id}><button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => { onPick({ id: s.id, name: `${s.first_name} ${s.last_name}` }); setQ(""); }}>
            {s.first_name} {s.last_name} <span className="text-xs text-slate-400">{s.admission_no} · {s.class_groups?.name}</span></button></li>))}</ul>
      )}
    </div>
  );
}

function SickBay({ visits, reload, canEdit }: { visits: Visit[]; reload: () => void; canEdit: boolean }) {
  const [student, setStudent] = useState<{ id: string; name: string } | null>(null);
  const blank = { complaint: "", temperature: "", pulse: "", blood_pressure: "", treatment: "", outcome: "returned_to_class", follow_up_on: "", notify_parent: true };
  const [f, setF] = useState(blank);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const { data: profile } = useApi<{ profile: any; plans: any[] }>(student ? `/api/health?student_id=${student.id}` : null, [student?.id]);
  const resting = visits.filter(v => v.outcome === "resting" && !v.left_at);
  return (
    <div className="grid gap-5 xl:grid-cols-3">
      {canEdit && <form className="card h-fit space-y-3 p-5" onSubmit={async e => {
        e.preventDefault();
        if (!student) return;
        const r = await send("/api/health", { action: "visit", student_id: student.id, complaint: f.complaint, temperature: f.temperature ? Number(f.temperature) : null, pulse: f.pulse ? Number(f.pulse) : null,
          blood_pressure: f.blood_pressure || null, treatment: f.treatment || null, outcome: f.outcome, follow_up_on: f.follow_up_on || null, notify_parent: f.notify_parent });
        setMsg({ ok: r.ok, text: r.ok ? `Visit recorded.${r.data.messages_queued ? " Parents notified." : ""}` : r.error ?? "failed" });
        if (r.ok) { setStudent(null); setF(blank); reload(); }
      }}>
        <h2 className="font-semibold">New visit</h2>
        {student ? <p className="flex items-center justify-between rounded bg-slate-50 px-2 py-1 text-sm"><b>{student.name}</b><button type="button" className="text-xs" onClick={() => setStudent(null)}>Change</button></p> : <StudentPicker onPick={setStudent} />}
        {profile?.profile?.allergies && <Alert>Allergies: {profile.profile.allergies}{profile.profile.allergy_severity ? ` (${profile.profile.allergy_severity})` : ""}{profile.profile.has_epipen ? " · carries an EpiPen" : ""}</Alert>}
        {profile?.profile?.conditions && <Alert tone="amber">Conditions: {profile.profile.conditions}</Alert>}
        {profile?.profile?.care_plan && <Alert tone="blue">Care plan: {profile.profile.care_plan}</Alert>}
        {(profile?.plans ?? []).filter((p: any) => p.active).length > 0 && <p className="text-xs text-slate-600">On medication: {profile!.plans.filter((p: any) => p.active).map((p: any) => `${p.medicine} ${p.dose}`).join(", ")}</p>}
        <Field label="Complaint"><input className="input" required value={f.complaint} onChange={e => setF({ ...f, complaint: e.target.value })} /></Field>
        <div className="grid grid-cols-3 gap-2">
          <Field label="Temp (°C)"><input className="input" type="number" step="0.1" min={30} max={45} value={f.temperature} onChange={e => setF({ ...f, temperature: e.target.value })} /></Field>
          <Field label="Pulse"><input className="input" type="number" min={20} max={250} value={f.pulse} onChange={e => setF({ ...f, pulse: e.target.value })} /></Field>
          <Field label="BP"><input className="input" placeholder="110/70" value={f.blood_pressure} onChange={e => setF({ ...f, blood_pressure: e.target.value })} /></Field>
        </div>
        <Field label="Treatment given"><input className="input" value={f.treatment} onChange={e => setF({ ...f, treatment: e.target.value })} /></Field>
        <Field label="Outcome"><select className="input" value={f.outcome} onChange={e => setF({ ...f, outcome: e.target.value })}>
          <option value="returned_to_class">Returned to class</option><option value="resting">Resting in sick bay</option><option value="sent_home">Needs to go home</option><option value="hospital">Referred to hospital</option></select></Field>
        <Field label="Check again on"><input className="input" type="date" value={f.follow_up_on} onChange={e => setF({ ...f, follow_up_on: e.target.value })} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.notify_parent} onChange={e => setF({ ...f, notify_parent: e.target.checked })} /> Tell parents now</label>
        {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
        <button className="btn btn-primary w-full" disabled={!student}>Save visit</button>
      </form>}
      <div className={"space-y-3 " + (canEdit ? "xl:col-span-2" : "xl:col-span-3")}>
        {resting.length > 0 && <Alert tone="amber">In the sick bay now: {resting.map(v => <span key={v.id} className="mr-2">{v.students.first_name} {v.students.last_name} (since {fmtTime(v.at)}){canEdit && <button className="ml-1 text-xs underline" onClick={async () => { await send("/api/health", { action: "visit_left", id: v.id }); reload(); }}>left</button>}</span>)}</Alert>}
        {!visits.length ? <Empty>No sick-bay visits yet.</Empty> : (
          <div className="card overflow-x-auto"><table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-2">When</th><th className="p-2">Student</th><th className="p-2">Complaint</th><th className="p-2">Outcome</th></tr></thead>
            <tbody>{visits.map(v => <tr key={v.id} className="border-t border-slate-100"><td className="p-2 text-xs">{fmtDate(v.at)} {fmtTime(v.at)}</td>
              <td className="p-2">{v.students.first_name} {v.students.last_name}<div className="text-xs text-slate-400">{v.students.class_groups?.name}</div></td>
              <td className="p-2">{v.complaint}{[v.temperature ? `${v.temperature}°C` : "", v.pulse ? `pulse ${v.pulse}` : "", v.blood_pressure ? `BP ${v.blood_pressure}` : ""].filter(Boolean).map(x => ` · ${x}`).join("")}
                {v.treatment ? <div className="text-xs text-slate-500">{v.treatment}</div> : null}{v.follow_up_on ? <div className="text-xs text-amber-700">check again {fmtDate(v.follow_up_on)}</div> : null}</td>
              <td className="p-2"><Badge tone={v.outcome === "hospital" ? "red" : v.outcome === "sent_home" ? "amber" : "green"}>{v.outcome.replace(/_/g, " ")}</Badge>{v.parent_notified && <span className="ml-1 text-xs text-slate-400">parents told</span>}</td></tr>)}</tbody></table></div>
        )}
      </div>
    </div>
  );
}

function Medication({ canEdit }: { canEdit: boolean }) {
  const { data, error, reload } = useApi<{ round: any[]; as_needed: any[]; given_today: any[] }>("/api/health?view=medication");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const give = async (student_id: string, plan_id: string, status: string, notify = false) => {
    const note = status !== "given" ? prompt("Note (optional)") : null;
    const r = await send("/api/health", { action: "give", student_id, plan_id, status, note: note || null, notify_parent: notify });
    setMsg({ ok: r.ok, text: r.ok ? "Logged." : r.error ?? "" }); reload();
  };
  if (error) return <Alert>{error}</Alert>;
  if (!data) return null;
  const STATE: Record<string, "green" | "amber" | "red" | "slate" | "blue"> = { given: "green", refused: "amber", due: "blue", overdue: "red", later: "slate" };
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <section className="card p-4">
        <h2 className="mb-2 font-semibold">Today’s round</h2>
        {msg && <div className="mb-2"><Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert></div>}
        {!data.round.length ? <p className="text-sm text-slate-500">No scheduled medication today. Add plans under Medical records.</p> : (
          <ul className="divide-y divide-slate-100 text-sm">{data.round.map((r, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2 py-2"><span className="w-12 font-mono">{r.time}</span><span className="font-medium">{r.student}</span><span className="text-xs text-slate-500">{r.class}</span>
              <span>{r.plan.medicine} · {r.plan.dose}</span>{!r.plan.parent_consent && <Badge tone="red">no consent</Badge>}<Badge tone={STATE[r.state]}>{r.state}</Badge>
              {canEdit && (r.state === "due" || r.state === "overdue") && <span className="ml-auto flex gap-1">
                <button className="btn btn-primary px-2 py-1 text-xs" onClick={() => give(r.plan.student_id, r.plan.id, "given")}>Given</button>
                <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => give(r.plan.student_id, r.plan.id, "refused", true)}>Refused</button></span>}</li>))}</ul>
        )}
      </section>
      <section className="space-y-4">
        <div className="card p-4"><h2 className="mb-2 font-semibold">When needed</h2>
          {!data.as_needed.length ? <p className="text-sm text-slate-500">None.</p> : <ul className="space-y-1 text-sm">{data.as_needed.map(p => (
            <li key={p.id} className="flex flex-wrap items-center gap-2"><span className="font-medium">{p.student}</span><span>{p.medicine} · {p.dose}</span>{p.instructions && <span className="text-xs text-slate-500">{p.instructions}</span>}
              {canEdit && <button className="btn btn-ghost ml-auto px-2 py-1 text-xs" onClick={() => give(p.student_id, p.id, "given", confirm("Tell the parents?"))}>Give now</button>}</li>))}</ul>}</div>
        <div className="card p-4"><h2 className="mb-2 font-semibold">Given today</h2>
          {!data.given_today.length ? <p className="text-sm text-slate-500">Nothing yet.</p> : <ul className="space-y-1 text-sm">{data.given_today.map(d => <li key={d.id}>{fmtTime(d.given_at)} · {d.student}: {d.medicine} {d.dose} <Badge tone={d.status === "given" ? "green" : "amber"}>{d.status.replace("_", " ")}</Badge>{d.note ? <span className="text-xs text-slate-500"> {d.note}</span> : null}</li>)}</ul>}</div>
      </section>
    </div>
  );
}

function ImmunisationsDue() {
  const { data } = useApi<{ due: { student_id: string; student: string; class: string | null; vaccine: string; next_due_on: string; overdue: boolean }[] }>("/api/health?view=immunisations");
  if (!data) return null;
  return !data.due.length ? <Empty>No immunisations due in the next 30 days. Record them under Medical records.</Empty> : (
    <div className="card overflow-x-auto"><table className="w-full text-sm">
      <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-2">Student</th><th className="p-2">Vaccine</th><th className="p-2">Due</th></tr></thead>
      <tbody>{data.due.map((d, i) => <tr key={i} className="border-t border-slate-100"><td className="p-2">{d.student}<div className="text-xs text-slate-400">{d.class}</div></td><td className="p-2">{d.vaccine}</td>
        <td className="p-2">{fmtDate(d.next_due_on)} {d.overdue && <Badge tone="red">overdue</Badge>}</td></tr>)}</tbody></table></div>
  );
}

function Profile({ canEdit }: { canEdit: boolean }) {
  const [student, setStudent] = useState<{ id: string; name: string } | null>(null);
  const { data, reload } = useApi<{ profile: any; visits: any[]; plans: any[]; doses: any[]; immunisations: any[]; vaccines: string[] }>(student ? `/api/health?student_id=${student.id}` : null, [student?.id]);
  const [p, setP] = useState<Record<string, any>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [plan, setPlan] = useState<any | null>(null);
  const [imm, setImm] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const val = (k: string) => p[k] ?? data?.profile?.[k] ?? "";
  const text = (k: string, label: string, ph?: string) => <Field label={label}><input className="input" disabled={!canEdit} value={val(k)} placeholder={ph} onChange={e => setP({ ...p, [k]: e.target.value })} /></Field>;
  return (
    <div className="space-y-4">
      <div className="max-w-xl">{student ? <p className="flex items-center justify-between rounded bg-slate-50 px-3 py-2"><b>{student.name}</b><button className="text-xs" onClick={() => { setStudent(null); setP({}); }}>Change</button></p> : <StudentPicker onPick={s => { setStudent(s); setP({}); }} />}</div>
      {student && data && <div className="grid gap-5 xl:grid-cols-2">
        <form className="card grid h-fit gap-3 p-5 sm:grid-cols-2" onSubmit={async e => {
          e.preventDefault();
          const keys = ["blood_group", "genotype", "allergies", "allergy_severity", "conditions", "medications", "dietary", "emergency_contact", "doctor", "care_plan"];
          const r = await send("/api/health", { action: "save_profile", student_id: student.id, has_epipen: Boolean(p.has_epipen ?? data.profile?.has_epipen), ...Object.fromEntries(keys.map(k => [k, val(k) || null])) });
          setMsg(r.ok ? "Saved." : r.error); reload();
        }}>
          {text("blood_group", "Blood group")}{text("genotype", "Genotype", "AA, AS, SS…")}
          <div className="sm:col-span-2">{text("allergies", "Allergies")}</div>
          <Field label="Allergy severity"><select className="input" disabled={!canEdit} value={val("allergy_severity")} onChange={e => setP({ ...p, allergy_severity: e.target.value })}><option value="">—</option>{["none", "mild", "moderate", "severe", "anaphylaxis"].map(s => <option key={s}>{s}</option>)}</select></Field>
          <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" disabled={!canEdit} checked={Boolean(p.has_epipen ?? data.profile?.has_epipen)} onChange={e => setP({ ...p, has_epipen: e.target.checked })} />Carries an EpiPen</label>
          <div className="sm:col-span-2">{text("conditions", "Medical conditions")}</div>
          <div className="sm:col-span-2"><Field label="Care plan (what to do in an emergency)"><textarea className="input" rows={3} disabled={!canEdit} value={val("care_plan")} onChange={e => setP({ ...p, care_plan: e.target.value })} /></Field></div>
          {text("medications", "Regular medication")}{text("dietary", "Dietary needs")}{text("emergency_contact", "Emergency contact")}{text("doctor", "Family doctor / clinic")}
          {msg && <div className="sm:col-span-2"><Alert tone="green">{msg}</Alert></div>}
          {canEdit && <div className="sm:col-span-2"><button className="btn btn-primary">Save medical record</button></div>}
        </form>
        <div className="space-y-4">
          <section className="card p-4">
            <div className="mb-2 flex items-center"><h3 className="mr-auto font-semibold">Medication plans</h3>{canEdit && <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setPlan({ route: "oral", times: ["08:00"], as_needed: false, starts_on: localDate(), parent_consent: false, active: true })}>+ Plan</button>}</div>
            {!data.plans.length ? <p className="text-sm text-slate-500">None.</p> : <ul className="space-y-1 text-sm">{data.plans.map(pl => (
              <li key={pl.id} className="flex flex-wrap items-center gap-2"><span className={pl.active ? "font-medium" : "text-slate-400 line-through"}>{pl.medicine} · {pl.dose}</span>
                <span className="text-xs text-slate-500">{pl.as_needed ? "when needed" : pl.times.join(", ")} · {pl.route}{pl.ends_on ? ` until ${fmtDate(pl.ends_on)}` : ""}</span>
                {!pl.parent_consent && <Badge tone="red">no consent</Badge>}{canEdit && <button className="ml-auto text-xs text-brand-700" onClick={() => setPlan(pl)}>Edit</button>}</li>))}</ul>}
            {data.doses.length > 0 && <details className="mt-2 text-xs"><summary className="cursor-pointer text-slate-500">Dose log ({data.doses.length})</summary>
              <ul className="mt-1 space-y-0.5">{data.doses.map(d => <li key={d.id}>{fmtDate(d.given_at)} {fmtTime(d.given_at)} · {d.medicine} {d.dose} · {d.status}{d.note ? ` · ${d.note}` : ""}</li>)}</ul></details>}
          </section>
          <section className="card p-4">
            <div className="mb-2 flex items-center"><h3 className="mr-auto font-semibold">Immunisations</h3>{canEdit && <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setImm({})}>+ Add</button>}</div>
            {!data.immunisations.length ? <p className="text-sm text-slate-500">None recorded.</p> : <ul className="space-y-1 text-sm">{data.immunisations.map(i => (
              <li key={i.id} className="flex flex-wrap gap-2"><span className="font-medium">{i.vaccine}{i.dose_no ? ` (dose ${i.dose_no})` : ""}</span><span className="text-slate-500">{i.given_on ? fmtDate(i.given_on) : "date unknown"}{i.provider ? ` · ${i.provider}` : ""}</span>
                {i.next_due_on && <span className="text-xs text-amber-700">next {fmtDate(i.next_due_on)}</span>}{canEdit && <button className="ml-auto text-xs text-brand-700" onClick={() => setImm(i)}>Edit</button>}</li>))}</ul>}
          </section>
        </div>
      </div>}
      <Modal open={Boolean(plan)} onClose={() => { setPlan(null); setErr(null); }} title={plan?.id ? "Edit medication plan" : "New medication plan"}>
        {plan && student && <form className="space-y-3" onSubmit={async e => {
          e.preventDefault();
          const r = await send("/api/health", { action: "save_plan", id: plan.id, student_id: student.id, medicine: plan.medicine, dose: plan.dose, route: plan.route || "oral",
            times: plan.as_needed ? [] : (plan.times ?? []).filter(Boolean), as_needed: Boolean(plan.as_needed), starts_on: plan.starts_on, ends_on: plan.ends_on || null,
            instructions: plan.instructions || null, parent_consent: Boolean(plan.parent_consent), stock_note: plan.stock_note || null, active: plan.active !== false });
          if (!r.ok) return setErr(r.error);
          setPlan(null); setErr(null); reload();
        }}>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Medicine"><input className="input" required value={plan.medicine ?? ""} onChange={e => setPlan({ ...plan, medicine: e.target.value })} /></Field>
            <Field label="Dose"><input className="input" required placeholder="e.g. 5 ml" value={plan.dose ?? ""} onChange={e => setPlan({ ...plan, dose: e.target.value })} /></Field>
            <Field label="How"><input className="input" value={plan.route ?? ""} onChange={e => setPlan({ ...plan, route: e.target.value })} /></Field>
            <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={Boolean(plan.as_needed)} onChange={e => setPlan({ ...plan, as_needed: e.target.checked })} />When needed</label>
          </div>
          {!plan.as_needed && <Field label="Times (school time)"><div className="flex flex-wrap gap-1">{(plan.times ?? []).map((t: string, i: number) => <input key={i} className="input w-28" type="time" value={t} onChange={e => setPlan({ ...plan, times: plan.times.map((x: string, j: number) => j === i ? e.target.value : x) })} />)}
            <button type="button" className="btn btn-ghost text-xs" onClick={() => setPlan({ ...plan, times: [...(plan.times ?? []), "13:00"] })}>+ time</button></div></Field>}
          <div className="grid grid-cols-2 gap-2">
            <Field label="From"><input className="input" type="date" required value={plan.starts_on ?? ""} onChange={e => setPlan({ ...plan, starts_on: e.target.value })} /></Field>
            <Field label="Until"><input className="input" type="date" value={plan.ends_on ?? ""} onChange={e => setPlan({ ...plan, ends_on: e.target.value })} /></Field>
          </div>
          <Field label="Instructions"><input className="input" value={plan.instructions ?? ""} onChange={e => setPlan({ ...plan, instructions: e.target.value })} /></Field>
          <Field label="Where it is kept / stock"><input className="input" value={plan.stock_note ?? ""} onChange={e => setPlan({ ...plan, stock_note: e.target.value })} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(plan.parent_consent)} onChange={e => setPlan({ ...plan, parent_consent: e.target.checked })} />Written consent from the parent is on file</label>
          {plan.id && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={plan.active !== false} onChange={e => setPlan({ ...plan, active: e.target.checked })} />Still taking it</label>}
          {err && <Alert>{err}</Alert>}
          <button className="btn btn-primary w-full">Save</button>
        </form>}
      </Modal>
      <Modal open={Boolean(imm)} onClose={() => { setImm(null); setErr(null); }} title={imm?.id ? "Edit immunisation" : "Add immunisation"}>
        {imm && student && <form className="space-y-3" onSubmit={async e => {
          e.preventDefault();
          const r = await send("/api/health", { action: "save_immunisation", id: imm.id, student_id: student.id, vaccine: imm.vaccine, dose_no: imm.dose_no ? Number(imm.dose_no) : null,
            given_on: imm.given_on || null, provider: imm.provider || null, batch_no: imm.batch_no || null, next_due_on: imm.next_due_on || null });
          if (!r.ok) return setErr(r.error);
          setImm(null); setErr(null); reload();
        }}>
          <Field label="Vaccine"><input className="input" required list="vaccines" value={imm.vaccine ?? ""} onChange={e => setImm({ ...imm, vaccine: e.target.value })} /></Field>
          <datalist id="vaccines">{(data?.vaccines ?? []).map(v => <option key={v} value={v} />)}</datalist>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Dose number"><input className="input" type="number" min={1} max={10} value={imm.dose_no ?? ""} onChange={e => setImm({ ...imm, dose_no: e.target.value })} /></Field>
            <Field label="Given on"><input className="input" type="date" value={imm.given_on ?? ""} onChange={e => setImm({ ...imm, given_on: e.target.value })} /></Field>
            <Field label="Where / by"><input className="input" value={imm.provider ?? ""} onChange={e => setImm({ ...imm, provider: e.target.value })} /></Field>
            <Field label="Batch"><input className="input" value={imm.batch_no ?? ""} onChange={e => setImm({ ...imm, batch_no: e.target.value })} /></Field>
          </div>
          <Field label="Next dose due"><input className="input" type="date" value={imm.next_due_on ?? ""} onChange={e => setImm({ ...imm, next_due_on: e.target.value })} /></Field>
          {err && <Alert>{err}</Alert>}
          <div className="flex gap-2"><button className="btn btn-primary flex-1">Save</button>
            {imm.id && <button type="button" className="btn btn-ghost text-rose-600" onClick={async () => { await send("/api/health", { action: "delete_immunisation", id: imm.id }); setImm(null); reload(); }}>Delete</button>}</div>
        </form>}
      </Modal>
    </div>
  );
}
