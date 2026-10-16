"use client";
import { useEffect, useState } from "react";
import { useApi, send, Alert, Empty, Field, Badge, Modal, fmtDate, fmtTime, localDate } from "@/components/ui";
import PeoplePicker, { type Person } from "@/components/comms/PeoplePicker";

type RollRow = { student_id: string; name: string; room: string; class: string | null; status: string };
const STATUS: Record<string, string> = { present: "Present", absent: "Absent", late: "Late", exeat: "On exeat", sick_bay: "Sick bay", excused: "Excused" };
const TONE: Record<string, "green" | "red" | "amber" | "blue" | "slate"> = { present: "green", absent: "red", late: "amber", exeat: "blue", sick_bay: "amber", excused: "slate" };

/** Take a roll call: everyone starts present (or on exeat / in the sick bay); tap anyone missing. */
export function RollCall({ hostels }: { hostels: { id: string; name: string }[] }) {
  const [hostel, setHostel] = useState(hostels[0]?.id ?? "");
  const { data, reload } = useApi<{ roll: RollRow[]; calls: { id: string; kind: string; taken_at: string; summary: any; missing: string[] }[] }>(hostel ? `/api/hostel/house?view=roll&hostel=${hostel}` : null, [hostel]);
  const [marks, setMarks] = useState<Record<string, string>>({});
  const [kind, setKind] = useState("evening");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { setMarks({}); }, [hostel]);
  if (!hostels.length) return <Empty>No boarding houses yet.</Empty>;
  const roll = (data?.roll ?? []).map(r => ({ ...r, status: marks[r.student_id] ?? r.status }));
  const cycle = (s: string) => ({ present: "absent", absent: "late", late: "excused", excused: "present", exeat: "present", sick_bay: "present" } as Record<string, string>)[s] ?? "present";
  const absent = roll.filter(r => r.status === "absent").length;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="House"><select className="input" value={hostel} onChange={e => setHostel(e.target.value)}>{hostels.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}</select></Field>
        <Field label="Roll"><select className="input" value={kind} onChange={e => setKind(e.target.value)}><option value="morning">Morning</option><option value="prep">Prep</option><option value="evening">Evening</option><option value="night">Lights out</option><option value="other">Other</option></select></Field>
        <span className="text-sm text-slate-600">Tap a name to change it: present → absent → late → excused.</span>
      </div>
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      {!roll.length ? <Empty>No boarders in this house.</Empty> : <>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4">{roll.map(r => (
          <button key={r.student_id} onClick={() => setMarks({ ...marks, [r.student_id]: cycle(r.status) })}
            className={"rounded-lg border px-2 py-2 text-left text-sm " + (r.status === "absent" ? "border-rose-400 bg-rose-50" : r.status === "present" ? "border-slate-200" : "border-amber-300 bg-amber-50")}>
            <span className="font-medium">{r.name}</span><span className="block text-xs text-slate-500">{r.room} · <Badge tone={TONE[r.status]}>{STATUS[r.status]}</Badge></span></button>))}</div>
        <button className="btn btn-primary" onClick={async () => {
          const r = await send<any>("/api/hostel/house", { action: "take_roll", hostel_id: hostel, kind, marks: roll.map(x => ({ student_id: x.student_id, status: x.status })) });
          setMsg({ ok: r.ok, text: r.ok ? `Saved: ${r.data.present} present${r.data.absent ? `, ${r.data.absent} absent; house staff and the principal have been alerted` : ""}.` : r.error ?? "" });
          if (r.ok) { setMarks({}); reload(); }
        }}>Save roll call{absent ? ` (${absent} absent)` : ""}</button>
      </>}
      {(data?.calls ?? []).length > 0 && <section className="card p-4"><h3 className="mb-2 font-semibold">Recent roll calls</h3>
        <ul className="space-y-1 text-sm">{data!.calls.map(c => <li key={c.id}>{fmtDate(c.taken_at)} {fmtTime(c.taken_at)} · <span className="capitalize">{c.kind}</span>: {c.summary.present}/{c.summary.total} present{c.summary.exeat ? `, ${c.summary.exeat} on exeat` : ""}{c.summary.sick_bay ? `, ${c.summary.sick_bay} sick bay` : ""}
          {c.missing.length > 0 && <span className="text-rose-700"> · missing: {c.missing.join(", ")}</span>}</li>)}</ul></section>}
    </div>
  );
}

/** House-parent notes about a boarder; some can be shared with the family. */
export function HouseNotes() {
  const [who, setWho] = useState<Person[]>([]);
  const sid = who[0]?.id;
  const { data, reload } = useApi<{ me: string; notes: any[] }>(sid ? `/api/hostel/house?view=notes&student=${sid}` : null, [sid]);
  const [f, setF] = useState({ kind: "general", note: "", visible_to_parent: false });
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="space-y-3">
        <Field label="Boarder"><PeoplePicker types={["Student"]} value={who} onChange={v => setWho(v.slice(-1))} placeholder="Search a boarder" /></Field>
        {sid && <form className="card space-y-2 p-4" onSubmit={async e => {
          e.preventDefault();
          const r = await send("/api/hostel/house", { action: "add_note", student_id: sid, ...f });
          if (!r.ok) return setErr(r.error);
          setErr(null); setF({ ...f, note: "" }); reload();
        }}>
          <Field label="Kind"><select className="input" value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })}>{["general", "welfare", "behaviour", "health", "achievement", "contact"].map(k => <option key={k}>{k}</option>)}</select></Field>
          <Field label="Note"><textarea className="input" rows={3} required minLength={2} value={f.note} onChange={e => setF({ ...f, note: e.target.value })} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.visible_to_parent} onChange={e => setF({ ...f, visible_to_parent: e.target.checked })} />Share with the family (shows in their portal)</label>
          {err && <Alert>{err}</Alert>}
          <button className="btn btn-primary">Add note</button>
        </form>}
      </div>
      <div>{!sid ? <Empty>Choose a boarder to see and add notes.</Empty> : !data?.notes.length ? <Empty>No notes yet.</Empty> : (
        <ul className="space-y-2">{data.notes.map(n => <li key={n.id} className="card p-3 text-sm"><p className="text-xs text-slate-500">{fmtDate(n.created_at)} · {n.author} · <span className="capitalize">{n.kind}</span>{n.visible_to_parent && <Badge tone="blue">shared with family</Badge>}
          {n.author_id === data.me && <button className="ml-2 text-rose-600" onClick={async () => { if (confirm("Delete this note?")) { await send("/api/hostel/house", { action: "delete_note", id: n.id }); reload(); } }}>delete</button>}</p>
          <p className="whitespace-pre-wrap">{n.note}</p></li>)}</ul>)}</div>
    </div>
  );
}

const MEALS = ["breakfast", "lunch", "supper", "snack"];

/** The week's menus, numbers to cook for and special diets, and the dining register. */
export function Dining() {
  const [date, setDate] = useState(localDate());
  const [meal, setMeal] = useState("lunch");
  const { data, reload } = useApi<any>(`/api/hostel/house?view=dining&date=${date}&meal=${meal}`, [date, meal]);
  const [edit, setEdit] = useState<{ on_date: string; meal: string; items: string; alternatives: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  if (!data) return null;
  const days = Array.from({ length: 7 }, (_, i) => new Date(Date.parse(`${date}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10));
  const menu = (d: string, m: string) => data.menus.find((x: any) => x.on_date === d && x.meal === m && !x.hostel_id);
  const mark = async (ids: string[], status: string) => { await send("/api/hostel/house", { action: "dining", on_date: date, meal, student_ids: ids, status }); reload(); };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Week from"><input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
        {data.can_edit && <button className="btn btn-ghost" onClick={async () => { const to = new Date(Date.parse(`${date}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10); const r = await send<{ copied: number }>("/api/hostel/house", { action: "copy_week", from: date, to }); setMsg(r.ok ? `${r.data.copied} menus copied to the next week.` : r.error); }}>Copy this week to next week</button>}
      </div>
      {msg && <Alert tone="green">{msg}</Alert>}
      <div className="card overflow-x-auto"><table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-2">Day</th>{MEALS.map(m => <th key={m} className="p-2 capitalize">{m}</th>)}</tr></thead>
        <tbody>{days.map(d => <tr key={d} className="border-t border-slate-100 align-top"><td className="whitespace-nowrap p-2 font-medium">{fmtDate(d)}</td>
          {MEALS.map(m => { const x = menu(d, m); return <td key={m} className="p-2">{x ? <>{x.items}{x.alternatives && <span className="block text-xs text-slate-500">or {x.alternatives}</span>}</> : <span className="text-slate-300">—</span>}
            {data.can_edit && <button className="ml-1 text-xs text-brand-700" onClick={() => setEdit({ on_date: d, meal: m, items: x?.items ?? "", alternatives: x?.alternatives ?? "" })}>{x ? "edit" : "add"}</button>}</td>; })}</tr>)}</tbody></table></div>
      <section className="card space-y-2 p-4">
        <div className="flex flex-wrap items-end gap-2"><h3 className="mr-auto font-semibold">{fmtDate(date)} · <span className="capitalize">{meal}</span></h3>
          <Field label="Meal"><select className="input" value={meal} onChange={e => setMeal(e.target.value)}>{MEALS.map(m => <option key={m} value={m}>{m}</option>)}</select></Field></div>
        <p className="text-sm">Cook for <b>{data.headcount.eating}</b> boarders ({data.headcount.away} away on exeat).</p>
        {data.headcount.diets.length > 0 && <p className="text-sm">Diets: {data.headcount.diets.map((d: any) => `${d.tag} (${d.count})`).join(", ")}</p>}
        {data.headcount.allergies.length > 0 && <p className="text-sm text-rose-700">Allergies: {data.headcount.allergies.map((d: any) => `${d.tag} (${d.count})`).join(", ")}</p>}
        {data.can_edit && <>
          <div className="flex gap-2"><button className="btn btn-outline px-2 py-1 text-xs" onClick={() => mark(data.register.filter((r: any) => !r.status).map((r: any) => r.student_id), "ate")}>Mark everyone not marked as ate</button></div>
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-4">{data.register.map((r: any) => (
            <button key={r.student_id} className={"rounded border px-2 py-1 text-left text-xs " + (r.status === "ate" ? "border-emerald-300 bg-emerald-50" : r.status === "missed" ? "border-rose-300 bg-rose-50" : "border-slate-200")}
              onClick={() => mark([r.student_id], r.status === "ate" ? "missed" : "ate")}>{r.name}{r.special && " ⚑"}<span className="block text-slate-500">{r.status ?? "not marked"}</span></button>))}</div>
          <p className="text-xs text-slate-500">⚑ special diet or allergy. Tap to switch between ate and missed; a boarder who keeps missing meals may need a welfare check.</p>
        </>}
      </section>
      <Modal open={Boolean(edit)} onClose={() => setEdit(null)} title={edit ? `${fmtDate(edit.on_date)} · ${edit.meal}` : ""}>
        {edit && <form className="space-y-3" onSubmit={async e => {
          e.preventDefault();
          const r = await send("/api/hostel/house", { action: "save_menu", on_date: edit.on_date, meal: edit.meal, items: edit.items, alternatives: edit.alternatives || null });
          if (r.ok) { setEdit(null); reload(); } else alert(r.error);
        }}>
          <Field label="Menu"><textarea className="input" rows={3} required value={edit.items} onChange={e => setEdit({ ...edit, items: e.target.value })} placeholder="e.g. Jollof rice, chicken, plantain" /></Field>
          <Field label="Alternative (vegetarian, allergy-safe)"><input className="input" value={edit.alternatives} onChange={e => setEdit({ ...edit, alternatives: e.target.value })} /></Field>
          <button className="btn btn-primary w-full">Save</button>
        </form>}
      </Modal>
    </div>
  );
}

/** Arrange an exeat from the house side; parents agree in their portal unless the house says otherwise. */
export function NewExeat({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (t: string) => void }) {
  const [who, setWho] = useState<Person[]>([]);
  const [f, setF] = useState({ kind: "weekend", reason: "", leave: "", ret: "", collector_name: "", needs_parent: true });
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal open={open} onClose={onClose} title="Arrange an exeat">
      <form className="space-y-3" onSubmit={async e => {
        e.preventDefault();
        if (!who.length) return setErr("choose the boarder");
        const r = await send("/api/hostel", { action: "exeat_create", student_id: who[0].id, kind: f.kind, reason: f.reason, leave_at: new Date(f.leave).toISOString(), return_by: new Date(f.ret).toISOString(),
          collector_name: f.collector_name || null, needs_parent: f.needs_parent });
        if (!r.ok) return setErr(r.error);
        setWho([]); setErr(null); onDone(f.needs_parent ? "Arranged; waiting for the parents to agree." : "Arranged and approved; parents told.");
      }}>
        <Field label="Boarder"><PeoplePicker types={["Student"]} value={who} onChange={v => setWho(v.slice(-1))} placeholder="Search a boarder" /></Field>
        <Field label="Kind"><select className="input" value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })}><option value="weekend">Weekend</option><option value="day">Day out</option><option value="medical">Medical appointment</option><option value="family">Family event</option><option value="holiday">Holiday</option><option value="other">Other</option></select></Field>
        <Field label="Reason"><input className="input" required minLength={3} value={f.reason} onChange={e => setF({ ...f, reason: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Leaving"><input className="input" type="datetime-local" required value={f.leave} onChange={e => setF({ ...f, leave: e.target.value })} /></Field>
          <Field label="Back by"><input className="input" type="datetime-local" required value={f.ret} onChange={e => setF({ ...f, ret: e.target.value })} /></Field>
        </div>
        <Field label="Collected by"><input className="input" value={f.collector_name} onChange={e => setF({ ...f, collector_name: e.target.value })} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.needs_parent} onChange={e => setF({ ...f, needs_parent: e.target.checked })} />A parent must agree first</label>
        {err && <Alert>{err}</Alert>}
        <button className="btn btn-primary w-full">Arrange</button>
      </form>
    </Modal>
  );
}
