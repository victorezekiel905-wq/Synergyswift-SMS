"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useApi, send, Page, PageHeader, Tabs, Alert, Empty, Field, Badge, Modal, Loading, fmtDate } from "@/components/ui";
import { buildSlots } from "@/lib/exams/schedule";

type Hall = { id: string; name: string; capacity: number; rows: number; cols: number; notes: string | null; active: boolean };
type SeriesRow = { id: string; name: string; starts_on: string; ends_on: string; status: string; term_id: string | null };
type SessionDef = { label: string; start: string; minutes: number };
type Series = SeriesRow & { sessions: SessionDef[]; skip_dates: string[]; max_per_day: number; invigilator_ratio: number; spacing: "every_seat" | "alternate" };
type Paper = { id: string; title: string; subject_id: string | null; class_group_ids: string[]; duration_minutes: number; slot_date: string | null; slot_session: number | null; locked: boolean; exam_id: string | null };
type SeatRow = { paper_id: string; hall_id: string; student_id: string; row: number; col: number; label: string; name: string; admission_no: string | null; class_group_id: string | null };
type Duty = { slot_date: string; slot_session: number; hall_id: string; staff_user_id: string; chief: boolean; name: string };
type Full = { series: Series; halls: Hall[]; papers: Paper[]; class_groups: { id: string; name: string; level: string | null }[]; subjects: { id: string; name: string }[]; seats: SeatRow[]; duties: Duty[]; can_edit: boolean };

const DEFAULT_SESSIONS: SessionDef[] = [{ label: "Morning", start: "09:00", minutes: 150 }, { label: "Afternoon", start: "12:30", minutes: 120 }];

export default function ExamPlannerPage() {
  const { data, error, reload } = useApi<{ halls: Hall[]; series: SeriesRow[]; can_edit: boolean }>("/api/exam-planner");
  const [open, setOpen] = useState<string | null>(null);
  const [tab, setTab] = useState<"series" | "halls">("series");
  const [newSeries, setNewSeries] = useState(false);
  if (error) return <Page><Alert>{error}</Alert></Page>;
  if (!data) return <Page><Loading /></Page>;
  if (open) return <SeriesWorkspace id={open} onBack={() => { setOpen(null); reload(); }} />;
  return (
    <Page wide>
      <PageHeader eyebrow="Assessment" title="Exam planner"
        subtitle="Plan an exam period: halls, a clash-free timetable, mixed seating plans and an invigilation roster. Students see their papers and seats once you publish."
        actions={data.can_edit ? <button className="btn btn-primary" onClick={() => setNewSeries(true)}>+ New exam period</button> : undefined} />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "series", label: "Exam periods" }, { id: "halls", label: `Halls (${data.halls.length})` }]} />
      {tab === "series" && (!data.series.length ? <Empty>No exam periods yet.{data.can_edit && " Add your halls, then create an exam period."}</Empty> : (
        <ul className="card divide-y divide-slate-100">
          {data.series.map(s => (
            <li key={s.id}><button className="flex w-full flex-wrap items-center gap-3 p-4 text-left hover:bg-slate-50" onClick={() => setOpen(s.id)}>
              <span className="font-semibold text-brand-700">{s.name}</span>
              <span className="text-sm text-slate-500">{fmtDate(s.starts_on)} – {fmtDate(s.ends_on)}</span>
              <Badge tone={s.status === "published" ? "green" : "slate"}>{s.status}</Badge>
            </button></li>
          ))}
        </ul>
      ))}
      {tab === "halls" && <Halls halls={data.halls} canEdit={data.can_edit} reload={reload} />}
      <Modal open={newSeries} onClose={() => setNewSeries(false)} title="New exam period" wide>
        {newSeries && <SeriesForm onSaved={id => { setNewSeries(false); reload(); setOpen(id); }} />}
      </Modal>
    </Page>
  );
}

function Halls({ halls, canEdit, reload }: { halls: Hall[]; canEdit: boolean; reload: () => void }) {
  const blank = { name: "", capacity: "40", rows: "5", cols: "8", notes: "", active: true };
  const [f, setF] = useState<typeof blank & { id?: string }>(blank);
  const [err, setErr] = useState<string | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const r = await send("/api/exam-planner", { action: "hall_save", id: f.id, name: f.name, capacity: Number(f.capacity), rows: Number(f.rows || 0), cols: Number(f.cols || 0), notes: f.notes || null, active: f.active });
    if (!r.ok) return setErr(r.error);
    setErr(null); setF(blank); reload();
  }
  async function remove(h: Hall) {
    if (!confirm(`Delete ${h.name}? Seating plans that use it are removed.`)) return;
    await send("/api/exam-planner", { action: "hall_delete", id: h.id }); reload();
  }
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
      {!halls.length ? <Empty>No halls yet.</Empty> : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-2">Hall</th><th className="p-2 text-center">Seats</th><th className="p-2 text-center">Layout</th><th className="p-2">Status</th><th className="p-2" /></tr></thead>
            <tbody>{halls.map(h => (
              <tr key={h.id} className="border-t border-slate-100">
                <td className="p-2 font-medium">{h.name}{h.notes && <div className="text-xs text-slate-500">{h.notes}</div>}</td>
                <td className="p-2 text-center tabular-nums">{h.capacity}</td>
                <td className="p-2 text-center tabular-nums">{h.rows && h.cols ? `${h.rows} × ${h.cols}` : "—"}</td>
                <td className="p-2">{h.active ? <Badge tone="green">in use</Badge> : <Badge>not used</Badge>}</td>
                <td className="whitespace-nowrap p-2 text-right">{canEdit && <>
                  <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setF({ id: h.id, name: h.name, capacity: String(h.capacity), rows: String(h.rows), cols: String(h.cols), notes: h.notes ?? "", active: h.active })}>Edit</button>
                  <button className="btn btn-ghost px-2 py-1 text-xs text-rose-600" onClick={() => remove(h)}>Delete</button>
                </>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {canEdit && (
        <form onSubmit={save} className="card h-fit space-y-3 p-4">
          <p className="font-semibold">{f.id ? "Edit hall" : "Add a hall"}</p>
          <Field label="Name"><input className="input" required value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="Main hall" /></Field>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Seats"><input className="input" type="number" min={1} required value={f.capacity} onChange={e => setF({ ...f, capacity: e.target.value })} /></Field>
            <Field label="Rows"><input className="input" type="number" min={0} value={f.rows} onChange={e => setF({ ...f, rows: e.target.value })} /></Field>
            <Field label="Columns"><input className="input" type="number" min={0} value={f.cols} onChange={e => setF({ ...f, cols: e.target.value })} /></Field>
          </div>
          <Field label="Notes"><input className="input" value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} placeholder="Ground floor, near the library" /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active} onChange={e => setF({ ...f, active: e.target.checked })} /> Use for seating</label>
          {err && <Alert>{err}</Alert>}
          <div className="flex justify-end gap-2">{f.id && <button type="button" className="btn btn-ghost" onClick={() => setF(blank)}>Cancel</button>}<button className="btn btn-primary">Save hall</button></div>
        </form>
      )}
    </div>
  );
}

function SeriesForm({ series, onSaved }: { series?: Series; onSaved: (id: string) => void }) {
  const { data: sessions } = useApi<{ id: string; name: string; terms: { id: string; name: string }[] }[]>("/api/school/academic");
  const [f, setF] = useState({
    name: series?.name ?? "", term_id: series?.term_id ?? "", starts_on: series?.starts_on ?? "", ends_on: series?.ends_on ?? "",
    sessions: series?.sessions ?? DEFAULT_SESSIONS, skip: (series?.skip_dates ?? []).join(", "),
    max_per_day: String(series?.max_per_day ?? 2), ratio: String(series?.invigilator_ratio ?? 30), spacing: series?.spacing ?? "every_seat"
  });
  const [err, setErr] = useState<string | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const r = await send<{ id: string }>("/api/exam-planner", {
      action: "series_save", id: series?.id, name: f.name, term_id: f.term_id || null, starts_on: f.starts_on, ends_on: f.ends_on,
      sessions: f.sessions.map(s => ({ ...s, minutes: Number(s.minutes) })), skip_dates: f.skip.split(/[\s,]+/).filter(Boolean),
      max_per_day: Number(f.max_per_day), invigilator_ratio: Number(f.ratio), spacing: f.spacing
    });
    if (!r.ok) return setErr(r.error);
    onSaved(r.data.id);
  }
  const setSession = (i: number, k: keyof SessionDef, v: string) => setF({ ...f, sessions: f.sessions.map((s, j) => j === i ? { ...s, [k]: k === "minutes" ? Number(v) : v } : s) });
  return (
    <form onSubmit={save} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name"><input className="input" required value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="First term examinations" /></Field>
        <Field label="Term"><select className="input" value={f.term_id} onChange={e => setF({ ...f, term_id: e.target.value })}><option value="">—</option>{(sessions ?? []).flatMap(s => s.terms.map(t => <option key={t.id} value={t.id}>{t.name} {s.name}</option>))}</select></Field>
        <Field label="First day"><input className="input" type="date" required value={f.starts_on} onChange={e => setF({ ...f, starts_on: e.target.value })} /></Field>
        <Field label="Last day"><input className="input" type="date" required value={f.ends_on} onChange={e => setF({ ...f, ends_on: e.target.value })} /></Field>
      </div>
      <div>
        <p className="label">Sessions each day</p>
        {f.sessions.map((s, i) => (
          <div key={i} className="mb-2 grid grid-cols-[1fr_110px_110px_auto] items-center gap-2">
            <input className="input" aria-label="Session name" value={s.label} onChange={e => setSession(i, "label", e.target.value)} />
            <input className="input" aria-label="Start time" type="time" value={s.start} onChange={e => setSession(i, "start", e.target.value)} />
            <input className="input" aria-label="Length in minutes" type="number" min={15} value={s.minutes} onChange={e => setSession(i, "minutes", e.target.value)} />
            <button type="button" className="btn btn-ghost px-2 text-rose-600" disabled={f.sessions.length < 2} onClick={() => setF({ ...f, sessions: f.sessions.filter((_, j) => j !== i) })} aria-label="Remove session">×</button>
          </div>
        ))}
        <button type="button" className="btn btn-ghost text-xs" onClick={() => setF({ ...f, sessions: [...f.sessions, { label: "Session", start: "14:30", minutes: 90 }] })}>+ Add session</button>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Days to skip" hint="Public holidays, comma separated (2026-10-01)."><input className="input" value={f.skip} onChange={e => setF({ ...f, skip: e.target.value })} /></Field>
        <Field label="Papers per class per day"><input className="input" type="number" min={1} max={6} value={f.max_per_day} onChange={e => setF({ ...f, max_per_day: e.target.value })} /></Field>
        <Field label="Students per invigilator"><input className="input" type="number" min={5} value={f.ratio} onChange={e => setF({ ...f, ratio: e.target.value })} /></Field>
        <Field label="Seating"><select className="input" value={f.spacing} onChange={e => setF({ ...f, spacing: e.target.value as Series["spacing"] })}><option value="every_seat">Use every seat (mixed classes)</option><option value="alternate">Leave every other seat empty when there is room</option></select></Field>
      </div>
      {err && <Alert>{err}</Alert>}
      <div className="flex justify-end"><button className="btn btn-primary">{series ? "Save" : "Create exam period"}</button></div>
    </form>
  );
}

type WTab = "papers" | "timetable" | "seating" | "invigilation" | "settings";

function SeriesWorkspace({ id, onBack }: { id: string; onBack: () => void }) {
  const { data, error, reload } = useApi<Full>(`/api/exam-planner?series_id=${id}`);
  const [tab, setTab] = useState<WTab>("papers");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  if (error) return <Page><Alert>{error}</Alert></Page>;
  if (!data) return <Page><Loading /></Page>;
  const s = data.series;
  async function act(action: string, extra: Record<string, unknown> = {}, done?: (d: any) => string) {
    setBusy(action); setMsg(null);
    const r = await send("/api/exam-planner", { action, series_id: id, ...extra });
    setBusy(null);
    setMsg({ ok: r.ok, text: r.ok ? (done ? done(r.data) : "Done.") : r.error ?? "failed" });
    reload();
  }
  const scheduled = data.papers.filter(p => p.slot_date).length;
  return (
    <Page wide>
      <button className="text-sm text-brand-700 hover:underline" onClick={onBack}>← Exam planner</button>
      <PageHeader title={s.name} subtitle={`${fmtDate(s.starts_on)} – ${fmtDate(s.ends_on)} · ${data.papers.length} papers · ${scheduled} timetabled · ${new Set(data.seats.map(x => x.student_id)).size} students seated · ${data.duties.length} invigilation duties`}
        actions={<>
          <Badge tone={s.status === "published" ? "green" : "slate"}>{s.status}</Badge>
          <Link className="btn btn-ghost" href={`/school/exam-planner/print?series=${id}`} target="_blank">Print</Link>
          {data.can_edit && <button className={"btn " + (s.status === "published" ? "btn-ghost" : "btn-success")} onClick={() => act("publish", { publish: s.status !== "published" }, () => s.status === "published" ? "Unpublished." : "Published. Students now see their timetable and seats.")}>{s.status === "published" ? "Unpublish" : "Publish to students"}</button>}
        </>} />
      {msg && <div className="mb-3"><Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert></div>}
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "papers", label: "1. Papers" }, { id: "timetable", label: "2. Timetable" }, { id: "seating", label: "3. Seating" }, { id: "invigilation", label: "4. Invigilators" }, { id: "settings", label: "Settings" }]} />
      {tab === "papers" && <Papers data={data} reload={reload} act={act} busy={busy} />}
      {tab === "timetable" && <Timetable data={data} act={act} busy={busy} reload={reload} />}
      {tab === "seating" && <Seating data={data} act={act} busy={busy} />}
      {tab === "invigilation" && <Invigilation data={data} act={act} busy={busy} />}
      {tab === "settings" && (data.can_edit ? <div className="card p-5"><SeriesForm series={s} onSaved={() => { setMsg({ ok: true, text: "Saved." }); reload(); }} /></div> : <Empty>Only admins change the plan.</Empty>)}
    </Page>
  );
}

type ActFn = (action: string, extra?: Record<string, unknown>, done?: (d: any) => string) => Promise<void>;

function slotName(s: Series, date: string | null, session: number | null) {
  if (!date) return "Not timetabled";
  const def = s.sessions[session ?? 0];
  return `${fmtDate(date)} · ${def?.label ?? `Session ${(session ?? 0) + 1}`}${def?.start ? ` ${def.start}` : ""}`;
}

function Papers({ data, reload, act, busy }: { data: Full; reload: () => void; act: ActFn; busy: string | null }) {
  const [editing, setEditing] = useState<Partial<Paper> | null>(null);
  const [fromSubjects, setFromSubjects] = useState(false);
  const cls = new Map(data.class_groups.map(g => [g.id, g.name]));
  return (
    <div className="space-y-3">
      {data.can_edit && (
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-primary" onClick={() => setFromSubjects(true)}>Create papers from class subjects</button>
          <button className="btn btn-outline" onClick={() => setEditing({ class_group_ids: [], duration_minutes: 120, locked: false })}>+ Add a paper</button>
        </div>
      )}
      {!data.papers.length ? <Empty>No papers yet. Create them from the subjects each class takes, or add them one by one.</Empty> : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-2">Paper</th><th className="p-2">Classes</th><th className="p-2 text-center">Minutes</th><th className="p-2">When</th><th className="p-2" /></tr></thead>
            <tbody>{data.papers.map(p => (
              <tr key={p.id} className="border-t border-slate-100">
                <td className="p-2 font-medium">{p.title}{p.exam_id && <Badge tone="violet">CBT</Badge>}</td>
                <td className="p-2 text-xs">{p.class_group_ids.map(c => cls.get(c)).filter(Boolean).join(", ")}</td>
                <td className="p-2 text-center tabular-nums">{p.duration_minutes}</td>
                <td className="p-2 text-xs">{slotName(data.series, p.slot_date, p.slot_session)}{p.locked && <Badge tone="amber">fixed</Badge>}</td>
                <td className="whitespace-nowrap p-2 text-right">{data.can_edit && <>
                  <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setEditing(p)}>Edit</button>
                  <button className="btn btn-ghost px-2 py-1 text-xs text-rose-600" onClick={async () => { if (confirm(`Delete ${p.title}?`)) { await send("/api/exam-planner", { action: "paper_delete", id: p.id }); reload(); } }}>Delete</button>
                </>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title={editing?.id ? "Edit paper" : "Add a paper"} wide>
        {editing && <PaperForm data={data} paper={editing} onSaved={() => { setEditing(null); reload(); }} />}
      </Modal>
      <Modal open={fromSubjects} onClose={() => setFromSubjects(false)} title="Create papers from class subjects" wide>
        {fromSubjects && <FromSubjects data={data} busy={busy} onRun={async (classIds, minutes, combine) => {
          await act("papers_from_offerings", { class_group_ids: classIds, duration_minutes: minutes, combine_levels: combine }, d => `Created ${d.created} papers.`);
          setFromSubjects(false);
        }} />}
      </Modal>
    </div>
  );
}

function FromSubjects({ data, busy, onRun }: { data: Full; busy: string | null; onRun: (ids: string[], minutes: number, combine: boolean) => void }) {
  const [sel, setSel] = useState<Set<string>>(new Set(data.class_groups.map(g => g.id)));
  const [minutes, setMinutes] = useState("120");
  const [combine, setCombine] = useState(true);
  return (
    <div className="space-y-3 text-sm">
      <p className="text-slate-600">One paper is made for every subject each chosen class takes (from School setup → Classes &amp; subjects). Subjects that already have a paper are skipped.</p>
      <div className="grid max-h-64 gap-1 overflow-y-auto rounded border border-slate-200 p-2 sm:grid-cols-3">
        {data.class_groups.map(g => <label key={g.id} className="flex items-center gap-2"><input type="checkbox" checked={sel.has(g.id)} onChange={e => { const n = new Set(sel); if (e.target.checked) n.add(g.id); else n.delete(g.id); setSel(n); }} />{g.name}</label>)}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Length of each paper (minutes)"><input className="input" type="number" min={5} value={minutes} onChange={e => setMinutes(e.target.value)} /></Field>
        <label className="flex items-center gap-2 self-end pb-2"><input type="checkbox" checked={combine} onChange={e => setCombine(e.target.checked)} /> Classes on the same level sit the same paper together</label>
      </div>
      <div className="flex justify-end"><button className="btn btn-primary" disabled={!sel.size || busy !== null} onClick={() => onRun([...sel], Number(minutes), combine)}>{busy ? "Creating…" : "Create papers"}</button></div>
    </div>
  );
}

function PaperForm({ data, paper, onSaved }: { data: Full; paper: Partial<Paper>; onSaved: () => void }) {
  const { data: exams } = useApi<{ id: string; title: string }[]>("/api/exams");
  const [f, setF] = useState({ title: paper.title ?? "", subject_id: paper.subject_id ?? "", classes: new Set(paper.class_group_ids ?? []), minutes: String(paper.duration_minutes ?? 120),
    date: paper.slot_date ?? "", session: String(paper.slot_session ?? 0), locked: Boolean(paper.locked), exam_id: paper.exam_id ?? "" });
  const [err, setErr] = useState<string | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const r = await send("/api/exam-planner", { action: "paper_save", id: paper.id, series_id: data.series.id, title: f.title, subject_id: f.subject_id || null,
      class_group_ids: [...f.classes], duration_minutes: Number(f.minutes), slot_date: f.date || null, slot_session: f.date ? Number(f.session) : null, locked: f.locked, exam_id: f.exam_id || null });
    if (!r.ok) return setErr(r.error);
    onSaved();
  }
  return (
    <form onSubmit={save} className="space-y-3 text-sm">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="sm:col-span-2"><Field label="Title"><input className="input" required value={f.title} onChange={e => setF({ ...f, title: e.target.value })} placeholder="SS2 Mathematics Paper 1" /></Field></div>
        <Field label="Subject"><select className="input" value={f.subject_id} onChange={e => setF({ ...f, subject_id: e.target.value })}><option value="">—</option>{data.subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
      </div>
      <p className="label">Classes sitting this paper</p>
      <div className="grid max-h-40 gap-1 overflow-y-auto rounded border border-slate-200 p-2 sm:grid-cols-4">
        {data.class_groups.map(g => <label key={g.id} className="flex items-center gap-2"><input type="checkbox" checked={f.classes.has(g.id)} onChange={e => { const n = new Set(f.classes); if (e.target.checked) n.add(g.id); else n.delete(g.id); setF({ ...f, classes: n }); }} />{g.name}</label>)}
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Minutes"><input className="input" type="number" min={5} value={f.minutes} onChange={e => setF({ ...f, minutes: e.target.value })} /></Field>
        <Field label="Date (optional)"><input className="input" type="date" min={data.series.starts_on} max={data.series.ends_on} value={f.date} onChange={e => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Session"><select className="input" value={f.session} onChange={e => setF({ ...f, session: e.target.value })} disabled={!f.date}>{data.series.sessions.map((s, i) => <option key={i} value={i}>{s.label} {s.start}</option>)}</select></Field>
        <label className="flex items-center gap-2 self-end pb-2"><input type="checkbox" checked={f.locked} disabled={!f.date} onChange={e => setF({ ...f, locked: e.target.checked })} /> Keep this slot</label>
      </div>
      <Field label="Linked CBT exam (optional)"><select className="input" value={f.exam_id} onChange={e => setF({ ...f, exam_id: e.target.value })}><option value="">Written paper</option>{(exams ?? []).map(x => <option key={x.id} value={x.id}>{x.title}</option>)}</select></Field>
      {err && <Alert>{err}</Alert>}
      <div className="flex justify-end"><button className="btn btn-primary" disabled={!f.classes.size}>Save paper</button></div>
    </form>
  );
}

const slotsOf = (s: Series) => buildSlots(s.starts_on, s.ends_on, s.sessions, { skipDates: s.skip_dates ?? [] });

function Timetable({ data, act, busy, reload }: { data: Full; act: ActFn; busy: string | null; reload: () => void }) {
  const s = data.series;
  const days = [...new Set(slotsOf(s).map(x => x.date))];
  const cls = new Map(data.class_groups.map(g => [g.id, g.name]));
  const unplaced = data.papers.filter(p => !p.slot_date);
  async function move(p: Paper, value: string) {
    const [date, session] = value ? value.split("#") : ["", "0"];
    await send("/api/exam-planner", { action: "paper_save", id: p.id, series_id: s.id, title: p.title, subject_id: p.subject_id, class_group_ids: p.class_group_ids,
      duration_minutes: p.duration_minutes, slot_date: date || null, slot_session: date ? Number(session) : null, locked: Boolean(date), exam_id: p.exam_id });
    reload();
  }
  return (
    <div className="space-y-3">
      {data.can_edit && (
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn btn-primary" disabled={!data.papers.length || busy !== null} onClick={() => confirm("Build the timetable? Papers marked “fixed” keep their slot; seating and invigilation are cleared.") && act("generate_timetable", {}, d => `Timetabled ${d.scheduled} papers.${d.unscheduled.length ? ` Could not fit: ${d.unscheduled.join(", ")}. Add days or sessions, or raise the papers per day.` : ""}`)}>{busy === "generate_timetable" ? "Building…" : "Build timetable automatically"}</button>
          <p className="text-xs text-slate-500">No class sits two papers at once or more than {s.max_per_day} a day, and each class&apos;s papers are spread out. Move a paper with its menu; moved papers stay fixed.</p>
        </div>
      )}
      {unplaced.length > 0 && <Alert tone="amber">Not timetabled: {unplaced.map(p => p.title).join(", ")}</Alert>}
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-2">Day</th>{s.sessions.map((x, i) => <th key={i} className="p-2">{x.label} <span className="font-normal normal-case">{x.start} · {x.minutes} min</span></th>)}</tr></thead>
          <tbody>{days.map(day => (
            <tr key={day} className="border-t border-slate-100 align-top">
              <td className="whitespace-nowrap p-2 font-medium">{fmtDate(day)}</td>
              {s.sessions.map((_, i) => (
                <td key={i} className="p-2">
                  <ul className="space-y-1">{data.papers.filter(p => p.slot_date === day && (p.slot_session ?? 0) === i).map(p => (
                    <li key={p.id} className="rounded border border-slate-200 bg-white p-1.5">
                      <p className="text-xs font-semibold">{p.title}{p.locked && " 📌"}</p>
                      <p className="text-[11px] text-slate-500">{p.class_group_ids.map(c => cls.get(c)).join(", ")} · {p.duration_minutes} min</p>
                      {data.can_edit && <select className="mt-1 w-full rounded border border-slate-200 text-[11px]" value={`${day}#${i}`} aria-label={`Move ${p.title}`} onChange={e => move(p, e.target.value)}>
                        <option value="">Unschedule</option>{slotsOf(s).map(x => <option key={`${x.date}#${x.session}`} value={`${x.date}#${x.session}`}>{fmtDate(x.date)} {s.sessions[x.session]?.label}</option>)}
                      </select>}
                    </li>
                  ))}</ul>
                </td>
              ))}
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}

function Seating({ data, act, busy }: { data: Full; act: ActFn; busy: string | null }) {
  const s = data.series;
  const paperBy = useMemo(() => new Map(data.papers.map(p => [p.id, p])), [data.papers]);
  const slotKeys = [...new Set(data.seats.map(x => { const p = paperBy.get(x.paper_id); return p?.slot_date ? `${p.slot_date}#${p.slot_session ?? 0}` : ""; }).filter(Boolean))].sort();
  const [slot, setSlot] = useState(slotKeys[0] ?? "");
  useEffect(() => { if (!slotKeys.includes(slot)) setSlot(slotKeys[0] ?? ""); }, [slotKeys.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const inSlot = data.seats.filter(x => { const p = paperBy.get(x.paper_id); return p?.slot_date && `${p.slot_date}#${p.slot_session ?? 0}` === slot; });
  const hallIds = [...new Set(inSlot.map(x => x.hall_id))];
  const palette = ["bg-sky-100", "bg-amber-100", "bg-emerald-100", "bg-rose-100", "bg-violet-100", "bg-lime-100", "bg-orange-100", "bg-teal-100"];
  const paperIds = [...new Set(inSlot.map(x => x.paper_id))];
  const colour = new Map(paperIds.map((id, i) => [id, palette[i % palette.length]]));
  return (
    <div className="space-y-3">
      {data.can_edit && (
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn btn-primary" disabled={busy !== null || !data.papers.some(p => p.slot_date)} onClick={() => act("allocate_seats", {}, d => `Seated ${d.seated} candidates.${d.unseated.length ? ` Not enough seats in ${d.unseated.length} session(s): add halls or seats.` : ""}`)}>{busy === "allocate_seats" ? "Seating…" : data.seats.length ? "Redo seating plans" : "Make seating plans"}</button>
          <p className="text-xs text-slate-500">Classes and papers are mixed so neighbours sit different papers. {s.spacing === "alternate" ? "Every other seat is left empty when there is room." : ""}</p>
        </div>
      )}
      {!data.seats.length ? <Empty>No seating yet. Build the timetable, then make seating plans.</Empty> : (
        <>
          <Field label="Session"><select className="input max-w-sm" value={slot} onChange={e => setSlot(e.target.value)}>{slotKeys.map(k => { const [d, i] = k.split("#"); return <option key={k} value={k}>{slotName(s, d, Number(i))}</option>; })}</select></Field>
          <div className="flex flex-wrap gap-2 text-xs">{paperIds.map(id => <span key={id} className={"rounded px-2 py-1 " + colour.get(id)}>{paperBy.get(id)?.title}</span>)}</div>
          {hallIds.map(hid => {
            const hall = data.halls.find(h => h.id === hid);
            const seats = inSlot.filter(x => x.hall_id === hid);
            const rows = Math.max(...seats.map(x => x.row)) + 1, cols = Math.max(...seats.map(x => x.col)) + 1;
            const at = new Map(seats.map(x => [`${x.row}|${x.col}`, x]));
            return (
              <section key={hid} className="card p-4">
                <h3 className="mb-2 font-semibold">{hall?.name ?? "Hall"} <span className="text-sm font-normal text-slate-500">· {seats.length} candidates · front of hall at the top</span></h3>
                <div className="overflow-x-auto">
                  <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${cols}, minmax(84px, 1fr))` }}>
                    {Array.from({ length: rows * cols }, (_, i) => {
                      const x = at.get(`${Math.floor(i / cols)}|${i % cols}`);
                      return x ? <div key={i} className={"rounded p-1 text-[11px] leading-tight " + colour.get(x.paper_id)}><b>{x.label}</b> {x.name}</div> : <div key={i} className="rounded border border-dashed border-slate-200 p-1 text-[11px] text-slate-300">empty</div>;
                    })}
                  </div>
                </div>
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}

function Invigilation({ data, act, busy }: { data: Full; act: ActFn; busy: string | null }) {
  const s = data.series;
  const hall = new Map(data.halls.map(h => [h.id, h.name]));
  const bySlot = new Map<string, Duty[]>();
  for (const d of data.duties) { const k = `${d.slot_date}#${d.slot_session}`; bySlot.set(k, [...(bySlot.get(k) ?? []), d]); }
  const load = new Map<string, { name: string; n: number }>();
  for (const d of data.duties) load.set(d.staff_user_id, { name: d.name, n: (load.get(d.staff_user_id)?.n ?? 0) + 1 });
  return (
    <div className="space-y-3">
      {data.can_edit && (
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn btn-primary" disabled={busy !== null || !data.seats.length} onClick={() => act("assign_invigilators", {}, d => `Assigned ${d.duties} duties.${d.short.length ? ` Short of staff in ${d.short.length} hall session(s).` : ""}`)}>{busy === "assign_invigilators" ? "Assigning…" : data.duties.length ? "Redo roster" : "Assign invigilators"}</button>
          <p className="text-xs text-slate-500">One invigilator per {s.invigilator_ratio} candidates (at least one per hall). Teachers on recorded absence are skipped, nobody is in two halls at once, subject teachers avoid their own paper, and duties are shared evenly.</p>
        </div>
      )}
      {!data.duties.length ? <Empty>No invigilation roster yet.</Empty> : (
        <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-2">Session</th><th className="p-2">Hall</th><th className="p-2">Invigilators</th></tr></thead>
              <tbody>{[...bySlot].sort(([a], [b]) => a.localeCompare(b)).flatMap(([k, ds]) => {
                const [d, i] = k.split("#");
                return [...new Set(ds.map(x => x.hall_id))].map((h, j) => (
                  <tr key={`${k}${h}`} className="border-t border-slate-100">
                    <td className="p-2 text-xs">{j === 0 ? slotName(s, d, Number(i)) : ""}</td>
                    <td className="p-2">{hall.get(h)}</td>
                    <td className="p-2">{ds.filter(x => x.hall_id === h).sort((a, b) => Number(b.chief) - Number(a.chief)).map(x => <span key={x.staff_user_id} className="mr-2 inline-block">{x.name}{x.chief && <Badge tone="blue">chief</Badge>}</span>)}</td>
                  </tr>
                ));
              })}</tbody>
            </table>
          </div>
          <div className="card h-fit p-4 text-sm">
            <p className="mb-2 font-semibold">Duties per person</p>
            <ul className="space-y-1">{[...load.values()].sort((a, b) => b.n - a.n).map(x => <li key={x.name} className="flex justify-between"><span>{x.name}</span><b className="tabular-nums">{x.n}</b></li>)}</ul>
          </div>
        </div>
      )}
    </div>
  );
}
