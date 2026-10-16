"use client";
import { useState } from "react";
import { useApi, send, Alert, Empty, Modal, Field, Badge, Loading, fmtDate, localDate } from "@/components/ui";
import ClassStudents from "./ClassStudents";

type Group = { id: string; name: string; kind: string; description: string | null; meets: string | null; location: string | null; capacity: number | null; lead_id: string | null; assistant_ids: string[];
  open_to_class_ids: string[]; joining: string; fee_item_id: string | null; active: boolean; lead_name: string | null; members: number; requests: number; mine: boolean };
type List = { admin: boolean; me: string; staff: { id: string; full_name: string }[]; classes: { id: string; name: string }[]; fee_items: { id: string; name: string }[]; groups: Group[] };
type Member = { student_id: string; role: string; status: string; joined_on: string | null; name: string; class: string | null; rate: number | null };
type Detail = { group: Group; can_manage: boolean; members: Member[]; sessions: { id: string; held_on: string; kind: string; notes: string | null; marks: { student_id: string; status: string }[] }[] };

const KINDS = [["club", "Club"], ["society", "Society"], ["sport", "Sport"], ["team", "Team"], ["choir", "Choir"], ["band", "Band"], ["drama", "Drama"], ["other", "Other"]];
const ROLES = [["member", "Member"], ["captain", "Captain"], ["vice_captain", "Vice-captain"], ["secretary", "Secretary"], ["treasurer", "Treasurer"], ["other", "Other"]];
const JOINING: Record<string, string> = { open: "students join themselves", approval: "students ask, leads accept", closed: "leads add members" };

export default function Clubs() {
  const { data, error, reload } = useApi<List>("/api/cocurricular?view=groups");
  const [edit, setEdit] = useState<Group | "new" | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [mineOnly, setMineOnly] = useState(false);
  if (!data) return error ? <Alert>{error}</Alert> : <Loading />;
  const groups = data.groups.filter(g => !mineOnly || g.mine);
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        {!data.admin ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={mineOnly} onChange={e => setMineOnly(e.target.checked)} /> Only groups I lead</label> : <span />}
        {data.admin && <button className="btn btn-primary" onClick={() => setEdit("new")}>+ New club or team</button>}
      </div>
      {!groups.length ? <Empty>No clubs or teams yet.{data.admin ? " Start one and choose a member of staff to lead it." : ""}</Empty> : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{groups.map(g => (
          <button key={g.id} className="card p-4 text-left transition hover:border-brand-300" onClick={() => setOpen(g.id)}>
            <div className="flex items-start justify-between gap-2"><p className="font-semibold">{g.name}</p><Badge tone="violet">{g.kind}</Badge></div>
            <p className="text-sm text-slate-500">{[g.meets, g.location].filter(Boolean).join(" · ") || "No meeting time set"}</p>
            <p className="mt-1 text-xs text-slate-500">Led by {g.lead_name ?? "nobody yet"}</p>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <Badge>{g.members}{g.capacity ? ` / ${g.capacity}` : ""} members</Badge>
              {g.requests > 0 && <Badge tone="amber">{g.requests} asking to join</Badge>}
              {!g.active && <Badge tone="red">not running</Badge>}
              {g.fee_item_id && <Badge tone="blue">has a fee</Badge>}
            </div>
          </button>))}</div>
      )}
      <Modal open={Boolean(edit)} onClose={() => setEdit(null)} title={edit === "new" ? "New club or team" : "Edit group"} wide>
        {edit && <GroupForm list={data} group={edit === "new" ? null : edit} onDone={() => { setEdit(null); reload(); }} />}
      </Modal>
      <Modal open={Boolean(open)} onClose={() => { setOpen(null); reload(); }} title={data.groups.find(g => g.id === open)?.name ?? "Group"} wide>
        {open && <GroupDetail id={open} list={data} onEdit={g => { setOpen(null); setEdit(g); }} />}
      </Modal>
    </>
  );
}

function GroupForm({ list, group, onDone }: { list: List; group: Group | null; onDone: () => void }) {
  const [f, setF] = useState({ name: group?.name ?? "", kind: group?.kind ?? "club", description: group?.description ?? "", meets: group?.meets ?? "", location: group?.location ?? "",
    capacity: group?.capacity ? String(group.capacity) : "", lead_id: group?.lead_id ?? "", assistant_ids: group?.assistant_ids ?? [], open_to_class_ids: group?.open_to_class_ids ?? [],
    joining: group?.joining ?? "approval", fee_item_id: group?.fee_item_id ?? "", active: group?.active ?? true });
  const [err, setErr] = useState<string | null>(null);
  return (
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={async e => {
      e.preventDefault();
      const r = await send("/api/cocurricular", { action: "save_group", id: group?.id, name: f.name, kind: f.kind, description: f.description, meets: f.meets, location: f.location,
        capacity: f.capacity ? Number(f.capacity) : null, lead_id: f.lead_id || null, assistant_ids: f.assistant_ids, open_to_class_ids: f.open_to_class_ids, joining: f.joining,
        fee_item_id: f.fee_item_id || null, active: f.active });
      if (!r.ok) return setErr(r.error);
      onDone();
    }}>
      <Field label="Name"><input className="input" required maxLength={120} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
      <Field label="Type"><select className="input" value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
      <Field label="Meets"><input className="input" placeholder="Wednesdays 3–4pm" value={f.meets} onChange={e => setF({ ...f, meets: e.target.value })} /></Field>
      <Field label="Where"><input className="input" value={f.location} onChange={e => setF({ ...f, location: e.target.value })} /></Field>
      <div className="sm:col-span-2"><Field label="About"><textarea className="input h-20" value={f.description} onChange={e => setF({ ...f, description: e.target.value })} /></Field></div>
      <Field label="Joining"><select className="input" value={f.joining} onChange={e => setF({ ...f, joining: e.target.value })}>{Object.entries(JOINING).map(([k, l]) => <option key={k} value={k}>{l[0].toUpperCase() + l.slice(1)}</option>)}</select></Field>
      <Field label="Places (optional)"><input className="input" type="number" min={1} max={2000} value={f.capacity} onChange={e => setF({ ...f, capacity: e.target.value })} /></Field>
      {list.admin && <>
        <Field label="Lead"><select className="input" value={f.lead_id} onChange={e => setF({ ...f, lead_id: e.target.value })}><option value="">Nobody yet</option>{list.staff.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select></Field>
        <Field label="Fee (added to members' invoices)" hint="Set the amount under Fees as an optional item."><select className="input" value={f.fee_item_id} onChange={e => setF({ ...f, fee_item_id: e.target.value })}><option value="">Free</option>{list.fee_items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select></Field>
        <fieldset className="sm:col-span-2"><legend className="label">Other staff who help run it</legend><div className="flex max-h-32 flex-wrap gap-2 overflow-y-auto">{list.staff.filter(s => s.id !== f.lead_id).map(s => (
          <label key={s.id} className="flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-sm"><input type="checkbox" checked={f.assistant_ids.includes(s.id)} onChange={e => setF({ ...f, assistant_ids: e.target.checked ? [...f.assistant_ids, s.id] : f.assistant_ids.filter(x => x !== s.id) })} />{s.full_name}</label>))}</div></fieldset>
      </>}
      <fieldset className="sm:col-span-2"><legend className="label">Open to (none ticked = every class)</legend><div className="flex flex-wrap gap-2">{list.classes.map(c => (
        <label key={c.id} className="flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-sm"><input type="checkbox" checked={f.open_to_class_ids.includes(c.id)} onChange={e => setF({ ...f, open_to_class_ids: e.target.checked ? [...f.open_to_class_ids, c.id] : f.open_to_class_ids.filter(x => x !== c.id) })} />{c.name}</label>))}</div></fieldset>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active} onChange={e => setF({ ...f, active: e.target.checked })} /> Running this term</label>
      {err && <div className="sm:col-span-2"><Alert>{err}</Alert></div>}
      <div className="flex justify-end sm:col-span-2"><button className="btn btn-primary">Save</button></div>
    </form>
  );
}

function GroupDetail({ id, list, onEdit }: { id: string; list: List; onEdit: (g: Group) => void }) {
  const { data, error, reload } = useApi<Detail>(`/api/cocurricular?view=group&id=${id}`, [id]);
  const [msg, setMsg] = useState<{ tone: "red" | "green"; text: string } | null>(null);
  const [register, setRegister] = useState(false);
  if (!data) return error ? <Alert>{error}</Alert> : <Loading />;
  const g = data.group, active = data.members.filter(m => m.status === "active"), requests = data.members.filter(m => m.status === "requested");
  async function act(body: object, ok?: string) {
    const r = await send("/api/cocurricular", body);
    setMsg(r.ok ? (ok ? { tone: "green", text: ok } : null) : { tone: "red", text: r.error ?? "Something went wrong" });
    if (r.ok) reload();
    return r.ok;
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2 text-sm">
        <div>
          <p>{[g.meets, g.location].filter(Boolean).join(" · ")}</p>
          <p className="text-slate-500">{JOINING[g.joining]}{g.capacity ? ` · ${g.capacity} places` : ""}</p>
          {g.description && <p className="mt-1 whitespace-pre-wrap">{g.description}</p>}
        </div>
        {data.can_manage && <div className="flex gap-2"><button className="btn btn-ghost" onClick={() => onEdit(g)}>Edit</button><button className="btn btn-primary" disabled={!active.length} onClick={() => setRegister(!register)}>{register ? "Close register" : "Take attendance"}</button></div>}
      </div>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {register && <Register members={active} groupId={g.id} onDone={() => { setRegister(false); setMsg({ tone: "green", text: "Attendance saved." }); reload(); }} />}
      {requests.length > 0 && (
        <section><h3 className="mb-2 font-semibold">Asking to join</h3>
          <ul className="space-y-1">{requests.map(m => (
            <li key={m.student_id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
              <span>{m.name} <span className="text-slate-500">{m.class}</span></span>
              {data.can_manage && <span className="flex gap-2"><button className="btn btn-primary px-2 py-1 text-xs" onClick={() => act({ action: "member", group_id: g.id, student_id: m.student_id, status: "active" }, `${m.name} has joined.`)}>Accept</button>
                <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => act({ action: "member", group_id: g.id, student_id: m.student_id, status: "declined" })}>Decline</button></span>}
            </li>))}</ul>
        </section>
      )}
      <section>
        <h3 className="mb-2 font-semibold">Members ({active.length})</h3>
        {!active.length ? <Empty>No members yet.</Empty> : (
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-[13px] text-slate-500"><tr><th className="py-1">Student</th><th>Class</th><th>Role</th><th>Attendance</th><th>Joined</th><th /></tr></thead>
            <tbody>{active.map(m => (
              <tr key={m.student_id} className="border-t border-slate-100">
                <td className="py-1.5">{m.name}</td><td>{m.class}</td>
                <td>{data.can_manage ? <select className="input py-1 text-xs" aria-label={`Role for ${m.name}`} value={m.role} onChange={e => act({ action: "member", group_id: g.id, student_id: m.student_id, role: e.target.value })}>{ROLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                  : ROLES.find(r => r[0] === m.role)?.[1]}</td>
                <td>{m.rate === null ? "—" : <Badge tone={m.rate >= 80 ? "green" : m.rate >= 60 ? "amber" : "red"}>{m.rate}%</Badge>}</td>
                <td className="text-xs">{fmtDate(m.joined_on)}</td>
                <td className="text-right">{data.can_manage && <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => confirm(`Take ${m.name} out of ${g.name}?`) && act({ action: "member", group_id: g.id, student_id: m.student_id, status: "left" })}>Remove</button>}</td>
              </tr>))}</tbody></table></div>
        )}
        {data.can_manage && <div className="mt-3"><ClassStudents classes={list.classes} exclude={active.map(m => m.student_id)} label="Add to group"
          onPick={async s => { await act({ action: "add_members", group_id: g.id, student_ids: s.map(x => x.id) }, `${s.length} added.`); }} /></div>}
      </section>
      {data.sessions.length > 0 && (
        <section><h3 className="mb-2 font-semibold">Sessions</h3>
          <ul className="divide-y divide-slate-100 text-sm">{data.sessions.map(s => {
            const here = s.marks.filter(m => m.status === "present" || m.status === "late").length;
            return <li key={s.id} className="flex justify-between py-1.5"><span>{fmtDate(s.held_on)} · {s.kind}{s.notes ? ` · ${s.notes}` : ""}</span><span className="text-slate-500">{here} of {s.marks.length} there</span></li>;
          })}</ul>
        </section>
      )}
    </div>
  );
}

function Register({ members, groupId, onDone }: { members: Member[]; groupId: string; onDone: () => void }) {
  const [day, setDay] = useState(localDate());
  const [kind, setKind] = useState("meeting");
  const [notes, setNotes] = useState("");
  const [marks, setMarks] = useState<Record<string, string>>(Object.fromEntries(members.map(m => [m.student_id, "present"])));
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="rounded-lg border border-brand-200 bg-brand-50/40 p-3">
      <div className="grid gap-2 sm:grid-cols-3">
        <Field label="Date"><input className="input" type="date" value={day} onChange={e => setDay(e.target.value)} /></Field>
        <Field label="Session"><select className="input" value={kind} onChange={e => setKind(e.target.value)}>{["meeting", "training", "rehearsal", "match", "performance", "other"].map(k => <option key={k} value={k}>{k[0].toUpperCase() + k.slice(1)}</option>)}</select></Field>
        <Field label="Notes"><input className="input" value={notes} onChange={e => setNotes(e.target.value)} /></Field>
      </div>
      <ul className="mt-2 divide-y divide-slate-100 text-sm">{members.map(m => (
        <li key={m.student_id} className="flex flex-wrap items-center justify-between gap-2 py-1.5"><span>{m.name}</span>
          <span className="flex gap-1">{["present", "late", "absent", "excused"].map(s => (
            <button key={s} type="button" aria-pressed={marks[m.student_id] === s} onClick={() => setMarks({ ...marks, [m.student_id]: s })}
              className={`rounded px-2 py-1 text-xs ${marks[m.student_id] === s ? (s === "absent" ? "bg-rose-600 text-white" : s === "late" ? "bg-amber-500 text-white" : s === "excused" ? "bg-slate-500 text-white" : "bg-emerald-600 text-white") : "bg-white ring-1 ring-slate-200"}`}>{s}</button>))}</span>
        </li>))}</ul>
      {err && <Alert>{err}</Alert>}
      <button className="btn btn-primary mt-2" onClick={async () => {
        const r = await send("/api/cocurricular", { action: "session", group_id: groupId, held_on: day, kind, notes, marks: Object.entries(marks).map(([student_id, status]) => ({ student_id, status })) });
        if (!r.ok) return setErr(r.error);
        onDone();
      }}>Save attendance</button>
    </div>
  );
}
