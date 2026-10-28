"use client";
import { useEffect, useState } from "react";
import { useApi, send, Alert, Badge, Empty, Field, Loading, fmtDate } from "@/components/ui";
import { iepReviewState, targetProgress } from "@/lib/sis";

type Target = { id: string; iep_id: string; area: string | null; target: string; strategies: string | null; success_criteria: string | null; owner_id: string | null; progress: string; notes: string | null; position: number; owner: { full_name: string } | null };
type Review = { id: string; reviewed_on: string; summary: string; attendees: string | null; next_review: string | null; users: { full_name: string } | null };
type Iep = { id: string; title: string; starts_on: string; review_on: string | null; status: "draft" | "active" | "closed"; student_voice: string | null; parent_views: string | null; parent_agreed_at: string | null; iep_targets: Target[]; iep_reviews: Review[] };
type Profile = { status: string; areas: string[]; needs: string[]; summary: string | null; strengths: string | null; strategies: string | null; extra_time_pct: number; arrangements: string[];
  agencies: string | null; coordinator_id: string | null; share_with_teachers: boolean; updated_at: string; coordinator: { full_name: string } | null;
  share_with_parents?: boolean; live_read_aloud?: boolean; live_readable_font?: boolean; live_calm_mode?: boolean };
type Note = { id: string; author_kind: string; author_name: string; kind: string; body: string; mood: number | null; created_at: string; read_by_staff_at: string | null; read_by_family_at: string | null };
type Feedback = { id: string; target_id: string; author_kind: string; author_name: string; rating: number; comment: string | null; created_at: string };
const RATING = ["", "Hard", "Getting there", "OK", "Good", "Great"];
const MOOD = ["", "A hard day", "Not great", "OK", "Good", "A great day"];
type Data = { profile: Profile | null; ieps: Iep[]; can_manage: boolean; staff: { id: string; full_name: string }[]; me: string; notes?: Note[]; feedback?: Feedback[];
  vocab: { status: Record<string, string>; areas: Record<string, string>; needs: Record<string, string>; arrangements: Record<string, string>; progress: Record<string, string> } };

const blank = { status: "monitoring", areas: [] as string[], needs: [] as string[], summary: "", strengths: "", strategies: "", extra_time_pct: 0, arrangements: [] as string[], agencies: "", coordinator_id: "", share_with_teachers: true,
  share_with_parents: true, live_read_aloud: false, live_readable_font: false, live_calm_mode: false };

/** Special educational needs: the profile teachers work from, access arrangements, and support plans with targets and reviews. */
export default function Sen({ studentId }: { studentId: string }) {
  const { data, error, reload } = useApi<Data>(`/api/sis/${studentId}/sen`);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [editing, setEditing] = useState(false);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  const act = async (body: Record<string, unknown>, ok: string) => {
    const r = await send(`/api/sis/${studentId}/sen`, body);
    setMsg({ ok: r.ok, text: r.ok ? ok : r.error ?? "failed" });
    if (r.ok) reload();
    return r.ok;
  };
  const v = data.vocab, p = data.profile;
  if (!p && !data.can_manage) return <Empty>No special educational needs are recorded for this student, or they have not been shared with you.</Empty>;
  return (
    <div className="space-y-4 text-sm">
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      {editing || (!p && data.can_manage) ? (
        <ProfileForm initial={p} vocab={v} staff={data.staff} onCancel={p ? () => setEditing(false) : undefined}
          onSave={async row => { if (await act({ action: "profile", ...row }, "SEN profile saved.")) setEditing(false); }} />
      ) : p && (
        <section className="card space-y-2 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="mr-auto font-semibold">Needs and support</h3>
            <Badge tone={p.status === "closed" ? "slate" : p.status === "ehcp" ? "violet" : "amber"}>{v.status[p.status]}</Badge>
            {data.can_manage && <button className="btn btn-outline px-2 py-1 text-xs" onClick={() => setEditing(true)}>Edit</button>}
          </div>
          {p.areas.length > 0 && <p><b>Areas:</b> {p.areas.map(a => v.areas[a] ?? a).join(", ")}</p>}
          {p.needs.length > 0 && <p><b>Needs:</b> {p.needs.map(a => v.needs[a] ?? a).join(", ")}</p>}
          {p.summary && <p className="whitespace-pre-wrap">{p.summary}</p>}
          {p.strengths && <p><b>Strengths:</b> {p.strengths}</p>}
          {p.strategies && <div className="rounded-lg bg-emerald-50 p-3"><p className="font-medium text-emerald-900">What helps in class</p><p className="whitespace-pre-wrap">{p.strategies}</p></div>}
          {(p.extra_time_pct > 0 || p.arrangements.length > 0) && <p><b>Exam arrangements:</b> {[p.extra_time_pct ? `${p.extra_time_pct}% extra time (applied automatically to online exams)` : null, ...p.arrangements.map(a => v.arrangements[a] ?? a)].filter(Boolean).join(", ")}</p>}
          {p.agencies && <p><b>Other professionals:</b> {p.agencies}</p>}
          {(p.live_read_aloud || p.live_readable_font || p.live_calm_mode) && <p><b>In live lessons:</b> {[p.live_read_aloud && "read aloud", p.live_readable_font && "easy-to-read font", p.live_calm_mode && "calm mode (no rankings)"].filter(Boolean).join(", ")}</p>}
          <p className="text-xs text-slate-500">{p.coordinator ? `Coordinator: ${p.coordinator.full_name} · ` : ""}{p.share_with_teachers ? "Shared with the child's teachers" : "Not shared with teachers"}{p.share_with_parents === false ? " · not shared with the family" : " · the family sees the plan in their portal"} · updated {fmtDate(p.updated_at)}</p>
        </section>
      )}
      <section className="space-y-3">
        <div className="flex items-center"><h3 className="mr-auto font-semibold">Support plans (IEPs)</h3>
          {data.can_manage && p && <button className="btn btn-outline px-2 py-1 text-xs" onClick={() => act({ action: "iep", title: "Individual education plan", starts_on: new Date().toISOString().slice(0, 10), status: "draft" }, "Draft plan started.")}>New plan</button>}</div>
        {!data.ieps.length ? <Empty>No plans yet.</Empty> : data.ieps.map(i => <Plan key={i.id} iep={i} data={data} act={act} studentId={studentId} />)}
      </section>
      {p && <HomeSchool notes={data.notes ?? []} act={act} />}
    </div>
  );
}

function ProfileForm({ initial, vocab, staff, onSave, onCancel }: { initial: Profile | null; vocab: Data["vocab"]; staff: Data["staff"]; onSave: (r: Record<string, unknown>) => void; onCancel?: () => void }) {
  const [f, setF] = useState(() => initial ? { ...blank, ...initial, summary: initial.summary ?? "", strengths: initial.strengths ?? "", strategies: initial.strategies ?? "", agencies: initial.agencies ?? "", coordinator_id: initial.coordinator_id ?? "" } : blank);
  const toggle = (k: "areas" | "needs" | "arrangements", x: string) => setF({ ...f, [k]: f[k].includes(x) ? f[k].filter(y => y !== x) : [...f[k], x] });
  const chips = (k: "areas" | "needs" | "arrangements", map: Record<string, string>) => (
    <div className="flex flex-wrap gap-1">{Object.entries(map).map(([key, label]) => (
      <button type="button" key={key} aria-pressed={f[k].includes(key)} onClick={() => toggle(k, key)} className={"rounded-full border px-2 py-0.5 text-xs " + (f[k].includes(key) ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-300")}>{label}</button>
    ))}</div>
  );
  return (
    <form className="card grid gap-3 p-4 sm:grid-cols-2" onSubmit={e => { e.preventDefault(); onSave({ ...f, summary: f.summary || null, strengths: f.strengths || null, strategies: f.strategies || null, agencies: f.agencies || null, coordinator_id: f.coordinator_id || null }); }}>
      <Field label="Register status"><select className="input" value={f.status} onChange={e => setF({ ...f, status: e.target.value })}>{Object.entries(vocab.status).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
      <Field label="Coordinator (SENCO)"><select className="input" value={f.coordinator_id} onChange={e => setF({ ...f, coordinator_id: e.target.value })}><option value="">—</option>{staff.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select></Field>
      <div className="sm:col-span-2"><span className="label">Areas of need</span>{chips("areas", vocab.areas)}</div>
      <div className="sm:col-span-2"><span className="label">Specific needs</span>{chips("needs", vocab.needs)}</div>
      <Field label="Summary"><textarea className="input min-h-20" value={f.summary} onChange={e => setF({ ...f, summary: e.target.value })} maxLength={4000} /></Field>
      <Field label="Strengths and interests"><textarea className="input min-h-20" value={f.strengths} onChange={e => setF({ ...f, strengths: e.target.value })} maxLength={2000} /></Field>
      <div className="sm:col-span-2"><Field label="What helps in class" hint="Teachers see this. Be practical: seating, instructions, breaks, materials."><textarea className="input min-h-24" value={f.strategies} onChange={e => setF({ ...f, strategies: e.target.value })} maxLength={4000} /></Field></div>
      <Field label="Extra exam time" hint="Applied automatically to online exams."><div className="flex items-center gap-2"><input className="input w-24" type="number" min={0} max={100} value={f.extra_time_pct} onChange={e => setF({ ...f, extra_time_pct: Number(e.target.value) })} /><span>%</span></div></Field>
      <Field label="Other professionals involved"><input className="input" value={f.agencies} onChange={e => setF({ ...f, agencies: e.target.value })} maxLength={1000} placeholder="e.g. speech therapist, paediatrician" /></Field>
      <div className="sm:col-span-2"><span className="label">Exam access arrangements</span>{chips("arrangements", vocab.arrangements)}</div>
      <label className="flex items-center gap-2 sm:col-span-2"><input type="checkbox" checked={f.share_with_teachers} onChange={e => setF({ ...f, share_with_teachers: e.target.checked })} /> Share this profile and live plans with the child&apos;s teachers</label>
      <label className="flex items-center gap-2 sm:col-span-2"><input type="checkbox" checked={f.share_with_parents !== false} onChange={e => setF({ ...f, share_with_parents: e.target.checked })} /> Share the plan with the family (their portal and the home–school book)</label>
      <fieldset className="sm:col-span-2"><legend className="label">In live lessons and games (set automatically for the child)</legend>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2"><input type="checkbox" checked={Boolean(f.live_read_aloud)} onChange={e => setF({ ...f, live_read_aloud: e.target.checked })} /> Read questions aloud</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={Boolean(f.live_readable_font)} onChange={e => setF({ ...f, live_readable_font: e.target.checked })} /> Easy-to-read font</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={Boolean(f.live_calm_mode)} onChange={e => setF({ ...f, live_calm_mode: e.target.checked })} /> Calm mode (no rankings)</label>
        </div>
        <p className="hint">Extra time above also applies to timed live questions (rounded to 25, 50 or 100%).</p></fieldset>
      <div className="flex gap-2 sm:col-span-2"><button className="btn btn-primary">Save</button>{onCancel && <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>}</div>
    </form>
  );
}

function Plan({ iep, data, act, studentId }: { iep: Iep; data: Data; act: (b: Record<string, unknown>, ok: string) => Promise<boolean>; studentId: string }) {
  const [edit, setEdit] = useState(false);
  const [ideas, setIdeas] = useState<{ area: string; target: string; strategies: string; success_criteria: string }[] | null>(null);
  const [thinking, setThinking] = useState<string | null>(null);
  async function suggest() {
    setThinking("Thinking…");
    const r = await send<{ targets: { area: string; target: string; strategies: string; success_criteria: string }[] }>("/api/ai/draft", { kind: "iep_targets", student_id: studentId, iep_id: iep.id });
    setThinking(r.ok ? null : r.error ?? "failed");
    if (r.ok) setIdeas(r.data.targets);
  }
  const [f, setF] = useState({ title: iep.title, starts_on: iep.starts_on, review_on: iep.review_on ?? "", student_voice: iep.student_voice ?? "", parent_views: iep.parent_views ?? "" });
  const [t, setT] = useState({ area: "", target: "", strategies: "", success_criteria: "", owner_id: "" });
  const [rv, setRv] = useState({ reviewed_on: new Date().toISOString().slice(0, 10), summary: "", attendees: "", next_review: "" });
  useEffect(() => setF({ title: iep.title, starts_on: iep.starts_on, review_on: iep.review_on ?? "", student_voice: iep.student_voice ?? "", parent_views: iep.parent_views ?? "" }), [iep]);
  const m = data.can_manage;
  const prog = targetProgress(iep.iep_targets);
  const review = iepReviewState(iep.review_on, iep.status);
  const save = (status: string, ok: string) => act({ action: "iep", id: iep.id, ...f, review_on: f.review_on || null, student_voice: f.student_voice || null, parent_views: f.parent_views || null, status }, ok);
  return (
    <article className="card space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="mr-auto font-semibold">{iep.title}</h4>
        <Badge tone={iep.status === "active" ? "green" : iep.status === "draft" ? "amber" : "slate"}>{iep.status}</Badge>
        {review === "overdue" && <Badge tone="red">review overdue</Badge>}{review === "due_soon" && <Badge tone="amber">review due {fmtDate(iep.review_on)}</Badge>}
        {iep.parent_agreed_at && <Badge tone="blue">parents agreed {fmtDate(iep.parent_agreed_at)}</Badge>}
        {m && iep.status === "draft" && <button className="btn btn-primary px-2 py-1 text-xs" onClick={() => save("active", "Plan is live. The family has been told.")}>Make live</button>}
        {m && iep.status === "active" && <button className="btn btn-outline px-2 py-1 text-xs" onClick={() => confirm("Close this plan?") && save("closed", "Plan closed.")}>Close</button>}
        {m && <button className="btn btn-outline px-2 py-1 text-xs" onClick={() => setEdit(!edit)}>{edit ? "Done" : "Edit"}</button>}
        {m && iep.status === "draft" && <button className="text-xs text-rose-600" onClick={() => confirm("Delete this draft?") && act({ action: "delete_iep", id: iep.id }, "Draft deleted.")}>Delete</button>}
      </div>
      <p className="text-xs text-slate-500">From {fmtDate(iep.starts_on)}{iep.review_on ? ` · review ${fmtDate(iep.review_on)}` : ""}{prog.total ? ` · ${prog.on_track} of ${prog.total} targets secure or achieved` : ""}</p>
      {edit ? (
        <form className="grid gap-2 sm:grid-cols-3" onSubmit={async e => { e.preventDefault(); if (await save(iep.status, "Plan saved.")) setEdit(false); }}>
          <Field label="Title"><input className="input" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} required /></Field>
          <Field label="Starts"><input className="input" type="date" value={f.starts_on} onChange={e => setF({ ...f, starts_on: e.target.value })} /></Field>
          <Field label="Review by"><input className="input" type="date" value={f.review_on} onChange={e => setF({ ...f, review_on: e.target.value })} /></Field>
          <div className="sm:col-span-3"><Field label="What the child says helps"><textarea className="input min-h-16" value={f.student_voice} onChange={e => setF({ ...f, student_voice: e.target.value })} /></Field></div>
          <div className="sm:col-span-3"><Field label="Parents' views"><textarea className="input min-h-16" value={f.parent_views} onChange={e => setF({ ...f, parent_views: e.target.value })} /></Field></div>
          <div><button className="btn btn-primary">Save</button></div>
        </form>
      ) : (
        <>
          {iep.student_voice && <p><b>The child says:</b> {iep.student_voice}</p>}
          {iep.parent_views && <p><b>Parents say:</b> {iep.parent_views}</p>}
        </>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-xs"><thead className="text-left text-slate-500"><tr><th className="p-1">Target</th><th className="p-1">How</th><th className="p-1">Who</th><th className="p-1">Progress</th><th /></tr></thead>
          <tbody className="divide-y divide-slate-100">{iep.iep_targets.map(x => (
            <tr key={x.id}><td className="p-1 align-top"><b>{x.target}</b>{x.area && <span className="block text-slate-500">{x.area}</span>}{x.success_criteria && <span className="block text-slate-500">Success: {x.success_criteria}</span>}
              {(["parent", "student"] as const).map(k => { const f = (data.feedback ?? []).find(y => y.target_id === x.id && y.author_kind === k); return f ? <span key={k} className="block text-xs text-brand-800">{k === "parent" ? "Family" : "The child"}: {RATING[f.rating]}{f.comment ? `, ${f.comment}` : ""} ({fmtDate(f.created_at)})</span> : null; })}</td>
              <td className="p-1 align-top">{x.strategies}</td><td className="p-1 align-top">{x.owner?.full_name ?? "—"}</td>
              <td className="p-1 align-top">{m || x.owner_id === data.me ? (
                <select className="input py-0.5 text-xs" value={x.progress} onChange={e => act({ action: "progress", id: x.id, progress: e.target.value }, "Progress saved.")} aria-label="Progress">{Object.entries(data.vocab.progress).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              ) : data.vocab.progress[x.progress]}</td>
              <td className="p-1 align-top">{m && <button className="text-rose-600" onClick={() => confirm("Remove this target?") && act({ action: "delete_target", id: x.id }, "Removed.")} aria-label="Remove target">✕</button>}</td></tr>
          ))}{!iep.iep_targets.length && <tr><td className="p-2 text-slate-500" colSpan={5}>No targets yet.</td></tr>}</tbody></table>
      </div>
      {m && iep.status !== "closed" && (
        <div className="rounded-lg border border-brand-200 bg-brand-50/40 p-2 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2"><span>Suggested targets from the profile (needs, strengths, what works). Pick one to fill the form, then edit it.</span>
            <button type="button" className="btn btn-outline px-2 py-1 text-xs" disabled={thinking === "Thinking…"} onClick={suggest}>{thinking === "Thinking…" ? "Thinking…" : ideas ? "More ideas" : "Suggest targets"}</button></div>
          {thinking && thinking !== "Thinking…" && <p className="mt-1 text-rose-700">{thinking}</p>}
          {ideas && <ul className="mt-2 space-y-1">{ideas.map((x, i) => (
            <li key={i} className="flex items-start justify-between gap-2 rounded bg-white p-2"><span><b>{x.area}:</b> {x.target}<span className="block text-slate-500">How: {x.strategies} · Success: {x.success_criteria}</span></span>
              <button type="button" className="text-brand-700 underline" onClick={() => setT({ ...t, area: x.area, target: x.target, strategies: x.strategies, success_criteria: x.success_criteria })}>Use</button></li>))}</ul>}
        </div>
      )}
      {m && iep.status !== "closed" && (
        <form className="grid gap-2 rounded-lg bg-slate-50 p-2 sm:grid-cols-5" onSubmit={async e => {
          e.preventDefault();
          if (await act({ action: "target", iep_id: iep.id, area: t.area || null, target: t.target, strategies: t.strategies || null, success_criteria: t.success_criteria || null, owner_id: t.owner_id || null, position: iep.iep_targets.length }, "Target added."))
            setT({ area: "", target: "", strategies: "", success_criteria: "", owner_id: "" });
        }}>
          <input className="input sm:col-span-2" value={t.target} onChange={e => setT({ ...t, target: e.target.value })} placeholder="Target, e.g. Read 60 words a minute" required aria-label="Target" />
          <input className="input" value={t.strategies} onChange={e => setT({ ...t, strategies: e.target.value })} placeholder="How (strategy)" aria-label="Strategy" />
          <select className="input" value={t.owner_id} onChange={e => setT({ ...t, owner_id: e.target.value })} aria-label="Who works on it"><option value="">Who</option>{data.staff.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select>
          <button className="btn btn-outline">Add target</button>
          <input className="input sm:col-span-2" value={t.success_criteria} onChange={e => setT({ ...t, success_criteria: e.target.value })} placeholder="How we will know (success criteria)" aria-label="Success criteria" />
          <input className="input" value={t.area} onChange={e => setT({ ...t, area: e.target.value })} placeholder="Area, e.g. Reading" aria-label="Area" />
        </form>
      )}
      <div>
        <p className="font-medium">Reviews</p>
        {iep.iep_reviews.map(r => <p key={r.id} className="mt-1 text-xs"><b>{fmtDate(r.reviewed_on)}</b> {r.summary}{r.attendees ? ` (with ${r.attendees})` : ""}{r.next_review ? ` · next review ${fmtDate(r.next_review)}` : ""}</p>)}
        {!iep.iep_reviews.length && <p className="text-xs text-slate-500">No reviews yet.</p>}
        {m && iep.status === "active" && (
          <form className="mt-2 grid gap-2 sm:grid-cols-4" onSubmit={async e => { e.preventDefault(); if (await act({ action: "review", iep_id: iep.id, reviewed_on: rv.reviewed_on, summary: rv.summary, attendees: rv.attendees || null, next_review: rv.next_review || null }, "Review recorded.")) setRv({ ...rv, summary: "", attendees: "" }); }}>
            <input className="input" type="date" value={rv.reviewed_on} onChange={e => setRv({ ...rv, reviewed_on: e.target.value })} aria-label="Review date" />
            <input className="input sm:col-span-2" value={rv.summary} onChange={e => setRv({ ...rv, summary: e.target.value })} placeholder="What was agreed" required aria-label="Review summary" />
            <input className="input" type="date" value={rv.next_review} onChange={e => setRv({ ...rv, next_review: e.target.value })} aria-label="Next review" title="Next review" />
            <input className="input sm:col-span-3" value={rv.attendees} onChange={e => setRv({ ...rv, attendees: e.target.value })} placeholder="Who attended (parents, teachers, specialists)" aria-label="Attendees" />
            <button className="btn btn-outline">Record review</button>
          </form>
        )}
      </div>
    </article>
  );
}

/** The two-way home–school book (phase 14h): notes from the family, the child and staff. */
function HomeSchool({ notes, act }: { notes: Note[]; act: (b: Record<string, unknown>, ok: string) => Promise<boolean> }) {
  const [body, setBody] = useState("");
  const [praise, setPraise] = useState(false);
  const unread = notes.filter(n => n.author_kind !== "staff" && !n.read_by_staff_at).length;
  useEffect(() => { if (unread) void act({ action: "notes_read" }, "Notes marked as read."); }, [unread]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section className="card space-y-3 p-4">
      <div className="flex items-center"><h3 className="mr-auto font-semibold">Home–school book</h3>{unread > 0 && <Badge tone="blue">{unread} new</Badge>}</div>
      <textarea className="input min-h-16" value={body} onChange={e => setBody(e.target.value)} placeholder="A note for the family: what went well, what to try at home" maxLength={4000} />
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2"><input type="checkbox" checked={praise} onChange={e => setPraise(e.target.checked)} /> Good news (the child sees it too)</label>
        <button className="btn btn-primary ml-auto" disabled={!body.trim()} onClick={async () => { if (await act({ action: "note", body, kind: praise ? "praise" : "note" }, "Sent to the family.")) { setBody(""); setPraise(false); } }}>Send to the family</button>
      </div>
      {!notes.length ? <p className="text-slate-500">No notes yet.</p> : <ul className="space-y-2">{notes.map(n => (
        <li key={n.id} className={"rounded-lg p-3 " + (n.author_kind === "staff" ? "bg-slate-50" : "bg-brand-50")}>
          <p className="text-xs text-slate-500">{n.author_name} ({n.author_kind === "parent" ? "parent" : n.author_kind === "student" ? "the child" : "staff"}) · {fmtDate(n.created_at, true)}
            {n.kind === "meeting_request" && <b className="text-amber-800"> · asked for a meeting</b>}{n.mood ? ` · ${MOOD[n.mood]}` : ""}
            {n.author_kind === "staff" && (n.read_by_family_at ? " · read by the family" : " · not yet read")}</p>
          <p className="whitespace-pre-wrap">{n.body}</p>
        </li>))}</ul>}
      <p className="hint">The family sees the school&apos;s notes and their own. What the child writes stays with staff.</p>
    </section>
  );
}
