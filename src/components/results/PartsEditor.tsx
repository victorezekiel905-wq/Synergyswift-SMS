"use client";
import { Field, Icon } from "@/components/ui";
import { addNumberedPart } from "@/lib/grading-presets";

/** One assessment part: a test, CA, CAT, homework, project or exam. */
export type Part = { id?: string; name: string; max_score: number | string; weight: number | string; midterm?: boolean };

const QUICK_PARTS: { label: string; part: Part }[] = [
  { label: "CA", part: { name: "CA", max_score: 10, weight: 10, midterm: true } },
  { label: "CAT", part: { name: "CAT", max_score: 15, weight: 15, midterm: true } },
  { label: "Classwork", part: { name: "Classwork", max_score: 10, weight: 10, midterm: true } },
  { label: "Homework", part: { name: "Homework", max_score: 10, weight: 10, midterm: true } },
  { label: "Test", part: { name: "Test", max_score: 20, weight: 20, midterm: true } },
  { label: "Project", part: { name: "Project", max_score: 20, weight: 20 } },
  { label: "Exam", part: { name: "Exam", max_score: 60, weight: 60 } }
];

export const PARTS_HINT = "Add each test, CA, CAT, homework, project or exam. Each part can be marked out of any number and counts for its share: a test marked out of 30 that counts for 20% adds score ÷ 30 × 20. Tick “On mid-term reports” for the parts that appear on mid-term progress reports (usually the CAs and tests).";

/** Small number buttons under a field (10, 20, 25…), like the quick picks on the screenshot the school asked for. */
export function Quick({ values, onPick, current, suffix = "" }: { values: number[]; onPick: (v: number) => void; current: number | string; suffix?: string }) {
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {values.map(v => (
        <button key={v} type="button" onClick={() => onPick(v)}
          className={"rounded border px-1.5 py-0.5 text-[11px] tabular-nums " + (Number(current) === v ? "border-brand-600 bg-brand-50 text-brand-800" : "border-slate-200 text-slate-600 hover:border-slate-300")}>{v}{suffix}</button>
      ))}
    </div>
  );
}

export const partsWeight = (parts: Part[]) => parts.reduce((n, p) => n + (Number(p.weight) || 0), 0);

/** Problems to fix before saving parts (shown in plain words). */
export function partsProblem(parts: Part[]): string | null {
  if (!parts.length) return "Add at least one part.";
  if (parts.some(p => !p.name.trim())) return "Give every part a name, e.g. CAT 1 or HW.";
  if (new Set(parts.map(p => p.name.trim().toLowerCase())).size !== parts.length) return "Two parts have the same name. Give each its own, e.g. CAT 1 and CAT 2.";
  if (parts.some(p => !(Number(p.max_score) > 0))) return "Every part needs a “marked out of” above 0.";
  const w = partsWeight(parts);
  if (Math.abs(w - 100) > 0.001) return `The parts must add up to 100% (now ${Math.round(w * 100) / 100}%).`;
  return null;
}

/** Add, name and weigh the parts that make up a subject's 100 marks. */
export default function PartsEditor({ parts, onChange }: { parts: Part[]; onChange: (parts: Part[]) => void }) {
  const weight = partsWeight(parts);
  const setPart = (i: number, patch: Partial<Part>) => onChange(parts.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  function fitTo100() {
    if (!weight) return;
    const scaled = parts.map(p => Math.round(((Number(p.weight) || 0) / weight) * 100));
    scaled[scaled.length - 1] += 100 - scaled.reduce((a, b) => a + b, 0);
    onChange(parts.map((p, i) => ({ ...p, weight: scaled[i] })));
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5" aria-label="Add a part">
        {QUICK_PARTS.map(q => (
          <button key={q.label} type="button" onClick={() => onChange(addNumberedPart(parts, q.part))} className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium uppercase tracking-wide text-slate-700 hover:border-slate-300">+ {q.label}</button>
        ))}
        <button type="button" onClick={() => onChange([...parts, { name: "", max_score: 10, weight: 10 }])}
          className="rounded-md border border-dashed border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:border-slate-400">+ Another part (name it yourself)</button>
      </div>
      {!parts.length && <p className="text-sm text-slate-500">No parts yet. Add them with the buttons above.</p>}
      <div className="space-y-2">
        {parts.map((p, i) => (
          <div key={p.id ?? `new-${i}`} className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-md border border-slate-200 p-3 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
            <div className="col-span-2 sm:col-span-1">
              <Field label="Part"><input className="input" value={p.name} maxLength={40} placeholder="e.g. CAT 1, HW, Mid-term test" onChange={e => setPart(i, { name: e.target.value })} /></Field>
              <label className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-600"><input type="checkbox" checked={Boolean(p.midterm)} onChange={e => setPart(i, { midterm: e.target.checked })} /> On mid-term reports</label>
            </div>
            <div>
              <Field label="Marked out of"><input className="input" type="number" min={1} inputMode="decimal" value={p.max_score} onChange={e => setPart(i, { max_score: e.target.value })} /></Field>
              <Quick values={[10, 20, 25, 50, 100]} current={p.max_score} onPick={v => setPart(i, { max_score: v })} />
            </div>
            <div>
              <Field label="Counts for (%)"><input className="input" type="number" min={0} max={100} inputMode="decimal" value={p.weight} onChange={e => setPart(i, { weight: e.target.value })} /></Field>
              <Quick values={[10, 20, 40, 60]} current={p.weight} suffix="%" onPick={v => setPart(i, { weight: v })} />
            </div>
            <div className="col-span-2 flex justify-end sm:col-span-1 sm:items-start sm:pt-6">
              <button type="button" className="btn btn-ghost px-2 text-rose-600" onClick={() => onChange(parts.filter((_, j) => j !== i))} aria-label={`Remove ${p.name || "part"}`}><Icon name="x" className="h-4 w-4" /></button>
            </div>
          </div>
        ))}
      </div>
      <div className={"flex flex-wrap items-center justify-between gap-2 rounded-md px-3 py-2 text-sm " + (Math.abs(weight - 100) < 0.001 ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-950")}>
        <span>{Math.abs(weight - 100) < 0.001 ? "The parts add up to 100%." : weight < 100 ? `The parts add up to ${weight}%: ${100 - weight}% still to give.` : `The parts add up to ${weight}%: ${weight - 100}% too many.`}</span>
        {Math.abs(weight - 100) >= 0.001 && weight > 0 && <button type="button" className="text-xs font-semibold underline" onClick={fitTo100}>Fit to 100%</button>}
      </div>
    </div>
  );
}
