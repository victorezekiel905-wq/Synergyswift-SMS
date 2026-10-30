"use client";
import { useEffect, useState } from "react";
import { useApi, send, Alert, Empty, Modal, Field, Badge, Loading, Stat, Tabs, fmtDate } from "@/components/ui";

type Plan = {
  id: string; name: string; level: string; intake: string; exam_id: string | null; status: "draft" | "open" | "closed";
  assign_on: "submitted" | "fee_paid" | "manual"; where_mode: "online" | "centre" | "choice"; face_check: boolean; seb_at_centre: boolean; seb_at_home?: boolean;
  test_weight: number; interview_weight: number; report_weight: number; pass_mark: number; section_pass_marks: Record<string, number>;
  borderline_band: number; interview_for: "none" | "borderline" | "passed" | "everyone"; decision_mode: "auto" | "approve"; waitlist_size: number;
  release_at: string | null; show_scores: boolean; offer_valid_days: number | null; acceptance_fee: number | null; class_group_id: string | null;
  exams?: { title: string } | null;
};
type Sitting = { id: string; plan_id: string; kind: "online" | "centre"; centre: string | null; address: string | null; starts_at: string; ends_at: string; seats: number | null;
  booked: number; checked_in: number; started: number; submitted: number; absent: number };
type Cand = { id: string; application_no: string; name: string; status: string; previous_school: string | null; source: string; test: number | null; sections: Record<string, number>;
  interview: number | null; report: number | null; score: number | null; rank: number | null; proposed: "offer" | "interview" | "waitlist" | "regret" | null; reason: string | null;
  waitlist_position: number | null; decided_at: string | null; lead_id: string | null;
  attempt: { id: string; status: string; absent: boolean; face_flags: number; violations: number; sitting_id: string | null; checked_in: boolean } | null };
type Analytics = { applicants: number; tested: number; absent: number; passed: number; offered: number; joined: number; average: number | null;
  spread: { from: number; to: number; count: number }[]; feeder_schools: Group[]; sources: Group[]; hardest: Q[]; easiest: Q[] };
type Group = { label: string; applicants: number; average: number | null; offered: number; joined: number };
type Q = { id: string; prompt: string; answered: number; percent: number | null };
type Data = { plans: Plan[]; sittings: Sitting[]; exams: { id: string; title: string; duration_minutes: number }[]; classes: { id: string; name: string }[];
  capacity: { level: string; intake: string; seats: number }[]; merit?: { seats_left: number | null; candidates: Cand[]; analytics: Analytics };
  /** Where families check results (needs the school's public web address, set under Setup). */
  results_url?: string | null };

const DECISION: Record<string, { label: string; tone: "green" | "amber" | "red" | "blue" }> = {
  offer: { label: "Offer", tone: "green" }, waitlist: { label: "Waiting list", tone: "amber" }, regret: { label: "Regret", tone: "red" }, interview: { label: "Interview", tone: "blue" }
};
const STATUS: Record<string, string> = { new: "New", reviewing: "Reviewing", assessment: "Test", interview: "Interview", offered: "Offered", accepted: "Accepted", enrolled: "Enrolled",
  rejected: "Not offered", withdrawn: "Withdrawn", waitlisted: "Waiting list", declined: "Declined", expired: "Offer expired" };
const BLANK: Omit<Plan, "id"> = {
  name: "", level: "", intake: "", exam_id: null, status: "open", assign_on: "fee_paid", where_mode: "online", face_check: false, seb_at_centre: true, seb_at_home: false,
  test_weight: 100, interview_weight: 0, report_weight: 0, pass_mark: 50, section_pass_marks: {}, borderline_band: 5, interview_for: "borderline",
  decision_mode: "approve", waitlist_size: 10, release_at: null, show_scores: false, offer_valid_days: null, acceptance_fee: null, class_group_id: null
};
const local = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : "");
const toIso = (v: string) => (v ? new Date(v).toISOString() : null);

/** Entrance exams: rules per intake, sittings and centres, the merit list with decisions, and analytics (phase 14e). */
export default function Entrance({ onOpenLead }: { onOpenLead: (id: string) => void }) {
  const [planId, setPlanId] = useState<string | null>(null);
  const { data, error, reload } = useApi<Data>(`/api/admissions/entrance${planId ? `?plan=${planId}` : ""}`, [planId]);
  const [view, setView] = useState<"merit" | "sittings" | "analytics">("merit");
  const [editPlan, setEditPlan] = useState<Partial<Plan> | null>(null);
  const [editSitting, setEditSitting] = useState<Partial<Sitting> | null>(null);
  const [photos, setPhotos] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!planId && data?.plans?.length) setPlanId(data.plans[0]!.id); }, [data, planId]);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;

  const act = async (body: Record<string, unknown>, ok: (d: any) => string) => {
    setBusy(true);
    const r = await send("/api/admissions/entrance", body);
    setBusy(false);
    setMsg({ ok: r.ok, text: r.ok ? ok(r.data) : r.error ?? "failed" });
    if (r.ok) reload();
    return r;
  };
  const plan = data.plans.find(p => p.id === planId) ?? null;
  const sittings = data.sittings.filter(s => s.plan_id === planId);
  const merit = data.merit;
  const released = plan && plan.release_at && new Date(plan.release_at) <= new Date();
  const pending = (merit?.candidates ?? []).filter(c => c.proposed && c.proposed !== "interview" && !["offered", "accepted", "enrolled", "rejected"].includes(c.status) && !(c.proposed === "waitlist" && c.status === "waitlisted"));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {data.plans.map(p => (
          <button key={p.id} onClick={() => { setPlanId(p.id); setPicked(new Set()); setMsg(null); }}
            className={"rounded-full border px-3 py-1.5 text-sm font-medium " + (p.id === planId ? "border-brand-700 bg-brand-700 text-white" : "border-slate-300 bg-white hover:border-slate-500")}>
            {p.name}{p.status !== "open" ? ` (${p.status})` : ""}
          </button>
        ))}
        <button className="btn btn-primary" onClick={() => setEditPlan({ ...BLANK })}>+ New intake</button>
      </div>
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}

      {!plan ? (
        <Empty>Set up an intake (for example, JSS1 September 2027): choose the entrance test and the rules once. Applicants then get the test automatically, families are told when and where, results are marked, and decisions, waiting list and enrolment follow from the merit list.</Empty>
      ) : (<>
        <section className="card p-4">
          <div className="flex flex-wrap items-start gap-3">
            <div className="flex-1">
              <p className="text-lg font-semibold">{plan.name} <Badge tone={plan.status === "open" ? "green" : "slate"}>{plan.status}</Badge></p>
              <p className="text-sm text-slate-600">{plan.level}{plan.intake ? ` · ${plan.intake}` : ""} · test: {plan.exams?.title ?? <b className="text-amber-700">not chosen yet</b>}</p>
              <p className="mt-1 text-xs text-slate-500">
                {plan.assign_on === "submitted" ? "Test sent when the application arrives" : plan.assign_on === "fee_paid" ? "Test sent when the form fee is paid" : "Tests assigned by hand"} ·{" "}
                {plan.where_mode === "online" ? "online at home" : plan.where_mode === "centre" ? "at a test centre with a PIN" : "families choose online or a centre"}{plan.face_check ? " · camera check at home" : ""}{plan.seb_at_home && plan.where_mode !== "centre" ? " · Safe Exam Browser at home" : ""} ·{" "}
                pass mark {plan.pass_mark}{plan.interview_for !== "none" ? ` · interview: ${plan.interview_for}` : ""} ·{" "}
                {plan.decision_mode === "auto" ? "decisions sent automatically" : "decisions need your approval"} ·{" "}
                {released ? `results released ${fmtDate(plan.release_at!)}` : plan.release_at ? `results out ${fmtDate(plan.release_at, true)}` : "results go out as candidates finish"}
              </p>
              {data.results_url && <p className="mt-1 text-xs text-slate-600">Families check results at <a className="font-medium text-brand-700 underline" href={data.results_url} target="_blank" rel="noreferrer">{data.results_url}</a></p>}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button className="btn btn-ghost" onClick={() => setEditPlan(plan)}>Edit rules</button>
              <button className="btn btn-ghost" disabled={busy} onClick={() => act({ action: "assign_waiting", plan_id: plan.id }, d => `${d.assigned} applicant${d.assigned === 1 ? "" : "s"} given the test.`)}>Assign waiting applicants</button>
              {!released && <button className="btn btn-ghost" disabled={busy} onClick={() => confirm("Release results now? Families can check results, and automatic decisions go out.") &&
                act({ action: "release", plan_id: plan.id }, d => `Results released. ${d.decisions} decision${d.decisions === 1 ? "" : "s"} sent.`)}>Release results</button>}
              <button className="btn btn-primary" disabled={busy} onClick={() => confirm("Enrol every accepted child whose acceptance fee is paid? They become students with first-term invoices, and their parents get sign-ins.") &&
                act({ action: "enrol", plan_id: plan.id }, d => `${d.enrolled} enrolled${d.waiting_for_fee ? `, ${d.waiting_for_fee} waiting for the acceptance fee` : ""}${d.invoices ? `, ${d.invoices} invoices made` : ""}.${d.problems?.length ? ` Problems: ${d.problems.join("; ")}` : ""}`)}>Enrol accepted</button>
            </div>
          </div>
        </section>

        <Tabs value={view} onChange={setView} tabs={[{ id: "merit", label: "Merit list" }, { id: "sittings", label: `Sittings (${sittings.length})` }, { id: "analytics", label: "Analytics" }]} />

        {view === "merit" && (!merit ? <Loading /> : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-slate-600">{merit.seats_left === null ? "No seat limit set for this class (add one under Setup)." : `${merit.seats_left} seat${merit.seats_left === 1 ? "" : "s"} left in ${plan.level}.`}</span>
              {pending.length > 0 && <>
                <span className="ml-auto text-slate-600">{pending.length} decision{pending.length === 1 ? "" : "s"} ready{picked.size ? `, ${picked.size} ticked` : ""}</span>
                <button className="btn btn-primary" disabled={busy} onClick={() => confirm(`Send ${picked.size || pending.length} decision letter(s) now?`) &&
                  act({ action: "send", plan_id: plan.id, ids: picked.size ? [...picked] : null }, d => `${d.decisions} decision${d.decisions === 1 ? "" : "s"} sent.`).then(() => setPicked(new Set()))}>
                  {picked.size ? "Send ticked decisions" : "Send all decisions"}</button>
              </>}
            </div>
            {!merit.candidates.length ? <Empty>No applicants for {plan.level} yet.</Empty> : (
              <div className="card overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr>
                    <th className="p-2" /><th className="p-2">#</th><th className="p-2">Applicant</th><th className="p-2">Test</th><th className="p-2">Interview</th><th className="p-2">Report</th>
                    <th className="p-2">Score</th><th className="p-2">Decision</th><th className="p-2">Status</th><th className="p-2">Test day</th>
                  </tr></thead>
                  <tbody className="divide-y divide-slate-100">{merit.candidates.map(c => {
                    const d = c.proposed ? DECISION[c.proposed] : null;
                    const sendable = pending.some(p => p.id === c.id);
                    const sit = c.attempt?.sitting_id ? sittings.find(s => s.id === c.attempt!.sitting_id) : null;
                    return (
                      <tr key={c.id} className="align-top">
                        <td className="p-2">{sendable && <input type="checkbox" aria-label={`Tick ${c.name}`} checked={picked.has(c.id)} onChange={e => setPicked(s => { const n = new Set(s); e.target.checked ? n.add(c.id) : n.delete(c.id); return n; })} />}</td>
                        <td className="p-2 font-semibold tabular-nums">{c.rank ?? ""}</td>
                        <td className="p-2"><button className="font-medium text-brand-700 hover:underline disabled:text-slate-900" disabled={!c.lead_id} onClick={() => c.lead_id && onOpenLead(c.lead_id)}>{c.name}</button>
                          <p className="text-xs text-slate-500">{c.application_no}{c.previous_school ? ` · ${c.previous_school}` : ""}</p></td>
                        <td className="p-2 tabular-nums">{c.test ?? <span className="text-slate-400">{c.attempt?.absent ? "absent" : c.attempt?.status === "submitted" ? "to mark" : c.attempt?.status === "in_progress" ? "writing" : "—"}</span>}
                          {Object.keys(c.sections).length > 0 && <p className="text-[11px] text-slate-500">{Object.entries(c.sections).map(([s, v]) => `${s} ${v}`).join(" · ")}</p>}
                          {c.attempt && (c.attempt.face_flags > 0 || c.attempt.violations > 0) && <button className="text-[11px] font-medium text-amber-700 underline" onClick={() => setPhotos(c.attempt!.id)}>
                            {c.attempt.face_flags ? `${c.attempt.face_flags} camera flag${c.attempt.face_flags === 1 ? "" : "s"}` : ""}{c.attempt.face_flags && c.attempt.violations ? ", " : ""}{c.attempt.violations ? `${c.attempt.violations} left the page` : ""}</button>}</td>
                        <td className="p-2 tabular-nums">{c.interview ?? "—"}</td>
                        <td className="p-2"><ReportScore value={c.report} disabled={plan.report_weight === 0}
                          onSave={v => act({ action: "report_score", application_id: c.id, score: v }, () => "Report score saved.")} /></td>
                        <td className="p-2 font-semibold tabular-nums">{c.score ?? "—"}</td>
                        <td className="p-2">{d ? <span title={c.reason ?? ""}><Badge tone={d.tone}>{d.label}{c.proposed === "waitlist" && c.waitlist_position ? ` ${c.waitlist_position}` : ""}</Badge></span> : <span className="text-xs text-slate-400">{c.reason}</span>}
                          {c.reason && d && <p className="max-w-[16rem] text-[11px] text-slate-500">{c.reason}</p>}</td>
                        <td className="p-2 text-xs">{STATUS[c.status] ?? c.status}</td>
                        <td className="p-2 text-xs">
                          {sit ? <>{sit.kind === "online" ? "Online" : sit.centre} · {fmtDate(sit.starts_at, true)}</> : c.attempt ? <span className="text-slate-400">{plan.where_mode === "choice" ? "family to choose" : "waiting for a seat"}</span> : ""}
                          {c.attempt?.status === "assigned" && sittings.length > 0 && (
                            <select className="mt-1 block rounded border border-slate-200 text-xs" aria-label={`Move ${c.name} to another sitting`} value="" onChange={e => e.target.value && act({ action: "move", attempt_id: c.attempt!.id, sitting_id: e.target.value }, () => "Moved. The family gets the new details.")}>
                              <option value="">Move to…</option>
                              {sittings.filter(s => s.id !== c.attempt!.sitting_id && new Date(s.ends_at) > new Date()).map(s => <option key={s.id} value={s.id}>{s.kind === "online" ? "Online" : s.centre} · {fmtDate(s.starts_at, true)}</option>)}
                            </select>)}
                          {c.attempt?.status === "assigned" && sit?.kind === "centre" && <button className="mt-1 block text-[11px] text-brand-700 underline" onClick={() => confirm(`Give ${c.name} a new test PIN? The old one stops working.`) &&
                            act({ action: "reset_pin", attempt_id: c.attempt!.id }, d => `New PIN for ${c.name}: ${d.pin}. Write it on a slip; it is not shown again.`)}>New PIN</button>}
                        </td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              </div>
            )}
            <p className="text-xs text-slate-500">The merit list updates every minute. Interviews for borderline candidates are booked automatically into your interview sessions (Tours & open days). Hover a decision to see why.</p>
          </div>
        ))}

        {view === "sittings" && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <button className="btn btn-primary" onClick={() => setEditSitting({ plan_id: plan.id, kind: plan.where_mode === "online" ? "online" : "centre" })}>+ Add sitting</button>
              <a className="btn btn-ghost" href="/entrance/pin" target="_blank" rel="noreferrer">Open the PIN screen (for centre computers)</a>
            </div>
            {!sittings.length ? <Empty>No sittings yet. Add an online window (families take the test at home between two times) or a session at a centre with a number of seats.</Empty> : (
              <div className="grid gap-3 lg:grid-cols-2">{sittings.map(s => (
                <section key={s.id} className="card p-4">
                  <div className="flex flex-wrap items-start gap-2">
                    <div className="flex-1"><p className="font-semibold">{s.kind === "online" ? "Online window" : s.centre}</p>
                      <p className="text-xs text-slate-500">{fmtDate(s.starts_at, true)} to {fmtDate(s.ends_at, true)}{s.address ? ` · ${s.address}` : ""}</p></div>
                    <Badge tone={s.seats !== null && s.booked >= s.seats ? "red" : "green"}>{s.booked}{s.seats !== null ? `/${s.seats}` : ""} booked</Badge>
                  </div>
                  <dl className="mt-3 grid grid-cols-4 gap-2 text-center text-xs">
                    {s.kind === "centre" && <div><dt className="text-slate-500">Checked in</dt><dd className="text-lg font-semibold">{s.checked_in}</dd></div>}
                    <div><dt className="text-slate-500">Writing</dt><dd className="text-lg font-semibold">{s.started}</dd></div>
                    <div><dt className="text-slate-500">Handed in</dt><dd className="text-lg font-semibold">{s.submitted}</dd></div>
                    <div><dt className="text-slate-500">Absent</dt><dd className="text-lg font-semibold">{s.absent}</dd></div>
                  </dl>
                  <div className="mt-3 flex flex-wrap gap-1">
                    <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setEditSitting(s)}>Edit</button>
                    {s.kind === "centre" && plan.seb_at_centre && <a className="btn btn-ghost px-2 py-1 text-xs" href={`/api/admissions/entrance?seb=${s.id}`}>Safe Exam Browser file</a>}
                    <button className="btn btn-ghost px-2 py-1 text-xs text-rose-700" onClick={() => confirm(s.booked ? `Delete this sitting? ${s.booked} candidate(s) go back to waiting for a seat and will be told the new details.` : "Delete this sitting?") &&
                      act({ action: "delete_sitting", id: s.id }, () => "Sitting deleted.")}>Delete</button>
                  </div>
                </section>
              ))}</div>
            )}
          </div>
        )}

        {view === "analytics" && (!merit ? <Loading /> : <EntranceAnalytics a={merit.analytics} passMark={plan.pass_mark} />)}
      </>)}

      <Modal open={Boolean(editPlan)} onClose={() => setEditPlan(null)} title={editPlan?.id ? "Edit intake rules" : "New intake"} wide>
        {editPlan && <PlanForm plan={editPlan} exams={data.exams} classes={data.classes} levels={[...new Set(data.capacity.map(c => c.level))]}
          onCancel={() => setEditPlan(null)} onSaved={(p, text) => { setEditPlan(null); setPlanId(p.id); setMsg({ ok: true, text }); reload(); }} />}
      </Modal>
      <Modal open={Boolean(editSitting)} onClose={() => setEditSitting(null)} title={editSitting?.id ? "Edit sitting" : "Add sitting"}>
        {editSitting && <SittingForm sitting={editSitting} onCancel={() => setEditSitting(null)} onSaved={text => { setEditSitting(null); setMsg({ ok: true, text }); reload(); }} />}
      </Modal>
      <Modal open={Boolean(photos)} onClose={() => setPhotos(null)} title="Camera photos and flags" wide>
        {photos && <Photos attempt={photos} />}
      </Modal>
    </div>
  );
}

function ReportScore({ value, disabled, onSave }: { value: number | null; disabled: boolean; onSave: (v: number | null) => void }) {
  const [v, setV] = useState(value === null ? "" : String(value));
  useEffect(() => setV(value === null ? "" : String(value)), [value]);
  if (disabled) return <span className="text-slate-400">—</span>;
  return <input className="w-16 rounded border border-slate-200 px-1 py-0.5 text-sm tabular-nums" inputMode="decimal" aria-label="Previous school report score out of 100" value={v}
    onChange={e => setV(e.target.value)} onBlur={() => { const n = v.trim() === "" ? null : Math.max(0, Math.min(100, Number(v))); if (n !== value && (n === null || Number.isFinite(n))) onSave(n); }} />;
}

function PlanForm({ plan, exams, classes, levels, onCancel, onSaved }: {
  plan: Partial<Plan>; exams: Data["exams"]; classes: Data["classes"]; levels: string[]; onCancel: () => void; onSaved: (p: Plan, text: string) => void;
}) {
  const [p, setP] = useState<Partial<Plan>>({ ...BLANK, ...plan });
  const [sections, setSections] = useState<{ s: string; m: string }[]>(Object.entries(plan.section_pass_marks ?? {}).map(([s, m]) => ({ s, m: String(m) })));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (x: Partial<Plan>) => setP(cur => ({ ...cur, ...x }));
  const total = Number(p.test_weight ?? 0) + Number(p.interview_weight ?? 0) + Number(p.report_weight ?? 0);
  async function save() {
    setBusy(true); setErr(null);
    const body = { ...p, action: "save_plan", exams: undefined, created_at: undefined, updated_at: undefined, tenant_id: undefined, created_by: undefined,
      section_pass_marks: Object.fromEntries(sections.filter(x => x.s.trim() && x.m !== "").map(x => [x.s.trim(), Number(x.m)])),
      release_at: p.release_at ?? null, offer_valid_days: p.offer_valid_days || null, acceptance_fee: p.acceptance_fee === null || (p.acceptance_fee as unknown) === "" ? null : Number(p.acceptance_fee) };
    const r = await send<{ plan: Plan }>("/api/admissions/entrance", body);
    setBusy(false);
    if (!r.ok) return setErr(r.error ?? "failed");
    onSaved(r.data.plan, plan.id ? "Rules saved." : "Intake created. Applicants for this class now get the test automatically.");
  }
  const num = (k: keyof Plan) => ({ value: (p[k] as number | null) ?? "", onChange: (e: React.ChangeEvent<HTMLInputElement>) => set({ [k]: e.target.value === "" ? null : Number(e.target.value) } as Partial<Plan>) });
  return (
    <div className="space-y-5">
      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-1 font-semibold">Intake</legend>
        <Field label="Name" hint="For example, JSS1 September 2027"><input className="input" value={p.name ?? ""} onChange={e => set({ name: e.target.value })} /></Field>
        <Field label="Class applied for" hint="Must match the class families choose on the application form">
          <input className="input" list="entrance-levels" value={p.level ?? ""} onChange={e => set({ level: e.target.value })} />
          <datalist id="entrance-levels">{levels.map(l => <option key={l} value={l} />)}</datalist></Field>
        <Field label="Intake label (optional)" hint="Only when the same class has two intakes"><input className="input" value={p.intake ?? ""} onChange={e => set({ intake: e.target.value })} /></Field>
        <Field label="Entrance test" hint="A paper from Exams (any question types; sections give section scores)">
          <select className="input" value={p.exam_id ?? ""} onChange={e => set({ exam_id: e.target.value || null })}><option value="">Choose…</option>{exams.map(x => <option key={x.id} value={x.id}>{x.title} ({x.duration_minutes} min)</option>)}</select></Field>
        <Field label="Status"><select className="input" value={p.status} onChange={e => set({ status: e.target.value as Plan["status"] })}><option value="open">Open</option><option value="draft">Draft (nothing automatic)</option><option value="closed">Closed</option></select></Field>
        <Field label="Enrol new students into"><select className="input" value={p.class_group_id ?? ""} onChange={e => set({ class_group_id: e.target.value || null })}><option value="">Choose later</option>{classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-1 font-semibold">When and where</legend>
        <Field label="Send the test"><select className="input" value={p.assign_on} onChange={e => set({ assign_on: e.target.value as Plan["assign_on"] })}>
          <option value="fee_paid">When the form fee is paid</option><option value="submitted">As soon as the application arrives</option><option value="manual">Only when we assign it</option></select></Field>
        <Field label="Taken"><select className="input" value={p.where_mode} onChange={e => set({ where_mode: e.target.value as Plan["where_mode"] })}>
          <option value="online">Online at home</option><option value="centre">At a test centre (PIN on the school&apos;s computer)</option><option value="choice">Family chooses online or a centre</option></select></Field>
        {p.where_mode !== "centre" && <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={Boolean(p.face_check)} onChange={e => set({ face_check: e.target.checked })} />
          <span>Camera check at home: a photo every minute, flagged when no face or two faces are seen</span></label>}
        {p.where_mode !== "centre" && <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={Boolean(p.seb_at_home)} onChange={e => set({ seb_at_home: e.target.checked })} />
          <span>Safe Exam Browser at home: the test opens only in Safe Exam Browser, which locks the device until it is submitted. Each family gets its own file from the test link. Works on Windows, Mac and iPad, not on Android phones or Chromebooks.</span></label>}
        {p.where_mode !== "online" && <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={p.seb_at_centre !== false} onChange={e => set({ seb_at_centre: e.target.checked })} />
          <span>Centre computers must use Safe Exam Browser (download its file from each sitting)</span></label>}
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-3">
        <legend className="mb-1 font-semibold">Marks</legend>
        <Field label="Test weight %"><input className="input" type="number" min={1} max={100} {...num("test_weight")} /></Field>
        <Field label="Interview weight %"><input className="input" type="number" min={0} max={100} {...num("interview_weight")} /></Field>
        <Field label="School report weight %"><input className="input" type="number" min={0} max={100} {...num("report_weight")} /></Field>
        {total !== 100 && <p className="text-xs text-rose-700 sm:col-span-3">The weights add up to {total}; they must add up to 100.</p>}
        <Field label="Pass mark (out of 100)"><input className="input" type="number" min={0} max={100} {...num("pass_mark")} /></Field>
        <Field label="Borderline band" hint="Points under the pass mark that still earn an interview"><input className="input" type="number" min={0} max={50} {...num("borderline_band")} /></Field>
        <Field label="Interview"><select className="input" value={p.interview_for} onChange={e => set({ interview_for: e.target.value as Plan["interview_for"] })}>
          <option value="borderline">Borderline candidates</option><option value="passed">Everyone who passed</option><option value="everyone">Everyone</option><option value="none">No interviews</option></select></Field>
        <div className="sm:col-span-3">
          <p className="label">Pass mark per section (optional)</p>
          <p className="hint">Section names as in the test, e.g. Mathematics 40. A candidate below any of these does not pass.</p>
          {sections.map((x, i) => (
            <div key={i} className="mt-1 flex gap-2">
              <input className="input" placeholder="Section" value={x.s} onChange={e => setSections(s => s.map((y, j) => j === i ? { ...y, s: e.target.value } : y))} />
              <input className="input w-24" type="number" min={0} max={100} placeholder="Min" value={x.m} onChange={e => setSections(s => s.map((y, j) => j === i ? { ...y, m: e.target.value } : y))} />
              <button className="btn btn-ghost" aria-label="Remove section" onClick={() => setSections(s => s.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          <button className="btn btn-ghost mt-1 text-xs" onClick={() => setSections(s => [...s, { s: "", m: "40" }])}>+ Section pass mark</button>
        </div>
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-1 font-semibold">Decisions</legend>
        <Field label="Decision letters"><select className="input" value={p.decision_mode} onChange={e => set({ decision_mode: e.target.value as Plan["decision_mode"] })}>
          <option value="approve">I approve them first</option><option value="auto">Send automatically</option></select></Field>
        <Field label="Release results on" hint="Empty: each family hears as soon as their child's result is ready">
          <input className="input" type="datetime-local" value={local(p.release_at ?? null)} onChange={e => set({ release_at: toIso(e.target.value) })} /></Field>
        <Field label="Waiting list size" hint="0 = no limit"><input className="input" type="number" min={0} max={10000} {...num("waitlist_size")} /></Field>
        <label className="flex items-start gap-2 self-end text-sm"><input type="checkbox" className="mt-0.5" checked={Boolean(p.show_scores)} onChange={e => set({ show_scores: e.target.checked })} />
          <span>Show families the entrance score with the result</span></label>
        <Field label="Offer valid for (days)" hint="Empty: the school's usual"><input className="input" type="number" min={1} max={120} {...num("offer_valid_days")} /></Field>
        <Field label="Acceptance fee" hint="Empty: the school's usual"><input className="input" type="number" min={0} {...num("acceptance_fee")} /></Field>
      </fieldset>
      {err && <Alert>{err}</Alert>}
      <div className="flex justify-end gap-2"><button className="btn btn-ghost" onClick={onCancel}>Cancel</button><button className="btn btn-primary" disabled={busy || total !== 100} onClick={save}>{busy ? "Saving…" : "Save"}</button></div>
    </div>
  );
}

function SittingForm({ sitting, onCancel, onSaved }: { sitting: Partial<Sitting>; onCancel: () => void; onSaved: (text: string) => void }) {
  const [s, setS] = useState<Partial<Sitting>>(sitting);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true); setErr(null);
    const r = await send<{ seated: number }>("/api/admissions/entrance", { action: "save_sitting", id: s.id ?? null, plan_id: s.plan_id, kind: s.kind ?? "centre",
      centre: s.centre ?? null, address: s.address ?? null, starts_at: s.starts_at, ends_at: s.ends_at, seats: s.seats ?? null });
    setBusy(false);
    if (!r.ok) return setErr(r.error ?? "failed");
    onSaved(`Sitting saved.${r.data.seated ? ` ${r.data.seated} waiting candidate${r.data.seated === 1 ? "" : "s"} booked into it; families are told within a minute.` : ""}`);
  }
  return (
    <div className="space-y-3">
      <Field label="Type"><select className="input" value={s.kind ?? "centre"} onChange={e => setS({ ...s, kind: e.target.value as Sitting["kind"] })}>
        <option value="centre">At a centre</option><option value="online">Online window (at home)</option></select></Field>
      {s.kind !== "online" && <>
        <Field label="Centre" hint="For example, Main hall, Lekki campus"><input className="input" value={s.centre ?? ""} onChange={e => setS({ ...s, centre: e.target.value })} /></Field>
        <Field label="Address"><input className="input" value={s.address ?? ""} onChange={e => setS({ ...s, address: e.target.value })} /></Field>
      </>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Starts"><input className="input" type="datetime-local" value={local(s.starts_at ?? null)} onChange={e => setS({ ...s, starts_at: toIso(e.target.value) ?? undefined })} /></Field>
        <Field label="Ends"><input className="input" type="datetime-local" value={local(s.ends_at ?? null)} onChange={e => setS({ ...s, ends_at: toIso(e.target.value) ?? undefined })} /></Field>
      </div>
      <Field label="Seats" hint="Empty: no limit"><input className="input" type="number" min={1} value={s.seats ?? ""} onChange={e => setS({ ...s, seats: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
      {err && <Alert>{err}</Alert>}
      <div className="flex justify-end gap-2"><button className="btn btn-ghost" onClick={onCancel}>Cancel</button><button className="btn btn-primary" disabled={busy || !s.starts_at || !s.ends_at} onClick={save}>{busy ? "Saving…" : "Save"}</button></div>
    </div>
  );
}

function Photos({ attempt }: { attempt: string }) {
  const { data, error } = useApi<{ photos: { url: string; at: string; faces: number | null }[]; events: { kind: string; at: string }[] }>(`/api/admissions/entrance?attempt=${attempt}`, [attempt]);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  const LABEL: Record<string, string> = { no_face: "No face seen", multiple_faces: "Two or more faces", camera_off: "Camera turned off", checked_in: "Checked in at the centre", seb_refused: "Tried a normal browser" };
  return (
    <div className="space-y-4">
      {data.photos.length ? <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{data.photos.map(p => (
        <figure key={p.url}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={p.url} alt="" className="w-full rounded border border-slate-200" /><figcaption className="text-xs text-slate-500">{fmtDate(p.at, true)}{p.faces !== null && p.faces >= 0 ? ` · ${p.faces} face${p.faces === 1 ? "" : "s"}` : ""}</figcaption></figure>
      ))}</div> : <p className="text-sm text-slate-500">No photos.</p>}
      <ul className="text-sm">{data.events.map((e, i) => <li key={i}>{fmtDate(e.at, true)}: {LABEL[e.kind] ?? e.kind}</li>)}</ul>
      <p className="text-xs text-slate-500">Flags are for a person to look at; nobody is marked down automatically. Photos are deleted after 60 days.</p>
    </div>
  );
}

function EntranceAnalytics({ a, passMark }: { a: Analytics; passMark: number }) {
  const most = Math.max(1, ...a.spread.map(s => s.count));
  const table = (title: string, rows: Group[]) => (
    <section className="card overflow-x-auto p-4">
      <h3 className="font-semibold">{title}</h3>
      <table className="mt-2 w-full text-sm"><thead className="text-left text-xs text-slate-500"><tr><th className="py-1">Name</th><th>Applicants</th><th>Average</th><th>Offered</th><th>Joined</th></tr></thead>
        <tbody>{rows.slice(0, 15).map(r => <tr key={r.label} className="border-t border-slate-100"><td className="py-1">{r.label}</td><td>{r.applicants}</td><td>{r.average ?? "—"}</td><td>{r.offered}</td><td>{r.joined}</td></tr>)}</tbody></table>
    </section>
  );
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Applicants" value={a.applicants} /><Stat label="Took the test" value={a.tested} /><Stat label="Absent" value={a.absent} tone={a.absent ? "warn" : undefined} />
        <Stat label={`Passed (${passMark}+)`} value={a.passed} /><Stat label="Offered" value={a.offered} /><Stat label="Joined" value={a.joined} tone="good" />
      </div>
      <section className="card p-4">
        <h3 className="font-semibold">Test scores{a.average !== null ? `: average ${a.average}` : ""}</h3>
        <div className="mt-3 flex h-36 items-end gap-1.5" role="img" aria-label="How many candidates scored in each band of ten">
          {a.spread.map(s => (
            <div key={s.from} className="flex flex-1 flex-col items-center gap-1">
              <span className="text-[11px] tabular-nums text-slate-600">{s.count || ""}</span>
              <div className={"w-full rounded-t " + (s.from >= passMark ? "bg-brand-600" : "bg-slate-300")} style={{ height: `${(s.count / most) * 100}px` }} />
              <span className="text-[10px] text-slate-500">{s.from}</span>
            </div>
          ))}
        </div>
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        {table("Feeder schools", a.feeder_schools)}
        {table("Where applicants came from", a.sources)}
      </div>
      <section className="card p-4">
        <h3 className="font-semibold">Hardest questions</h3>
        {!a.hardest.length ? <p className="text-sm text-slate-500">Shown once tests are marked.</p> : (
          <ol className="mt-2 space-y-1 text-sm">{a.hardest.map(q => <li key={q.id} className="flex gap-3"><span className="w-14 shrink-0 font-semibold tabular-nums">{q.percent}%</span><span className="flex-1">{q.prompt}</span><span className="text-xs text-slate-500">{q.answered} answered</span></li>)}</ol>
        )}
      </section>
    </div>
  );
}
