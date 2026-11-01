"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useApi, send, Page, PageHeader, Alert, Empty, Loading, Tabs } from "@/components/ui";
import type { ScaleItem } from "@/lib/traits";
import type { EyOptions } from "@/lib/early-years";
import { useResultsPicker } from "./useResultsPicker";

type Student = { id: string; admission_no: string; first_name: string; last_name: string; other_names: string | null };
type Area = { id: string; name: string; items: { id: string; text: string }[] };
type Data = {
  class_name: string; early_years: boolean; students: Student[]; areas: Area[];
  ratings: Record<string, Record<string, number>>; comments: Record<string, Record<string, string>>;
  scale: ScaleItem[]; options: EyOptions;
};
const fullName = (s: Student) => `${s.first_name} ${s.last_name}`;

/** Preschool assessment: rate each child against the checklist and write a comment per area. */
export default function EarlyYearsAssess() {
  const { termId, cg, classes, picker, loaded } = useResultsPicker("preschool");
  const { data, error, reload } = useApi<Data>(termId && cg ? `/api/results/early-years/assess?term_id=${termId}&class_group_id=${cg}` : null);
  const [mode, setMode] = useState<"child" | "area">("child");

  return (
    <Page wide>
      <PageHeader eyebrow="Results" title="Preschool assessment"
        subtitle="Rate what each child can do against your checklist, and add a short comment for each area. Everything here goes on the child's early years report card." />
      {picker}
      {loaded && !classes.length && (
        <Alert tone="blue">No class is set up as preschool yet. In <Link className="font-semibold underline" href="/school/results/grading">Grading systems</Link>, make a Preschool grading system and tick your nursery classes.</Alert>
      )}
      {error && <Alert>{error}</Alert>}
      {cg && termId && !data && !error && <Loading />}
      {data && !data.areas.length && (
        <Alert tone="amber">The checklist is empty. An admin adds areas of learning under <Link className="font-semibold underline" href="/school/results/preschool-settings">Preschool settings</Link>.</Alert>
      )}
      {data && data.areas.length > 0 && (!data.students.length ? <Empty>No children in {data.class_name} yet.</Empty> : (
        <>
          <Tabs value={mode} onChange={setMode} tabs={[{ id: "child", label: "One child at a time" }, { id: "area", label: "Whole class, one area" }]} />
          {mode === "child" ? <ByChild data={data} termId={termId} onSaved={reload} /> : <ByArea data={data} termId={termId} onSaved={reload} />}
        </>
      ))}
    </Page>
  );
}

function ScalePick({ scale, value, onChange, label }: { scale: ScaleItem[]; value: number | undefined; onChange: (v: number | null) => void; label: string }) {
  return (
    <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={label}>
      {scale.map(s => {
        const on = value === s.value;
        return (
          <button key={s.value} type="button" role="radio" aria-checked={on} onClick={() => onChange(on ? null : s.value)} title={on ? "Click again to clear" : s.label}
            className={"rounded-md border px-2.5 py-1 text-xs font-medium transition-colors " + (on ? "border-brand-600 bg-brand-600 text-white" : "border-slate-200 text-slate-700 hover:border-slate-300")}>
            {s.label}
          </button>
        );
      })}
    </div>
  );
}

type Changes = { ratings: Map<string, number | null>; comments: Map<string, string> };
const emptyChanges = (): Changes => ({ ratings: new Map(), comments: new Map() });
async function saveChanges(termId: string, c: Changes) {
  const ratings = [...c.ratings].map(([k, rating]) => { const [student_id, item_id] = k.split("|"); return { student_id, item_id, rating }; });
  const comments = [...c.comments].map(([k, comment]) => { const [student_id, area_id] = k.split("|"); return { student_id, area_id, comment }; });
  if (!ratings.length && !comments.length) return true;
  return (await send("/api/results/early-years/assess", { term_id: termId, ratings, comments }, "POST")).ok;
}

function useEdits(data: Data) {
  const [changes, setChanges] = useState<Changes>(emptyChanges);
  useEffect(() => setChanges(emptyChanges()), [data]);
  const rating = (sid: string, iid: string) => { const k = `${sid}|${iid}`; return changes.ratings.has(k) ? changes.ratings.get(k) ?? undefined : data.ratings[sid]?.[iid]; };
  const comment = (sid: string, aid: string) => { const k = `${sid}|${aid}`; return changes.comments.has(k) ? changes.comments.get(k)! : data.comments[sid]?.[aid] ?? ""; };
  const rate = (sid: string, iid: string, v: number | null) => setChanges(c => ({ ...c, ratings: new Map(c.ratings).set(`${sid}|${iid}`, v) }));
  const write = (sid: string, aid: string, v: string) => setChanges(c => ({ ...c, comments: new Map(c.comments).set(`${sid}|${aid}`, v) }));
  const dirty = changes.ratings.size + changes.comments.size;
  return { changes, setChanges, rating, comment, rate, write, dirty };
}

function ByChild({ data, termId, onSaved }: { data: Data; termId: string; onSaved: () => void }) {
  const [idx, setIdx] = useState(0);
  const e = useEdits(data);
  const [busy, setBusy] = useState(false);
  const child = data.students[Math.min(idx, data.students.length - 1)];
  const itemCount = data.areas.reduce((n, a) => n + a.items.length, 0);
  const done = (sid: string) => data.areas.reduce((n, a) => n + a.items.filter(i => e.rating(sid, i.id) !== undefined).length, 0);

  async function save(then?: number) {
    setBusy(true);
    const ok = await saveChanges(termId, e.changes);
    setBusy(false);
    if (!ok) return;
    if (e.dirty) onSaved();
    if (then !== undefined) setIdx(then);
  }
  const go = (to: number) => (e.dirty ? save(to) : setIdx(to));

  return (
    <div className="grid gap-5 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <nav aria-label="Children" className="card max-h-[70vh] overflow-y-auto p-2">
        {data.students.map((s, i) => {
          const n = done(s.id);
          return (
            <button key={s.id} type="button" onClick={() => go(i)} aria-current={s.id === child.id ? "true" : undefined}
              className={"flex w-full items-center justify-between gap-2 rounded px-2.5 py-1.5 text-left text-sm " + (s.id === child.id ? "bg-slate-100 font-medium" : "hover:bg-slate-50")}>
              <span className="truncate">{fullName(s)}</span>
              <span className={"shrink-0 text-xs tabular-nums " + (n === itemCount ? "text-emerald-700" : "text-slate-400")}>{n}/{itemCount}</span>
            </button>
          );
        })}
      </nav>
      <div className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">{fullName(child)} <span className="text-sm font-normal text-slate-500">{child.admission_no}</span></h2>
          <p className="text-sm text-slate-500">{done(child.id)} of {itemCount} rated</p>
        </div>
        {data.areas.map(a => (
          <section key={a.id} className="card p-4">
            <h3 className="mb-2 font-semibold">{a.name}</h3>
            <ul className="divide-y divide-slate-100">
              {a.items.map(it => (
                <li key={it.id} className="flex flex-col gap-1.5 py-2 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-sm">{it.text}</span>
                  <ScalePick scale={data.scale} value={e.rating(child.id, it.id)} onChange={v => e.rate(child.id, it.id, v)} label={it.text} />
                </li>
              ))}
            </ul>
            {data.options.area_comments && (
              <textarea className="input mt-2 min-h-[64px] text-sm" maxLength={1500} placeholder={`A sentence or two about ${child.first_name} in ${a.name.toLowerCase()}`}
                value={e.comment(child.id, a.id)} onChange={ev => e.write(child.id, a.id, ev.target.value)} aria-label={`Comment on ${a.name}`} />
            )}
          </section>
        ))}
        <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-white/95 py-3 backdrop-blur">
          <p className="text-sm text-slate-600">{e.dirty ? `${e.dirty} unsaved change${e.dirty === 1 ? "" : "s"}` : "All saved"}</p>
          <div className="flex gap-2">
            <button className="btn btn-outline" disabled={busy || idx === 0} onClick={() => go(idx - 1)}>← Previous</button>
            <button className="btn btn-outline" disabled={busy || !e.dirty} onClick={() => save()}>Save</button>
            <button className="btn btn-primary" disabled={busy || idx >= data.students.length - 1} onClick={() => go(idx + 1)}>{e.dirty ? "Save and next" : "Next child"} →</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ByArea({ data, termId, onSaved }: { data: Data; termId: string; onSaved: () => void }) {
  const [areaId, setAreaId] = useState(data.areas[0].id);
  const area = useMemo(() => data.areas.find(a => a.id === areaId) ?? data.areas[0], [data.areas, areaId]);
  const e = useEdits(data);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const ok = await saveChanges(termId, e.changes);
    setBusy(false);
    if (ok && e.dirty) onSaved();
  }
  const fillColumn = (itemId: string, v: number) => { for (const s of data.students) if (e.rating(s.id, itemId) === undefined) e.rate(s.id, itemId, v); };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Area of learning">
        {data.areas.map(a => (
          <button key={a.id} type="button" aria-pressed={a.id === area.id} onClick={() => setAreaId(a.id)}
            className={"rounded-md border px-3 py-1.5 text-sm " + (a.id === area.id ? "border-brand-600 bg-brand-50 text-brand-800" : "border-slate-200 hover:border-slate-300")}>{a.name}</button>
        ))}
      </div>
      <p className="text-xs text-slate-500">Each cell: {data.scale.map(s => `${s.short} = ${s.label}`).join(" · ")}. &ldquo;Fill blanks&rdquo; gives every child not yet rated the same rating, ready to change one by one.</p>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left align-bottom text-xs text-slate-600">
              <th className="sticky left-0 bg-white px-3 py-2">Child</th>
              {area.items.map(it => (
                <th key={it.id} className="min-w-[9rem] px-2 py-2 font-medium">
                  <span className="block">{it.text}</span>
                  <select className="mt-1 rounded border border-slate-200 px-1 py-0.5 text-[11px] font-normal" value="" aria-label={`Fill blanks for ${it.text}`}
                    onChange={ev => { if (ev.target.value) fillColumn(it.id, Number(ev.target.value)); }}>
                    <option value="">Fill blanks…</option>
                    {data.scale.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.students.map(s => (
              <tr key={s.id} className="border-b border-slate-100 last:border-0">
                <td className="sticky left-0 whitespace-nowrap bg-white px-3 py-1.5 font-medium">{fullName(s)}</td>
                {area.items.map(it => (
                  <td key={it.id} className="px-2 py-1">
                    <select className="input py-1 text-sm" value={e.rating(s.id, it.id) ?? ""} aria-label={`${fullName(s)}: ${it.text}`}
                      onChange={ev => e.rate(s.id, it.id, ev.target.value ? Number(ev.target.value) : null)}>
                      <option value="">—</option>
                      {data.scale.map(x => <option key={x.value} value={x.value}>{x.short} · {x.label}</option>)}
                    </select>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-slate-600">{e.dirty ? `${e.dirty} unsaved change${e.dirty === 1 ? "" : "s"}` : "All saved"}</p>
        <button className="btn btn-primary" disabled={busy || !e.dirty} onClick={save}>Save {area.name.toLowerCase()}</button>
      </div>
    </div>
  );
}
