"use client";
import { useRef } from "react";
import { Field, Icon } from "@/components/ui";
import { passageWords } from "@/lib/exams/words";
import { parseEquation, isBalanced } from "@/lib/exams/chem";
import { GraphPlotInput, FormulaText } from "./QuestionTypes";

type Opt = { id: string; text: string };
type Q = { type: string; data: Record<string, any>; answer: Record<string, any> };
type Setter = (v: Record<string, any>) => void;
const uid = () => Math.random().toString(36).slice(2, 8);

function ListEditor({ label, items, onChange, placeholder }: { label: string; items: Opt[]; onChange: (v: Opt[]) => void; placeholder: string }) {
  return (
    <div className="space-y-2">
      <p className="label">{label}</p>
      {items.map((it, i) => (
        <div key={it.id} className="flex items-center gap-2">
          <input className="input" value={it.text} placeholder={`${placeholder} ${i + 1}`} aria-label={`${placeholder} ${i + 1}`} onChange={e => onChange(items.map(x => x.id === it.id ? { ...x, text: e.target.value } : x))} />
          <button type="button" className="btn btn-ghost px-2 text-rose-600" aria-label="Remove" onClick={() => onChange(items.filter(x => x.id !== it.id))}><Icon name="x" className="h-4 w-4" /></button>
        </div>
      ))}
      <button type="button" className="btn btn-ghost text-xs" onClick={() => onChange([...items, { id: uid(), text: "" }])}>+ Add</button>
    </div>
  );
}

export function NumericExtras({ q, setAnswer }: { q: Q; setAnswer: Setter }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Or tolerance as a percentage (±%)" hint="Useful in physics and chemistry: 1% of 9.81 accepts 9.71 to 9.91.">
        <input className="input" type="number" min={0} max={50} step="any" value={q.answer.tolerance_pct ?? ""} onChange={e => setAnswer({ tolerance_pct: e.target.value === "" ? null : Number(e.target.value) })} />
      </Field>
      <Field label="Significant figures required (optional)" hint="Right value with the wrong number of significant figures earns half marks.">
        <input className="input" type="number" min={0} max={10} value={q.answer.sig_figs ?? ""} onChange={e => setAnswer({ sig_figs: e.target.value === "" ? null : Number(e.target.value) })} />
      </Field>
      <p className="text-xs text-slate-500 sm:col-span-2">Students can type 6.02 × 10^23, 6.02e23 or 1,250; units typed after the number are ignored.</p>
    </div>
  );
}

export function MatrixEditor({ q, setData, setAnswer }: { q: Q; setData: Setter; setAnswer: Setter }) {
  const rows: Opt[] = q.data.rows ?? [], cols: Opt[] = q.data.cols ?? [];
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <ListEditor label="Statements (rows)" items={rows} onChange={v => setData({ rows: v })} placeholder="Statement" />
        <ListEditor label="Choices (columns), such as True / False / Not given" items={cols} onChange={v => setData({ cols: v })} placeholder="Choice" />
      </div>
      {rows.length > 0 && cols.length > 0 && (
        <div className="space-y-2 rounded-lg border border-slate-200 p-3">
          <p className="label">Correct choice for each statement</p>
          {rows.map((r, i) => (
            <div key={r.id} className="grid items-center gap-2 sm:grid-cols-[1fr_200px]">
              <span className="text-sm">{r.text || `Statement ${i + 1}`}</span>
              <select className="input" value={q.answer.correct?.[r.id] ?? ""} aria-label={`Correct choice for statement ${i + 1}`} onChange={e => setAnswer({ correct: { ...(q.answer.correct ?? {}), [r.id]: e.target.value } })}>
                <option value="">Choose…</option>{cols.map((c, j) => <option key={c.id} value={c.id}>{c.text || `Choice ${j + 1}`}</option>)}
              </select>
            </div>
          ))}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={q.answer.partial !== false} onChange={e => setAnswer({ partial: e.target.checked })} /> Partial credit for each correct row</label>
        </div>
      )}
    </div>
  );
}

export function HighlightEditor({ q, setData, setAnswer }: { q: Q; setData: Setter; setAnswer: Setter }) {
  const words = passageWords(q.data.text ?? "");
  const correct = new Set<number>(q.answer.correct ?? []);
  return (
    <div className="space-y-3">
      <Field label="Passage"><textarea className="input h-28" value={q.data.text ?? ""} onChange={e => { setData({ text: e.target.value }); setAnswer({ correct: [] }); }} /></Field>
      <Field label="Instruction to students (optional)"><input className="input" value={q.data.instruction ?? ""} onChange={e => setData({ instruction: e.target.value })} placeholder="Select all the verbs." /></Field>
      {words.length > 0 && (
        <div>
          <p className="label">Click the correct words</p>
          <p className="rounded-lg border border-slate-200 p-3 leading-loose">
            {words.map((w, i) => (
              <span key={i}><button type="button" onClick={() => { const n = new Set(correct); n.has(i) ? n.delete(i) : n.add(i); setAnswer({ correct: [...n].sort((a, b) => a - b) }); }}
                className={"rounded px-0.5 " + (correct.has(i) ? "bg-emerald-200 ring-1 ring-emerald-500" : "hover:bg-slate-100")}>{w}</button>{" "}</span>
            ))}
          </p>
          <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={q.answer.partial !== false} onChange={e => setAnswer({ partial: e.target.checked })} /> Partial credit (wrong picks cancel right ones, never negative)</label>
        </div>
      )}
    </div>
  );
}

export function LabelImageEditor({ q, setData, setAnswer }: { q: Q; setData: Setter; setAnswer: Setter }) {
  const ref = useRef<HTMLDivElement>(null);
  const pins: { id: string; x: number; y: number }[] = q.data.pins ?? [];
  const labels: Opt[] = q.data.labels ?? [];
  const placement: Record<string, string> = q.answer.placement ?? {};
  return (
    <div className="space-y-3">
      <Field label="Diagram image URL"><input className="input" value={q.data.image_url ?? ""} onChange={e => setData({ image_url: e.target.value })} /></Field>
      {q.data.image_url && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div>
            <p className="mb-1 text-xs text-slate-500">Click the diagram to add numbered points. Click a point to remove it.</p>
            <div ref={ref} className="relative inline-block max-w-full cursor-crosshair select-none" onClick={e => {
              if ((e.target as HTMLElement).dataset.pin) return;
              const r = ref.current!.getBoundingClientRect();
              const x = Math.round(((e.clientX - r.left) / r.width) * 1000) / 10, y = Math.round(((e.clientY - r.top) / r.height) * 1000) / 10;
              setData({ pins: [...pins, { id: uid(), x, y }] });
            }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={q.data.image_url} alt="Diagram" className="max-h-[400px] max-w-full" draggable={false} />
              {pins.map((p, i) => (
                <button key={p.id} type="button" data-pin="1" aria-label={`Remove point ${i + 1}`} onClick={() => { const n = { ...placement }; delete n[p.id]; setAnswer({ placement: n }); setData({ pins: pins.filter(x => x.id !== p.id) }); }}
                  className="absolute grid h-7 w-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-white bg-brand-700 text-xs font-bold text-white shadow" style={{ left: `${p.x}%`, top: `${p.y}%` }}>{i + 1}</button>
              ))}
            </div>
          </div>
          <div className="space-y-3">
            <ListEditor label="Labels (add extra wrong ones to make it harder)" items={labels} onChange={v => setData({ labels: v })} placeholder="Label" />
            {pins.length > 0 && (
              <div className="space-y-2">
                <p className="label">Correct label for each point</p>
                {pins.map((p, i) => (
                  <div key={p.id} className="flex items-center gap-2">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-700 text-xs font-bold text-white">{i + 1}</span>
                    <select className="input" value={placement[p.id] ?? ""} aria-label={`Correct label for point ${i + 1}`} onChange={e => setAnswer({ placement: { ...placement, [p.id]: e.target.value } })}>
                      <option value="">Choose…</option>{labels.map((l, j) => <option key={l.id} value={l.id}>{l.text || `Label ${j + 1}`}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function GraphPlotEditor({ q, setData, setAnswer }: { q: Q; setData: Setter; setAnswer: Setter }) {
  const d = q.data;
  const num = (k: string, label: string) => <Field label={label}><input className="input" type="number" step="any" value={d[k] ?? ""} onChange={e => setData({ [k]: Number(e.target.value) })} /></Field>;
  const ok = [d.x_min, d.x_max, d.y_min, d.y_max].every(v => Number.isFinite(Number(v))) && Number(d.x_min) < Number(d.x_max) && Number(d.y_min) < Number(d.y_max) && Number(d.step) > 0;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-4">
        {num("x_min", "x from")}{num("x_max", "x to")}{num("y_min", "y from")}{num("y_max", "y to")}
        {num("step", "Grid step")}
        <Field label="Marking tolerance (±)" hint="How far a point may be from the correct one."><input className="input" type="number" min={0} step="any" value={q.answer.tolerance ?? 0} onChange={e => setAnswer({ tolerance: Number(e.target.value) })} /></Field>
        <Field label="x-axis label"><input className="input" value={d.x_label ?? "x"} onChange={e => setData({ x_label: e.target.value })} /></Field>
        <Field label="y-axis label"><input className="input" value={d.y_label ?? "y"} onChange={e => setData({ y_label: e.target.value })} /></Field>
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={d.snap !== false} onChange={e => setData({ snap: e.target.checked })} /> Points snap to the grid</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={Boolean(d.join)} onChange={e => setData({ join: e.target.checked })} /> Join the points with a line</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={q.answer.partial !== false} onChange={e => setAnswer({ partial: e.target.checked })} /> Partial credit per point</label>
      </div>
      {ok && (
        <div>
          <p className="label">Click the correct points on the grid</p>
          <GraphPlotInput d={{ x_min: Number(d.x_min), x_max: Number(d.x_max), y_min: Number(d.y_min), y_max: Number(d.y_max), step: Number(d.step), snap: d.snap !== false, join: Boolean(d.join), x_label: d.x_label ?? "x", y_label: d.y_label ?? "y" }}
            value={q.answer.points ?? []} onChange={v => setAnswer({ points: v })} />
        </div>
      )}
    </div>
  );
}

export function ChemEditor({ q, setData, setAnswer }: { q: Q; setData: Setter; setAnswer: Setter }) {
  let status: { ok: boolean; text: string } | null = null;
  if (String(q.answer.equation ?? "").trim()) {
    try { status = isBalanced(parseEquation(q.answer.equation)) ? { ok: true, text: "Balanced" } : { ok: false, text: "Not balanced: atoms or charge differ" }; }
    catch (e) { status = { ok: false, text: (e as Error).message }; }
  }
  return (
    <div className="space-y-3">
      <Field label="Correct equation" hint="Use → or ->, + between substances, ^ for charges (Fe^3+), and (s) (l) (g) (aq) if states matter.">
        <input className="input font-mono" value={q.answer.equation ?? ""} onChange={e => setAnswer({ equation: e.target.value })} placeholder="2Mg + O2 -> 2MgO" />
      </Field>
      {status && <p className={"text-sm " + (status.ok ? "text-emerald-700" : "text-rose-700")}><FormulaText text={q.answer.equation} /> · {status.text}</p>}
      <Field label="Other accepted equations (one per line)"><textarea className="input h-16 font-mono" value={(q.answer.alternatives ?? []).join("\n")} onChange={e => setAnswer({ alternatives: e.target.value.split("\n").map((s: string) => s.trim()).filter(Boolean) })} /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Marks for the right substances but wrong numbers" hint="As a fraction of the full marks: 0.5 = half, 0 = none.">
          <input className="input" type="number" min={0} max={1} step={0.1} value={q.answer.species_credit ?? 0.5} onChange={e => setAnswer({ species_credit: Number(e.target.value) })} />
        </Field>
        <Field label="Hint shown to students (optional)"><input className="input" value={q.data.hint ?? ""} onChange={e => setData({ hint: e.target.value })} placeholder="Include state symbols." /></Field>
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={Boolean(q.answer.states)} onChange={e => setAnswer({ states: e.target.checked })} /> State symbols must be right</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={Boolean(q.answer.accept_multiples)} onChange={e => setAnswer({ accept_multiples: e.target.checked })} /> Accept whole multiples (4H₂ + 2O₂ → 4H₂O)</label>
      </div>
    </div>
  );
}

export function RatingEditor({ q, setData, setAnswer }: { q: Q; setData: Setter; setAnswer: Setter }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Field label="Lowest"><input className="input" type="number" value={q.data.min ?? 1} onChange={e => setData({ min: Number(e.target.value) })} /></Field>
      <Field label="Highest"><input className="input" type="number" value={q.data.max ?? 5} onChange={e => setData({ max: Number(e.target.value) })} /></Field>
      <Field label="Correct value (optional)" hint="Leave empty for opinions: any answer gets the marks."><input className="input" type="number" value={q.answer.correct ?? ""} onChange={e => setAnswer({ correct: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
      <Field label="Label for the lowest"><input className="input" value={q.data.min_label ?? ""} onChange={e => setData({ min_label: e.target.value })} placeholder="Strongly disagree" /></Field>
      <Field label="Label for the highest"><input className="input" value={q.data.max_label ?? ""} onChange={e => setData({ max_label: e.target.value })} placeholder="Strongly agree" /></Field>
    </div>
  );
}

export function DrawingEditor({ q, setData, setAnswer }: { q: Q; setData: Setter; setAnswer: Setter }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Background"><select className="input" value={q.data.grid ?? "square"} onChange={e => setData({ grid: e.target.value })}><option value="square">Squared paper</option><option value="graph">Graph paper (fine)</option><option value="none">Plain</option></select></Field>
      <Field label="Image to draw on (optional URL)" hint="For example a map, a circuit to complete or a triangle to construct on."><input className="input" value={q.data.background_url ?? ""} onChange={e => setData({ background_url: e.target.value || null })} /></Field>
      <div className="sm:col-span-2"><Field label="Marking guide (teachers only)"><textarea className="input h-20" value={q.answer.rubric ?? ""} onChange={e => setAnswer({ rubric: e.target.value })} /></Field></div>
      <p className="text-xs text-slate-500 sm:col-span-2">Students get a pen, ruler lines that show length and angle, compass circles that show the radius, rectangles and text labels.</p>
    </div>
  );
}

export function AudioEditor({ q, setData, setAnswer }: { q: Q; setData: Setter; setAnswer: Setter }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Longest recording (seconds)"><input className="input" type="number" min={10} max={600} value={q.data.max_seconds ?? 120} onChange={e => setData({ max_seconds: Number(e.target.value) })} /></Field>
      <p className="self-end text-xs text-slate-500">For oral French, Yorùbá, Igbo, Hausa, English speaking and reading aloud. To play audio to students, put an .mp3 link in the image/media box.</p>
      <div className="sm:col-span-2"><Field label="Marking guide (teachers only)"><textarea className="input h-20" value={q.answer.rubric ?? ""} onChange={e => setAnswer({ rubric: e.target.value })} /></Field></div>
    </div>
  );
}
