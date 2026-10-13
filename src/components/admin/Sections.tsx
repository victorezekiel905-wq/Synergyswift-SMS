"use client";
import { useState } from "react";
import { useApi, send, Alert, Badge, Empty, Field, Loading } from "@/components/ui";

type StageInfo = { key: string; name: string; kind: string; levels: string[]; exam: string | null; subjects: number; grading: string };
type Data = {
  sections: { id: string; name: string; kind: string; curriculum: string | null; curriculum_label: string | null; position: number; classes: number }[];
  classes: { id: string; name: string; level: string | null; section_id: string | null; curriculum: string | null; curriculum_label: string | null }[];
  unsectioned: number; curriculum: string | null;
  frameworks: { key: string; name: string; summary: string; stages: StageInfo[] }[];
};
type Plan = { sections: { name: string }[]; classes: string[]; subjects: string[]; offerings: number; grading: string[]; existing_classes: number };
const KINDS: [string, string][] = [["nursery", "Nursery / early years"], ["primary", "Primary"], ["secondary", "Secondary"], ["sixth_form", "Sixth form"], ["other", "Other"]];

/** Sections (Nursery, Primary, Secondary …), the curriculum each follows, and setting a school up from a curriculum. */
export default function Sections() {
  const { data, error, reload } = useApi<Data>("/api/school/sections");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [edit, setEdit] = useState<{ id?: string; name: string; kind: string; curriculum: string; position: number } | null>(null);
  const [assign, setAssign] = useState<{ section: string; ids: string[]; curriculum: string }>({ section: "", ids: [], curriculum: "" });
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <Loading />;
  const stageOptions = data.frameworks.flatMap(f => f.stages.map(s => ({ key: s.key, label: `${f.name.split(" (")[0]}: ${s.name}` })));
  const act = async (body: Record<string, unknown>, ok: string) => {
    const r = await send("/api/school/sections", body);
    setMsg({ ok: r.ok, text: r.ok ? ok : r.error ?? "failed" });
    if (r.ok) reload();
    return r.ok;
  };
  return (
    <div className="space-y-5">
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      <Wizard frameworks={data.frameworks} onDone={t => { setMsg({ ok: true, text: t }); reload(); }} />

      <section className="card p-5">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="mr-auto font-semibold">Sections</h2>
          <button className="btn btn-outline" onClick={() => setEdit({ name: "", kind: "primary", curriculum: "", position: data.sections.length })}>Add section</button>
        </div>
        {!data.sections.length ? <Empty>No sections yet. Use a curriculum above, or add Nursery, Primary and Secondary yourself.</Empty> : (
          <ul className="divide-y divide-slate-100 text-sm">{data.sections.map(s => (
            <li key={s.id} className="flex flex-wrap items-center gap-2 py-2">
              <span className="flex-1"><b>{s.name}</b> <Badge>{KINDS.find(k => k[0] === s.kind)?.[1] ?? s.kind}</Badge>
                <span className="block text-xs text-slate-500">{s.curriculum_label ?? "No curriculum set"} · {s.classes} class{s.classes === 1 ? "" : "es"}</span></span>
              <button className="text-xs text-brand-700" onClick={() => setEdit({ id: s.id, name: s.name, kind: s.kind, curriculum: s.curriculum ?? "", position: s.position })}>Edit</button>
              <button className="text-xs text-rose-600" onClick={() => confirm(`Delete ${s.name}? Its classes stay, without a section.`) && act({ action: "delete", id: s.id }, "Section deleted.")}>Delete</button>
            </li>
          ))}</ul>
        )}
        {edit && (
          <form className="mt-3 grid gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-4" onSubmit={async e => {
            e.preventDefault();
            if (await act({ action: "save", id: edit.id ?? null, name: edit.name, kind: edit.kind, curriculum: edit.curriculum || null, position: edit.position }, "Section saved.")) setEdit(null);
          }}>
            <Field label="Name"><input className="input" value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} required maxLength={60} /></Field>
            <Field label="Kind"><select className="input" value={edit.kind} onChange={e => setEdit({ ...edit, kind: e.target.value })}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            <Field label="Curriculum"><select className="input" value={edit.curriculum} onChange={e => setEdit({ ...edit, curriculum: e.target.value })}><option value="">Not set</option>{stageOptions.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}</select></Field>
            <Field label="Order"><input className="input" type="number" min={0} max={100} value={edit.position} onChange={e => setEdit({ ...edit, position: Number(e.target.value) })} /></Field>
            <div className="flex gap-2 sm:col-span-4"><button className="btn btn-primary">Save</button><button type="button" className="btn btn-ghost" onClick={() => setEdit(null)}>Cancel</button></div>
          </form>
        )}
      </section>

      {data.sections.length > 0 && data.classes.length > 0 && (
        <section className="card space-y-3 p-5">
          <h2 className="font-semibold">Classes by section {data.unsectioned > 0 && <Badge tone="amber">{data.unsectioned} without a section</Badge>}</h2>
          <p className="text-sm text-slate-600">Pick classes, then move them to a section. A class can follow a different curriculum from its section (for example a British stream in a Nigerian secondary).</p>
          <div className="flex flex-wrap gap-2">{data.classes.map(c => {
            const on = assign.ids.includes(c.id);
            const sec = data.sections.find(s => s.id === c.section_id);
            return <button key={c.id} type="button" aria-pressed={on} onClick={() => setAssign({ ...assign, ids: on ? assign.ids.filter(x => x !== c.id) : [...assign.ids, c.id] })}
              className={"rounded-full border px-3 py-1 text-xs " + (on ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-300")}>{c.name}<span className="text-slate-400"> · {sec?.name ?? "none"}{c.curriculum_label ? ` · ${c.curriculum_label}` : ""}</span></button>;
          })}</div>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Section"><select className="input" value={assign.section} onChange={e => setAssign({ ...assign, section: e.target.value })}><option value="">No section</option>{data.sections.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
            <Field label="Curriculum for these classes"><select className="input" value={assign.curriculum} onChange={e => setAssign({ ...assign, curriculum: e.target.value })}><option value="">Same as the section</option>{stageOptions.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}</select></Field>
            <button className="btn btn-primary" disabled={!assign.ids.length} onClick={async () => {
              if (await act({ action: "assign", class_group_ids: assign.ids, section_id: assign.section || null, curriculum: assign.curriculum || null }, `Moved ${assign.ids.length} class${assign.ids.length === 1 ? "" : "es"}.`)) setAssign({ section: "", ids: [], curriculum: "" });
            }}>Apply to {assign.ids.length || ""} selected</button>
          </div>
        </section>
      )}
    </div>
  );
}

function Wizard({ frameworks, onDone }: { frameworks: Data["frameworks"]; onDone: (t: string) => void }) {
  const [open, setOpen] = useState(false);
  const [stages, setStages] = useState<string[]>([]);
  const [arms, setArms] = useState("");
  const [opts, setOpts] = useState({ subjects: true, grading: true });
  const [plan, setPlan] = useState<Plan | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const body = () => ({ stages, arms: arms.split(",").map(a => a.trim()).filter(Boolean), ...opts });
  if (!open) return (
    <section className="card flex flex-wrap items-center gap-3 p-5">
      <div className="flex-1"><h2 className="font-semibold">Set up from a curriculum</h2>
        <p className="text-sm text-slate-600">Nigerian (UBE, BECE, WAEC/NECO), British (EYFS to A Level), Cambridge (IGCSE, A Level) or American. Mix stages from different curricula if your school runs more than one.</p></div>
      <button className="btn btn-primary" onClick={() => setOpen(true)}>Choose a curriculum</button>
    </section>
  );
  return (
    <section className="card space-y-4 p-5 text-sm">
      <div className="flex items-center"><h2 className="mr-auto font-semibold">Set up from a curriculum</h2><button className="text-xs text-slate-500" onClick={() => setOpen(false)}>Close</button></div>
      {frameworks.map(f => (
        <fieldset key={f.key} className="rounded-lg border border-slate-200 p-3">
          <legend className="px-1 font-medium">{f.name}</legend>
          <p className="mb-2 text-xs text-slate-500">{f.summary}</p>
          <div className="grid gap-2 sm:grid-cols-2">{f.stages.map(s => (
            <label key={s.key} className="flex items-start gap-2 rounded p-1 hover:bg-slate-50">
              <input type="checkbox" className="mt-1" checked={stages.includes(s.key)} onChange={e => { setPlan(null); setStages(e.target.checked ? [...stages, s.key] : stages.filter(x => x !== s.key)); }} />
              <span><b>{s.name}</b>{s.exam ? <span className="text-xs text-slate-500"> · {s.exam}</span> : null}<span className="block text-xs text-slate-500">{s.levels.join(", ")} · {s.subjects} subjects · {s.grading}</span></span>
            </label>
          ))}</div>
        </fieldset>
      ))}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Arms per level" hint="e.g. A, B or Gold, Silver. Leave empty for one class per level."><input className="input" value={arms} onChange={e => { setPlan(null); setArms(e.target.value); }} /></Field>
        <label className="mt-6 flex items-center gap-2"><input type="checkbox" checked={opts.subjects} onChange={e => setOpts({ ...opts, subjects: e.target.checked })} /> Add the usual subjects</label>
        <label className="mt-6 flex items-center gap-2"><input type="checkbox" checked={opts.grading} onChange={e => setOpts({ ...opts, grading: e.target.checked })} /> Add matching grading schemes</label>
      </div>
      {err && <Alert>{err}</Alert>}
      {plan && (
        <Alert tone="blue">This will add {plan.sections.length} section{plan.sections.length === 1 ? "" : "s"}, {plan.classes.length} class{plan.classes.length === 1 ? "" : "es"}{plan.existing_classes > 0 ? ` (${plan.existing_classes} already exist and are kept)` : ""}
          {opts.subjects ? `, ${plan.subjects.length} new subjects and ${plan.offerings} class-subject links` : ""}{opts.grading ? `, and grading schemes: ${plan.grading.join("; ")}` : ""}. Nothing is deleted.</Alert>
      )}
      <div className="flex gap-2">
        <button className="btn btn-outline" disabled={!stages.length || busy} onClick={async () => { setErr(null); const r = await send<Plan>("/api/school/sections", { action: "plan", ...body() }); if (r.ok) setPlan(r.data); else setErr(r.error); }}>Preview</button>
        <button className="btn btn-primary" disabled={!plan || busy} onClick={async () => {
          setBusy(true);
          const r = await send<{ classes: number; subjects: number; sections: number }>("/api/school/sections", { action: "apply", ...body() });
          setBusy(false);
          if (!r.ok) { setErr(r.error); return; }
          setOpen(false); setPlan(null); setStages([]);
          onDone(`Done: ${r.data.sections} sections, ${r.data.classes} new classes and ${r.data.subjects} new subjects. Assign form and subject teachers under Classes & subjects.`);
        }}>{busy ? "Setting up…" : "Set up"}</button>
      </div>
    </section>
  );
}
