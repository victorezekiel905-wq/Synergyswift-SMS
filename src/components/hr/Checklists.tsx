"use client";
import { useState } from "react";
import { useApi, send, Alert, Empty, Modal, Field, Badge, fmtDate, localDate } from "@/components/ui";

export type Item = { id: string; position: number; label: string; owner: string; due_on: string | null; done_at: string | null; note: string | null; can_tick?: boolean };
export type Checklist = { id: string; staff_id?: string; staff_name?: string; kind: "onboarding" | "offboarding"; name: string; started_on: string; completed_at: string | null; items: Item[] };
type Template = { id: string; kind: "onboarding" | "offboarding"; name: string; items: { label: string; owner: string; due_days: number }[] };

export const OWNERS: Record<string, string> = { hr_manager: "HR", school_admin: "Admin", principal: "Principal", it_admin: "IT", bursar: "Bursary", staff: "The staff member", line_manager: "Line manager" };

/** One checklist: items with their owner and due date, ticked by whoever owns them. */
export function ChecklistCard({ list, canManage, onChange, selfStaff }: { list: Checklist; canManage: boolean; onChange: () => void; selfStaff?: boolean }) {
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const today = localDate();
  const done = list.items.filter(i => i.done_at).length;
  const tickable = (i: Item) => i.can_tick ?? (canManage || (selfStaff && i.owner === "staff"));
  return (
    <section className="card p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">{list.kind === "onboarding" ? "Onboarding" : "Offboarding"}{list.staff_name ? `: ${list.staff_name}` : ""}</h3>
        <span className="text-xs text-slate-500">{list.name} · from {fmtDate(list.started_on)}</span>
        {list.completed_at ? <Badge tone="green">done {fmtDate(list.completed_at)}</Badge> : <Badge tone="blue">{done}/{list.items.length}</Badge>}
        {canManage && <span className="ml-auto flex gap-1">
          <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setAdding(true)}>+ Item</button>
          <button className="btn btn-ghost px-2 py-1 text-xs text-rose-600" onClick={async () => { if (confirm("Delete this checklist?")) { await send("/api/hr/people", { action: "delete_checklist", id: list.id }); onChange(); } }}>Delete</button></span>}
      </div>
      <div className="mb-2 h-1.5 rounded bg-slate-100"><div className="h-1.5 rounded bg-emerald-500" style={{ width: `${list.items.length ? (done / list.items.length) * 100 : 0}%` }} /></div>
      <ul className="space-y-1 text-sm">{list.items.map(i => {
        const late = !i.done_at && i.due_on && i.due_on < today;
        return (
          <li key={i.id} className="flex items-start gap-2">
            <input type="checkbox" className="mt-1" checked={Boolean(i.done_at)} disabled={!tickable(i)} aria-label={i.label} onChange={async e => {
              const note = e.target.checked && i.owner !== "staff" ? prompt("Note (optional)") : null;
              const r = await send("/api/hr/people", { action: "tick", item_id: i.id, done: e.target.checked, note: note || null });
              if (!r.ok) setErr(r.error); else { setErr(null); onChange(); }
            }} />
            <div className="flex-1">
              <span className={i.done_at ? "text-slate-400 line-through" : ""}>{i.label}</span>
              <span className="ml-2 text-xs text-slate-500">{OWNERS[i.owner] ?? i.owner.replace(/_/g, " ")}{i.due_on ? ` · by ${fmtDate(i.due_on)}` : ""}</span>
              {late && <Badge tone="red">overdue</Badge>}
              {i.note && <p className="text-xs text-slate-500">{i.note}</p>}
            </div>
            {canManage && !i.done_at && <button className="text-xs text-slate-400" aria-label="Remove item" onClick={async () => { await send("/api/hr/people", { action: "delete_item", id: i.id }); onChange(); }}>✕</button>}
          </li>
        );
      })}</ul>
      {err && <div className="mt-2"><Alert>{err}</Alert></div>}
      <Modal open={adding} onClose={() => setAdding(false)} title="Add an item">
        <form className="space-y-3" onSubmit={async e => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const r = await send("/api/hr/people", { action: "add_item", checklist_id: list.id, label: String(fd.get("label")), owner: String(fd.get("owner")), due_on: String(fd.get("due_on") || "") || null });
          if (!r.ok) return setErr(r.error);
          setAdding(false); onChange();
        }}>
          <Field label="Task"><input className="input" name="label" required maxLength={200} /></Field>
          <Field label="Who does it"><select className="input" name="owner">{Object.entries(OWNERS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Due"><input className="input" type="date" name="due_on" /></Field>
          <button className="btn btn-primary w-full">Add</button>
        </form>
      </Modal>
    </section>
  );
}

/** All onboarding and offboarding checklists the user can see, and (for HR) starting them and editing templates. */
export function Checklists({ staff }: { staff: { id: string; full_name: string; status: string }[] }) {
  const { data, error, reload } = useApi<{ hr: boolean; open_for_me: number; checklists: Checklist[] }>("/api/hr/people?view=checklists");
  const [start, setStart] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [templates, setTemplates] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const tpl = useApi<{ templates: Template[] }>(data?.hr ? "/api/hr/people?view=templates" : null, [data?.hr, templates]);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return null;
  const open = data.checklists.filter(c => !c.completed_at), closed = data.checklists.filter(c => c.completed_at);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {data.hr && <button className="btn btn-primary" onClick={() => setStart(true)}>Start a checklist</button>}
        {data.hr && <button className="btn btn-outline" onClick={() => setTemplates(true)}>Templates</button>}
        <span className="text-sm text-slate-600">{data.open_for_me ? `${data.open_for_me} item${data.open_for_me === 1 ? "" : "s"} waiting for you.` : "Nothing waiting for you."}</span>
      </div>
      {!open.length ? <Empty>No onboarding or offboarding under way.</Empty> : open.map(c => <ChecklistCard key={c.id} list={c} canManage={data.hr} onChange={reload} />)}
      {closed.length > 0 && <button className="text-sm text-brand-700 underline" onClick={() => setShowDone(!showDone)}>{showDone ? "Hide" : "Show"} finished checklists ({closed.length})</button>}
      {showDone && closed.map(c => <ChecklistCard key={c.id} list={c} canManage={false} onChange={reload} />)}

      <Modal open={start} onClose={() => { setStart(false); setErr(null); }} title="Start a checklist">
        <form className="space-y-3" onSubmit={async e => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const t = (tpl.data?.templates ?? []).find(x => x.id === fd.get("template_id"));
          const r = await send("/api/hr/people", { action: "start_checklist", staff_id: String(fd.get("staff_id")), kind: t?.kind ?? "onboarding", template_id: t?.id ?? null, started_on: String(fd.get("started_on")) });
          if (!r.ok) return setErr(r.error);
          setStart(false); setErr(null); reload();
        }}>
          <Field label="Staff member"><select className="input" name="staff_id" required>{staff.filter(s => s.status !== "exited").map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select></Field>
          <Field label="Checklist"><select className="input" name="template_id" required>{(tpl.data?.templates ?? []).map(t => <option key={t.id} value={t.id}>{t.kind === "onboarding" ? "Onboarding" : "Offboarding"}: {t.name}</option>)}</select></Field>
          <Field label="Start date (due dates count from here)"><input className="input" type="date" name="started_on" defaultValue={localDate()} required /></Field>
          {err && <Alert>{err}</Alert>}
          <button className="btn btn-primary w-full">Start</button>
        </form>
      </Modal>
      <Modal open={templates} onClose={() => setTemplates(false)} title="Checklist templates" wide>
        <TemplateEditor templates={tpl.data?.templates ?? []} onChange={tpl.reload} />
      </Modal>
    </div>
  );
}

function TemplateEditor({ templates, onChange }: { templates: Template[]; onChange: () => void }) {
  const [edit, setEdit] = useState<Partial<Template> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (edit) {
    const items = edit.items ?? [];
    const set = (i: number, p: Partial<Template["items"][number]>) => setEdit({ ...edit, items: items.map((x, j) => j === i ? { ...x, ...p } : x) });
    return (
      <form className="space-y-3" onSubmit={async e => {
        e.preventDefault();
        const r = await send("/api/hr/people", { action: "save_template", id: edit.id, kind: edit.kind, name: edit.name, items: items.filter(i => i.label.trim()) });
        if (!r.ok) return setErr(r.error);
        setEdit(null); setErr(null); onChange();
      }}>
        <div className="grid gap-2 sm:grid-cols-3">
          <Field label="Kind"><select className="input" value={edit.kind} onChange={e => setEdit({ ...edit, kind: e.target.value as Template["kind"] })}><option value="onboarding">Onboarding</option><option value="offboarding">Offboarding</option></select></Field>
          <div className="sm:col-span-2"><Field label="Name"><input className="input" required value={edit.name ?? ""} onChange={e => setEdit({ ...edit, name: e.target.value })} /></Field></div>
        </div>
        <table className="w-full text-sm"><thead className="text-left text-[13px] text-slate-500"><tr><th>Task</th><th>Who</th><th>Due after (days)</th><th /></tr></thead>
          <tbody>{items.map((it, i) => (
            <tr key={i}><td className="py-1 pr-2"><input className="input" value={it.label} onChange={e => set(i, { label: e.target.value })} /></td>
              <td className="py-1 pr-2"><select className="input" value={it.owner} onChange={e => set(i, { owner: e.target.value })}>{Object.entries(OWNERS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></td>
              <td className="py-1 pr-2"><input className="input w-24" type="number" min={0} max={365} value={it.due_days} onChange={e => set(i, { due_days: Number(e.target.value) })} /></td>
              <td><button type="button" className="text-xs text-rose-600" aria-label="Remove" onClick={() => setEdit({ ...edit, items: items.filter((_, j) => j !== i) })}>✕</button></td></tr>))}</tbody></table>
        <button type="button" className="btn btn-ghost" onClick={() => setEdit({ ...edit, items: [...items, { label: "", owner: "hr_manager", due_days: 7 }] })}>+ Task</button>
        {err && <Alert>{err}</Alert>}
        <div className="flex justify-end gap-2"><button type="button" className="btn btn-ghost" onClick={() => setEdit(null)}>Back</button><button className="btn btn-primary">Save template</button></div>
      </form>
    );
  }
  return (
    <div className="space-y-2">
      <button className="btn btn-outline" onClick={() => setEdit({ kind: "onboarding", name: "", items: [] })}>+ New template</button>
      <ul className="divide-y divide-slate-100 text-sm">{templates.map(t => (
        <li key={t.id} className="flex items-center gap-2 py-2"><Badge>{t.kind}</Badge><span className="font-medium">{t.name}</span><span className="text-slate-500">{t.items.length} tasks</span>
          <span className="ml-auto flex gap-1"><button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setEdit(t)}>Edit</button>
            <button className="btn btn-ghost px-2 py-1 text-xs text-rose-600" onClick={async () => { if (confirm("Delete this template?")) { await send("/api/hr/people", { action: "delete_template", id: t.id }); onChange(); } }}>Delete</button></span></li>))}</ul>
    </div>
  );
}
