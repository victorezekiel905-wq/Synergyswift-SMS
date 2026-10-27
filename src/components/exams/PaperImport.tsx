"use client";
import { useState } from "react";
import { send, Alert, Badge } from "@/components/ui";

type Draft = { number: number; type: "mcq_single" | "true_false" | "short_answer" | "essay"; prompt: string; points: number; section: string | null;
  data: { options?: { id: string; text: string }[] }; answer: Record<string, any>; notes: string[] };
const TYPE = { mcq_single: "Multiple choice", true_false: "True / False", short_answer: "Short answer", essay: "Essay / theory" };

/** Import an existing paper: upload a PDF or Word file, or paste the text, check the questions, add them (phase 14j). */
export default function PaperImport({ examId, onDone }: { examId: string; onDone: (added: number, unfinished: number) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ questions: Draft[]; warnings: string[] } | null>(null);
  const [skip, setSkip] = useState<Set<number>>(new Set());
  const upload = async (file: File) => {
    setBusy(true); setError(null);
    const fd = new FormData(); fd.append("file", file);
    const r = await fetch(`/api/exams/${examId}/import`, { method: "POST", body: fd });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setError(j.error ?? "That file could not be read.");
    setResult(j); setSkip(new Set()); if (j.text) setText(j.text);
  };
  const preview = async () => {
    setBusy(true); setError(null);
    const r = await send<{ questions: Draft[]; warnings: string[] }>(`/api/exams/${examId}/import`, { action: "preview", text });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setResult(r.data); setSkip(new Set());
  };
  const save = async () => {
    if (!result) return;
    setBusy(true);
    const keep = result.questions.filter((_, i) => !skip.has(i)).map(({ number: _n, notes: _x, ...q }) => q);
    const r = await send<{ added: number; unfinished: number }>(`/api/exams/${examId}/import`, { action: "save", questions: keep });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    onDone(r.data.added, r.data.unfinished);
  };
  const correct = (q: Draft) => q.type === "mcq_single" ? q.data.options?.find(o => o.id === q.answer.correct)?.text
    : q.type === "true_false" ? (q.answer.correct === undefined ? null : q.answer.correct ? "True" : "False")
    : q.type === "short_answer" ? (q.answer.accepted ?? []).join(" / ") || null : null;
  return (
    <div className="space-y-4 text-sm">
      <p className="text-slate-600">Upload the paper as a PDF or Word file, or paste it below. Questions should be numbered (1., 2., …) with options A–D; an answer key at the end (&quot;ANSWERS 1. B 2. C …&quot;) fills in the answers. Scanned papers have no text: type or paste those.</p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="btn btn-outline cursor-pointer">Upload PDF or Word<input type="file" className="sr-only" accept=".pdf,.docx,.txt" onChange={e => e.target.files?.[0] && upload(e.target.files[0])} /></label>
        {busy && <span className="text-slate-500">Reading…</span>}
      </div>
      <textarea className="input min-h-40 font-mono text-xs" value={text} onChange={e => setText(e.target.value)} placeholder={"1. What is 2 + 2?\nA. 3\nB. 4\nC. 5\nD. 6\n\nANSWERS\n1. B"} />
      <button className="btn btn-ghost border border-slate-300" disabled={busy || text.trim().length < 5} onClick={preview}>Read the questions</button>
      {error && <Alert>{error}</Alert>}
      {result && (<>
        {result.warnings.length > 0 && <Alert tone="amber">{result.warnings.map((w, i) => <p key={i}>{w}</p>)}</Alert>}
        <p className="font-medium">{result.questions.length} question{result.questions.length === 1 ? "" : "s"} found. Untick any you do not want, then add them; you can edit each one afterwards.</p>
        <ol className="max-h-[50vh] space-y-2 overflow-y-auto">{result.questions.map((q, i) => (
          <li key={i} className={"rounded-lg border p-3 " + (skip.has(i) ? "border-slate-200 opacity-50" : q.notes.length ? "border-amber-300" : "border-slate-200")}>
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-1" checked={!skip.has(i)} onChange={e => { const s = new Set(skip); if (e.target.checked) s.delete(i); else s.add(i); setSkip(s); }} />
              <span className="flex-1">
                <span className="mb-1 flex flex-wrap items-center gap-2"><b>{q.number}.</b><Badge>{TYPE[q.type]}</Badge>{q.section && <Badge tone="violet">{q.section}</Badge>}<span className="text-slate-500">{q.points} mark{q.points === 1 ? "" : "s"}</span></span>
                <span className="block whitespace-pre-wrap">{q.prompt}</span>
                {q.data.options && <span className="mt-1 block text-slate-600">{q.data.options.map((o, k) => <span key={o.id} className={"mr-3 " + (o.id === q.answer.correct ? "font-semibold text-emerald-800" : "")}>{"ABCDEF"[k]}. {o.text}</span>)}</span>}
                {correct(q) && q.type !== "mcq_single" && <span className="block text-emerald-800">Answer: {correct(q)}</span>}
                {q.notes.map((n, k) => <span key={k} className="block text-amber-800">{n}</span>)}
              </span>
            </label>
          </li>))}</ol>
        <button className="btn btn-primary" disabled={busy || result.questions.length === skip.size} onClick={save}>Add {result.questions.length - skip.size} question{result.questions.length - skip.size === 1 ? "" : "s"} to the exam</button>
      </>)}
    </div>
  );
}
