"use client";
import { useRef, useState } from "react";
import { Field, Alert, Icon } from "@/components/ui";
import { NumericExtras, MatrixEditor, HighlightEditor, LabelImageEditor, GraphPlotEditor, ChemEditor, RatingEditor, DrawingEditor, AudioEditor } from "./QuestionTypeEditors";

export type QType = "mcq_single" | "mcq_multi" | "true_false" | "short_answer" | "numeric" | "fill_blanks" | "matching" | "ordering" | "hotspot" | "math" | "drag_drop" | "essay" | "code" | "file_upload"
  | "matrix" | "highlight" | "label_image" | "graph_plot" | "chem_equation" | "rating" | "passage" | "drawing" | "audio_response";
export type EditorQuestion = { id?: string; type: QType; prompt: string; points: number; media_url?: string | null; section?: string | null; data: Record<string, any>; answer: Record<string, any> };

export const TYPE_LABELS: Record<QType, string> = {
  mcq_single: "Multiple choice (one answer)", mcq_multi: "Multiple choice (several answers)", true_false: "True / False",
  short_answer: "Short answer (auto-marked)", numeric: "Numeric with tolerance", fill_blanks: "Fill in the blanks",
  matching: "Matching pairs", ordering: "Put in order", hotspot: "Hotspot on image", math: "Maths input", drag_drop: "Drag and drop into groups", essay: "Essay / long answer",
  code: "Code answer", file_upload: "File upload",
  matrix: "Grid (statements × choices)", highlight: "Select words in a passage", label_image: "Label the diagram", graph_plot: "Plot points on a graph",
  chem_equation: "Chemical equation", rating: "Rating scale", passage: "Reading passage or case study", drawing: "Drawing or construction", audio_response: "Spoken answer (recording)"
};

/** Question types grouped for the "Add question" menu. */
export const TYPE_GROUPS: { label: string; types: QType[] }[] = [
  { label: "Objective", types: ["mcq_single", "mcq_multi", "true_false", "matrix", "matching", "ordering", "drag_drop", "rating"] },
  { label: "Written", types: ["short_answer", "fill_blanks", "highlight", "essay", "passage"] },
  { label: "Maths and science", types: ["numeric", "math", "graph_plot", "chem_equation", "drawing"] },
  { label: "Images, sound and files", types: ["hotspot", "label_image", "audio_response", "file_upload", "code"] }
];

const uid = () => Math.random().toString(36).slice(2, 8);

export function blankQuestion(type: QType): EditorQuestion {
  const base = { type, prompt: "", points: 1, media_url: null, section: null };
  switch (type) {
    case "mcq_single": return { ...base, data: { options: [{ id: uid(), text: "" }, { id: uid(), text: "" }, { id: uid(), text: "" }, { id: uid(), text: "" }] }, answer: {} };
    case "mcq_multi": return { ...base, points: 2, data: { options: [{ id: uid(), text: "" }, { id: uid(), text: "" }, { id: uid(), text: "" }, { id: uid(), text: "" }] }, answer: { correct: [], partial: true } };
    case "true_false": return { ...base, data: {}, answer: { correct: true } };
    case "short_answer": return { ...base, data: { max_length: 200 }, answer: { accepted: [], case_sensitive: false } };
    case "numeric": return { ...base, data: { unit: "" }, answer: { value: 0, tolerance: 0 } };
    case "fill_blanks": return { ...base, points: 2, prompt: "Complete the passage.", data: { text: "" }, answer: { blanks: [] } };
    case "matching": return { ...base, points: 3, data: { left: [{ id: uid(), text: "" }, { id: uid(), text: "" }, { id: uid(), text: "" }], right: [] }, answer: { pairs: {} } };
    case "ordering": return { ...base, points: 3, data: { items: [{ id: uid(), text: "" }, { id: uid(), text: "" }, { id: uid(), text: "" }] }, answer: { order: [], partial: true } };
    case "hotspot": return { ...base, data: { image_url: "" }, answer: { regions: [] } };
    case "math": return { ...base, points: 2, data: { hint: "" }, answer: { expression: "", alternatives: [] } };
    case "drag_drop": {
      const z1 = uid(), z2 = uid();
      return { ...base, points: 4, data: { zones: [{ id: z1, text: "" }, { id: z2, text: "" }], items: [{ id: uid(), text: "" }, { id: uid(), text: "" }] }, answer: { placement: {}, partial: true } };
    }
    case "essay": return { ...base, points: 10, data: { min_words: null, max_words: null }, answer: { rubric: "" } };
    case "code": return { ...base, points: 10, data: { language: "python", starter: "" }, answer: { reference: "" } };
    case "file_upload": return { ...base, points: 10, data: { accept: ".pdf,.jpg,.jpeg,.png,.docx", max_mb: 10 }, answer: {} };
    case "matrix": {
      const t = uid(), f = uid();
      return { ...base, points: 3, data: { rows: [{ id: uid(), text: "" }, { id: uid(), text: "" }, { id: uid(), text: "" }], cols: [{ id: t, text: "True" }, { id: f, text: "False" }] }, answer: { correct: {}, partial: true } };
    }
    case "highlight": return { ...base, points: 3, prompt: "Select the correct words in the passage.", data: { text: "", instruction: "" }, answer: { correct: [], partial: true } };
    case "label_image": return { ...base, points: 4, prompt: "Label the diagram.", data: { image_url: "", pins: [], labels: [] }, answer: { placement: {}, partial: true } };
    case "graph_plot": return { ...base, points: 4, data: { x_min: -5, x_max: 5, y_min: -5, y_max: 5, step: 1, snap: true, join: false, x_label: "x", y_label: "y" }, answer: { points: [], tolerance: 0, partial: true } };
    case "chem_equation": return { ...base, points: 2, prompt: "Write a balanced equation for the reaction.", data: { hint: "" }, answer: { equation: "", alternatives: [], species_credit: 0.5, states: false, accept_multiples: false } };
    case "rating": return { ...base, data: { min: 1, max: 5, min_label: "", max_label: "" }, answer: { correct: null } };
    case "passage": return { ...base, points: 0, prompt: "Read the passage below and answer the questions that follow.\n\n", data: {}, answer: {} };
    case "drawing": return { ...base, points: 6, data: { grid: "square", background_url: null }, answer: { rubric: "" } };
    case "audio_response": return { ...base, points: 5, data: { max_seconds: 120 }, answer: { rubric: "" } };
  }
}

/** Matching is edited as rows of pairs; stored as left/right lists plus a pairs map. */
function pairsFrom(q: EditorQuestion): { l: { id: string; text: string }; r: { id: string; text: string } }[] {
  const left = q.data.left ?? [];
  const right: { id: string; text: string }[] = q.data.right ?? [];
  return left.map((l: { id: string; text: string }) => {
    const rid = q.answer.pairs?.[l.id];
    return { l, r: right.find(x => x.id === rid) ?? { id: `r${l.id}`, text: "" } };
  });
}

export default function QuestionEditor({ initial, onSave, onCancel, extra }: { initial: EditorQuestion; onSave: (q: EditorQuestion) => Promise<string | null>; onCancel: () => void; extra?: React.ReactNode }) {
  const [q, setQ] = useState<EditorQuestion>(initial);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const setData = (d: Record<string, any>) => setQ(x => ({ ...x, data: { ...x.data, ...d } }));
  const setAnswer = (a: Record<string, any>) => setQ(x => ({ ...x, answer: { ...x.answer, ...a } }));

  async function save() {
    setBusy(true); setErr(null);
    let out = q;
    if (q.type === "matching") {
      const rows = pairsFrom(q).filter(p => p.l.text.trim() || p.r.text.trim());
      out = { ...q, data: { left: rows.map(p => p.l), right: rows.map(p => p.r) }, answer: { pairs: Object.fromEntries(rows.map(p => [p.l.id, p.r.id])) } };
    }
    if (q.type === "ordering") {
      const items = (q.data.items ?? []).filter((i: { text: string }) => i.text.trim());
      out = { ...q, data: { items }, answer: { ...q.answer, order: items.map((i: { id: string }) => i.id) } };
    }
    if (q.type === "short_answer") {
      out = { ...q, answer: { ...q.answer, accepted: (q.answer.accepted ?? []).map((s: string) => s.trim()).filter(Boolean) } };
    }
    if (q.type === "mcq_single" || q.type === "mcq_multi") {
      out = { ...q, data: { options: (q.data.options ?? []).filter((o: { text: string }) => o.text.trim()) } };
    }
    if (q.type === "math") {
      out = { ...q, answer: { ...q.answer, expression: String(q.answer.expression ?? "").trim(), alternatives: (q.answer.alternatives ?? []).map((s: string) => s.trim()).filter(Boolean) } };
    }
    if (q.type === "drag_drop") {
      const zones = (q.data.zones ?? []).filter((z: { text: string }) => z.text.trim());
      const items = (q.data.items ?? []).filter((i: { text: string }) => i.text.trim());
      out = { ...q, data: { zones, items }, answer: { ...q.answer, placement: Object.fromEntries(items.map((i: { id: string }) => [i.id, q.answer.placement?.[i.id]]).filter(([, z]: [string, string]) => zones.some((x: { id: string }) => x.id === z))) } };
    }
    if (q.type === "matrix") {
      const rows = (q.data.rows ?? []).filter((r: { text: string }) => r.text.trim()), cols = (q.data.cols ?? []).filter((c: { text: string }) => c.text.trim());
      out = { ...q, data: { rows, cols }, answer: { ...q.answer, correct: Object.fromEntries(rows.map((r: { id: string }) => [r.id, q.answer.correct?.[r.id]]).filter(([, c]: [string, string]) => cols.some((x: { id: string }) => x.id === c))) } };
    }
    if (q.type === "label_image") {
      out = { ...q, data: { ...q.data, labels: (q.data.labels ?? []).filter((l: { text: string }) => l.text.trim()) } };
    }
    if (q.type === "passage") out = { ...out, points: 0 };
    const e = await onSave({ ...out, points: Number(out.points) });
    setBusy(false);
    if (e) setErr(e);
  }

  const opts: { id: string; text: string }[] = q.data.options ?? [];
  return (
    <div className="space-y-4">
      <p className="text-xs font-semibold uppercase text-brand-600">{TYPE_LABELS[q.type]}</p>
      <Field label="Question"><textarea className="input h-24" value={q.prompt} onChange={e => setQ({ ...q, prompt: e.target.value })} /></Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Points"><input className="input" type="number" min={0} step="any" value={q.type === "passage" ? 0 : q.points} disabled={q.type === "passage"} onChange={e => setQ({ ...q, points: e.target.value as unknown as number })} /></Field>
        <Field label="Section (optional)"><input className="input" value={q.section ?? ""} onChange={e => setQ({ ...q, section: e.target.value || null })} placeholder="Section A" /></Field>
        {q.type !== "hotspot" && q.type !== "label_image" && <Field label="Image, audio or video URL (optional)"><input className="input" value={q.media_url ?? ""} onChange={e => setQ({ ...q, media_url: e.target.value || null })} /></Field>}
      </div>

      {(q.type === "mcq_single" || q.type === "mcq_multi") && (
        <div className="space-y-2">
          <p className="label">Options: tick the correct {q.type === "mcq_single" ? "answer" : "answers"}</p>
          {opts.map((o, i) => (
            <div key={o.id} className="flex items-center gap-2">
              <input type={q.type === "mcq_single" ? "radio" : "checkbox"} name="correct" aria-label={`Option ${i + 1} correct`}
                checked={q.type === "mcq_single" ? q.answer.correct === o.id : (q.answer.correct ?? []).includes(o.id)}
                onChange={e => q.type === "mcq_single" ? setAnswer({ correct: o.id })
                  : setAnswer({ correct: e.target.checked ? [...(q.answer.correct ?? []), o.id] : (q.answer.correct ?? []).filter((x: string) => x !== o.id) })} />
              <span className="w-5 text-xs font-bold text-slate-400">{String.fromCharCode(65 + i)}</span>
              <input className="input" value={o.text} onChange={e => setData({ options: opts.map(x => x.id === o.id ? { ...x, text: e.target.value } : x) })} aria-label={`Option ${i + 1}`} />
              <button type="button" className="btn btn-ghost px-2 text-rose-600" onClick={() => setData({ options: opts.filter(x => x.id !== o.id) })} aria-label="Remove option"><Icon name="x" className="h-4 w-4" /></button>
            </div>
          ))}
          <button className="btn btn-ghost text-xs" onClick={() => setData({ options: [...opts, { id: uid(), text: "" }] })}>+ Add option</button>
          {q.type === "mcq_multi" && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={q.answer.partial !== false} onChange={e => setAnswer({ partial: e.target.checked })} /> Partial credit (wrong picks cancel right ones, never negative)</label>}
        </div>
      )}

      {q.type === "true_false" && (
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="radio" checked={q.answer.correct === true} onChange={() => setAnswer({ correct: true })} /> True</label>
          <label className="flex items-center gap-2"><input type="radio" checked={q.answer.correct === false} onChange={() => setAnswer({ correct: false })} /> False</label>
        </div>
      )}

      {q.type === "short_answer" && (
        <>
          <Field label="Accepted answers (one per line)" hint="Marking ignores extra spaces. Case is ignored unless you tick the box.">
            <textarea className="input h-20" value={(q.answer.accepted ?? []).join("\n")} onChange={e => setAnswer({ accepted: e.target.value.split("\n") })} />
          </Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(q.answer.case_sensitive)} onChange={e => setAnswer({ case_sensitive: e.target.checked })} /> Case sensitive</label>
        </>
      )}

      {q.type === "numeric" && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Correct value"><input className="input" type="number" step="any" value={q.answer.value} onChange={e => setAnswer({ value: Number(e.target.value) })} /></Field>
          <Field label="Tolerance (±)"><input className="input" type="number" step="any" min={0} value={q.answer.tolerance} onChange={e => setAnswer({ tolerance: Number(e.target.value) })} /></Field>
          <Field label="Unit shown to students"><input className="input" value={q.data.unit ?? ""} onChange={e => setData({ unit: e.target.value })} /></Field>
          <div className="sm:col-span-3"><NumericExtras q={q} setAnswer={setAnswer} /></div>
        </div>
      )}

      {q.type === "matrix" && <MatrixEditor q={q} setData={setData} setAnswer={setAnswer} />}
      {q.type === "highlight" && <HighlightEditor q={q} setData={setData} setAnswer={setAnswer} />}
      {q.type === "label_image" && <LabelImageEditor q={q} setData={setData} setAnswer={setAnswer} />}
      {q.type === "graph_plot" && <GraphPlotEditor q={q} setData={setData} setAnswer={setAnswer} />}
      {q.type === "chem_equation" && <ChemEditor q={q} setData={setData} setAnswer={setAnswer} />}
      {q.type === "rating" && <RatingEditor q={q} setData={setData} setAnswer={setAnswer} />}
      {q.type === "drawing" && <DrawingEditor q={q} setData={setData} setAnswer={setAnswer} />}
      {q.type === "audio_response" && <AudioEditor q={q} setData={setData} setAnswer={setAnswer} />}
      {q.type === "passage" && <p className="text-sm text-slate-600">Put the passage, case study or data in the question box above. It carries no marks; add the questions about it after it, in the same section.</p>}

      {q.type === "fill_blanks" && (
        <Field label="Passage" hint="Wrap each answer in double brackets. Separate alternatives with |, for example: Water boils at [[100|one hundred]] degrees.">
          <textarea className="input h-32 font-mono text-sm" value={q.data.text ?? ""} onChange={e => setData({ text: e.target.value })} />
        </Field>
      )}

      {q.type === "matching" && (
        <div className="space-y-2">
          <p className="label">Pairs (students see the right column shuffled)</p>
          {pairsFrom(q).map((p, i) => (
            <div key={p.l.id} className="grid grid-cols-[1fr_1fr_auto] gap-2">
              <input className="input" placeholder="Left" value={p.l.text} aria-label={`Left ${i + 1}`} onChange={e => {
                const rows = pairsFrom(q).map(x => x.l.id === p.l.id ? { ...x, l: { ...x.l, text: e.target.value } } : x);
                setQ({ ...q, data: { left: rows.map(x => x.l), right: rows.map(x => x.r) }, answer: { pairs: Object.fromEntries(rows.map(x => [x.l.id, x.r.id])) } });
              }} />
              <input className="input" placeholder="Matches" value={p.r.text} aria-label={`Right ${i + 1}`} onChange={e => {
                const rows = pairsFrom(q).map(x => x.l.id === p.l.id ? { ...x, r: { ...x.r, text: e.target.value } } : x);
                setQ({ ...q, data: { left: rows.map(x => x.l), right: rows.map(x => x.r) }, answer: { pairs: Object.fromEntries(rows.map(x => [x.l.id, x.r.id])) } });
              }} />
              <button type="button" className="btn btn-ghost px-2 text-rose-600" aria-label="Remove pair" onClick={() => {
                const rows = pairsFrom(q).filter(x => x.l.id !== p.l.id);
                setQ({ ...q, data: { left: rows.map(x => x.l), right: rows.map(x => x.r) }, answer: { pairs: Object.fromEntries(rows.map(x => [x.l.id, x.r.id])) } });
              }}><Icon name="x" className="h-4 w-4" /></button>
            </div>
          ))}
          <button className="btn btn-ghost text-xs" onClick={() => { const id = uid(); setQ({ ...q, data: { left: [...(q.data.left ?? []), { id, text: "" }], right: [...(q.data.right ?? []), { id: `r${id}`, text: "" }] }, answer: { pairs: { ...(q.answer.pairs ?? {}), [id]: `r${id}` } } }); }}>+ Add pair</button>
        </div>
      )}

      {q.type === "ordering" && (
        <div className="space-y-2">
          <p className="label">Items in the CORRECT order (students see them shuffled)</p>
          {(q.data.items ?? []).map((it: { id: string; text: string }, i: number) => (
            <div key={it.id} className="flex items-center gap-2">
              <span className="w-6 text-center text-xs font-bold text-slate-400">{i + 1}</span>
              <input className="input" value={it.text} aria-label={`Item ${i + 1}`} onChange={e => setData({ items: q.data.items.map((x: { id: string }) => x.id === it.id ? { ...x, text: e.target.value } : x) })} />
              <button type="button" className="btn btn-ghost px-2 text-rose-600" aria-label="Remove item" onClick={() => setData({ items: q.data.items.filter((x: { id: string }) => x.id !== it.id) })}><Icon name="x" className="h-4 w-4" /></button>
            </div>
          ))}
          <button className="btn btn-ghost text-xs" onClick={() => setData({ items: [...(q.data.items ?? []), { id: uid(), text: "" }] })}>+ Add item</button>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={q.answer.partial !== false} onChange={e => setAnswer({ partial: e.target.checked })} /> Partial credit for items in the right position</label>
        </div>
      )}

      {q.type === "hotspot" && <HotspotEditor q={q} setData={setData} setAnswer={setAnswer} />}

      {q.type === "math" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Correct answer" hint="Any equivalent form is accepted: 2(x+1) also matches 2x+2. Use ^ for powers, sqrt( ), pi.">
            <input className="input font-mono" value={q.answer.expression ?? ""} onChange={e => setAnswer({ expression: e.target.value })} placeholder="x^2 - 4" />
          </Field>
          <Field label="Other accepted answers (one per line)" hint="For answers that are not algebraically equal, such as x = 2 or x = -2.">
            <textarea className="input h-16 font-mono" value={(q.answer.alternatives ?? []).join("\n")} onChange={e => setAnswer({ alternatives: e.target.value.split("\n") })} />
          </Field>
          <div className="sm:col-span-2"><Field label="Hint shown to students (optional)"><input className="input" value={q.data.hint ?? ""} onChange={e => setData({ hint: e.target.value })} placeholder="Simplify fully." /></Field></div>
        </div>
      )}

      {q.type === "drag_drop" && <DragDropEditor q={q} setData={setData} setAnswer={setAnswer} />}

      {q.type === "essay" && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Minimum words"><input className="input" type="number" min={0} value={q.data.min_words ?? ""} onChange={e => setData({ min_words: e.target.value ? Number(e.target.value) : null })} /></Field>
          <Field label="Maximum words"><input className="input" type="number" min={0} value={q.data.max_words ?? ""} onChange={e => setData({ max_words: e.target.value ? Number(e.target.value) : null })} /></Field>
          <div className="sm:col-span-3"><Field label="Marking guide (teachers only)"><textarea className="input h-20" value={q.answer.rubric ?? ""} onChange={e => setAnswer({ rubric: e.target.value })} /></Field></div>
        </div>
      )}

      {q.type === "code" && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Language"><select className="input" value={q.data.language} onChange={e => setData({ language: e.target.value })}>{["python", "javascript", "java", "c", "cpp", "csharp", "html", "sql", "pseudocode"].map(l => <option key={l}>{l}</option>)}</select></Field>
          <div className="sm:col-span-2"><Field label="Starter code"><textarea className="input h-24 font-mono text-xs" value={q.data.starter ?? ""} onChange={e => setData({ starter: e.target.value })} /></Field></div>
          <div className="sm:col-span-3"><Field label="Reference solution (teachers only)"><textarea className="input h-24 font-mono text-xs" value={q.answer.reference ?? ""} onChange={e => setAnswer({ reference: e.target.value })} /></Field></div>
          <div className="sm:col-span-3"><CodeTests q={q} setAnswer={setAnswer} /></div>
        </div>
      )}

      {q.type === "file_upload" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Allowed file types"><input className="input" value={q.data.accept} onChange={e => setData({ accept: e.target.value })} /></Field>
          <Field label="Max size (MB)"><input className="input" type="number" min={1} max={50} value={q.data.max_mb} onChange={e => setData({ max_mb: Number(e.target.value) })} /></Field>
        </div>
      )}

      {extra}
      {err && <Alert>{err}</Alert>}
      <div className="flex justify-end gap-2">
        <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save question"}</button>
      </div>
    </div>
  );
}

type CodeTest = { input: string; expected: string; hidden?: boolean };

/** Test cases for automatic marking of code answers, with a button to check the reference solution. */
function CodeTests({ q, setAnswer }: { q: EditorQuestion; setAnswer: (a: Record<string, any>) => void }) {
  const tests: CodeTest[] = q.answer.tests ?? [];
  const [check, setCheck] = useState<{ text: string; ok: boolean } | null>(null);
  const set = (i: number, k: keyof CodeTest, v: string | boolean) => setAnswer({ tests: tests.map((t, j) => j === i ? { ...t, [k]: v } : t) });
  async function run() {
    setCheck(null);
    const res = await fetch("/api/exams/code-test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ language: q.data.language, code: q.answer.reference ?? "", tests }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return setCheck({ ok: false, text: j.error ?? "Could not run the code." });
    const bad = (j.outcomes ?? []).map((o: { passed: boolean; output: string | null; error: string | null }, i: number) => o.passed ? null : `Test ${i + 1}: ${o.error ?? `printed "${(o.output ?? "").trim()}"`}`).filter(Boolean);
    setCheck({ ok: !bad.length, text: `Reference solution passes ${j.passed} of ${j.total} tests.${bad.length ? " " + bad.join(" · ") : ""}` });
  }
  return (
    <div className="space-y-2 rounded-lg border border-slate-200 p-3">
      <p className="label">Automatic marking (optional)</p>
      <p className="text-xs text-slate-500">Each test gives the program some input and checks what it prints. Marks are shared equally between tests. Visible tests are shown to students as examples they can run; hidden tests are only used for marking. In JavaScript, input is the variable <code>input</code> (or call <code>readLine()</code>) and output is <code>console.log</code>. Other languages read standard input and need a Judge0 server.</p>
      {tests.map((t, i) => (
        <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
          <textarea className="input h-14 font-mono text-xs" placeholder="Input" value={t.input} onChange={e => set(i, "input", e.target.value)} aria-label={`Test ${i + 1} input`} />
          <textarea className="input h-14 font-mono text-xs" placeholder="Expected output" value={t.expected} onChange={e => set(i, "expected", e.target.value)} aria-label={`Test ${i + 1} expected output`} />
          <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={Boolean(t.hidden)} onChange={e => set(i, "hidden", e.target.checked)} /> Hidden</label>
          <button type="button" className="btn btn-ghost px-2 text-rose-600" aria-label="Remove test" onClick={() => setAnswer({ tests: tests.filter((_, j) => j !== i) })}><Icon name="x" className="h-4 w-4" /></button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-ghost text-xs" disabled={tests.length >= 20} onClick={() => setAnswer({ tests: [...tests, { input: "", expected: "", hidden: tests.length > 0 }] })}>+ Add test</button>
        {tests.length > 0 && <button type="button" className="btn btn-outline text-xs" disabled={!String(q.answer.reference ?? "").trim()} onClick={run}>Check reference solution</button>}
      </div>
      {check && <p className={"text-xs " + (check.ok ? "text-emerald-700" : "text-rose-700")}>{check.text}</p>}
    </div>
  );
}

function DragDropEditor({ q, setData, setAnswer }: { q: EditorQuestion; setData: (d: Record<string, any>) => void; setAnswer: (a: Record<string, any>) => void }) {
  const zones: { id: string; text: string }[] = q.data.zones ?? [];
  const items: { id: string; text: string }[] = q.data.items ?? [];
  const placement: Record<string, string> = q.answer.placement ?? {};
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <p className="label">Groups (drop zones)</p>
        {zones.map((z, i) => (
          <div key={z.id} className="flex items-center gap-2">
            <input className="input" value={z.text} placeholder={`Group ${i + 1}`} aria-label={`Group ${i + 1}`} onChange={e => setData({ zones: zones.map(x => x.id === z.id ? { ...x, text: e.target.value } : x) })} />
            <button type="button" className="btn btn-ghost px-2 text-rose-600" aria-label="Remove group" onClick={() => setData({ zones: zones.filter(x => x.id !== z.id) })}><Icon name="x" className="h-4 w-4" /></button>
          </div>
        ))}
        <button className="btn btn-ghost text-xs" onClick={() => setData({ zones: [...zones, { id: uid(), text: "" }] })}>+ Add group</button>
      </div>
      <div className="space-y-2">
        <p className="label">Items and the group each belongs in</p>
        {items.map((it, i) => (
          <div key={it.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-2">
            <input className="input" value={it.text} placeholder={`Item ${i + 1}`} aria-label={`Item ${i + 1}`} onChange={e => setData({ items: items.map(x => x.id === it.id ? { ...x, text: e.target.value } : x) })} />
            <select className="input w-36" value={placement[it.id] ?? ""} aria-label={`Group for item ${i + 1}`} onChange={e => setAnswer({ placement: { ...placement, [it.id]: e.target.value } })}>
              <option value="">Group…</option>{zones.map((z, j) => <option key={z.id} value={z.id}>{z.text || `Group ${j + 1}`}</option>)}
            </select>
            <button type="button" className="btn btn-ghost px-2 text-rose-600" aria-label="Remove item" onClick={() => setData({ items: items.filter(x => x.id !== it.id) })}><Icon name="x" className="h-4 w-4" /></button>
          </div>
        ))}
        <button className="btn btn-ghost text-xs" onClick={() => setData({ items: [...items, { id: uid(), text: "" }] })}>+ Add item</button>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={q.answer.partial !== false} onChange={e => setAnswer({ partial: e.target.checked })} /> Partial credit for each item placed correctly</label>
      </div>
    </div>
  );
}

function HotspotEditor({ q, setData, setAnswer }: { q: EditorQuestion; setData: (d: Record<string, any>) => void; setAnswer: (a: Record<string, any>) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);
  const regions: { x: number; y: number; w: number; h: number }[] = q.answer.regions ?? [];
  const pos = (e: React.MouseEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: Math.round(((e.clientX - r.left) / r.width) * 1000) / 10, y: Math.round(((e.clientY - r.top) / r.height) * 1000) / 10 };
  };
  return (
    <div className="space-y-2">
      <Field label="Image URL"><input className="input" value={q.data.image_url ?? ""} onChange={e => setData({ image_url: e.target.value })} /></Field>
      {q.data.image_url && (
        <>
          <p className="text-xs text-slate-500">Drag on the image to draw each correct area. A click inside any area earns the points.</p>
          <div ref={ref} className="relative inline-block max-w-full cursor-crosshair select-none"
            onMouseDown={e => setStart(pos(e))}
            onMouseUp={e => {
              if (!start) return;
              const p = pos(e);
              const g = { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) };
              if (g.w > 1 && g.h > 1) setAnswer({ regions: [...regions, g] });
              setStart(null);
            }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={q.data.image_url} alt="Hotspot" className="max-h-[400px] max-w-full" draggable={false} />
            {regions.map((g, i) => (
              <div key={i} className="absolute border-2 border-emerald-500 bg-emerald-400/30" style={{ left: `${g.x}%`, top: `${g.y}%`, width: `${g.w}%`, height: `${g.h}%` }} />
            ))}
          </div>
          {regions.length > 0 && <button className="btn btn-ghost text-xs text-rose-600" onClick={() => setAnswer({ regions: [] })}>Clear areas ({regions.length})</button>}
        </>
      )}
    </div>
  );
}
