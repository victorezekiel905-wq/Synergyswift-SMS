"use client";
import { useState } from "react";
import { useApi, send, Alert, Empty, Modal, Field, Badge, fmtDate, localDate } from "@/components/ui";
import { nextStages, STAGES, type Stage } from "@/lib/hr";

type Pipeline = Record<Stage, number>;
type Posting = { id: string; title: string; department: string | null; employment_type: string; location?: string | null; description?: string; requirements?: string | null; salary_range?: string | null;
  positions: number; closes_on: string | null; status: "draft" | "open" | "closed" | "filled"; token: string; internal_only: boolean; pipeline?: Pipeline };
type AppRow = { id: string; full_name: string; email: string; phone: string | null; stage: Stage; rating: number | null; source: string | null; internal: boolean; has_cv: boolean; created_at: string;
  next_interview: string | null; summary: { count: number; average: number | null; hire: number } };
type List = { hr: true; careers_slug: string | null; people: { id: string; full_name: string }[]; postings: Posting[] } | { hr: false; interviews: any[] };

const STAGE_LABEL: Record<Stage, string> = { applied: "Applied", shortlisted: "Shortlisted", interview: "Interview", offer: "Offer", hired: "Hired", rejected: "Rejected", withdrawn: "Withdrawn" };
const STAGE_TONE: Record<Stage, "slate" | "blue" | "violet" | "amber" | "green" | "red"> = { applied: "slate", shortlisted: "blue", interview: "violet", offer: "amber", hired: "green", rejected: "red", withdrawn: "slate" };
const TYPE: Record<string, string> = { full_time: "Full time", part_time: "Part time", contract: "Contract", volunteer: "Volunteer" };

/** Job postings, candidates through to hire, interviews with a panel and their scores. Panel members see only their interviews. */
export function Recruitment({ initialPosting, initialApplication }: { initialPosting?: string | null; initialApplication?: string | null }) {
  const { data, error, reload } = useApi<List>("/api/hr/recruitment");
  const [posting, setPosting] = useState<string | null>(initialPosting ?? null);
  const [app, setApp] = useState<string | null>(initialApplication ?? null);
  const [edit, setEdit] = useState<Partial<Posting> | null>(null);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return null;

  if (!data.hr) return (
    <div className="space-y-3">
      <h2 className="font-semibold">Interviews you are on</h2>
      {!data.interviews.length ? <Empty>You are not on any interview panel.</Empty> : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 text-sm">{data.interviews.map((i: any) => (
          <li key={i.id} className="flex flex-wrap items-center gap-2 p-3"><span className="font-medium">{i.job_applications?.full_name}</span><span className="text-slate-500">{i.job_applications?.job_postings?.title}</span>
            <span>{fmtDate(i.scheduled_at, true)}</span><Badge>{i.status}</Badge><button className="btn btn-outline ml-auto px-2 py-1 text-xs" onClick={() => setApp(i.application_id)}>Open and score</button></li>))}</ul>
      )}
      <ApplicationModal id={app} onClose={() => setApp(null)} onChange={reload} people={[]} />
    </div>
  );

  const link = data.careers_slug ? `${typeof window !== "undefined" ? window.location.origin : ""}/careers/${data.careers_slug}` : null;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn btn-primary" onClick={() => setEdit({ employment_type: "full_time", positions: 1, status: "draft", internal_only: false })}>+ New job</button>
        {link ? <span className="text-sm text-slate-600">Careers page: <a className="text-brand-700 underline" href={link} target="_blank" rel="noreferrer">{link}</a></span>
          : <span className="text-sm text-amber-700">Set the school’s public web address (Settings) to get a careers page.</span>}
      </div>
      {!data.postings.length ? <Empty>No jobs yet. Add one, publish it, and share the careers page link.</Empty> : (
        <div className="card overflow-x-auto"><table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-[13px] text-slate-500"><tr><th className="p-3">Job</th><th className="p-3">Status</th><th className="p-3">Candidates</th><th className="p-3">Closes</th><th className="p-3" /></tr></thead>
          <tbody>{data.postings.map(p => {
            const pl = p.pipeline!;
            const active = pl.applied + pl.shortlisted + pl.interview + pl.offer;
            return (
              <tr key={p.id} className={"border-t border-slate-100 " + (posting === p.id ? "bg-brand-50" : "")}>
                <td className="p-3"><button className="text-left font-medium text-brand-700 hover:underline" onClick={() => setPosting(p.id)}>{p.title}</button><div className="text-xs text-slate-500">{[p.department, TYPE[p.employment_type], p.internal_only ? "internal" : null].filter(Boolean).join(" · ")}</div></td>
                <td className="p-3"><Badge tone={p.status === "open" ? "green" : p.status === "draft" ? "amber" : "slate"}>{p.status}</Badge></td>
                <td className="p-3 text-xs">{active} in progress{pl.applied ? ` · ${pl.applied} new` : ""}{pl.hired ? ` · ${pl.hired}/${p.positions} hired` : ""}</td>
                <td className="p-3">{p.closes_on ? fmtDate(p.closes_on) : "—"}</td>
                <td className="whitespace-nowrap p-3 text-right"><button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setEdit(p)}>Edit</button></td>
              </tr>
            );
          })}</tbody></table></div>
      )}
      {posting && <PostingDetail id={posting} slug={data.careers_slug} onOpen={setApp} onChange={reload} />}
      <PostingEditor posting={edit} onClose={() => setEdit(null)} onSaved={id => { setEdit(null); setPosting(id); reload(); }} />
      <ApplicationModal id={app} onClose={() => setApp(null)} onChange={reload} people={data.people} />
    </div>
  );
}

function PostingEditor({ posting, onClose, onSaved }: { posting: Partial<Posting> | null; onClose: () => void; onSaved: (id: string) => void }) {
  const [p, setP] = useState<Partial<Posting>>({});
  const [err, setErr] = useState<string | null>(null);
  const cur = { ...posting, ...p };
  const bind = (k: keyof Posting) => ({ value: (cur[k] as string | number | undefined) ?? "", onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setP({ ...p, [k]: e.target.value }) });
  return (
    <Modal open={Boolean(posting)} onClose={() => { setP({}); setErr(null); onClose(); }} title={cur.id ? "Edit job" : "New job"} wide>
      <form className="grid gap-3 sm:grid-cols-3" onSubmit={async e => {
        e.preventDefault();
        const r = await send<{ id: string }>("/api/hr/recruitment", { action: "save_posting", id: cur.id, title: cur.title, department: cur.department || null, employment_type: cur.employment_type,
          location: cur.location || null, description: cur.description ?? "", requirements: cur.requirements || null, salary_range: cur.salary_range || null, positions: Number(cur.positions || 1),
          closes_on: cur.closes_on || null, internal_only: Boolean(cur.internal_only) });
        if (!r.ok) return setErr(r.error);
        setP({}); setErr(null); onSaved(r.data.id);
      }}>
        <div className="sm:col-span-2"><Field label="Job title"><input className="input" required minLength={2} maxLength={160} {...bind("title")} /></Field></div>
        <Field label="Department"><input className="input" {...bind("department")} /></Field>
        <Field label="Type"><select className="input" {...bind("employment_type")}>{Object.entries(TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Location"><input className="input" {...bind("location")} /></Field>
        <Field label="Pay (optional)"><input className="input" placeholder="e.g. ₦250,000–₦320,000 a month" {...bind("salary_range")} /></Field>
        <Field label="Places"><input className="input" type="number" min={1} max={100} {...bind("positions")} /></Field>
        <Field label="Closing date"><input className="input" type="date" {...bind("closes_on")} /></Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={Boolean(cur.internal_only)} onChange={e => setP({ ...p, internal_only: e.target.checked })} />Current staff only</label>
        <div className="sm:col-span-3"><Field label="About the job"><textarea className="input" rows={6} maxLength={8000} {...bind("description")} /></Field></div>
        <div className="sm:col-span-3"><Field label="What we are looking for (qualifications, experience)"><textarea className="input" rows={4} maxLength={6000} {...bind("requirements")} /></Field></div>
        {err && <div className="sm:col-span-3"><Alert>{err}</Alert></div>}
        <button className="btn btn-primary sm:col-span-3">Save</button>
      </form>
    </Modal>
  );
}

function PostingDetail({ id, slug, onOpen, onChange }: { id: string; slug: string | null; onOpen: (id: string) => void; onChange: () => void }) {
  const { data, error, reload } = useApi<{ posting: Posting; pipeline: Pipeline; applications: AppRow[] }>(`/api/hr/recruitment?posting=${id}`, [id]);
  const [stage, setStage] = useState<Stage | "active">("active");
  const [add, setAdd] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return null;
  const p = data.posting;
  const status = async (s: Posting["status"]) => { const r = await send("/api/hr/recruitment", { action: "posting_status", id: p.id, status: s }); if (!r.ok) setErr(r.error); else { setErr(null); reload(); onChange(); } };
  const rows = data.applications.filter(a => stage === "active" ? ["applied", "shortlisted", "interview", "offer"].includes(a.stage) : a.stage === stage);
  const url = slug ? `${window.location.origin}/careers/${slug}/${p.token}` : null;
  return (
    <section className="card space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-lg font-semibold">{p.title}</h2>
        {p.status !== "open" && p.status !== "filled" && <button className="btn btn-primary" onClick={() => status("open")}>Publish</button>}
        {p.status === "open" && <button className="btn btn-outline" onClick={() => status("closed")}>Close applications</button>}
        {p.status !== "filled" && p.status !== "draft" && <button className="btn btn-ghost" onClick={() => status("filled")}>Mark filled</button>}
        {url && p.status === "open" && <button className="btn btn-ghost" onClick={() => { navigator.clipboard?.writeText(url); alert(`Link copied:\n${url}`); }}>Copy link</button>}
        <button className="btn btn-ghost" onClick={() => setAdd(true)}>+ Candidate</button>
      </div>
      {err && <Alert>{err}</Alert>}
      <div className="flex flex-wrap gap-1 text-xs">
        <button className={"rounded px-2 py-1 " + (stage === "active" ? "bg-brand-600 text-white" : "bg-slate-100")} onClick={() => setStage("active")}>In progress ({data.pipeline.applied + data.pipeline.shortlisted + data.pipeline.interview + data.pipeline.offer})</button>
        {STAGES.map(s => <button key={s} className={"rounded px-2 py-1 " + (stage === s ? "bg-brand-600 text-white" : "bg-slate-100")} onClick={() => setStage(s)}>{STAGE_LABEL[s]} ({data.pipeline[s]})</button>)}
      </div>
      {!rows.length ? <Empty>No candidates here.</Empty> : (
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead className="text-left text-[13px] text-slate-500"><tr><th className="py-1">Candidate</th><th className="py-1">Stage</th><th className="py-1">Rating</th><th className="py-1">Panel</th><th className="py-1">Applied</th></tr></thead>
          <tbody>{rows.map(a => (
            <tr key={a.id} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50" onClick={() => onOpen(a.id)}>
              <td className="py-2"><span className="font-medium">{a.full_name}</span>{a.internal && <Badge tone="blue">staff</Badge>}<div className="text-xs text-slate-500">{a.email}{a.source ? ` · ${a.source}` : ""}</div></td>
              <td className="py-2"><Badge tone={STAGE_TONE[a.stage]}>{STAGE_LABEL[a.stage]}</Badge>{a.next_interview && <div className="text-xs text-slate-500">interview {fmtDate(a.next_interview, true)}</div>}</td>
              <td className="py-2">{a.rating ? "★".repeat(a.rating) : ""}</td>
              <td className="py-2 text-xs">{a.summary.count ? `${a.summary.average}/5 · ${a.summary.hire} of ${a.summary.count} would hire` : ""}</td>
              <td className="py-2 text-xs">{fmtDate(a.created_at)}</td>
            </tr>))}</tbody></table></div>
      )}
      <Modal open={add} onClose={() => setAdd(false)} title="Add a candidate (walk-in or referral)">
        <form className="space-y-3" onSubmit={async e => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const r = await send("/api/hr/recruitment", { action: "add_application", posting_id: p.id, full_name: String(fd.get("full_name")), email: String(fd.get("email")), phone: String(fd.get("phone") || "") || null,
            source: String(fd.get("source") || "") || null, notes: String(fd.get("notes") || "") || null });
          if (!r.ok) return setErr(r.error);
          setAdd(false); reload(); onChange();
        }}>
          <Field label="Full name"><input className="input" name="full_name" required /></Field>
          <Field label="Email"><input className="input" name="email" type="email" required /></Field>
          <Field label="Phone"><input className="input" name="phone" /></Field>
          <Field label="Source"><input className="input" name="source" list="sources" placeholder="referral, walk-in, agency…" /></Field>
          <datalist id="sources">{["referral", "walk-in", "agency", "newspaper", "LinkedIn", "Jobberman"].map(s => <option key={s} value={s} />)}</datalist>
          <Field label="Notes"><textarea className="input" name="notes" rows={2} /></Field>
          <button className="btn btn-primary w-full">Add</button>
        </form>
      </Modal>
    </section>
  );
}

function ApplicationModal({ id, onClose, onChange, people }: { id: string | null; onClose: () => void; onChange: () => void; people: { id: string; full_name: string }[] }) {
  const { data, error, reload } = useApi<any>(id ? `/api/hr/recruitment?application=${id}` : null, [id]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [sched, setSched] = useState(false);
  const [hire, setHire] = useState(false);
  const refresh = () => { reload(); onChange(); };
  const call = async (body: object, ok: string) => { const r = await send("/api/hr/recruitment", body); setMsg({ ok: r.ok, text: r.ok ? ok : r.error ?? "failed" }); if (r.ok) refresh(); return r.ok; };
  const a = data?.application;
  return (
    <Modal open={Boolean(id)} onClose={() => { setMsg(null); setSched(false); setHire(false); onClose(); }} title={a ? `${a.full_name}: ${a.job_postings?.title ?? ""}` : "Candidate"} wide>
      {error && <Alert>{error}</Alert>}
      {a && <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone={STAGE_TONE[a.stage as Stage]}>{STAGE_LABEL[a.stage as Stage]}</Badge>
          <a className="text-brand-700 underline" href={`mailto:${a.email}`}>{a.email}</a>{a.phone && <a className="text-brand-700 underline" href={`tel:${a.phone}`}>{a.phone}</a>}
          {a.has_cv && <a className="btn btn-outline px-2 py-1 text-xs" href={`/api/hr/recruitment?cv=${a.id}`} target="_blank" rel="noreferrer">Open CV</a>}
          <span className="text-xs text-slate-500">applied {fmtDate(a.created_at)}{a.source ? ` via ${a.source}` : ""}</span>
        </div>
        {a.cover_letter && <div className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded bg-slate-50 p-3 text-sm">{a.cover_letter}</div>}
        {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}

        {data.hr && <HrControls a={a} call={call} openSchedule={() => setSched(true)} openHire={() => setHire(true)} />}

        <section>
          <h3 className="mb-1 font-semibold">Interviews</h3>
          {!data.interviews.length ? <p className="text-sm text-slate-500">None yet.</p> : data.interviews.map((iv: any) => {
            const onPanel = iv.panel.some((p: any) => p.id === data.me);
            const mine = iv.scores.find((s: any) => s.panelist_id === data.me);
            return (
              <div key={iv.id} className="mb-2 rounded-lg border border-slate-200 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{fmtDate(iv.scheduled_at, true)}</span><span className="text-slate-500">{iv.duration_min} min · {iv.mode.replace("_", " ")}{iv.location ? ` · ${iv.location}` : ""}</span><Badge>{iv.status}</Badge>
                  {data.hr && iv.status === "scheduled" && <span className="ml-auto flex gap-1">
                    <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => call({ action: "interview_status", id: iv.id, status: "done" }, "Marked as held.")}>Held</button>
                    <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => call({ action: "interview_status", id: iv.id, status: "no_show" }, "Marked as no-show.")}>No-show</button>
                    <button className="btn btn-ghost px-2 py-1 text-xs text-rose-600" onClick={() => call({ action: "interview_status", id: iv.id, status: "cancelled", notify_candidate: confirm("Tell the candidate it is cancelled?") }, "Cancelled.")}>Cancel</button></span>}
                </div>
                <p className="text-xs text-slate-500">Panel: {iv.panel.map((p: any) => p.name).join(", ") || "—"}</p>
                {iv.scores.length > 0 && <ul className="mt-1 space-y-0.5 text-xs">{iv.scores.map((s: any) => <li key={s.panelist_id}><b>{s.name}</b>: {s.score}/5, {s.recommendation}{s.comments ? ` · ${s.comments}` : ""}</li>)}</ul>}
                {data.hr && iv.summary.count > 0 && <p className="mt-1 text-xs">Average {iv.summary.average}/5 · hire {iv.summary.hire}, maybe {iv.summary.maybe}, no {iv.summary.no}</p>}
                {onPanel && <ScoreForm interviewId={iv.id} mine={mine} onSaved={() => { setMsg({ ok: true, text: "Score saved." }); reload(); }} />}
              </div>
            );
          })}
        </section>

        <Modal open={sched} onClose={() => setSched(false)} title="Schedule an interview">
          <form className="space-y-3" onSubmit={async e => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const ok = await call({ action: "schedule_interview", application_id: a.id, at: String(fd.get("at")), duration_min: Number(fd.get("duration")), mode: String(fd.get("mode")),
              location: String(fd.get("location") || "") || null, panel: fd.getAll("panel").map(String), notify_candidate: fd.get("notify") === "on" }, "Interview booked; the candidate and panel have been told.");
            if (ok) setSched(false);
          }}>
            <div className="grid grid-cols-2 gap-2">
              <Field label="When (school time)"><input className="input" type="datetime-local" name="at" required /></Field>
              <Field label="Minutes"><input className="input" type="number" name="duration" min={5} max={480} defaultValue={30} /></Field>
            </div>
            <Field label="How"><select className="input" name="mode"><option value="in_person">In person</option><option value="video">Video call</option><option value="phone">Phone</option></select></Field>
            <Field label="Where, or the video link"><input className="input" name="location" maxLength={300} /></Field>
            <fieldset><legend className="label">Panel</legend><div className="grid max-h-40 grid-cols-2 gap-1 overflow-y-auto text-sm">{people.map(p => <label key={p.id} className="flex items-center gap-2"><input type="checkbox" name="panel" value={p.id} />{p.full_name}</label>)}</div></fieldset>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="notify" defaultChecked />Email the candidate the details</label>
            <button className="btn btn-primary w-full">Book</button>
          </form>
        </Modal>
        <Modal open={hire} onClose={() => setHire(false)} title={`Hire ${a.full_name}`}>
          <form className="space-y-3" onSubmit={async e => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const ok = await call({ action: "hire", application_id: a.id, staff_no: String(fd.get("staff_no")), position: String(fd.get("position") || "") || null, department: String(fd.get("department") || "") || null,
              hire_date: String(fd.get("hire_date")), employment_type: String(fd.get("employment_type")), start_onboarding: fd.get("onboard") === "on" }, "Hired. Their staff record is ready and onboarding has started.");
            if (ok) setHire(false);
          }}>
            {!a.internal_staff_id && <Field label="Staff number"><input className="input" name="staff_no" required maxLength={40} /></Field>}
            {a.internal_staff_id && <input type="hidden" name="staff_no" value="internal" />}
            <Field label="Position"><input className="input" name="position" defaultValue={a.job_postings?.title ?? ""} /></Field>
            <Field label="Department"><input className="input" name="department" /></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Start date"><input className="input" type="date" name="hire_date" required defaultValue={localDate()} /></Field>
              <Field label="Type"><select className="input" name="employment_type">{Object.entries(TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            </div>
            {!a.internal_staff_id && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="onboard" defaultChecked />Start the onboarding checklist</label>}
            <p className="text-xs text-slate-500">Their CV is copied to their staff record. Add the contract and give them a login from the staff directory.</p>
            <button className="btn btn-primary w-full">Hire</button>
          </form>
        </Modal>
      </div>}
    </Modal>
  );
}

function HrControls({ a, call, openSchedule, openHire }: { a: any; call: (b: object, ok: string) => Promise<boolean>; openSchedule: () => void; openHire: () => void }) {
  const [notes, setNotes] = useState<string>(a.notes ?? "");
  const [rating, setRating] = useState<number | null>(a.rating);
  const [notify, setNotify] = useState(true);
  const next = nextStages(a.stage as Stage).filter(s => s !== "hired" && s !== "interview");
  return (
    <section className="space-y-2 rounded-lg bg-slate-50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        {!["hired", "rejected", "withdrawn"].includes(a.stage) && <button className="btn btn-outline px-2 py-1 text-xs" onClick={openSchedule}>Schedule interview</button>}
        {next.map(s => <button key={s} className={"btn px-2 py-1 text-xs " + (s === "rejected" ? "btn-ghost text-rose-600" : "btn-outline")} onClick={() => {
          const message = s === "offer" || s === "rejected" ? prompt("Add a personal line to the email (optional)") : null;
          call({ action: "move", id: a.id, stage: s, notify, message: message || null }, `Moved to ${STAGE_LABEL[s]}${notify ? "; the candidate has been emailed" : ""}.`);
        }}>{s === "applied" ? "Back to applied" : `→ ${STAGE_LABEL[s]}`}</button>)}
        {a.stage === "offer" && <button className="btn btn-primary px-2 py-1 text-xs" onClick={openHire}>Hire</button>}
        <label className="ml-auto flex items-center gap-1 text-xs"><input type="checkbox" checked={notify} onChange={e => setNotify(e.target.checked)} />Email the candidate on a move</label>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div><span className="label">Rating</span><div className="flex">{[1, 2, 3, 4, 5].map(n => <button key={n} type="button" aria-label={`${n} stars`} className={"text-xl " + (rating && n <= rating ? "text-amber-500" : "text-slate-300")} onClick={() => setRating(rating === n ? null : n)}>★</button>)}</div></div>
        <div className="flex-1"><Field label="HR notes (not shown to the panel)"><textarea className="input" rows={2} value={notes} onChange={e => setNotes(e.target.value)} /></Field></div>
        <button className="btn btn-ghost" onClick={() => call({ action: "update_application", id: a.id, rating, notes: notes || null }, "Saved.")}>Save</button>
        <button className="btn btn-ghost text-rose-600" onClick={() => { if (confirm("Delete this application and CV for good?")) call({ action: "delete_application", id: a.id }, "Deleted."); }}>Delete</button>
      </div>
    </section>
  );
}

function ScoreForm({ interviewId, mine, onSaved }: { interviewId: string; mine?: { score: number; recommendation: string; comments: string | null }; onSaved: () => void }) {
  const [f, setF] = useState({ score: mine?.score ?? 3, recommendation: mine?.recommendation ?? "maybe", comments: mine?.comments ?? "" });
  const [err, setErr] = useState<string | null>(null);
  return (
    <form className="mt-2 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-2" onSubmit={async e => {
      e.preventDefault();
      const r = await send("/api/hr/recruitment", { action: "score", interview_id: interviewId, score: Number(f.score), recommendation: f.recommendation, comments: f.comments || null });
      if (!r.ok) setErr(r.error); else { setErr(null); onSaved(); }
    }}>
      <Field label="Your score"><select className="input w-20" value={f.score} onChange={e => setF({ ...f, score: Number(e.target.value) })}>{[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}</select></Field>
      <Field label="Recommendation"><select className="input" value={f.recommendation} onChange={e => setF({ ...f, recommendation: e.target.value })}><option value="hire">Hire</option><option value="maybe">Maybe</option><option value="no">Do not hire</option></select></Field>
      <div className="min-w-[12rem] flex-1"><Field label="Comments"><input className="input" value={f.comments} onChange={e => setF({ ...f, comments: e.target.value })} /></Field></div>
      <button className="btn btn-primary">{mine ? "Update" : "Save"} score</button>
      {err && <p className="w-full text-xs text-rose-600">{err}</p>}
    </form>
  );
}
