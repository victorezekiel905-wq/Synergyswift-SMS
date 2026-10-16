"use client";
import { useEffect, useState } from "react";
import { useApi, send, Alert, Empty, Modal, Field, Badge, Loading, fmtDate, money, statusTone } from "@/components/ui";
import { toLocalInput } from "./ClassStudents";

type TripRow = { id: string; title: string; starts_at: string; departs_at: string | null; returns_at: string | null; location: string | null; fee: number; capacity: number | null; requires_consent: boolean;
  staff_ids: string[]; consented: number; roster: Summary; on_staff: boolean };
type Summary = { total: number; going: number; departed: number; returned: number; absent: number };
type Detail = { event: TripRow & { meeting_point: string | null; risk_assessment: string | null; emergency_contact: string | null }; staff: { id: string; full_name: string }[]; admin: boolean; can_manage: boolean;
  responses: { student_id: string; consent: boolean; name: string; class: string | null; paid: boolean }[];
  roster: { student_id: string; status: string; departed_at: string | null; returned_at: string | null; note: string | null; name: string; class: string | null; paid: boolean; medical: string | null }[]; summary: Summary };

export default function Trips({ initial }: { initial: string | null }) {
  const { data, error, reload } = useApi<TripRow[]>("/api/cocurricular?view=trips");
  const { data: settings } = useApi<{ settings: { currency?: string } }>("/api/school/settings");
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { if (initial) setOpen(initial); }, [initial]);
  const cur = settings?.settings?.currency ?? "NGN";
  if (!data) return error ? <Alert>{error}</Alert> : <Loading />;
  return (
    <>
      {!data.length ? <Empty>No trips coming up. Publish one under Events &amp; trips (type &ldquo;Trip&rdquo;, with consent and a fee if needed); it then appears here for the roster.</Empty> : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{data.map(t => (
          <button key={t.id} className="card p-4 text-left transition hover:border-brand-300" onClick={() => setOpen(t.id)}>
            <p className="font-semibold">{t.title}</p>
            <p className="text-sm text-slate-500">{fmtDate(t.departs_at ?? t.starts_at, true)}{t.location ? ` · ${t.location}` : ""}</p>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              {t.fee > 0 && <Badge tone="amber">{money(t.fee, cur)}</Badge>}
              {t.requires_consent && <Badge tone="green">{t.consented} consented</Badge>}
              {t.roster.total > 0 && <Badge>{t.roster.total} on roster</Badge>}
              {t.roster.departed > 0 && <Badge tone="blue">{t.roster.departed} out</Badge>}
              {t.roster.returned > 0 && <Badge tone="green">{t.roster.returned} back</Badge>}
              {!t.staff_ids.length && <Badge tone="red">no staff set</Badge>}
            </div>
          </button>))}</div>
      )}
      <Modal open={Boolean(open)} onClose={() => { setOpen(null); reload(); }} title={data.find(t => t.id === open)?.title ?? "Trip"} wide>
        {open && <TripDetail id={open} currency={cur} />}
      </Modal>
    </>
  );
}

function TripDetail({ id, currency }: { id: string; currency: string }) {
  const { data, error, reload } = useApi<Detail>(`/api/cocurricular?view=trip&id=${id}`, [id]);
  const [setup, setSetup] = useState(false);
  const [sel, setSel] = useState<string[]>([]);
  const [tell, setTell] = useState(true);
  const [msg, setMsg] = useState<{ tone: "red" | "green"; text: string } | null>(null);
  if (!data) return error ? <Alert>{error}</Alert> : <Loading />;
  const e = data.event, onRoster = new Set(data.roster.map(r => r.student_id));
  const waiting = data.responses.filter(r => r.consent && !onRoster.has(r.student_id));
  async function act(body: object, ok: (d: any) => string) {
    const r = await send("/api/cocurricular", body);
    setMsg(r.ok ? { tone: "green", text: ok(r.data) } : { tone: "red", text: r.error ?? "Something went wrong" });
    if (r.ok) { setSel([]); reload(); }
  }
  const mark = (status: string) => act({ action: "roster", id, student_ids: sel, status, tell_parents: tell }, d => `${sel.length} marked ${status}.${d.parents_told ? ` ${d.parents_told} messages to parents.` : ""}`);
  return (
    <div className="space-y-4">
      <div className="grid gap-2 text-sm sm:grid-cols-2">
        <p><span className="text-slate-500">Leaves:</span> {e.departs_at ? fmtDate(e.departs_at, true) : "not set"}{e.meeting_point ? ` from ${e.meeting_point}` : ""}</p>
        <p><span className="text-slate-500">Back:</span> {e.returns_at ? fmtDate(e.returns_at, true) : "not set"}</p>
        <p><span className="text-slate-500">Staff:</span> {data.staff.filter(s => e.staff_ids.includes(s.id)).map(s => s.full_name).join(", ") || "none yet"}</p>
        <p><span className="text-slate-500">Emergency contact:</span> {e.emergency_contact ?? "—"}</p>
        {e.fee > 0 && <p><span className="text-slate-500">Cost:</span> {money(e.fee, currency)}</p>}
      </div>
      {e.risk_assessment && <details className="rounded border border-slate-200 p-2 text-sm"><summary className="cursor-pointer font-medium">Risk assessment</summary><p className="mt-2 whitespace-pre-wrap">{e.risk_assessment}</p></details>}
      <div className="flex flex-wrap gap-2 print:hidden">
        {data.admin && <button className="btn btn-ghost" onClick={() => setSetup(!setup)}>{setup ? "Close" : "Trip details & staff"}</button>}
        <button className="btn btn-ghost" onClick={() => window.print()}>Print roster</button>
      </div>
      {setup && <Setup d={data} onDone={() => { setSetup(false); setMsg({ tone: "green", text: "Trip details saved." }); reload(); }} />}
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}

      {waiting.length > 0 && data.can_manage && (
        <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm print:hidden">
          <p>{waiting.length} with consent not on the roster yet ({waiting.filter(w => !w.paid).length} not paid).</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button className="btn btn-primary px-2 py-1 text-xs" onClick={() => act({ action: "build_roster", id }, d => `${d.added} on the roster.`)}>Add those who have paid</button>
            <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => act({ action: "build_roster", id, include_unpaid: true }, d => `${d.added} on the roster.`)}>Add everyone with consent</button>
          </div>
        </div>
      )}

      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">Roster · {data.summary.total} ({data.summary.departed} out, {data.summary.returned} back{data.summary.absent ? `, ${data.summary.absent} absent` : ""})</h3>
          {data.can_manage && sel.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 print:hidden">
              <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={tell} onChange={x => setTell(x.target.checked)} /> Tell parents</label>
              <button className="btn btn-primary px-2 py-1 text-xs" onClick={() => mark("departed")}>Left with us</button>
              <button className="btn btn-primary px-2 py-1 text-xs" onClick={() => mark("returned")}>Back at school</button>
              <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => mark("absent")}>Did not come</button>
              <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => mark("cancelled")}>Off the trip</button>
            </div>
          )}
        </div>
        {!data.roster.length ? <Empty>Nobody on the roster yet.</Empty> : (
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-xs uppercase text-slate-500"><tr>
            {data.can_manage && <th className="print:hidden"><input type="checkbox" aria-label="Select everyone" checked={sel.length === data.roster.length} onChange={x => setSel(x.target.checked ? data.roster.map(r => r.student_id) : [])} /></th>}
            <th className="py-1">Student</th><th>Class</th><th>Status</th><th>Paid</th><th>Medical</th></tr></thead>
            <tbody>{data.roster.map(r => (
              <tr key={r.student_id} className="border-t border-slate-100">
                {data.can_manage && <td className="print:hidden"><input type="checkbox" aria-label={`Select ${r.name}`} checked={sel.includes(r.student_id)} onChange={x => setSel(x.target.checked ? [...sel, r.student_id] : sel.filter(s => s !== r.student_id))} /></td>}
                <td className="py-1.5">{r.name}</td><td>{r.class}</td>
                <td><Badge tone={r.status === "returned" ? "green" : r.status === "departed" ? "blue" : statusTone(r.status)}>{r.status === "departed" ? "out" : r.status === "returned" ? "back" : r.status}</Badge>
                  <span className="ml-1 text-xs text-slate-400">{r.returned_at ? fmtDate(r.returned_at, true) : r.departed_at ? fmtDate(r.departed_at, true) : ""}</span></td>
                <td>{r.paid ? <Badge tone="green">yes</Badge> : <Badge tone="amber">no</Badge>}</td>
                <td className="text-xs text-rose-700">{r.medical}</td>
              </tr>))}</tbody></table></div>
        )}
      </section>
    </div>
  );
}

function Setup({ d, onDone }: { d: Detail; onDone: () => void }) {
  const e = d.event;
  const [f, setF] = useState({ departs: toLocalInput(e.departs_at ?? e.starts_at), returns: toLocalInput(e.returns_at), meeting_point: e.meeting_point ?? "", staff_ids: e.staff_ids, risk: e.risk_assessment ?? "", emergency: e.emergency_contact ?? "" });
  const [err, setErr] = useState<string | null>(null);
  return (
    <form className="grid gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-2" onSubmit={async x => {
      x.preventDefault();
      const r = await send("/api/cocurricular", { action: "trip_setup", id: e.id, departs_at: f.departs ? new Date(f.departs).toISOString() : null, returns_at: f.returns ? new Date(f.returns).toISOString() : null,
        meeting_point: f.meeting_point, staff_ids: f.staff_ids, risk_assessment: f.risk, emergency_contact: f.emergency });
      if (!r.ok) return setErr(r.error);
      onDone();
    }}>
      <Field label="Leaves"><input className="input" type="datetime-local" value={f.departs} onChange={x => setF({ ...f, departs: x.target.value })} /></Field>
      <Field label="Back at school" hint="Staff and admins are alerted if anyone is still out 30 minutes after this."><input className="input" type="datetime-local" value={f.returns} onChange={x => setF({ ...f, returns: x.target.value })} /></Field>
      <Field label="Meeting point"><input className="input" value={f.meeting_point} onChange={x => setF({ ...f, meeting_point: x.target.value })} /></Field>
      <Field label="Emergency contact on the day"><input className="input" value={f.emergency} onChange={x => setF({ ...f, emergency: x.target.value })} /></Field>
      <fieldset className="sm:col-span-2"><legend className="label">Staff going</legend><div className="flex max-h-32 flex-wrap gap-2 overflow-y-auto">{d.staff.map(s => (
        <label key={s.id} className="flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-sm"><input type="checkbox" checked={f.staff_ids.includes(s.id)} onChange={x => setF({ ...f, staff_ids: x.target.checked ? [...f.staff_ids, s.id] : f.staff_ids.filter(i => i !== s.id) })} />{s.full_name}</label>))}</div></fieldset>
      <div className="sm:col-span-2"><Field label="Risk assessment"><textarea className="input h-28" placeholder="Hazards, who might be harmed, controls, first aid, ratios…" value={f.risk} onChange={x => setF({ ...f, risk: x.target.value })} /></Field></div>
      {err && <div className="sm:col-span-2"><Alert>{err}</Alert></div>}
      <div className="flex justify-end sm:col-span-2"><button className="btn btn-primary">Save</button></div>
    </form>
  );
}
