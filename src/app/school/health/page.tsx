"use client";
import { useState } from "react";
import { useApi, send, Page, PageHeader, Tabs, Alert, Empty, Field, Badge, fmtDate, fmtTime } from "@/components/ui";

type Visit = { id: string; complaint: string; temperature: number | null; treatment: string | null; outcome: string; at: string; parent_notified: boolean;
  students: { first_name: string; last_name: string; admission_no: string; class_groups: { name: string } | null } };
type AlertRow = { student_id: string; allergies: string | null; conditions: string | null; medications: string | null; blood_group: string | null; genotype: string | null;
  students: { first_name: string; last_name: string; class_groups: { name: string } | null } };

export default function HealthPage() {
  const { data, error, reload } = useApi<{ visits: Visit[]; alerts: AlertRow[] }>("/api/health");
  const [tab, setTab] = useState<"sickbay" | "alerts" | "profile">("sickbay");
  return (
    <Page wide>
      <PageHeader eyebrow="Welfare" title="Health & sick bay" subtitle="Log sick-bay visits with the parent told immediately, and keep allergies and conditions visible to the child's teachers." />
      {error && <Alert>{error}</Alert>}
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "sickbay", label: "Sick bay" }, { id: "alerts", label: `Allergies & conditions${data?.alerts.length ? ` (${data.alerts.length})` : ""}` }, { id: "profile", label: "Medical records" }]} />
      {tab === "sickbay" && <SickBay visits={data?.visits ?? []} reload={reload} />}
      {tab === "alerts" && (!data?.alerts.length ? <Empty>No allergies or conditions recorded.</Empty> : (
        <div className="card overflow-x-auto"><table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-2">Student</th><th className="p-2">Allergies</th><th className="p-2">Conditions</th><th className="p-2">Medication</th><th className="p-2">Blood / genotype</th></tr></thead>
          <tbody>{data.alerts.map(a => <tr key={a.student_id} className="border-t border-slate-100"><td className="p-2">{a.students.first_name} {a.students.last_name}<div className="text-xs text-slate-400">{a.students.class_groups?.name}</div></td>
            <td className="p-2 font-medium text-rose-700">{a.allergies}</td><td className="p-2">{a.conditions}</td><td className="p-2">{a.medications}</td><td className="p-2">{[a.blood_group, a.genotype].filter(Boolean).join(" / ")}</td></tr>)}</tbody></table></div>
      ))}
      {tab === "profile" && <Profile />}
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

function SickBay({ visits, reload }: { visits: Visit[]; reload: () => void }) {
  const [student, setStudent] = useState<{ id: string; name: string } | null>(null);
  const [f, setF] = useState({ complaint: "", temperature: "", treatment: "", outcome: "returned_to_class", notify_parent: true });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const { data: profile } = useApi<{ profile: any }>(student ? `/api/health?student_id=${student.id}` : null, [student?.id]);
  return (
    <div className="grid gap-5 xl:grid-cols-3">
      <form className="card h-fit space-y-3 p-5" onSubmit={async e => {
        e.preventDefault();
        if (!student) return;
        const r = await send("/api/health", { action: "visit", student_id: student.id, complaint: f.complaint, temperature: f.temperature ? Number(f.temperature) : null,
          treatment: f.treatment || null, outcome: f.outcome, notify_parent: f.notify_parent });
        setMsg({ ok: r.ok, text: r.ok ? `Visit recorded.${r.data.messages_queued ? " Parents notified." : ""}` : r.error ?? "failed" });
        if (r.ok) { setStudent(null); setF({ ...f, complaint: "", temperature: "", treatment: "" }); reload(); }
      }}>
        <h2 className="font-semibold">New visit</h2>
        {student ? <p className="flex items-center justify-between rounded bg-slate-50 px-2 py-1 text-sm"><b>{student.name}</b><button type="button" className="text-xs" onClick={() => setStudent(null)}>Change</button></p> : <StudentPicker onPick={setStudent} />}
        {profile?.profile?.allergies && <Alert>Allergies: {profile.profile.allergies}</Alert>}
        {profile?.profile?.conditions && <Alert tone="amber">Conditions: {profile.profile.conditions}</Alert>}
        <Field label="Complaint"><input className="input" required value={f.complaint} onChange={e => setF({ ...f, complaint: e.target.value })} /></Field>
        <Field label="Temperature (°C)"><input className="input" type="number" step="0.1" min={30} max={45} value={f.temperature} onChange={e => setF({ ...f, temperature: e.target.value })} /></Field>
        <Field label="Treatment given"><input className="input" value={f.treatment} onChange={e => setF({ ...f, treatment: e.target.value })} /></Field>
        <Field label="Outcome"><select className="input" value={f.outcome} onChange={e => setF({ ...f, outcome: e.target.value })}>
          <option value="returned_to_class">Returned to class</option><option value="resting">Resting in sick bay</option><option value="sent_home">Needs to go home</option><option value="hospital">Referred to hospital</option></select></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.notify_parent} onChange={e => setF({ ...f, notify_parent: e.target.checked })} /> Tell parents now</label>
        {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
        <button className="btn btn-primary w-full" disabled={!student}>Save visit</button>
      </form>
      <div className="xl:col-span-2">
        {!visits.length ? <Empty>No sick-bay visits yet.</Empty> : (
          <div className="card overflow-x-auto"><table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-2">When</th><th className="p-2">Student</th><th className="p-2">Complaint</th><th className="p-2">Outcome</th></tr></thead>
            <tbody>{visits.map(v => <tr key={v.id} className="border-t border-slate-100"><td className="p-2 text-xs">{fmtDate(v.at)} {fmtTime(v.at)}</td>
              <td className="p-2">{v.students.first_name} {v.students.last_name}<div className="text-xs text-slate-400">{v.students.class_groups?.name}</div></td>
              <td className="p-2">{v.complaint}{v.temperature ? ` · ${v.temperature}°C` : ""}{v.treatment ? <div className="text-xs text-slate-500">{v.treatment}</div> : null}</td>
              <td className="p-2"><Badge tone={v.outcome === "hospital" ? "red" : v.outcome === "sent_home" ? "amber" : "green"}>{v.outcome.replace(/_/g, " ")}</Badge>{v.parent_notified && <span className="ml-1 text-xs text-slate-400">parents told</span>}</td></tr>)}</tbody></table></div>
        )}
      </div>
    </div>
  );
}

function Profile() {
  const [student, setStudent] = useState<{ id: string; name: string } | null>(null);
  const { data, reload } = useApi<{ profile: any; visits: any[] }>(student ? `/api/health?student_id=${student.id}` : null, [student?.id]);
  const [p, setP] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const val = (k: string) => p[k] ?? data?.profile?.[k] ?? "";
  return (
    <div className="max-w-2xl space-y-4">
      {student ? <p className="flex items-center justify-between rounded bg-slate-50 px-3 py-2"><b>{student.name}</b><button className="text-xs" onClick={() => { setStudent(null); setP({}); }}>Change</button></p> : <StudentPicker onPick={s => { setStudent(s); setP({}); }} />}
      {student && data && (
        <form className="card grid gap-3 p-5 sm:grid-cols-2" onSubmit={async e => {
          e.preventDefault();
          const keys = ["blood_group", "genotype", "allergies", "conditions", "medications", "dietary", "emergency_contact", "doctor"];
          const r = await send("/api/health", { action: "save_profile", student_id: student.id, ...Object.fromEntries(keys.map(k => [k, val(k) || null])) });
          setMsg(r.ok ? "Saved." : r.error); reload();
        }}>
          <Field label="Blood group"><input className="input" value={val("blood_group")} onChange={e => setP({ ...p, blood_group: e.target.value })} /></Field>
          <Field label="Genotype"><input className="input" value={val("genotype")} onChange={e => setP({ ...p, genotype: e.target.value })} placeholder="AA, AS, SS…" /></Field>
          <div className="sm:col-span-2"><Field label="Allergies"><input className="input" value={val("allergies")} onChange={e => setP({ ...p, allergies: e.target.value })} /></Field></div>
          <div className="sm:col-span-2"><Field label="Medical conditions"><input className="input" value={val("conditions")} onChange={e => setP({ ...p, conditions: e.target.value })} /></Field></div>
          <Field label="Regular medication"><input className="input" value={val("medications")} onChange={e => setP({ ...p, medications: e.target.value })} /></Field>
          <Field label="Dietary needs"><input className="input" value={val("dietary")} onChange={e => setP({ ...p, dietary: e.target.value })} /></Field>
          <Field label="Emergency contact"><input className="input" value={val("emergency_contact")} onChange={e => setP({ ...p, emergency_contact: e.target.value })} /></Field>
          <Field label="Family doctor / clinic"><input className="input" value={val("doctor")} onChange={e => setP({ ...p, doctor: e.target.value })} /></Field>
          {msg && <div className="sm:col-span-2"><Alert tone="green">{msg}</Alert></div>}
          <div className="sm:col-span-2"><button className="btn btn-primary">Save medical record</button></div>
        </form>
      )}
    </div>
  );
}
