"use client";
import { useState } from "react";
import { useApi, send, Alert, Badge, Field, Loading, fmtDate } from "@/components/ui";
import { LEAVING_KINDS, LEAVING_LABEL, MOVEMENT_LABEL } from "@/lib/sis";

type Data = {
  student: { id: string; status: string; admitted_on: string | null; previous_school: string | null; left_on: string | null; leaving_kind: string | null; leaving_reason: string | null; destination_school: string | null };
  movements: { id: string; kind: string; effective_on: string; from_class: string | null; to_class: string | null; session_name: string | null; school: string | null; reason: string | null; notes: string | null; users: { full_name: string } | null }[];
  clearance: { key: string; label: string; ok: boolean; detail: string }[] | null;
  admin: boolean;
};

/** Enrolment history, admission details, and leaving (transfer, withdrawal, graduation) or coming back. */
export default function History({ studentId, classes, onChanged }: { studentId: string; classes: { id: string; name: string }[]; onChanged: () => void }) {
  const { data, error, reload } = useApi<Data>(`/api/sis/${studentId}/leaving`);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [leave, setLeave] = useState({ kind: "transferred", left_on: new Date().toISOString().slice(0, 10), reason: "", destination: "", notes: "", add_to_alumni: false });
  const [adm, setAdm] = useState<{ admitted_on: string; previous_school: string } | null>(null);
  const [back, setBack] = useState("");
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  const s = data.student;
  const act = async (body: Record<string, unknown>, ok: string) => {
    const r = await send(`/api/sis/${studentId}/leaving`, body);
    setMsg({ ok: r.ok, text: r.ok ? ok : r.error ?? "failed" });
    if (r.ok) { reload(); onChanged(); }
    return r.ok;
  };
  const active = s.status === "active" || s.status === "suspended";
  return (
    <div className="space-y-4 text-sm">
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      <section className="card flex flex-wrap items-end gap-3 p-4">
        <div className="flex-1"><h3 className="font-semibold">Admission</h3>
          <p>Admitted {s.admitted_on ? fmtDate(s.admitted_on) : "—"}{s.previous_school ? ` from ${s.previous_school}` : ""}</p>
          {s.left_on && <p>Left {fmtDate(s.left_on)}: {LEAVING_LABEL[s.leaving_kind as keyof typeof LEAVING_LABEL] ?? s.leaving_kind}{s.destination_school ? `, to ${s.destination_school}` : ""}{s.leaving_reason ? ` (${s.leaving_reason})` : ""}</p>}</div>
        {data.admin && !adm && <button className="btn btn-outline px-2 py-1 text-xs" onClick={() => setAdm({ admitted_on: s.admitted_on ?? "", previous_school: s.previous_school ?? "" })}>Edit admission</button>}
        {adm && (
          <form className="flex flex-wrap items-end gap-2" onSubmit={async e => { e.preventDefault(); if (await act({ action: "admission", admitted_on: adm.admitted_on || null, previous_school: adm.previous_school || null }, "Saved.")) setAdm(null); }}>
            <Field label="Date admitted"><input className="input" type="date" value={adm.admitted_on} onChange={e => setAdm({ ...adm, admitted_on: e.target.value })} /></Field>
            <Field label="Previous school"><input className="input" value={adm.previous_school} onChange={e => setAdm({ ...adm, previous_school: e.target.value })} /></Field>
            <button className="btn btn-primary">Save</button>
          </form>
        )}
      </section>

      <section>
        <h3 className="mb-2 font-semibold">History</h3>
        <ol className="relative space-y-2 border-l border-slate-200 pl-4">{data.movements.map(m => (
          <li key={m.id}>
            <p><b>{MOVEMENT_LABEL[m.kind] ?? m.kind}</b>{m.from_class || m.to_class ? `: ${[m.from_class, m.to_class].filter(Boolean).join(" → ")}` : ""}{m.school ? ` · ${m.school}` : ""}{m.session_name ? ` · ${m.session_name}` : ""}</p>
            <p className="text-xs text-slate-500">{fmtDate(m.effective_on)}{m.users ? ` · ${m.users.full_name}` : ""}{m.reason ? ` · ${m.reason}` : ""}{m.notes ? ` · ${m.notes}` : ""}</p>
          </li>
        ))}</ol>
      </section>

      {data.admin && active && (
        <section className="card space-y-3 p-4">
          <h3 className="font-semibold">Leaving the school</h3>
          {data.clearance && (
            <ul className="grid gap-2 sm:grid-cols-2">{data.clearance.map(c => (
              <li key={c.key} className="flex items-center gap-2"><Badge tone={c.ok ? "green" : "amber"}>{c.ok ? "✓" : "!"}</Badge><span><b>{c.label}:</b> {c.detail}</span></li>
            ))}</ul>
          )}
          <form className="grid gap-3 sm:grid-cols-3" onSubmit={async e => {
            e.preventDefault();
            if (!confirm("Record that this student has left? Their place, bed and bus seat are released and their own sign-in stops. Their records are kept.")) return;
            await act({ action: "leave", ...leave, reason: leave.reason || null, destination: leave.destination || null, notes: leave.notes || null }, "Recorded. You can now issue a transfer certificate or testimonial from Achievements & certificates.");
          }}>
            <Field label="How"><select className="input" value={leave.kind} onChange={e => setLeave({ ...leave, kind: e.target.value, add_to_alumni: e.target.value === "graduated" })}>{LEAVING_KINDS.map(k => <option key={k} value={k}>{LEAVING_LABEL[k]}</option>)}</select></Field>
            <Field label="Last day"><input className="input" type="date" value={leave.left_on} onChange={e => setLeave({ ...leave, left_on: e.target.value })} required /></Field>
            {leave.kind === "transferred" && <Field label="New school"><input className="input" value={leave.destination} onChange={e => setLeave({ ...leave, destination: e.target.value })} maxLength={160} /></Field>}
            <div className="sm:col-span-2"><Field label="Reason (printed on a transfer certificate)"><input className="input" value={leave.reason} onChange={e => setLeave({ ...leave, reason: e.target.value })} maxLength={500} placeholder="e.g. Family relocation to Abuja" /></Field></div>
            <Field label="Private note"><input className="input" value={leave.notes} onChange={e => setLeave({ ...leave, notes: e.target.value })} maxLength={1000} /></Field>
            <label className="flex items-center gap-2 sm:col-span-2"><input type="checkbox" checked={leave.add_to_alumni} onChange={e => setLeave({ ...leave, add_to_alumni: e.target.checked })} /> Add to the alumni list</label>
            <div><button className="btn btn-primary">Record leaving</button></div>
          </form>
        </section>
      )}
      {data.admin && !active && (
        <section className="card flex flex-wrap items-end gap-2 p-4">
          <p className="flex-1">This student has left. If they come back, put them in a class:</p>
          <select className="input w-auto" value={back} onChange={e => setBack(e.target.value)} aria-label="Class"><option value="">No class yet</option>{classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <button className="btn btn-outline" onClick={() => confirm("Re-admit this student?") && act({ action: "reinstate", class_group_id: back || null }, "Re-admitted.")}>Re-admit</button>
        </section>
      )}
    </div>
  );
}
