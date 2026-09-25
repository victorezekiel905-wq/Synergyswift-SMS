"use client";
import { useState } from "react";
import { useApi, send, Page, PageHeader, Tabs, Alert, Empty, Modal, Field, Stat, fmtDate } from "@/components/ui";

type Criterion = { id: string; label: string; max: number };
type QA = {
  checklists: { id: string; name: string; criteria: Criterion[] }[];
  observations: { id: string; observed_on: string; total: number; max_total: number; strengths: string | null; improvements: string | null; action_plan: string | null; follow_up_on: string | null;
    staff: { full_name: string } | null; subjects: { name: string } | null; class_groups: { name: string } | null; observer: { full_name: string } | null; checklist_id: string }[];
  indicators: {
    term: string | null; score_completion: { class_group: string; subject: string; entered: number; expected: number }[];
    staff_punctuality_30d: number | null; student_signins_today: number; overdue_library_loans: number; pending_requisitions: number; pending_leave: number;
    message_delivery_30d: { total: number; sent: number; failed: number; skipped: number } | null;
  };
};
type Structure = { class_groups: { id: string; name: string }[]; subjects: { id: string; name: string }[] };

const STARTER: Criterion[] = [
  { id: "c1", label: "Lesson objectives are clear and shared with learners", max: 5 },
  { id: "c2", label: "Lesson plan and notes are prepared", max: 5 },
  { id: "c3", label: "Teaching methods engage all learners", max: 5 },
  { id: "c4", label: "Checks for understanding during the lesson", max: 5 },
  { id: "c5", label: "Classroom management and time use", max: 5 },
  { id: "c6", label: "Feedback and marking of learners' work", max: 5 }
];

export default function QaPage() {
  const { data, error, reload } = useApi<QA>("/api/qa");
  const [tab, setTab] = useState<"health" | "observations" | "checklists">("health");
  const ind = data?.indicators;
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
  return (
    <Page wide>
      <PageHeader eyebrow="Quality assurance" title="School health & lesson observations"
        subtitle="Indicators are computed from live data: score entry, staff punctuality, library, approvals and parent message delivery." />
      {error && <Alert>{error}</Alert>}
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "health", label: "Indicators" }, { id: "observations", label: "Observations" }, { id: "checklists", label: "Checklists" }]} />
      {tab === "health" && ind && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Stat label="Staff punctuality (30d)" value={ind.staff_punctuality_30d === null ? "—" : `${ind.staff_punctuality_30d}%`} tone={ind.staff_punctuality_30d !== null && ind.staff_punctuality_30d < 85 ? "warn" : "good"} />
            <Stat label="Student sign-ins today" value={ind.student_signins_today} />
            <Stat label="Overdue library books" value={ind.overdue_library_loans} tone={ind.overdue_library_loans ? "warn" : undefined} />
            <Stat label="Pending requisitions" value={ind.pending_requisitions} />
            <Stat label="Pending leave" value={ind.pending_leave} />
            <Stat label="Messages delivered (30d)" value={ind.message_delivery_30d ? `${pct(ind.message_delivery_30d.sent, ind.message_delivery_30d.total)}%` : "—"}
              hint={ind.message_delivery_30d ? `${ind.message_delivery_30d.failed} failed · ${ind.message_delivery_30d.skipped} not configured` : undefined}
              tone={ind.message_delivery_30d && ind.message_delivery_30d.failed ? "bad" : "good"} />
          </div>
          <section className="card p-5">
            <h2 className="mb-1 font-semibold">Score entry progress {ind.term ? `· ${ind.term}` : ""}</h2>
            <p className="mb-3 text-xs text-slate-500">Scores entered compared with students × assessment components. Lowest first.</p>
            {!ind.score_completion.length ? <Empty>No subject offerings or no current term.</Empty> : (
              <div className="max-h-[420px] space-y-2 overflow-y-auto">
                {ind.score_completion.map((r, i) => {
                  const p = pct(r.entered, r.expected);
                  return (
                    <div key={i} className="grid grid-cols-[1fr_2fr_auto] items-center gap-3 text-sm">
                      <span className="truncate">{r.class_group} · {r.subject}</span>
                      <div className="h-2 rounded-full bg-slate-100" role="progressbar" aria-valuenow={p} aria-valuemin={0} aria-valuemax={100}><div className={"h-2 rounded-full " + (p >= 100 ? "bg-emerald-500" : p >= 50 ? "bg-amber-500" : "bg-rose-500")} style={{ width: `${Math.min(p, 100)}%` }} /></div>
                      <span className="w-12 text-right tabular-nums">{p}%</span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}
      {tab === "observations" && data && <Observations data={data} onSaved={reload} />}
      {tab === "checklists" && data && <Checklists data={data} onSaved={reload} />}
    </Page>
  );
}

function Observations({ data, onSaved }: { data: QA; onSaved: () => void }) {
  const { data: staff } = useApi<{ id: string; full_name: string }[]>("/api/hr/staff");
  const { data: structure } = useApi<Structure>("/api/school/structure");
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<{ checklist_id: string; staff_id: string; subject_id: string; class_group_id: string; observed_on: string; scores: Record<string, number>; strengths: string; improvements: string; action_plan: string; follow_up_on: string }>({
    checklist_id: "", staff_id: "", subject_id: "", class_group_id: "", observed_on: new Date().toISOString().slice(0, 10), scores: {}, strengths: "", improvements: "", action_plan: "", follow_up_on: "" });
  const [err, setErr] = useState<string | null>(null);
  const cl = data.checklists.find(c => c.id === f.checklist_id);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const r = await send("/api/qa", { action: "observe", ...f, subject_id: f.subject_id || null, class_group_id: f.class_group_id || null, follow_up_on: f.follow_up_on || null });
    if (!r.ok) return setErr(r.error);
    setOpen(false); setErr(null); onSaved();
  }
  return (
    <div>
      <button className="btn btn-primary mb-4" disabled={!data.checklists.length} onClick={() => { setF(x => ({ ...x, checklist_id: data.checklists[0]?.id ?? "" })); setOpen(true); }}>+ Record observation</button>
      {!data.checklists.length && <Alert tone="amber">Create a checklist first.</Alert>}
      {!data.observations.length ? <Empty>No observations yet.</Empty> : (
        <div className="space-y-3">
          {data.observations.map(o => (
            <div key={o.id} className="card p-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{o.staff?.full_name}</span>
                <span className="text-slate-500">{o.subjects?.name ?? ""} {o.class_groups?.name ?? ""} · {fmtDate(o.observed_on)} · by {o.observer?.full_name}</span>
                <span className="ml-auto text-lg font-bold tabular-nums">{Math.round((Number(o.total) / Math.max(Number(o.max_total), 1)) * 100)}%</span>
              </div>
              {o.strengths && <p className="mt-2"><b>Strengths:</b> {o.strengths}</p>}
              {o.improvements && <p><b>To improve:</b> {o.improvements}</p>}
              {o.action_plan && <p><b>Action plan:</b> {o.action_plan}{o.follow_up_on ? ` (follow up ${fmtDate(o.follow_up_on)})` : ""}</p>}
            </div>
          ))}
        </div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Lesson observation" wide>
        <form onSubmit={save} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Checklist"><select className="input" value={f.checklist_id} onChange={e => setF({ ...f, checklist_id: e.target.value, scores: {} })}>{data.checklists.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
            <Field label="Teacher"><select className="input" required value={f.staff_id} onChange={e => setF({ ...f, staff_id: e.target.value })}><option value="">—</option>{(staff ?? []).map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select></Field>
            <Field label="Date"><input className="input" type="date" value={f.observed_on} onChange={e => setF({ ...f, observed_on: e.target.value })} /></Field>
            <Field label="Subject"><select className="input" value={f.subject_id} onChange={e => setF({ ...f, subject_id: e.target.value })}><option value="">—</option>{(structure?.subjects ?? []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
            <Field label="Class"><select className="input" value={f.class_group_id} onChange={e => setF({ ...f, class_group_id: e.target.value })}><option value="">—</option>{(structure?.class_groups ?? []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          </div>
          <table className="w-full text-sm">
            <tbody>
              {(cl?.criteria ?? []).map(c => (
                <tr key={c.id} className="border-t border-slate-100">
                  <td className="py-2 pr-2">{c.label}</td>
                  <td className="whitespace-nowrap py-2">
                    {Array.from({ length: c.max + 1 }, (_, n) => (
                      <label key={n} className="mr-1 inline-flex cursor-pointer items-center">
                        <input type="radio" className="sr-only peer" name={c.id} checked={f.scores[c.id] === n} onChange={() => setF({ ...f, scores: { ...f.scores, [c.id]: n } })} />
                        <span className="grid h-7 w-7 place-items-center rounded border border-slate-300 text-xs peer-checked:border-brand-600 peer-checked:bg-brand-600 peer-checked:text-white">{n}</span>
                      </label>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Field label="Strengths"><textarea className="input h-16" value={f.strengths} onChange={e => setF({ ...f, strengths: e.target.value })} /></Field>
          <Field label="Areas to improve"><textarea className="input h-16" value={f.improvements} onChange={e => setF({ ...f, improvements: e.target.value })} /></Field>
          <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
            <Field label="Action plan"><textarea className="input h-16" value={f.action_plan} onChange={e => setF({ ...f, action_plan: e.target.value })} /></Field>
            <Field label="Follow up on"><input className="input" type="date" value={f.follow_up_on} onChange={e => setF({ ...f, follow_up_on: e.target.value })} /></Field>
          </div>
          {err && <Alert>{err}</Alert>}
          <div className="flex justify-end"><button className="btn btn-primary">Save observation</button></div>
        </form>
      </Modal>
    </div>
  );
}

function Checklists({ data, onSaved }: { data: QA; onSaved: () => void }) {
  const [edit, setEdit] = useState<{ id?: string; name: string; criteria: Criterion[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function save() {
    if (!edit) return;
    const r = await send("/api/qa", { action: "save_checklist", ...edit, criteria: edit.criteria.map((c, i) => ({ ...c, id: c.id || `c${i + 1}`, max: Number(c.max) })) });
    if (!r.ok) return setErr(r.error);
    setEdit(null); setErr(null); onSaved();
  }
  return (
    <div className="space-y-3">
      <button className="btn btn-primary" onClick={() => setEdit({ name: "Lesson observation", criteria: STARTER })}>+ New checklist</button>
      {data.checklists.map(c => (
        <div key={c.id} className="card flex items-center justify-between p-4 text-sm">
          <span><b>{c.name}</b> · {c.criteria.length} criteria · max {c.criteria.reduce((a, x) => a + x.max, 0)}</span>
          <button className="btn btn-ghost text-xs" onClick={() => setEdit({ id: c.id, name: c.name, criteria: c.criteria })}>Edit</button>
        </div>
      ))}
      <Modal open={Boolean(edit)} onClose={() => setEdit(null)} title="Checklist" wide>
        {edit && (
          <div className="space-y-3">
            <Field label="Name"><input className="input" value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} /></Field>
            {edit.criteria.map((c, i) => (
              <div key={i} className="flex gap-2">
                <input className="input" value={c.label} onChange={e => setEdit({ ...edit, criteria: edit.criteria.map((x, j) => j === i ? { ...x, label: e.target.value } : x) })} aria-label="Criterion" />
                <input className="input w-20" type="number" min={1} max={10} value={c.max} onChange={e => setEdit({ ...edit, criteria: edit.criteria.map((x, j) => j === i ? { ...x, max: Number(e.target.value) } : x) })} aria-label="Max points" />
                <button className="btn btn-ghost px-2 text-rose-600" onClick={() => setEdit({ ...edit, criteria: edit.criteria.filter((_, j) => j !== i) })} aria-label="Remove">✕</button>
              </div>
            ))}
            <button className="btn btn-ghost text-xs" onClick={() => setEdit({ ...edit, criteria: [...edit.criteria, { id: `c${Date.now().toString(36)}`, label: "", max: 5 }] })}>+ Add criterion</button>
            {err && <Alert>{err}</Alert>}
            <div className="flex justify-end"><button className="btn btn-primary" onClick={save}>Save checklist</button></div>
          </div>
        )}
      </Modal>
    </div>
  );
}
