"use client";
import { useState } from "react";
import { send, Alert, Badge } from "@/components/ui";

type Item = { question_id: string; label: string; type: string; prompt: string; display: string; replaces: boolean };
type Preview = { items: Item[]; warnings: string[]; text?: string };

/**
 * Attach answers to the questions already in the exam: paste the whole answer sheet or marking guide
 * (or upload it as Word or PDF), check where each answer goes, then attach. Theory answers become the
 * questions' marking guides, which the AI marker uses.
 */
export default function AttachAnswers({ examId, onDone }: { examId: string; onDone: (text: string) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Preview | null>(null);
  const [skip, setSkip] = useState<Set<string>>(new Set());

  const show = (p: Preview) => { setResult(p); setSkip(new Set()); if (p.text) setText(p.text); };
  const upload = async (file: File) => {
    setBusy(true); setError(null);
    const fd = new FormData(); fd.append("file", file); fd.append("purpose", "answers");
    const r = await fetch(`/api/exams/${examId}/import`, { method: "POST", body: fd }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    setBusy(false);
    if (!r?.ok) return setError(j.error ?? "That file could not be read.");
    show(j);
  };
  const preview = async () => {
    setBusy(true); setError(null);
    const r = await send<Preview>(`/api/exams/${examId}/import`, { action: "answers_preview", text });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    show(r.data);
  };
  const apply = async () => {
    setBusy(true); setError(null);
    const r = await send<{ attached: number; remarked: number; changed: number }>(`/api/exams/${examId}/import`, { action: "answers_apply", text, skip: [...skip] });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    onDone(`Attached ${r.data.attached} answer${r.data.attached === 1 ? "" : "s"}.${r.data.remarked ? ` ${r.data.remarked} handed-in script${r.data.remarked === 1 ? " was" : "s were"} marked again (${r.data.changed} score${r.data.changed === 1 ? "" : "s"} changed); marks you gave by hand are kept.` : ""}`);
  };
  const chosen = result ? result.items.filter(i => !skip.has(i.question_id)).length : 0;

  return (
    <div className="space-y-4 text-sm">
      <p className="text-slate-600">
        Paste the whole answer sheet or marking guide, or upload it. Each answer goes to its question by number:
        objectives as <b>1. B 2. C 3. A</b> (one per line or many on a line), and theory after a <b>THEORY</b> or <b>SECTION B</b> heading
        as <b>1.</b>, <b>1a.</b> or <b>1. (a)</b> with the lines that follow. Theory answers become each question&apos;s marking guide, which the AI uses to mark.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="btn btn-outline cursor-pointer">Upload answers (Word or PDF)<input type="file" className="sr-only" accept=".pdf,.docx,.txt" onChange={e => e.target.files?.[0] && upload(e.target.files[0])} /></label>
        {busy && <span className="text-slate-500">Reading…</span>}
      </div>
      <textarea className="input min-h-44 font-mono text-xs" value={text} onChange={e => setText(e.target.value)}
        placeholder={"Paste the answers here, for example:\n\nOBJECTIVES\n1. B  2. C  3. A  4. D\n5. B\n\nTHEORY\n1a. A computer is an electronic machine that accepts data, processes it and gives information. (2 marks)\n1b. Any THREE: speed, accuracy, storage, diligence (1 mark each)\n2. Input → Processing → Output (1 mark each)"} />
      <button className="btn btn-ghost border border-slate-300" disabled={busy || text.trim().length < 3} onClick={preview}>Match the answers to the questions</button>
      {error && <Alert>{error}</Alert>}
      {result && (<>
        {result.warnings.length > 0 && <Alert tone="amber">{result.warnings.map((w, i) => <p key={i}>{w}</p>)}</Alert>}
        <p className="font-medium">{result.items.length} answer{result.items.length === 1 ? "" : "s"} matched. Untick any that are wrong, then attach.</p>
        <ol className="max-h-[50vh] space-y-2 overflow-y-auto">{result.items.map(it => (
          <li key={it.question_id} className={"rounded-lg border p-3 " + (skip.has(it.question_id) ? "border-slate-200 opacity-50" : "border-slate-200")}>
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-1" checked={!skip.has(it.question_id)} onChange={e => { const s = new Set(skip); if (e.target.checked) s.delete(it.question_id); else s.add(it.question_id); setSkip(s); }} />
              <span className="flex-1">
                <span className="mb-1 flex flex-wrap items-center gap-2"><b>{it.label}</b>{it.replaces && <Badge tone="amber">replaces the current answer</Badge>}</span>
                <span className="block text-slate-600">{it.prompt}</span>
                <span className="mt-1 block whitespace-pre-wrap font-medium text-emerald-800">→ {it.display}</span>
              </span>
            </label>
          </li>))}</ol>
        <button className="btn btn-primary" disabled={busy || !chosen} onClick={apply}>Attach {chosen} answer{chosen === 1 ? "" : "s"}</button>
      </>)}
    </div>
  );
}
