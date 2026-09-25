"use client";
import { useRef, useState } from "react";
import { Field, Alert } from "@/components/ui";

export type QType = "mcq_single" | "mcq_multi" | "true_false" | "short_answer" | "numeric" | "fill_blanks" | "matching" | "ordering" | "hotspot" | "essay" | "code" | "file_upload";
export type EditorQuestion = { id?: string; type: QType; prompt: string; points: number; media_url?: string | null; section?: string | null; data: Record<string, any>; answer: Record<string, any> };

export const TYPE_LABELS: Record<QType, string> = {
  mcq_single: "Multiple choice (one answer)", mcq_multi: "Multiple choice (several answers)", true_false: "True / False",
  short_answer: "Short answer (auto-marked)", numeric: "Numeric with tolerance", fill_blanks: "Fill in the blanks",
  matching: "Matching pairs", ordering: "Put in order", hotspot: "Hotspot on image", essay: "Essay / long answer",
  code: "Code answer", file_upload: "File upload"
};

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
    case "essay": return { ...base, points: 10, data: { min_words: null, max_words: null }, answer: { rubric: "" } };
    case "code": return { ...base, points: 10, data: { language: "python", starter: "" }, answer: { reference: "" } };
    case "file_upload": return { ...base, points: 10, data: { accept: ".pdf,.jpg,.jpeg,.png,.docx", max_mb: 10 }, answer: {} };
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

export default function QuestionEditor({ initial, onSave, onCancel }: { initial: EditorQuestion; onSave: (q: EditorQuestion) => Promise<string | null>; onCancel: () => void }) {
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
        <Field label="Points"><input className="input" type="number" min={0} step="any" value={q.points} onChange={e => setQ({ ...q, points: e.target.value as unknown as number })} /></Field>
        <Field label="Section (optional)"><input className="input" value={q.section ?? ""} onChange={e => setQ({ ...q, section: e.target.value || null })} placeholder="Section A" /></Field>
        {q.type !== "hotspot" && <Field label="Image / diagram URL (optional)"><input className="input" value={q.media_url ?? ""} onChange={e => setQ({ ...q, media_url: e.target.value || null })} /></Field>}
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
              <button className="btn btn-ghost px-2 text-rose-600" onClick={() => setData({ options: opts.filter(x => x.id !== o.id) })} aria-label="Remove option">✕</button>
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
        </div>
      )}

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
              <button className="btn btn-ghost px-2 text-rose-600" aria-label="Remove pair" onClick={() => {
                const rows = pairsFrom(q).filter(x => x.l.id !== p.l.id);
                setQ({ ...q, data: { left: rows.map(x => x.l), right: rows.map(x => x.r) }, answer: { pairs: Object.fromEntries(rows.map(x => [x.l.id, x.r.id])) } });
              }}>✕</button>
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
              <button className="btn btn-ghost px-2 text-rose-600" aria-label="Remove item" onClick={() => setData({ items: q.data.items.filter((x: { id: string }) => x.id !== it.id) })}>✕</button>
            </div>
          ))}
          <button className="btn btn-ghost text-xs" onClick={() => setData({ items: [...(q.data.items ?? []), { id: uid(), text: "" }] })}>+ Add item</button>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={q.answer.partial !== false} onChange={e => setAnswer({ partial: e.target.checked })} /> Partial credit for items in the right position</label>
        </div>
      )}

      {q.type === "hotspot" && <HotspotEditor q={q} setData={setData} setAnswer={setAnswer} />}

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
        </div>
      )}

      {q.type === "file_upload" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Allowed file types"><input className="input" value={q.data.accept} onChange={e => setData({ accept: e.target.value })} /></Field>
          <Field label="Max size (MB)"><input className="input" type="number" min={1} max={50} value={q.data.max_mb} onChange={e => setData({ max_mb: Number(e.target.value) })} /></Field>
        </div>
      )}

      {err && <Alert>{err}</Alert>}
      <div className="flex justify-end gap-2">
        <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save question"}</button>
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
