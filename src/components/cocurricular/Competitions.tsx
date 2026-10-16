"use client";
import { useState } from "react";
import { useApi, send, Alert, Empty, Modal, Field, Badge, Loading, fmtDate, localDate } from "@/components/ui";
import ClassStudents from "./ClassStudents";

type Comp = { id: string; title: string; kind: string; level: string; held_on: string; venue: string | null; organiser: string | null; group_id: string | null; notes: string | null;
  cc_groups: { name: string } | null; entries: number; podium: number };
type Entry = { id?: string; student_id: string; name: string; class?: string | null; event: string | null; team_name: string | null; position: number | null; score: string | null; award: string | null; notes: string | null; achievement_id?: string | null };
type Lists = { classes: { id: string; name: string }[]; groups: { id: string; name: string }[] };

const KINDS = [["sports", "Sports"], ["academic", "Academic"], ["arts", "Arts"], ["debate", "Debate"], ["quiz", "Quiz"], ["other", "Other"]];
const LEVELS = [["house", "Inter-house"], ["school", "School"], ["local", "Local / zonal"], ["state", "State"], ["national", "National"], ["international", "International"]];

export default function Competitions() {
  const { data, error, reload } = useApi<Comp[]>("/api/cocurricular?view=competitions");
  const { data: lists } = useApi<Lists>("/api/cocurricular?view=groups");
  const [edit, setEdit] = useState<Comp | "new" | null>(null);
  const [open, setOpen] = useState<Comp | null>(null);
  if (!data) return error ? <Alert>{error}</Alert> : <Loading />;
  return (
    <>
      <div className="mb-3 flex justify-end"><button className="btn btn-primary" onClick={() => setEdit("new")}>+ Record a competition</button></div>
      {!data.length ? <Empty>No competitions yet. Record one, enter the students and their results; podium places and awards go on each child&apos;s achievements.</Empty> : (
        <div className="card overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="px-3 py-2">Date</th><th>Competition</th><th>Level</th><th>Team</th><th>Entries</th><th>Top three</th></tr></thead>
          <tbody>{data.map(c => (
            <tr key={c.id} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50" onClick={() => setOpen(c)}>
              <td className="px-3 py-2">{fmtDate(c.held_on)}</td><td className="font-medium">{c.title} <Badge tone="violet">{c.kind}</Badge></td>
              <td>{LEVELS.find(l => l[0] === c.level)?.[1]}</td><td>{c.cc_groups?.name ?? "—"}</td><td>{c.entries}</td><td>{c.podium ? <Badge tone="green">{c.podium}</Badge> : "—"}</td>
            </tr>))}</tbody></table></div>
      )}
      <Modal open={Boolean(edit)} onClose={() => setEdit(null)} title={edit === "new" ? "Record a competition" : "Edit competition"} wide>
        {edit && <CompForm comp={edit === "new" ? null : edit} groups={lists?.groups ?? []} onDone={() => { setEdit(null); reload(); }} />}
      </Modal>
      <Modal open={Boolean(open)} onClose={() => { setOpen(null); reload(); }} title={open?.title ?? ""} wide>
        {open && <Results comp={open} classes={lists?.classes ?? []} onEdit={() => { setEdit(open); setOpen(null); }} />}
      </Modal>
    </>
  );
}

function CompForm({ comp, groups, onDone }: { comp: Comp | null; groups: { id: string; name: string }[]; onDone: () => void }) {
  const [f, setF] = useState({ title: comp?.title ?? "", kind: comp?.kind ?? "sports", level: comp?.level ?? "school", held_on: comp?.held_on ?? localDate(), venue: comp?.venue ?? "",
    organiser: comp?.organiser ?? "", group_id: comp?.group_id ?? "", notes: comp?.notes ?? "" });
  const [err, setErr] = useState<string | null>(null);
  return (
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={async e => {
      e.preventDefault();
      const r = await send("/api/cocurricular", { action: "save_competition", id: comp?.id, ...f, group_id: f.group_id || null });
      if (!r.ok) return setErr(r.error);
      onDone();
    }}>
      <div className="sm:col-span-2"><Field label="Competition"><input className="input" required minLength={2} maxLength={160} placeholder="Lagos State inter-schools athletics" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} /></Field></div>
      <Field label="Type"><select className="input" value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
      <Field label="Level"><select className="input" value={f.level} onChange={e => setF({ ...f, level: e.target.value })}>{LEVELS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
      <Field label="Date"><input className="input" type="date" required value={f.held_on} onChange={e => setF({ ...f, held_on: e.target.value })} /></Field>
      <Field label="Our team (optional)"><select className="input" value={f.group_id} onChange={e => setF({ ...f, group_id: e.target.value })}><option value="">—</option>{groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>
      <Field label="Venue"><input className="input" value={f.venue} onChange={e => setF({ ...f, venue: e.target.value })} /></Field>
      <Field label="Organised by"><input className="input" value={f.organiser} onChange={e => setF({ ...f, organiser: e.target.value })} /></Field>
      <div className="sm:col-span-2"><Field label="Notes"><textarea className="input h-20" value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></Field></div>
      {err && <div className="sm:col-span-2"><Alert>{err}</Alert></div>}
      <div className="flex justify-end sm:col-span-2"><button className="btn btn-primary">Save</button></div>
    </form>
  );
}

function Results({ comp, classes, onEdit }: { comp: Comp; classes: { id: string; name: string }[]; onEdit: () => void }) {
  const { data, error, reload } = useApi<{ entries: Entry[] }>(`/api/cocurricular?view=competition&id=${comp.id}`, [comp.id]);
  const [rows, setRows] = useState<Entry[] | null>(null);
  const [msg, setMsg] = useState<{ tone: "red" | "green"; text: string } | null>(null);
  if (!data) return error ? <Alert>{error}</Alert> : <Loading />;
  const list = rows ?? data.entries;
  const set = (i: number, patch: Partial<Entry>) => setRows(list.map((r, j) => j === i ? { ...r, ...patch } : r));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-500">
        <span>{fmtDate(comp.held_on)}{comp.venue ? ` · ${comp.venue}` : ""}{comp.organiser ? ` · ${comp.organiser}` : ""}</span>
        <button className="btn btn-ghost" onClick={onEdit}>Edit details</button>
      </div>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {!list.length ? <Empty>No students entered yet.</Empty> : (
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-1">Student</th><th>Event</th><th>Team</th><th>Position</th><th>Score / time</th><th>Award</th><th /></tr></thead>
          <tbody>{list.map((e, i) => (
            <tr key={e.id ?? `${e.student_id}-${i}`} className="border-t border-slate-100">
              <td className="py-1.5">{e.name}<div className="text-xs text-slate-400">{e.class}</div></td>
              <td><input className="input py-1 text-xs" aria-label="Event" placeholder="100 m" value={e.event ?? ""} onChange={x => set(i, { event: x.target.value || null })} /></td>
              <td><input className="input py-1 text-xs" aria-label="Team" value={e.team_name ?? ""} onChange={x => set(i, { team_name: x.target.value || null })} /></td>
              <td><input className="input w-20 py-1 text-xs" aria-label="Position" type="number" min={1} value={e.position ?? ""} onChange={x => set(i, { position: x.target.value ? Number(x.target.value) : null })} /></td>
              <td><input className="input w-24 py-1 text-xs" aria-label="Score" value={e.score ?? ""} onChange={x => set(i, { score: x.target.value || null })} /></td>
              <td><input className="input py-1 text-xs" aria-label="Award" placeholder="Best speaker" value={e.award ?? ""} onChange={x => set(i, { award: x.target.value || null })} /></td>
              <td>{e.achievement_id ? <Badge tone="green">on record</Badge> : !e.id && <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setRows(list.filter((_, j) => j !== i))}>Remove</button>}</td>
            </tr>))}</tbody></table></div>
      )}
      <ClassStudents classes={classes} label="Enter" onPick={s => setRows([...list, ...s.map(x => ({ student_id: x.id, name: x.name, event: null, team_name: null, position: null, score: null, award: null, notes: null }))])} />
      {rows && <div className="flex justify-end"><button className="btn btn-primary" onClick={async () => {
        const r = await send<{ achievements: number }>("/api/cocurricular", { action: "entries", competition_id: comp.id, entries: rows.map(e => ({ id: e.id, student_id: e.student_id, event: e.event, team_name: e.team_name, position: e.position, score: e.score, award: e.award, notes: e.notes })) });
        if (!r.ok) return setMsg({ tone: "red", text: r.error ?? "Could not save" });
        setRows(null); reload();
        setMsg({ tone: "green", text: `Results saved.${r.data.achievements ? ` ${r.data.achievements} added to students' achievements.` : ""}` });
      }}>Save results</button></div>}
    </div>
  );
}
