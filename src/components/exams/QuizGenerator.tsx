"use client";
import { useState } from "react";
import { useApi, send, Alert, Field, Badge } from "@/components/ui";

type Q = { type: string; prompt: string; points: number; data: any; answer: any; explanation: string; difficulty: string; bloom: string; objective: string | null };
const TYPES: [string, string][] = [["mcq_single", "Multiple choice"], ["true_false", "True / false"], ["short_answer", "Short answer"], ["numeric", "Number"]];

function answerText(q: Q) {
  switch (q.type) {
    case "mcq_single": return q.data.options.find((o: any) => o.id === q.answer.correct)?.text ?? "";
    case "true_false": return q.answer.correct ? "True" : "False";
    case "short_answer": return (q.answer.accepted ?? []).join(" or ");
    case "numeric": return `${q.answer.value}${q.answer.tolerance ? ` (± ${q.answer.tolerance})` : ""}${q.data.unit ? ` ${q.data.unit}` : ""}`;
    default: return "";
  }
}

/**
 * Drafts questions on a topic (optionally against curriculum objectives),
 * lets the teacher check and edit them, then adds the chosen ones to the bank.
 */
export default function QuizGenerator({ subjects, defaults, onSaved }: { subjects: { id: string; name: string }[]; defaults?: { subject_id?: string | null; level?: string | null; topic?: string };
  onSaved?: (ids: string[]) => void }) {
  const { data: avail } = useApi<{ available: boolean }>("/api/question-bank/generate");
  const [f, setF] = useState({ subject_id: defaults?.subject_id ?? "", level: defaults?.level ?? "", topic: defaults?.topic ?? "", count: 8, types: ["mcq_single"], difficulty: "mixed", objective_ids: [] as string[], source: "" });
  const { data: objs } = useApi<{ items: { id: string; code: string | null; statement: string }[] }>(f.subject_id && f.level ? `/api/schemes?objectives=1&subject_id=${f.subject_id}&level=${encodeURIComponent(f.level)}` : null, [f.subject_id, f.level]);
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<(Q & { keep: boolean })[]>([]);
  const [practice, setPractice] = useState(true);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (avail && !avail.available) return <Alert tone="amber">Question drafting is not set up on this server (ANTHROPIC_API_KEY).</Alert>;

  async function generate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const r = await send<{ questions: Q[]; dropped: number }>("/api/question-bank/generate", { action: "generate", ...f, source: f.source || null });
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, text: r.error ?? "failed" });
    setDrafts(r.data.questions.map(q => ({ ...q, keep: true })));
    setMsg({ ok: true, text: `${r.data.questions.length} questions drafted${r.data.dropped ? ` (${r.data.dropped} could not be used)` : ""}. Check each one before saving.` });
  }
  async function save() {
    const chosen = drafts.filter(d => d.keep);
    const r = await send<{ ids: string[] }>("/api/question-bank/generate", { action: "save", subject_id: f.subject_id || null, level: f.level || null, topic: f.topic || null, practice,
      questions: chosen.map(({ keep: _k, objective: _o, ...q }) => q) });
    if (!r.ok) return setMsg({ ok: false, text: r.error ?? "failed" });
    setMsg({ ok: true, text: `${r.data.ids.length} questions added to the question bank.` });
    setDrafts([]);
    onSaved?.(r.data.ids);
  }
  const edit = (i: number, patch: Partial<Q & { keep: boolean }>) => setDrafts(drafts.map((d, j) => j === i ? { ...d, ...patch } : d));

  return (
    <div className="space-y-3 text-sm">
      <form className="grid gap-2 sm:grid-cols-4" onSubmit={generate}>
        <Field label="Subject"><select className="input" value={f.subject_id} onChange={e => setF({ ...f, subject_id: e.target.value, objective_ids: [] })} required><option value="">Choose…</option>{subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Class level"><input className="input" value={f.level} onChange={e => setF({ ...f, level: e.target.value, objective_ids: [] })} required maxLength={40} placeholder="JSS 1" /></Field>
        <div className="sm:col-span-2"><Field label="Topic"><input className="input" value={f.topic} onChange={e => setF({ ...f, topic: e.target.value })} required maxLength={200} placeholder="Adding fractions" /></Field></div>
        <Field label="How many"><input className="input" type="number" min={1} max={20} value={f.count} onChange={e => setF({ ...f, count: Number(e.target.value) })} /></Field>
        <Field label="Difficulty"><select className="input" value={f.difficulty} onChange={e => setF({ ...f, difficulty: e.target.value })}>{["mixed", "easy", "medium", "hard"].map(d => <option key={d}>{d}</option>)}</select></Field>
        <div className="sm:col-span-2"><Field label="Question types"><div className="flex flex-wrap gap-3 pt-1">{TYPES.map(([t, l]) => (
          <label key={t} className="flex items-center gap-1"><input type="checkbox" checked={f.types.includes(t)} onChange={e => setF({ ...f, types: e.target.checked ? [...f.types, t] : f.types.filter(x => x !== t) })} />{l}</label>))}</div></Field></div>
        {(objs?.items.length ?? 0) > 0 && <div className="sm:col-span-4"><Field label="Curriculum objectives to cover (optional)">
          <ul className="max-h-32 space-y-1 overflow-y-auto rounded border border-slate-200 p-2">{objs!.items.map(o => (
            <li key={o.id}><label className="flex gap-2"><input type="checkbox" checked={f.objective_ids.includes(o.id)} onChange={e => setF({ ...f, objective_ids: e.target.checked ? [...f.objective_ids, o.id] : f.objective_ids.filter(x => x !== o.id) })} />
              <span>{o.code && <b>{o.code} </b>}{o.statement}</span></label></li>))}</ul></Field></div>}
        <div className="sm:col-span-4"><Field label="Lesson notes to base them on (optional)"><textarea className="input min-h-16" value={f.source} onChange={e => setF({ ...f, source: e.target.value })} maxLength={30000} placeholder="Paste notes or a passage" /></Field></div>
        <div className="sm:col-span-4"><button className="btn btn-primary" disabled={busy || !f.types.length}>{busy ? "Drafting… (up to a minute)" : "Draft questions"}</button></div>
      </form>
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      {drafts.length > 0 && (
        <div className="space-y-2">
          <ol className="space-y-2">{drafts.map((d, i) => (
            <li key={i} className={"rounded-lg border p-3 " + (d.keep ? "border-slate-200" : "border-dashed border-slate-200 opacity-60")}>
              <div className="flex items-start gap-2">
                <input type="checkbox" checked={d.keep} onChange={e => edit(i, { keep: e.target.checked })} aria-label={`Keep question ${i + 1}`} className="mt-1" />
                <div className="flex-1 space-y-1">
                  <textarea className="input min-h-12" value={d.prompt} onChange={e => edit(i, { prompt: e.target.value })} aria-label={`Question ${i + 1}`} />
                  {d.type === "mcq_single" && <ul className="grid gap-1 sm:grid-cols-2">{d.data.options.map((o: any) => <li key={o.id} className={o.id === d.answer.correct ? "font-semibold text-emerald-700" : ""}>{o.id}) {o.text}</li>)}</ul>}
                  <p className="text-xs"><b>Answer:</b> {answerText(d)} <Badge tone="slate">{TYPES.find(t => t[0] === d.type)?.[1]}</Badge> <Badge tone="blue">{d.difficulty}</Badge>{d.objective && <span className="text-slate-500"> · {d.objective}</span>}</p>
                  <p className="text-xs text-slate-600"><b>Why:</b> {d.explanation}</p>
                </div>
              </div>
            </li>
          ))}</ol>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1"><input type="checkbox" checked={practice} onChange={e => setPractice(e.target.checked)} /> Open for student practice</label>
            <button className="btn btn-primary" onClick={save} disabled={!drafts.some(d => d.keep)}>Add {drafts.filter(d => d.keep).length} to the question bank</button>
            <button className="btn btn-ghost" onClick={() => setDrafts([])}>Discard</button>
          </div>
        </div>
      )}
    </div>
  );
}
