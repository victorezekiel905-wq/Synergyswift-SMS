"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useApi, send, Page, PageHeader, Alert, Icon, Loading } from "@/components/ui";
import { checkEyScale, type EyOptions } from "@/lib/early-years";
import type { ScaleItem } from "@/lib/traits";

type Item = { id: string; area_id: string; text: string; position: number };
type Area = { id: string; name: string; position: number; items: Item[] };
type Data = {
  areas: Area[]; scale: ScaleItem[]; options: EyOptions; classes: { id: string; name: string }[]; has_scheme: boolean;
  frameworks: { key: string; name: string; hint: string; areas: number; items: number }[];
  scale_presets: { name: string; scale: ScaleItem[] }[];
};

const OPTIONS: { key: keyof EyOptions; label: string; hint: string }[] = [
  { key: "area_comments", label: "A comment for each area of learning", hint: "Teachers write a sentence or two under each area." },
  { key: "show_attendance", label: "Days present", hint: "From the class register." },
  { key: "show_traits", label: "Character & skills ratings", hint: "The school's own ratings from Results → Character & skills." },
  { key: "show_key", label: "What the ratings mean", hint: "A short key at the bottom for parents." }
];

/** Preschool settings: the classes, the rating scale, the report card, and the checklist teachers rate against. */
export default function EarlyYearsSettings() {
  const { data, error, reload } = useApi<Data>("/api/results/early-years");
  const [scale, setScale] = useState<ScaleItem[]>([]);
  const [options, setOptions] = useState<EyOptions | null>(null);
  const [newArea, setNewArea] = useState("");
  useEffect(() => { if (data) { setScale(data.scale); setOptions(data.options); } }, [data]);

  if (error) return <Page><PageHeader eyebrow="Results" title="Preschool settings" /><Alert>{error}</Alert></Page>;
  if (!data || !options) return <Page><Loading /></Page>;

  const act = async (body: Record<string, unknown>) => { const r = await send("/api/results/early-years", body); if (r.ok) reload(); return r.ok; };
  const scaleProblems = checkEyScale(scale);
  const move = (list: { id: string }[], i: number, d: -1 | 1, kind: "area" | "item") => {
    const ids = list.map(x => x.id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    act({ action: "reorder", kind, ids });
  };

  return (
    <Page>
      <PageHeader eyebrow="Results" title="Preschool settings"
        subtitle="Preschool children aren't marked or ranked. Teachers rate each child against your checklist of what children learn to do, on your own scale, with a comment per area. The report card shows exactly that." />

      <section className="card mb-5 p-5">
        <h2 className="font-semibold">Preschool classes</h2>
        {data.classes.length ? (
          <p className="mt-1 text-sm text-slate-600">{data.classes.map(c => c.name).join(", ")} use the preschool way. <Link className="font-medium text-brand-700 underline" href="/school/results/grading">Change which classes</Link></p>
        ) : (
          <p className="mt-1 text-sm text-slate-600">No class is set up as preschool yet. In <Link className="font-medium text-brand-700 underline" href="/school/results/grading">Grading systems</Link>, make a <b>Preschool</b> grading system and tick your nursery classes.</p>
        )}
      </section>

      <section className="card mb-5 space-y-4 p-5">
        <div>
          <h2 className="font-semibold">Rating scale</h2>
          <p className="text-sm text-slate-600">How teachers describe where each child is. Best first. Parents see the words, not numbers.</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {data.scale_presets.map(p => (
            <button key={p.name} type="button" onClick={() => setScale(p.scale.map(x => ({ ...x })))}
              className={"rounded-md border px-2.5 py-1 text-xs " + (JSON.stringify(p.scale) === JSON.stringify(scale) ? "border-brand-600 bg-brand-50 text-brand-800" : "border-slate-200 text-slate-700 hover:border-slate-300")}>{p.name}</button>
          ))}
        </div>
        <div className="space-y-1.5">
          {scale.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <input className="input w-20 py-1.5" value={s.short} maxLength={4} aria-label="Short code" onChange={e => setScale(scale.map((x, j) => j === i ? { ...x, short: e.target.value } : x))} />
              <input className="input min-w-0 flex-1 py-1.5" value={s.label} maxLength={40} aria-label="Label" onChange={e => setScale(scale.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} />
              <button type="button" className="btn btn-ghost px-2 text-rose-600" disabled={scale.length <= 2} onClick={() => setScale(scale.filter((_, j) => j !== i).map((x, j, all) => ({ ...x, value: all.length - j })))} aria-label={`Remove ${s.label}`}><Icon name="x" className="h-4 w-4" /></button>
            </div>
          ))}
          {scale.length < 6 && <button type="button" className="text-sm font-medium text-brand-700" onClick={() => setScale([...scale, { value: 0, short: "", label: "" }].map((x, j, all) => ({ ...x, value: all.length - j })))}>+ Add a point (lowest)</button>}
        </div>

        <div>
          <h3 className="mb-2 text-sm font-semibold">On the report card</h3>
          <div className="space-y-2">
            {OPTIONS.map(o => (
              <label key={o.key} className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" checked={options[o.key]} onChange={e => setOptions({ ...options, [o.key]: e.target.checked })} />
                <span><span className="font-medium">{o.label}</span> <span className="text-slate-500">· {o.hint}</span></span>
              </label>
            ))}
          </div>
        </div>
        {scaleProblems.map(p => <p key={p} className="text-xs text-amber-800">{p}</p>)}
        <button className="btn btn-primary" disabled={scaleProblems.length > 0} onClick={() => act({ action: "save_settings", scale: scale.map(s => ({ ...s, short: s.short.trim(), label: s.label.trim() })), options })}>Save scale and report options</button>
      </section>

      <section className="card space-y-4 p-5">
        <div>
          <h2 className="font-semibold">The checklist</h2>
          <p className="text-sm text-slate-600">Areas of learning, and what a child in your preschool learns to do in each. Keep statements short and in plain words: parents read them.</p>
        </div>
        {!data.areas.length && <Alert tone="blue">Start from a ready-made checklist, then change it to fit your school. Or add your own areas below.</Alert>}
        <div className="grid gap-2 sm:grid-cols-3">
          {data.frameworks.map(f => (
            <button key={f.key} type="button" onClick={() => act({ action: "use_framework", key: f.key })}
              className="rounded-md border border-slate-200 p-3 text-left text-sm hover:border-brand-600">
              <span className="block font-medium">{data.areas.length ? "Add: " : ""}{f.name}</span>
              <span className="mt-0.5 block text-xs text-slate-500">{f.areas} areas, {f.items} statements. {f.hint}</span>
            </button>
          ))}
        </div>

        <div className="space-y-3">
          {data.areas.map((a, i) => <AreaBlock key={a.id} area={a} first={i === 0} last={i === data.areas.length - 1}
            onMove={d => move(data.areas, i, d, "area")} onMoveItem={(j, d) => move(a.items, j, d, "item")} act={act} />)}
        </div>
        <form className="flex gap-2" onSubmit={async e => { e.preventDefault(); if (newArea.trim() && await act({ action: "save_area", name: newArea.trim() })) setNewArea(""); }}>
          <input className="input min-w-0 flex-1" placeholder="New area of learning, e.g. French" value={newArea} onChange={e => setNewArea(e.target.value)} maxLength={80} />
          <button className="btn btn-outline" disabled={!newArea.trim()}>Add area</button>
        </form>
      </section>
    </Page>
  );
}

function AreaBlock({ area, first, last, onMove, onMoveItem, act }: {
  area: Area; first: boolean; last: boolean; onMove: (d: -1 | 1) => void; onMoveItem: (i: number, d: -1 | 1) => void; act: (b: Record<string, unknown>) => Promise<boolean>;
}) {
  const [name, setName] = useState(area.name);
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  useEffect(() => setName(area.name), [area.name]);
  return (
    <div className="rounded-md border border-slate-200">
      <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2">
        <input className="min-w-0 flex-1 bg-transparent font-semibold outline-none focus:underline" value={name} aria-label="Area name" maxLength={80}
          onChange={e => setName(e.target.value)} onBlur={() => { if (name.trim() && name.trim() !== area.name) act({ action: "save_area", id: area.id, name: name.trim() }); else setName(area.name); }} />
        <span className="text-xs text-slate-500">{area.items.length}</span>
        <button type="button" className="btn btn-ghost px-1.5 text-xs" disabled={first} onClick={() => onMove(-1)} aria-label={`Move ${area.name} up`}>↑</button>
        <button type="button" className="btn btn-ghost px-1.5 text-xs" disabled={last} onClick={() => onMove(1)} aria-label={`Move ${area.name} down`}>↓</button>
        <button type="button" className="btn btn-ghost px-1.5 text-rose-600" aria-label={`Delete ${area.name}`}
          onClick={() => confirm(`Delete "${area.name}" and its ${area.items.length} statements? Ratings already given for them are deleted too.`) && act({ action: "delete_area", id: area.id })}><Icon name="x" className="h-4 w-4" /></button>
      </div>
      <ul className="divide-y divide-slate-100">
        {area.items.map((it, j) => (
          <li key={it.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
            {editing?.id === it.id ? (
              <form className="flex flex-1 gap-2" onSubmit={async e => { e.preventDefault(); if (editing.text.trim() && await act({ action: "save_item", id: it.id, area_id: area.id, text: editing.text.trim() })) setEditing(null); }}>
                <input className="input min-w-0 flex-1 py-1" autoFocus value={editing.text} maxLength={200} onChange={e => setEditing({ ...editing, text: e.target.value })} />
                <button className="btn btn-outline px-2 py-1 text-xs">Save</button>
                <button type="button" className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setEditing(null)}>Cancel</button>
              </form>
            ) : (
              <>
                <button type="button" className="min-w-0 flex-1 text-left hover:underline" onClick={() => setEditing({ id: it.id, text: it.text })} title="Edit">{it.text}</button>
                <button type="button" className="btn btn-ghost px-1 text-xs" disabled={j === 0} onClick={() => onMoveItem(j, -1)} aria-label="Move up">↑</button>
                <button type="button" className="btn btn-ghost px-1 text-xs" disabled={j === area.items.length - 1} onClick={() => onMoveItem(j, 1)} aria-label="Move down">↓</button>
                <button type="button" className="btn btn-ghost px-1 text-rose-600" onClick={() => act({ action: "delete_item", id: it.id })} aria-label={`Delete "${it.text}"`}><Icon name="x" className="h-3.5 w-3.5" /></button>
              </>
            )}
          </li>
        ))}
      </ul>
      <form className="flex gap-2 border-t border-slate-100 p-2" onSubmit={async e => { e.preventDefault(); if (text.trim() && await act({ action: "save_item", area_id: area.id, text: text.trim() })) setText(""); }}>
        <input className="input min-w-0 flex-1 py-1.5 text-sm" placeholder="Add what a child can do, e.g. Counts to 20" value={text} maxLength={200} onChange={e => setText(e.target.value)} aria-label={`New statement for ${area.name}`} />
        <button className="btn btn-ghost text-sm" disabled={!text.trim()}>Add</button>
      </form>
    </div>
  );
}
