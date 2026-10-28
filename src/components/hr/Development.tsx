"use client";
import { useState } from "react";
import { useApi, send, Alert, Empty, Modal, Field, Badge, Tabs, Stat, fmtDate, localDate } from "@/components/ui";
import { weightedScore, ratingLabel, type Criterion } from "@/lib/hr";

type Cycle = { id: string; name: string; starts_on: string; ends_on: string; status: "draft" | "open" | "closed"; criteria: Criterion[]; self_review: boolean };
type ARow = { id: string; cycle_id: string; staff_id: string; reviewer_id: string | null; reviewer_name: string | null; status: string; completed_at: string | null; mine: boolean; reviewing: boolean;
  staff: { full_name: string; department: string | null; position: string | null } | null; review?: { overall: number | null; recommendation: string | null; submitted_at: string | null } | null };
type List = { hr: boolean; me: string | null; user: string; cycles: Cycle[]; people: { id: string; full_name: string }[]; staff: { id: string; full_name: string; line_manager_id: string | null }[];
  default_criteria: Criterion[]; appraisals: ARow[] };
type Sub = "appraisals" | "cpd" | "observations";

const STATUS: Record<string, string> = { self_review: "Self-review", review: "With reviewer", discussion: "To discuss", completed: "Completed" };
const REC: Record<string, string> = { confirm: "Confirm in post", promote: "Promote", increment: "Pay increment", support_plan: "Support plan", none: "No change" };

/** Appraisals, CPD and lesson observations to answer. */
export function Development() {
  const [sub, setSub] = useState<Sub>("appraisals");
  return (
    <div className="space-y-4">
      <Tabs value={sub} onChange={setSub} tabs={[{ id: "appraisals", label: "Appraisals" }, { id: "cpd", label: "CPD" }, { id: "observations", label: "My lesson observations" }]} />
      {sub === "appraisals" && <Appraisals />}
      {sub === "cpd" && <Cpd />}
      {sub === "observations" && <Observations />}
    </div>
  );
}

function Appraisals() {
  const [cycle, setCycle] = useState<string>("");
  const { data, error, reload } = useApi<List>(`/api/hr/development?view=appraisals${cycle ? `&cycle=${cycle}` : ""}`, [cycle]);
  const [open, setOpen] = useState<string | null>(null);
  const [editCycle, setEditCycle] = useState<Partial<Cycle> | null>(null);
  const [assign, setAssign] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return null;
  const mine = data.appraisals.filter(a => a.mine), reviewing = data.appraisals.filter(a => a.reviewing);
  const current = data.cycles.find(c => c.id === cycle);
  return (
    <div className="space-y-4">
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      {mine.length > 0 && <section><h2 className="mb-2 font-semibold">My appraisals</h2><Rows rows={mine} onOpen={setOpen} /></section>}
      {reviewing.length > 0 && <section><h2 className="mb-2 font-semibold">I am reviewing</h2><Rows rows={reviewing} onOpen={setOpen} showStaff /></section>}
      {!data.hr && !mine.length && !reviewing.length && <Empty>No appraisals for you yet.</Empty>}
      {data.hr && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <h2 className="mr-auto font-semibold">All appraisals</h2>
            <Field label="Cycle"><select className="input" value={cycle} onChange={e => setCycle(e.target.value)}><option value="">All cycles</option>{data.cycles.map(c => <option key={c.id} value={c.id}>{c.name} ({c.status})</option>)}</select></Field>
            <button className="btn btn-outline" onClick={() => setEditCycle({ name: `Annual appraisal ${new Date().getFullYear()}`, starts_on: `${new Date().getFullYear()}-01-01`, ends_on: `${new Date().getFullYear()}-12-31`, self_review: true, criteria: data.default_criteria })}>+ Cycle</button>
            {current && <>
              <button className="btn btn-ghost" onClick={() => setEditCycle(current)}>Edit cycle</button>
              {current.status !== "closed" && <button className="btn btn-primary" onClick={() => setAssign(true)}>Add staff</button>}
              {current.status === "open" && <button className="btn btn-ghost" onClick={async () => { if (confirm("Close this cycle?")) { await send("/api/hr/development", { action: "cycle_status", id: current.id, status: "closed" }); reload(); } }}>Close</button>}
            </>}
          </div>
          {!data.cycles.length ? <Empty>No appraisal cycles yet. Create one with its criteria, then add staff; each person’s line manager reviews them unless you choose someone else.</Empty>
            : !data.appraisals.length ? <Empty>{cycle ? "Nobody in this cycle yet." : "Choose a cycle and add staff."}</Empty> : <Rows rows={data.appraisals} onOpen={setOpen} showStaff hr />}
        </section>
      )}
      <AppraisalDetail id={open} onClose={() => { setOpen(null); reload(); }} people={data.people} />
      <Modal open={Boolean(editCycle)} onClose={() => setEditCycle(null)} title={editCycle?.id ? "Edit cycle" : "New appraisal cycle"} wide>
        {editCycle && <CycleForm cycle={editCycle} onSaved={id => { setEditCycle(null); setCycle(id); reload(); }} />}
      </Modal>
      <Modal open={assign} onClose={() => setAssign(false)} title={`Add staff to ${current?.name ?? ""}`} wide>
        {current && <form className="space-y-3" onSubmit={async e => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const r = await send<{ created: number; without_reviewer: number }>("/api/hr/development", { action: "assign", cycle_id: current.id, staff_ids: fd.getAll("staff").map(String), reviewer: String(fd.get("reviewer")) });
          setMsg({ ok: r.ok, text: r.ok ? `${r.data.created} added.${r.data.without_reviewer ? ` ${r.data.without_reviewer} have no line manager; choose their reviewer from the list.` : ""}` : r.error ?? "" });
          if (r.ok) { setAssign(false); reload(); }
        }}>
          <Field label="Reviewer"><select className="input" name="reviewer"><option value="line_manager">Each person’s line manager</option>{data.people.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></Field>
          <fieldset><legend className="label">Staff</legend>
            <label className="mb-1 flex items-center gap-2 text-sm font-medium"><input type="checkbox" onChange={e => document.querySelectorAll<HTMLInputElement>("input[name=staff]").forEach(i => { i.checked = e.target.checked; })} />Everyone</label>
            <div className="grid max-h-64 grid-cols-2 gap-1 overflow-y-auto text-sm">{data.staff.filter(s => !data.appraisals.some(a => a.cycle_id === current.id && a.staff_id === s.id)).map(s => (
              <label key={s.id} className="flex items-center gap-2"><input type="checkbox" name="staff" value={s.id} />{s.full_name}{!s.line_manager_id && <span className="text-xs text-amber-600">no manager</span>}</label>))}</div></fieldset>
          <button className="btn btn-primary w-full">Add</button>
        </form>}
      </Modal>
    </div>
  );
}

function Rows({ rows, onOpen, showStaff, hr }: { rows: ARow[]; onOpen: (id: string) => void; showStaff?: boolean; hr?: boolean }) {
  return (
    <div className="card overflow-x-auto"><table className="w-full text-sm">
      <thead className="bg-slate-50 text-left text-[13px] text-slate-500"><tr>{showStaff && <th className="p-2">Staff</th>}<th className="p-2">Reviewer</th><th className="p-2">Stage</th>{hr && <th className="p-2">Overall</th>}<th className="p-2" /></tr></thead>
      <tbody>{rows.map(a => (
        <tr key={a.id} className="border-t border-slate-100">
          {showStaff && <td className="p-2">{a.staff?.full_name}<div className="text-xs text-slate-500">{a.staff?.position}</div></td>}
          <td className="p-2">{a.reviewer_name ?? <span className="text-amber-600">none</span>}</td>
          <td className="p-2"><Badge tone={a.status === "completed" ? "green" : a.status === "discussion" ? "violet" : "blue"}>{STATUS[a.status]}</Badge></td>
          {hr && <td className="p-2">{a.review?.overall != null ? `${a.review.overall} · ${ratingLabel(Number(a.review.overall))}` : ""}{a.review?.recommendation ? <div className="text-xs text-slate-500">{REC[a.review.recommendation]}</div> : null}</td>}
          <td className="p-2 text-right"><button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => onOpen(a.id)}>Open</button></td>
        </tr>))}</tbody></table></div>
  );
}

function CycleForm({ cycle, onSaved }: { cycle: Partial<Cycle>; onSaved: (id: string) => void }) {
  const [c, setC] = useState(cycle);
  const [err, setErr] = useState<string | null>(null);
  const crit = c.criteria ?? [];
  const total = crit.reduce((s, x) => s + Number(x.weight || 0), 0);
  return (
    <form className="space-y-3" onSubmit={async e => {
      e.preventDefault();
      const r = await send<{ id: string }>("/api/hr/development", { action: "save_cycle", id: c.id, name: c.name, starts_on: c.starts_on, ends_on: c.ends_on, self_review: c.self_review !== false,
        criteria: crit.map((x, i) => ({ id: x.id || `c${i + 1}`, label: x.label, weight: Number(x.weight) || 0 })) });
      if (!r.ok) return setErr(r.error);
      onSaved(r.data.id ?? c.id!);
    }}>
      <div className="grid gap-2 sm:grid-cols-3">
        <Field label="Name"><input className="input" required value={c.name ?? ""} onChange={e => setC({ ...c, name: e.target.value })} /></Field>
        <Field label="From"><input className="input" type="date" required value={c.starts_on ?? ""} onChange={e => setC({ ...c, starts_on: e.target.value })} /></Field>
        <Field label="To"><input className="input" type="date" required value={c.ends_on ?? ""} onChange={e => setC({ ...c, ends_on: e.target.value })} /></Field>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={c.self_review !== false} onChange={e => setC({ ...c, self_review: e.target.checked })} />Staff review themselves first</label>
      <table className="w-full text-sm"><thead className="text-left text-[13px] text-slate-500"><tr><th>Area</th><th className="w-24">Weight</th><th /></tr></thead>
        <tbody>{crit.map((x, i) => (
          <tr key={i}><td className="py-1 pr-2"><input className="input" value={x.label} onChange={e => setC({ ...c, criteria: crit.map((y, j) => j === i ? { ...y, label: e.target.value } : y) })} /></td>
            <td className="py-1 pr-2"><input className="input" type="number" min={0} max={100} value={x.weight} onChange={e => setC({ ...c, criteria: crit.map((y, j) => j === i ? { ...y, weight: Number(e.target.value) } : y) })} /></td>
            <td><button type="button" className="text-xs text-rose-600" aria-label="Remove" onClick={() => setC({ ...c, criteria: crit.filter((_, j) => j !== i) })}>✕</button></td></tr>))}</tbody></table>
      <div className="flex items-center gap-2"><button type="button" className="btn btn-ghost" onClick={() => setC({ ...c, criteria: [...crit, { id: `c${Date.now() % 100000}`, label: "", weight: 10 }] })}>+ Area</button>
        <span className={"text-xs " + (total === 100 ? "text-slate-500" : "text-amber-700")}>Weights add up to {total}{total !== 100 ? " (they are used as proportions, so 100 is not required)" : ""}.</span></div>
      <p className="text-xs text-slate-500">Each area is scored 1 (inadequate) to 5 (outstanding).</p>
      {err && <Alert>{err}</Alert>}
      <button className="btn btn-primary w-full">Save cycle</button>
    </form>
  );
}

function AppraisalDetail({ id, onClose, people }: { id: string | null; onClose: () => void; people: { id: string; full_name: string }[] }) {
  const { data, error, reload } = useApi<any>(id ? `/api/hr/development?view=appraisal&id=${id}` : null, [id]);
  const [self, setSelf] = useState<{ scores: Record<string, number | null>; comments: string } | null>(null);
  const [rev, setRev] = useState<{ scores: Record<string, number | null>; strengths: string; development: string; recommendation: string } | null>(null);
  const [goals, setGoals] = useState<any[] | null>(null);
  const [comment, setComment] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [drafting, setDrafting] = useState(false);
  const a = data?.appraisal, role = data?.role ?? {}, criteria: Criterion[] = data?.criteria ?? [];
  const call = async (body: object, ok: string) => { const r = await send("/api/hr/development", body); setMsg({ ok: r.ok, text: r.ok ? ok : r.error ?? "failed" }); if (r.ok) { setSelf(null); setRev(null); setGoals(null); reload(); } };
  const selfEditable = role.self && a?.status === "self_review";
  const reviewEditable = (role.reviewer || role.hr) && !role.self && a && ["self_review", "review"].includes(a.status);
  const s = self ?? (a ? { scores: a.self_scores ?? {}, comments: a.self_comments ?? "" } : null);
  const r = rev ?? (data ? { scores: data.review?.scores ?? {}, strengths: data.review?.strengths ?? "", development: data.review?.development ?? "", recommendation: data.review?.recommendation ?? "" } : null);
  const g = goals ?? a?.goals ?? [];
  const pick = (v: number | null | undefined, on: (n: number | null) => void, disabled: boolean) => (
    <select className="input w-20" disabled={disabled} value={v ?? ""} onChange={e => on(e.target.value ? Number(e.target.value) : null)}><option value="">—</option>{[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}</select>);
  const showReview = role.hr || role.reviewer || (role.self && ["discussion", "completed"].includes(a?.status));
  return (
    <Modal open={Boolean(id)} onClose={() => { setSelf(null); setRev(null); setGoals(null); setMsg(null); onClose(); }} title={a ? `${a.staff?.full_name}: ${a.appraisal_cycles?.name ?? "appraisal"}` : "Appraisal"} wide>
      {error && <Alert>{error}</Alert>}
      {a && s && r && <div className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center gap-2"><Badge tone={a.status === "completed" ? "green" : "blue"}>{STATUS[a.status]}</Badge>
          <span className="text-slate-500">Reviewer: {a.reviewer_name ?? "not set"}</span>
          {role.hr && !role.self && <select className="input w-auto py-1 text-xs" value={a.reviewer_id ?? ""} onChange={e => call({ action: "set_reviewer", id: a.id, reviewer_id: e.target.value }, "Reviewer changed.")}><option value="" disabled>Change reviewer…</option>{people.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select>}
          <button className="btn btn-ghost ml-auto px-2 py-1 text-xs" onClick={() => window.print()}>Print</button></div>
        {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
        <div className="overflow-x-auto"><table className="w-full">
          <thead className="text-left text-[13px] text-slate-500"><tr><th className="py-1">Area</th><th className="py-1">Weight</th><th className="py-1">Self</th>{showReview && <th className="py-1">Reviewer</th>}</tr></thead>
          <tbody>{criteria.map(c => (
            <tr key={c.id} className="border-t border-slate-100"><td className="py-1.5">{c.label}</td><td className="py-1.5 text-slate-500">{c.weight}</td>
              <td className="py-1.5">{pick(s.scores[c.id], v => setSelf({ ...s, scores: { ...s.scores, [c.id]: v } }), !selfEditable)}</td>
              {showReview && <td className="py-1.5">{pick(r.scores[c.id], v => setRev({ ...r, scores: { ...r.scores, [c.id]: v } }), !reviewEditable)}</td>}</tr>))}
            <tr className="border-t-2 border-slate-300 font-semibold"><td className="py-1.5" colSpan={2}>Overall</td>
              <td className="py-1.5">{(() => { const v = weightedScore(criteria, s.scores); return v === null ? "—" : `${v} (${ratingLabel(v)})`; })()}</td>
              {showReview && <td className="py-1.5">{(() => { const v = weightedScore(criteria, r.scores); return v === null ? "—" : `${v} (${ratingLabel(v)})`; })()}</td>}</tr></tbody></table></div>

        <Field label="Self-review comments"><textarea className="input" rows={3} disabled={!selfEditable} value={s.comments} onChange={e => setSelf({ ...s, comments: e.target.value })} /></Field>
        {selfEditable && <div className="flex gap-2"><button className="btn btn-outline" onClick={() => call({ action: "self_review", id: a.id, scores: s.scores, comments: s.comments || null }, "Saved.")}>Save draft</button>
          <button className="btn btn-primary" onClick={() => { if (confirm("Send your self-review to your reviewer? You cannot change it afterwards.")) call({ action: "self_review", id: a.id, scores: s.scores, comments: s.comments || null, submit: true }, "Sent to your reviewer."); }}>Send self-review</button></div>}

        {showReview && <section className="space-y-2 rounded-lg bg-slate-50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">Reviewer’s view</h3>
            {reviewEditable && <button type="button" className="btn btn-outline px-2.5 py-1 text-xs" disabled={drafting} onClick={async () => {
              setDrafting(true);
              const d = await send<{ strengths: string; development: string }>("/api/ai/draft", { kind: "appraisal_summary", appraisal_id: a.id });
              setDrafting(false);
              if (!d.ok) return setMsg({ ok: false, text: d.error ?? "failed" });
              setRev({ ...r, strengths: d.data.strengths, development: d.data.development });
              setMsg({ ok: true, text: "Drafted from the scores, self-review, observations and training. Read it and change anything before you save." });
            }}>{drafting ? "Drafting…" : "Draft from the evidence"}</button>}
          </div>
          <Field label="Strengths"><textarea className="input" rows={2} disabled={!reviewEditable} value={r.strengths} onChange={e => setRev({ ...r, strengths: e.target.value })} /></Field>
          <Field label="Areas to develop"><textarea className="input" rows={2} disabled={!reviewEditable} value={r.development} onChange={e => setRev({ ...r, development: e.target.value })} /></Field>
          <Field label="Recommendation"><select className="input" disabled={!reviewEditable} value={r.recommendation} onChange={e => setRev({ ...r, recommendation: e.target.value })}><option value="">—</option>{Object.entries(REC).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          {reviewEditable && <div className="flex flex-wrap gap-2">
            <button className="btn btn-outline" onClick={() => call({ action: "save_review", appraisal_id: a.id, scores: r.scores, strengths: r.strengths || null, development: r.development || null, recommendation: r.recommendation || null }, "Saved.")}>Save draft</button>
            <button className="btn btn-outline" onClick={() => call({ action: "save_review", appraisal_id: a.id, scores: r.scores, strengths: r.strengths || null, development: r.development || null, recommendation: r.recommendation || null, submit: true }, "Review finished.")}>Finish review</button>
            {data.review?.submitted_at && <button className="btn btn-primary" onClick={() => { if (confirm("Share your review with them? They will see your scores and comments.")) call({ action: "share", id: a.id }, "Shared. Talk it through, then they acknowledge it."); }}>Share for discussion</button>}
          </div>}
          {data.review?.submitted_at && <p className="text-xs text-slate-500">Review finished {fmtDate(data.review.submitted_at)}.</p>}
        </section>}

        <section>
          <div className="mb-1 flex items-center"><h3 className="mr-auto font-semibold">Goals for the year ahead</h3>
            {(role.reviewer || role.hr) && !role.self && a.status !== "completed" && <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setGoals([...g, { text: "", measure: "", due_on: null, status: "open" }])}>+ Goal</button>}</div>
          {!g.length ? <p className="text-slate-500">None yet.</p> : <ul className="space-y-1">{g.map((x: any, i: number) => (goals && (role.reviewer || role.hr) ? (
            <li key={i} className="grid gap-1 sm:grid-cols-4"><input className="input sm:col-span-2" placeholder="Goal" value={x.text} onChange={e => setGoals(g.map((y: any, j: number) => j === i ? { ...y, text: e.target.value } : y))} />
              <input className="input" placeholder="How it is measured" value={x.measure ?? ""} onChange={e => setGoals(g.map((y: any, j: number) => j === i ? { ...y, measure: e.target.value } : y))} />
              <input className="input" type="date" value={x.due_on ?? ""} onChange={e => setGoals(g.map((y: any, j: number) => j === i ? { ...y, due_on: e.target.value || null } : y))} /></li>
          ) : <li key={i}>• {x.text}{x.measure ? <span className="text-slate-500"> — {x.measure}</span> : null}{x.due_on ? <span className="text-slate-500"> by {fmtDate(x.due_on)}</span> : null}</li>))}</ul>}
          {goals && <button className="btn btn-outline mt-2" onClick={() => call({ action: "set_goals", id: a.id, goals: g.filter((x: any) => x.text?.trim()).map((x: any) => ({ ...x, measure: x.measure || null })) }, "Goals saved.")}>Save goals</button>}
        </section>

        {a.status === "discussion" && role.self && <section className="space-y-2 rounded-lg border border-slate-200 p-3">
          <Field label="Your comment on the review"><textarea className="input" rows={2} value={comment} onChange={e => setComment(e.target.value)} /></Field>
          <button className="btn btn-primary" onClick={() => call({ action: "acknowledge", id: a.id, comment: comment || null }, "Acknowledged. The appraisal is complete.")}>Acknowledge and complete</button></section>}
        {a.staff_comment && <p><span className="font-semibold">Their comment:</span> {a.staff_comment}</p>}
        {role.hr && !role.self && a.status !== "completed" && <button className="btn btn-ghost" onClick={() => call({ action: "complete", id: a.id }, "Marked complete.")}>Mark complete</button>}

        <section className="grid gap-3 sm:grid-cols-2">
          <div><h3 className="mb-1 font-semibold">Lesson observations in this cycle</h3>
            {!data.observations.length ? <p className="text-slate-500">None.</p> : <ul className="space-y-1">{data.observations.map((o: any) => <li key={o.id}>{fmtDate(o.observed_on)} · {o.subjects?.name ?? ""} {o.class_groups?.name ?? ""}: <b>{o.total}/{o.max_total}</b>{o.acknowledged_at ? <span className="text-xs text-emerald-700"> acknowledged</span> : null}</li>)}</ul>}</div>
          <div><h3 className="mb-1 font-semibold">CPD in this cycle: {data.cpd_hours} hours</h3>
            {!data.cpd.length ? <p className="text-slate-500">None logged.</p> : <ul className="space-y-1">{data.cpd.map((c: any, i: number) => <li key={i}>{fmtDate(c.starts_on)} · {c.title} ({c.hours} h){c.verified_at ? " ✓" : ""}</li>)}</ul>}</div>
        </section>
        {role.hr && !role.self && <button className="text-xs text-rose-600" onClick={async () => { if (confirm("Remove this appraisal?")) { await send("/api/hr/development", { action: "delete_appraisal", id: a.id }); onClose(); } }}>Remove from cycle</button>}
      </div>}
    </Modal>
  );
}

type CpdItem = { id: string; title: string; provider: string | null; kind: string; starts_on: string; ends_on: string | null; hours: number; cost: number | null; status: string; reflection: string | null; verified_at: string | null; document_id: string | null };
const KINDS: Record<string, string> = { workshop: "Workshop", course: "Course", conference: "Conference", in_house: "In-house training", online: "Online", mentoring: "Mentoring", reading: "Reading", other: "Other" };

function Cpd() {
  const [staff, setStaff] = useState<string>("");
  const { data, error, reload } = useApi<{ target: number; year: { from: string; to: string }; items: CpdItem[]; summary: { hours: number; verified: number; remaining: number; met: boolean; activities: number }; can_verify: boolean; staff_id: string | null }>(
    `/api/hr/development?view=cpd${staff ? `&staff=${staff}` : ""}`, [staff]);
  const all = useApi<{ target: number; summary: { id: string; full_name: string; department: string | null; hours: number; verified: number; met: boolean }[] }>(data?.can_verify ? "/api/hr/development?view=cpd&summary=1" : null, [data?.can_verify]);
  const [edit, setEdit] = useState<Partial<CpdItem> | null>(null);
  const [group, setGroup] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return null;
  const sum = data.summary;
  return (
    <div className="space-y-4">
      {data.can_verify && all.data && (
        <section className="card p-4">
          <div className="mb-2 flex flex-wrap items-center gap-2"><h2 className="mr-auto font-semibold">Everyone this year ({fmtDate(data.year.from)} – {fmtDate(data.year.to)})</h2>
            <button className="btn btn-outline" onClick={() => setGroup(true)}>Record training for a group</button>
            <button className="btn btn-ghost" onClick={async () => { const t = prompt("Hours of CPD expected per person each year", String(data.target)); if (t !== null && !Number.isNaN(Number(t))) { await send("/api/hr/development", { action: "cpd_target", cpd_target_hours: Number(t), leave_year_start_month: Number(data.year.from.slice(5, 7)) }); reload(); all.reload(); } }}>Target: {data.target} h</button></div>
          <div className="max-h-72 overflow-y-auto"><table className="w-full text-sm"><tbody>{all.data.summary.map(s => (
            <tr key={s.id} className="border-t border-slate-100"><td className="py-1"><button className="text-brand-700 hover:underline" onClick={() => setStaff(s.id)}>{s.full_name}</button> <span className="text-xs text-slate-500">{s.department}</span></td>
              <td className="w-48 py-1"><div className="h-1.5 rounded bg-slate-100"><div className={"h-1.5 rounded " + (s.met ? "bg-emerald-500" : "bg-amber-500")} style={{ width: `${Math.min(100, all.data!.target ? (s.hours / all.data!.target) * 100 : 100)}%` }} /></div></td>
              <td className="py-1 text-right tabular-nums">{s.hours} h{s.verified < s.hours ? <span className="text-xs text-slate-500"> ({s.verified} verified)</span> : null}</td></tr>))}</tbody></table></div>
        </section>
      )}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto font-semibold">{staff && data.can_verify ? `CPD: ${all.data?.summary.find(s => s.id === staff)?.full_name ?? ""}` : "My CPD"}</h2>
          {staff && <button className="btn btn-ghost" onClick={() => setStaff("")}>Back to mine</button>}
          {data.staff_id && <button className="btn btn-primary" onClick={() => setEdit({ kind: "workshop", status: "completed", starts_on: localDate(), hours: 3 })}>+ Log CPD</button>}
        </div>
        <div className="grid grid-cols-3 gap-3"><Stat label="Hours this year" value={sum.hours} tone={sum.met ? "good" : undefined} /><Stat label="Target" value={data.target} /><Stat label="Still to do" value={sum.remaining} tone={sum.remaining ? "warn" : "good"} /></div>
        {!data.items.length ? <Empty>No CPD logged yet: workshops, courses, conferences, in-house training, mentoring, reading.</Empty> : (
          <div className="card overflow-x-auto"><table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-[13px] text-slate-500"><tr><th className="p-2">Date</th><th className="p-2">Activity</th><th className="p-2 text-right">Hours</th><th className="p-2">Status</th><th className="p-2" /></tr></thead>
            <tbody>{data.items.map(c => (
              <tr key={c.id} className="border-t border-slate-100 align-top"><td className="whitespace-nowrap p-2">{fmtDate(c.starts_on)}</td>
                <td className="p-2"><span className="font-medium">{c.title}</span><div className="text-xs text-slate-500">{[KINDS[c.kind], c.provider].filter(Boolean).join(" · ")}</div>{c.reflection && <p className="text-xs text-slate-600">{c.reflection}</p>}</td>
                <td className="p-2 text-right tabular-nums">{c.hours}</td>
                <td className="p-2">{c.status === "planned" ? <Badge>planned</Badge> : c.verified_at ? <Badge tone="green">verified</Badge> : <Badge tone="amber">done</Badge>}</td>
                <td className="whitespace-nowrap p-2 text-right">
                  {data.can_verify && c.status === "completed" && <button className="btn btn-ghost px-2 py-1 text-xs" onClick={async () => { await send("/api/hr/development", { action: "verify_cpd", id: c.id, verified: !c.verified_at }); reload(); all.reload(); }}>{c.verified_at ? "Unverify" : "Verify"}</button>}
                  {(data.can_verify || !c.verified_at) && <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setEdit(c)}>Edit</button>}
                  {(data.can_verify || !c.verified_at) && <button className="btn btn-ghost px-2 py-1 text-xs text-rose-600" onClick={async () => { if (confirm("Delete?")) { await send("/api/hr/development", { action: "delete_cpd", id: c.id }); reload(); all.reload(); } }}>Delete</button>}
                </td></tr>))}</tbody></table></div>
        )}
      </section>
      <Modal open={Boolean(edit)} onClose={() => { setEdit(null); setErr(null); }} title={edit?.id ? "Edit CPD" : "Log CPD"} wide>
        {edit && <form className="grid gap-3 sm:grid-cols-3" onSubmit={async e => {
          e.preventDefault();
          const r = await send("/api/hr/development", { action: "save_cpd", id: edit.id, staff_id: staff || undefined, title: edit.title, provider: edit.provider || null, kind: edit.kind, starts_on: edit.starts_on,
            ends_on: edit.ends_on || null, hours: Number(edit.hours), cost: edit.cost ? Number(edit.cost) : null, status: edit.status, reflection: edit.reflection || null });
          if (!r.ok) return setErr(r.error);
          setEdit(null); setErr(null); reload(); all.reload();
        }}>
          <div className="sm:col-span-2"><Field label="Title"><input className="input" required maxLength={200} value={edit.title ?? ""} onChange={e => setEdit({ ...edit, title: e.target.value })} /></Field></div>
          <Field label="Kind"><select className="input" value={edit.kind} onChange={e => setEdit({ ...edit, kind: e.target.value })}>{Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Provider"><input className="input" value={edit.provider ?? ""} onChange={e => setEdit({ ...edit, provider: e.target.value })} /></Field>
          <Field label="Date"><input className="input" type="date" required value={edit.starts_on ?? ""} onChange={e => setEdit({ ...edit, starts_on: e.target.value })} /></Field>
          <Field label="Until (if longer)"><input className="input" type="date" value={edit.ends_on ?? ""} onChange={e => setEdit({ ...edit, ends_on: e.target.value })} /></Field>
          <Field label="Hours"><input className="input" type="number" min={0.5} step={0.5} required value={edit.hours ?? ""} onChange={e => setEdit({ ...edit, hours: Number(e.target.value) })} /></Field>
          <Field label="Cost (if any)"><input className="input" type="number" min={0} step="any" value={edit.cost ?? ""} onChange={e => setEdit({ ...edit, cost: e.target.value ? Number(e.target.value) : null })} /></Field>
          <Field label="Status"><select className="input" value={edit.status} onChange={e => setEdit({ ...edit, status: e.target.value })}><option value="completed">Done</option><option value="planned">Planned</option></select></Field>
          <div className="sm:col-span-3"><Field label="What I learned and how I will use it"><textarea className="input" rows={3} maxLength={4000} value={edit.reflection ?? ""} onChange={e => setEdit({ ...edit, reflection: e.target.value })} /></Field></div>
          <p className="text-xs text-slate-500 sm:col-span-3">Upload the certificate under My HR → Documents; HR verifies the hours.</p>
          {err && <div className="sm:col-span-3"><Alert>{err}</Alert></div>}
          <button className="btn btn-primary sm:col-span-3">Save</button>
        </form>}
      </Modal>
      <Modal open={group} onClose={() => setGroup(false)} title="Record training for a group" wide>
        <form className="space-y-3" onSubmit={async e => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const r = await send<{ created: number }>("/api/hr/development", { action: "group_cpd", staff_ids: fd.getAll("staff").map(String), title: String(fd.get("title")), provider: String(fd.get("provider") || "") || null,
            kind: String(fd.get("kind")), starts_on: String(fd.get("starts_on")), hours: Number(fd.get("hours")) });
          if (!r.ok) return setErr(r.error);
          setGroup(false); setErr(null); reload(); all.reload();
        }}>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="sm:col-span-2"><Field label="Title"><input className="input" name="title" required placeholder="e.g. Safeguarding refresher" /></Field></div>
            <Field label="Kind"><select className="input" name="kind" defaultValue="in_house">{Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <Field label="Provider"><input className="input" name="provider" /></Field>
            <Field label="Date"><input className="input" type="date" name="starts_on" required defaultValue={localDate()} /></Field>
            <Field label="Hours"><input className="input" type="number" name="hours" min={0.5} step={0.5} required defaultValue={2} /></Field>
          </div>
          <fieldset><legend className="label">Who attended</legend>
            <div className="grid max-h-60 grid-cols-2 gap-1 overflow-y-auto text-sm">{(all.data?.summary ?? []).map(s => <label key={s.id} className="flex items-center gap-2"><input type="checkbox" name="staff" value={s.id} />{s.full_name}</label>)}</div></fieldset>
          <p className="text-xs text-slate-500">Recorded as done and verified for each person.</p>
          {err && <Alert>{err}</Alert>}
          <button className="btn btn-primary w-full">Record</button>
        </form>
      </Modal>
    </div>
  );
}

function Observations() {
  const { data, error, reload } = useApi<{ observations: any[] }>("/api/hr/development?view=observations");
  const [resp, setResp] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return null;
  if (!data.observations.length) return <Empty>No lesson observations of your teaching yet.</Empty>;
  return (
    <div className="space-y-3">
      {msg && <Alert tone="green">{msg}</Alert>}
      {data.observations.map(o => (
        <section key={o.id} className="card space-y-2 p-4 text-sm">
          <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{fmtDate(o.observed_on)}</span><span className="text-slate-500">{[o.subjects?.name, o.class_groups?.name, o.qa_checklists?.name].filter(Boolean).join(" · ")}</span>
            <Badge tone="blue">{o.total}/{o.max_total}</Badge>{o.acknowledged_at && <Badge tone="green">acknowledged</Badge>}</div>
          {o.qa_checklists?.criteria?.length > 0 && <ul className="grid gap-x-4 text-xs sm:grid-cols-2">{o.qa_checklists.criteria.map((c: any) => <li key={c.id} className="flex justify-between"><span>{c.label}</span><span className="tabular-nums">{o.scores?.[c.id] ?? "—"}/{c.max}</span></li>)}</ul>}
          {o.strengths && <p><b>Strengths:</b> {o.strengths}</p>}
          {o.improvements && <p><b>To improve:</b> {o.improvements}</p>}
          {o.action_plan && <p><b>Action plan:</b> {o.action_plan}{o.follow_up_on ? ` (follow-up ${fmtDate(o.follow_up_on)})` : ""}</p>}
          {o.acknowledged_at ? (o.teacher_response && <p className="rounded bg-slate-50 p-2"><b>Your response:</b> {o.teacher_response}</p>) : (
            <div className="flex flex-wrap items-end gap-2"><div className="min-w-[16rem] flex-1"><Field label="Your response (optional)"><input className="input" value={resp[o.id] ?? ""} onChange={e => setResp({ ...resp, [o.id]: e.target.value })} /></Field></div>
              <button className="btn btn-primary" onClick={async () => { const r = await send("/api/hr/development", { action: "ack_observation", id: o.id, response: resp[o.id] || null }); setMsg(r.ok ? "Acknowledged." : r.error); reload(); }}>Acknowledge</button></div>
          )}
        </section>
      ))}
    </div>
  );
}
