"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useApi, send, Page, PageHeader, Alert, Badge, Empty, Field, Icon, Loading } from "@/components/ui";
import { validateScheme } from "@/lib/grading";
import { GRADING_PRESETS, STAGES, bandGaps, classStage, type SchoolStage, type GradingPreset } from "@/lib/grading-presets";
import PartsEditor, { PARTS_HINT, Quick, partsProblem, type Part } from "./PartsEditor";

type Layout = "nigerian" | "british" | "american" | "early_years";
type BandRow = { grade: string; min_score: number | string; max_score: number | string; remark: string | null; grade_point: number | string | null };
type Scheme = {
  id?: string; name: string; is_default: boolean; pass_mark: number | string; show_position: boolean; show_class_average: boolean;
  cumulative_mode: string; decimals: number; template?: Layout; stage?: SchoolStage | null; subject_parts?: boolean;
  grading_components?: Part[]; grade_bands?: BandRow[];
};
type ClassRow = { id: string; name: string; level: string | null; scheme_id: string | null; students: number };
type Sections = { sections: { id: string; name: string; kind: string }[]; classes: { id: string; section_id: string | null }[] };
type EyStatus = { areas: { items: unknown[] }[]; scale: { label: string }[] };

const LAYOUTS: { id: Exclude<Layout, "early_years">; label: string; hint: string }[] = [
  { id: "nigerian", label: "Nigerian", hint: "A column for each CA, then total, grade, position and class average." },
  { id: "british", label: "British", hint: "Attainment, effort, target and predicted grades, with a comment per subject. No positions." },
  { id: "american", label: "American", hint: "Percentages, letter grades, grade points and GPA." }
];
const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const stageLabel = (s: SchoolStage | null | undefined) => STAGES.find(x => x.id === s)?.label ?? "Not sorted yet";

function fromPreset(p: GradingPreset, base: Partial<Scheme> = {}): Scheme {
  return { is_default: false, show_position: p.template === "nigerian", show_class_average: true, cumulative_mode: "average", decimals: 1, ...base,
    name: p.name, template: p.template, pass_mark: p.pass_mark, grading_components: p.parts.map(x => ({ ...x })), grade_bands: p.bands.map(x => ({ ...x })) };
}
function blankFor(stage: SchoolStage, first: boolean): Scheme {
  if (stage === "preschool") return { name: "Preschool", stage, template: "early_years", is_default: false, pass_mark: 0, show_position: false, show_class_average: false, cumulative_mode: "none", decimals: 0, grading_components: [], grade_bands: [] };
  return { ...fromPreset(GRADING_PRESETS.find(p => p.stages.includes(stage))!, { is_default: first }), stage };
}

export default function GradingSystems() {
  const schemes = useApi<Scheme[]>("/api/school/grading");
  const structure = useApi<{ class_groups: ClassRow[] }>("/api/school/structure");
  const sections = useApi<Sections>("/api/school/sections");
  const [open, setOpen] = useState<{ scheme: Scheme; classIds: string[] } | null>(null);

  const sectionOf = useMemo(() => {
    const kind = new Map((sections.data?.sections ?? []).map(s => [s.id, s]));
    return new Map((sections.data?.classes ?? []).map(c => [c.id, c.section_id ? kind.get(c.section_id) ?? null : null]));
  }, [sections.data]);
  const classes = useMemo(() => (structure.data?.class_groups ?? []).map(c => ({ ...c, section: sectionOf.get(c.id)?.name ?? null, stage: classStage(c.name, sectionOf.get(c.id)?.kind) })), [structure.data, sectionOf]);
  const list = schemes.data ?? [];
  const fallback = list.find(s => s.is_default) ?? list[0];

  // A system's stage: what it says, else preschool for the early-years layout, else the stage most of its classes are in.
  const stageOf = (s: Scheme): SchoolStage | null => {
    if (s.stage) return s.stage;
    if (s.template === "early_years") return "preschool";
    const counts = new Map<SchoolStage, number>();
    for (const c of classes.filter(c => c.scheme_id === s.id && c.stage)) counts.set(c.stage!, (counts.get(c.stage!) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  };
  const usersOf = (s: Scheme) => classes.filter(c => c.scheme_id === s.id || (!c.scheme_id && fallback?.id === s.id));
  const unassigned = classes.filter(c => !c.scheme_id);

  async function remove(s: Scheme) {
    if (!s.id || !confirm(`Delete "${s.name}"? Its classes will use the school's default grading system.`)) return;
    const r = await send(`/api/school/grading?id=${s.id}`, undefined, "DELETE");
    if (r.ok) { schemes.reload(); structure.reload(); }
  }
  const edit = (s: Scheme) => setOpen({ scheme: { ...s, stage: stageOf(s) ?? s.stage ?? null }, classIds: classes.filter(c => c.scheme_id === s.id).map(c => c.id) });
  const create = (stage: SchoolStage) => {
    const s = blankFor(stage, !list.length);
    setOpen({ scheme: s, classIds: classes.filter(c => c.stage === stage && !c.scheme_id).map(c => c.id) });
  };

  if (!schemes.data || !structure.data) return <Page wide><Loading /></Page>;
  const groups: (SchoolStage | null)[] = [...STAGES.map(s => s.id), null];
  return (
    <Page wide>
      <PageHeader eyebrow="Results" title="Grading systems"
        subtitle="Each stage marks differently. Make a grading system for preschool, primary, secondary and sixth form, say how marks add up and what each grade means, then tick the classes that use it."
        actions={<button className="btn btn-primary" onClick={() => create(classes.some(c => c.stage === "secondary") ? "secondary" : "primary")}>+ New grading system</button>} />
      {schemes.error && <Alert>{schemes.error}</Alert>}
      {fallback && unassigned.length > 0 && (
        <Alert tone="blue">{plural(unassigned.length, "class", "classes")} {unassigned.length === 1 ? "has" : "have"} no grading system of {unassigned.length === 1 ? "its" : "their"} own, so {unassigned.length === 1 ? "it uses" : "they use"} the school default, <b>{fallback.name}</b>: {unassigned.slice(0, 6).map(c => c.name).join(", ")}{unassigned.length > 6 ? "…" : ""}.</Alert>
      )}
      <div className="mt-5 space-y-8">
        {groups.map(stage => {
          const mine = list.filter(s => stageOf(s) === stage);
          const st = STAGES.find(s => s.id === stage);
          if (!st && !mine.length) return null;
          const stageClasses = classes.filter(c => c.stage === stage);
          if (st && !mine.length && !stageClasses.length && stage !== "preschool") return null;
          return (
            <section key={stage ?? "none"}>
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <h2 className="text-lg font-semibold">{stageLabel(stage)}</h2>
                  <p className="text-xs text-slate-500">{st ? `${st.hint}${stageClasses.length ? ` · ${plural(stageClasses.length, "class", "classes")} in your school` : ""}` : "Open one to say which stage it is for."}</p>
                </div>
                {st && <button className="btn btn-ghost text-sm" onClick={() => create(st.id)}>+ {st.label} grading system</button>}
              </div>
              {!mine.length ? (
                <button type="button" onClick={() => st && create(st.id)} className="w-full rounded-lg border border-dashed border-slate-300 p-5 text-left text-sm text-slate-600 hover:border-slate-400 hover:bg-slate-50">
                  {stage === "preschool"
                    ? <>No preschool grading system yet. Preschool children are rated against an early years checklist, not marked. <span className="font-semibold text-brand-700">Set one up</span></>
                    : <>No {stageLabel(stage).toLowerCase()} grading system yet. <span className="font-semibold text-brand-700">Make one</span></>}
                </button>
              ) : (
                <div className="grid gap-3 lg:grid-cols-2">
                  {mine.map(s => <SchemeCard key={s.id} s={s} users={usersOf(s)} isFallback={fallback?.id === s.id} onEdit={() => edit(s)} onDelete={() => remove(s)} />)}
                </div>
              )}
            </section>
          );
        })}
      </div>
      {open && (
        <SchemeDialog initial={open.scheme} initialClasses={open.classIds} classes={classes} schemes={list} hasOthers={list.length > (open.scheme.id ? 1 : 0)}
          onClose={() => setOpen(null)} onSaved={() => { setOpen(null); schemes.reload(); structure.reload(); }} />
      )}
    </Page>
  );
}

function SchemeCard({ s, users, isFallback, onEdit, onDelete }: { s: Scheme; users: ClassRow[]; isFallback: boolean; onEdit: () => void; onDelete: () => void }) {
  const early = s.template === "early_years";
  const parts = s.grading_components ?? [];
  const bands = s.grade_bands ?? [];
  const children = users.reduce((n, c) => n + (c.students ?? 0), 0);
  return (
    <article className="card flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold">{s.name}</h3>
          <p className="text-xs text-slate-500">{early ? "Early years checklist, no marks" : `${LAYOUTS.find(l => l.id === s.template)?.label ?? "Nigerian"} report card · pass mark ${s.pass_mark}%`}</p>
        </div>
        <div className="flex shrink-0 gap-1">
          {isFallback && <Badge tone="blue">School default</Badge>}
        </div>
      </div>
      {early ? (
        <p className="text-sm text-slate-600">Children are rated against the areas and statements in <Link className="font-medium text-brand-700 underline" href="/school/results/preschool-settings">Preschool settings</Link>.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            {parts.map(p => <span key={p.id ?? p.name} className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs"><b className="font-medium">{p.name}</b> <span className="text-slate-500">/{p.max_score} · {p.weight}%</span></span>)}
          </div>
          <p className="text-xs text-slate-600">Grades: {bands.map(b => b.grade).join(" · ")}</p>
          {s.subject_parts && <p className="text-xs text-slate-600">Subject teachers set their own parts; these are the starting point.</p>}
        </>
      )}
      <p className="text-xs text-slate-500">{users.length ? `${plural(users.length, "class", "classes")}, ${plural(children, "child", "children")}: ${users.slice(0, 5).map(c => c.name).join(", ")}${users.length > 5 ? "…" : ""}` : "No classes use it yet."}</p>
      <div className="mt-auto flex gap-2">
        <button className="btn btn-outline text-sm" onClick={onEdit}>Edit</button>
        <button className="btn btn-ghost text-sm text-rose-700" onClick={onDelete}>Delete</button>
      </div>
    </article>
  );
}

/* ---------- the dialog ---------- */

function Step({ n, title, hint, children }: { n: number; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 border-b border-slate-100 px-5 py-5 last:border-0 sm:px-6">
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
        <span className="grid h-5 w-5 place-items-center rounded bg-slate-900 text-[11px] font-semibold text-white">{n}</span>{title}
      </h3>
      {hint && <p className="-mt-1 text-xs leading-relaxed text-slate-500">{hint}</p>}
      {children}
    </section>
  );
}
function Chip({ on, onClick, children, title }: { on: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} title={title}
      className={"rounded-md border px-3 py-2 text-[13px] font-medium transition-colors " + (on ? "border-brand-600 bg-brand-50 text-brand-800" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300")}>
      {children}
    </button>
  );
}
function SchemeDialog({ initial, initialClasses, classes, schemes, hasOthers, onClose, onSaved }: {
  initial: Scheme; initialClasses: string[]; classes: (ClassRow & { section: string | null; stage: SchoolStage | null })[]; schemes: Scheme[]; hasOthers: boolean;
  onClose: () => void; onSaved: () => void;
}) {
  const router = useRouter();
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  const [s, setS] = useState<Scheme>(initial);
  const [picked, setPicked] = useState<Set<string>>(new Set(initialClasses));
  const [named, setNamed] = useState(Boolean(initial.id));
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stage = s.stage ?? null;
  const early = s.template === "early_years";
  const ey = useApi<EyStatus>(early ? "/api/results/early-years" : null, [early]);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") close.current(); };
    window.addEventListener("keydown", h);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    box.current?.querySelector<HTMLElement>("button[aria-pressed], input")?.focus();
    return () => { window.removeEventListener("keydown", h); document.body.style.overflow = overflow; before?.focus?.(); };
  }, []);

  const parts = s.grading_components ?? [];
  const bands = s.grade_bands ?? [];
  const setBand = (i: number, patch: Partial<BandRow>) => setS(x => ({ ...x, grade_bands: bands.map((b, j) => (j === i ? { ...b, ...patch } : b)) }));
  // Every pattern stays available (as on the old Grading page); the ones for this stage come first.
  const presets = stage ? [...GRADING_PRESETS.filter(p => p.stages.includes(stage)), ...GRADING_PRESETS.filter(p => !p.stages.includes(stage))] : GRADING_PRESETS;
  const forStage = (p: GradingPreset) => !stage || p.stages.includes(stage);

  function chooseStage(next: SchoolStage) {
    if (next === stage) return;
    if (next === "preschool") setS(x => ({ ...blankFor("preschool", false), id: x.id, name: named ? x.name : "Preschool" }));
    else if (early || !parts.length) setS(x => ({ ...blankFor(next, false), id: x.id, is_default: x.is_default, name: named ? x.name : blankFor(next, false).name }));
    else setS(x => ({ ...x, stage: next }));
    // Tick this stage's classes that have no system yet; keep what was ticked by hand.
    setPicked(p => new Set([...p].filter(id => classes.find(c => c.id === id)?.stage !== stage).concat(classes.filter(c => c.stage === next && !c.scheme_id).map(c => c.id))));
  }
  function applyPreset(p: GradingPreset) {
    setS(x => ({ ...fromPreset(p, { id: x.id, is_default: x.is_default, show_position: x.show_position, show_class_average: x.show_class_average, cumulative_mode: x.cumulative_mode, decimals: x.decimals }), stage: x.stage, name: named ? x.name : p.name }));
  }
  const numBands = bands.map(b => ({ grade: b.grade, remark: b.remark, min_score: Number(b.min_score), max_score: Number(b.max_score),
    grade_point: b.grade_point === null || b.grade_point === "" ? null : Number(b.grade_point) }));
  const problems = early ? [] : validateScheme({ components: parts.map((p, i) => ({ id: String(i), name: p.name, max_score: Number(p.max_score), weight: Number(p.weight) })), bands: numBands });
  const gaps = early ? [] : bandGaps(numBands);
  const ticked = classes.filter(c => picked.has(c.id));
  const children = ticked.reduce((n, c) => n + (c.students ?? 0), 0);
  const visible = classes.filter(c => showAll || !stage || c.stage === stage || picked.has(c.id));
  const bySection = [...new Set(visible.map(c => c.section ?? "Other classes"))].map(name => ({ name, rows: visible.filter(c => (c.section ?? "Other classes") === name) }));
  const otherScheme = (c: ClassRow) => (c.scheme_id && c.scheme_id !== s.id ? schemes.find(x => x.id === c.scheme_id)?.name : null);

  async function save(go: boolean) {
    if (!s.name.trim()) { setError("Give the grading system a name."); return; }
    if (!stage) { setError("Say which stage it is for."); return; }
    const partIssue = early ? null : partsProblem(parts);
    if (partIssue) { setError(partIssue); return; }
    if (!early && bands.some(b => !b.grade.trim())) { setError("Every grade needs a name, e.g. A or B2."); return; }
    if (problems.length) { setError(problems[0]); return; }
    setBusy(true); setError(null);
    const r = await send("/api/school/grading", {
      id: s.id, name: s.name.trim(), is_default: Boolean(s.is_default), stage, report_layout: s.template ?? "nigerian", subject_parts: Boolean(s.subject_parts),
      pass_mark: Number(s.pass_mark) || 0, show_position: s.show_position, show_class_average: s.show_class_average,
      cumulative_mode: s.cumulative_mode, decimals: Number(s.decimals) || 0,
      components: parts.map(p => ({ id: p.id, name: p.name.trim(), max_score: Number(p.max_score), weight: Number(p.weight), midterm: Boolean(p.midterm) })),
      bands: bands.map(b => ({ grade: b.grade.trim(), min_score: Number(b.min_score), max_score: Number(b.max_score), remark: b.remark || null,
        grade_point: b.grade_point === null || b.grade_point === "" ? null : Number(b.grade_point) })),
      class_group_ids: [...picked]
    }, "PUT");
    setBusy(false);
    if (!r.ok) { setError(r.error ?? "Could not save."); return; }
    onSaved();
    if (go) router.push(early ? "/school/results/early-years" : "/school/results");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/40 p-3 sm:p-8" onMouseDown={onClose}>
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby={titleId} onMouseDown={e => e.stopPropagation()}
        className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-pop sm:max-h-[calc(100dvh-4rem)]">
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4 sm:px-6">
          <div>
            <h2 id={titleId} className="font-serif text-xl font-semibold leading-snug">{s.id ? "Edit" : "New"} <span className="text-brand-700">grading system</span></h2>
            <p className="mt-0.5 text-sm text-slate-500">Say who it&apos;s for, how marks add up and what each grade means. Tick the classes that use it, and save.</p>
          </div>
          <button type="button" onClick={onClose} className="btn btn-ghost -mr-2 border border-slate-200 p-1.5" aria-label="Close"><Icon name="x" /></button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <Step n={1} title="Who it's for">
            <div className="flex flex-wrap gap-2" role="group" aria-label="Stage">
              {STAGES.map(st => <Chip key={st.id} on={stage === st.id} onClick={() => chooseStage(st.id)} title={st.hint}>{st.label}</Chip>)}
            </div>
            <Field label="Name">
              <input className="input" value={s.name} placeholder="Junior secondary, IGCSE, Nursery…" onChange={e => { setNamed(true); setS({ ...s, name: e.target.value }); }} />
            </Field>
            {!early && presets.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-medium text-slate-600">Start from a pattern (fills the marks and grades below; everything stays editable)</p>
                <div className="flex flex-wrap gap-1.5">
                  {presets.map(p => (
                    <button key={p.id} type="button" title={p.hint} onClick={() => applyPreset(p)}
                      className={"rounded-md border px-2.5 py-1 text-xs hover:border-brand-600 hover:text-brand-800 " + (forStage(p) ? "border-slate-200 text-slate-700" : "border-dashed border-slate-200 text-slate-500")}>{p.name}</button>
                  ))}
                </div>
              </div>
            )}
          </Step>

          {early ? (
            <Step n={2} title="How preschool is assessed">
              <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm leading-relaxed text-slate-700">
                <p>Preschool children aren&apos;t marked or ranked. Teachers rate each child against your <b>early years checklist</b> (areas of learning and what the child can do) and write a short comment for each area. The report card shows exactly that.</p>
                {ey.loading ? <p className="mt-2 text-xs text-slate-500">Checking your checklist…</p> : ey.data ? (
                  <p className="mt-2 text-xs text-slate-600">
                    {ey.data.areas.length
                      ? <>Your checklist has {plural(ey.data.areas.length, "area")} and {plural(ey.data.areas.reduce((n, a) => n + a.items.length, 0), "statement")}, rated {ey.data.scale.map(x => x.label).join(" / ")}. </>
                      : <>Your checklist is empty: add areas of learning before teachers start. </>}
                    <Link className="font-semibold text-brand-700 underline" href="/school/results/preschool-settings">Preschool settings</Link>
                  </p>
                ) : ey.error ? <p className="mt-2 text-xs text-amber-800">{ey.error}</p> : null}
              </div>
            </Step>
          ) : (
            <>
              <Step n={2} title="How marks add up" hint={PARTS_HINT}>
                <PartsEditor parts={parts} onChange={next => setS(x => ({ ...x, grading_components: next }))} />
                <label className="flex items-start gap-2 rounded-md border border-slate-200 p-3 text-sm">
                  <input type="checkbox" className="mt-0.5" checked={Boolean(s.subject_parts)} onChange={e => setS({ ...s, subject_parts: e.target.checked })} />
                  <span><span className="font-medium">Subject teachers may set their own parts</span>
                    <span className="block text-xs text-slate-500">Each subject teacher can choose the parts for their own subject in these classes (for example CAT 1, CAT 2, HW, Test, Exam for Maths, and Classwork, Project, Exam for English) from Score entry. The parts above are the starting point for every subject. Grades, pass mark and the report card stay as set here.</span></span>
                </label>
              </Step>

              <Step n={3} title="Grades" hint={'A total gets the grade whose "from" mark it reaches. The remark prints on the report card. Points are optional: fill them in and each report card shows a GPA (the average points across subjects).'}>
                <div className="space-y-1.5">
                  <div className="grid grid-cols-[4.5rem_4.5rem_4.5rem_minmax(0,1fr)_auto] gap-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    <span>Grade</span><span>From</span><span>To</span><span className="flex gap-2"><span className="flex-1">Remark</span><span className="w-16">Points</span></span><span />
                  </div>
                  {bands.map((b, i) => (
                    <div key={i} className="grid grid-cols-[4.5rem_4.5rem_4.5rem_minmax(0,1fr)_auto] items-center gap-2">
                      <input className="input py-1.5" value={b.grade} maxLength={12} onChange={e => setBand(i, { grade: e.target.value })} aria-label="Grade" />
                      <input className="input py-1.5" type="number" step="any" min={0} max={100} value={b.min_score} onChange={e => setBand(i, { min_score: e.target.value })} aria-label={`${b.grade} from`} />
                      <input className="input py-1.5" type="number" step="any" min={0} max={100} value={b.max_score} onChange={e => setBand(i, { max_score: e.target.value })} aria-label={`${b.grade} to`} />
                      <div className="flex gap-2">
                        <input className="input min-w-0 flex-1 py-1.5" value={b.remark ?? ""} maxLength={60} onChange={e => setBand(i, { remark: e.target.value })} aria-label={`${b.grade} remark`} />
                        <input className="input w-16 py-1.5" type="number" step="any" min={0} max={10} placeholder="–" value={b.grade_point ?? ""} onChange={e => setBand(i, { grade_point: e.target.value })} aria-label={`${b.grade} grade points (optional)`} />
                      </div>
                      <button type="button" className="btn btn-ghost px-2 text-rose-600" onClick={() => setS({ ...s, grade_bands: bands.filter((_, j) => j !== i) })} aria-label={`Remove grade ${b.grade}`}><Icon name="x" className="h-4 w-4" /></button>
                    </div>
                  ))}
                </div>
                <button type="button" className="text-sm font-medium text-brand-700" onClick={() => setS({ ...s, grade_bands: [...bands, { grade: "", min_score: 0, max_score: 0, remark: "", grade_point: null }] })}>+ Add a grade</button>
                {[...problems.filter(p => !/weights|component/i.test(p)), ...gaps].map(p => <p key={p} className="text-xs text-amber-800">{p}</p>)}
              </Step>

              <Step n={4} title="On the report card">
                <div className="flex flex-wrap gap-2">
                  {LAYOUTS.map(l => <Chip key={l.id} on={(s.template ?? "nigerian") === l.id} onClick={() => setS({ ...s, template: l.id, show_position: l.id === "british" ? false : s.show_position })}>{l.label}</Chip>)}
                </div>
                <p className="text-xs text-slate-500">{LAYOUTS.find(l => l.id === (s.template ?? "nigerian"))?.hint}</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Field label="Pass mark (%)"><input className="input" type="number" min={0} max={100} value={s.pass_mark} onChange={e => setS({ ...s, pass_mark: e.target.value })} /></Field>
                    <Quick values={[40, 45, 50, 60]} current={s.pass_mark} suffix="%" onPick={v => setS({ ...s, pass_mark: v })} />
                  </div>
                  <div>
                    <p className="mb-1 text-sm font-medium text-slate-700">Decimal places</p>
                    <div className="flex gap-1.5">{[0, 1, 2, 3].map(d => <Chip key={d} on={Number(s.decimals) === d} onClick={() => setS({ ...s, decimals: d })}>{d}</Chip>)}</div>
                    <p className="mt-1 text-xs text-slate-500">For totals and averages, e.g. {(72.456).toFixed(Number(s.decimals) || 0)}.</p>
                  </div>
                </div>
                <div className="flex flex-col gap-2 text-sm">
                  {s.template !== "british" && <label className="flex items-center gap-2"><input type="checkbox" checked={s.show_position} onChange={e => setS({ ...s, show_position: e.target.checked })} /> Show each child&apos;s position in class</label>}
                  <label className="flex items-center gap-2"><input type="checkbox" checked={s.show_class_average} onChange={e => setS({ ...s, show_class_average: e.target.checked })} /> Show the class average for each subject</label>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={s.cumulative_mode !== "none"} onChange={e => setS({ ...s, cumulative_mode: e.target.checked ? "average" : "none" })} /> Show the session so far (average of this year&apos;s terms)</label>
                  {hasOthers && <label className="flex items-center gap-2"><input type="checkbox" checked={s.is_default} onChange={e => setS({ ...s, is_default: e.target.checked })} /> School default: classes with no grading system use this one</label>}
                </div>
              </Step>
            </>
          )}

          <Step n={early ? 3 : 5} title="Which classes use it" hint={stage ? `Showing ${stageLabel(stage).toLowerCase()} classes. A class can use one grading system; ticking it here moves it from its old one.` : undefined}>
            {!classes.length ? <Empty>No classes yet. Add them under School setup → Classes &amp; subjects.</Empty> : (
              <div className="space-y-3">
                {bySection.map(g => {
                  const allOn = g.rows.every(c => picked.has(c.id));
                  return (
                    <div key={g.name}>
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-slate-600">{g.name}</p>
                        <button type="button" className="text-xs font-medium text-brand-700" onClick={() => setPicked(p => { const n = new Set(p); for (const c of g.rows) { if (allOn) n.delete(c.id); else n.add(c.id); } return n; })}>{allOn ? "Untick all" : "Tick all"}</button>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {g.rows.map(c => {
                          const on = picked.has(c.id), other = otherScheme(c);
                          return (
                            <label key={c.id} className={"flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm " + (on ? "border-brand-600 bg-brand-50" : "border-slate-200 hover:border-slate-300")}
                              title={other ? `Now on ${other}` : undefined}>
                              <input type="checkbox" checked={on} onChange={e => setPicked(p => { const n = new Set(p); if (e.target.checked) n.add(c.id); else n.delete(c.id); return n; })} />
                              <span>{c.name}</span>
                              <span className="text-xs text-slate-500 tabular-nums">{c.students}</span>
                              {other && !on && <span className="max-w-[9rem] truncate text-[11px] text-slate-400">· now {other}</span>}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
                {stage && classes.some(c => c.stage !== stage && !picked.has(c.id)) && (
                  <button type="button" className="text-xs font-medium text-slate-600 underline" onClick={() => setShowAll(v => !v)}>{showAll ? "Show only this stage" : "Show classes in other stages too"}</button>
                )}
              </div>
            )}
          </Step>
        </div>

        <footer className="border-t border-slate-200 bg-white px-5 py-3 sm:px-6">
          {error && <p role="alert" className="mb-2 text-sm text-rose-700">{error}</p>}
          {s.id && !early && <p className="mb-2 text-xs text-slate-500">Report cards already made keep their old figures until you press <b>Compile report cards</b> again (Results → Report cards &amp; publishing).</p>}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-700">{plural(ticked.length, "class", "classes")}, {plural(children, "child", "children")}</p>
            <div className="flex gap-2">
              <button type="button" className="btn btn-outline" disabled={busy} onClick={() => save(false)}>Save</button>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => save(true)}>{early ? "Save and start assessing" : "Save and enter scores"} <span aria-hidden>→</span></button>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
