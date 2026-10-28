"use client";
import { useState } from "react";
import { useApi, Alert, Empty, Badge, fmtDate } from "@/components/ui";
import RichText from "@/components/content/RichText";

type Note = { id: string; kind: "text" | "pin"; start_offset: number | null; end_offset: number | null; quote: string | null; file_index: number | null; x: number | null; y: number | null; comment: string };
type Sub = { id: string; body: string | null; files: { name: string; type: string; size: number; index: number }[]; submitted_at: string; late: boolean; attempt: number; status: "submitted" | "returned" | "marked";
  score: number | null; raw_score: number | null; penalty_pct: number; feedback: string | null; returned_note: string | null; feedback_media: { type: string; seconds: number; index: number }[]; annotations: Note[] };
type Hw = { id: string; title: string; instructions: string | null; attachment_url: string | null; due_at: string; max_score: number | null; allow_late: boolean; allow_resubmit: boolean;
  max_attempts: number; accept_files: boolean; late_penalty_pct: number; late_penalty_max: number; subjects: { name: string } | null; submission: Sub | null };

/** The answer with the teacher's comments highlighted. */
export function AnnotatedAnswer({ text, notes }: { text: string; notes: Note[] }) {
  const ranges = notes.filter(n => n.kind === "text" && n.start_offset != null && n.end_offset != null).sort((a, b) => a.start_offset! - b.start_offset!);
  const parts: React.ReactNode[] = [];
  let at = 0;
  ranges.forEach((n, i) => {
    if (n.start_offset! < at) return;
    parts.push(text.slice(at, n.start_offset!));
    parts.push(<mark key={n.id} className="rounded bg-amber-100 px-0.5" title={n.comment}>{text.slice(n.start_offset!, n.end_offset!)}<sup className="ml-0.5 text-[10px] font-bold text-amber-800">{i + 1}</sup></mark>);
    at = n.end_offset!;
  });
  parts.push(text.slice(at));
  return (
    <div>
      <p className="whitespace-pre-wrap rounded border border-slate-200 bg-white p-2">{parts}</p>
      {ranges.length > 0 && <ol className="mt-1 list-decimal pl-5 text-xs text-amber-900">{ranges.map(n => <li key={n.id}>{n.comment}</li>)}</ol>}
    </div>
  );
}

/** Student homework: hand in text and files, see feedback, comments and recordings, and try again when allowed. */
export function StudentHomework() {
  const { data, error, reload } = useApi<Hw[]>("/api/homework");
  const [open, setOpen] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (error) return <Alert tone="amber">{error}</Alert>;
  if (!data?.length) return <Empty>No homework right now.</Empty>;
  return (
    <ul className="space-y-2">{data.map(h => {
      const s = h.submission;
      const overdue = new Date(h.due_at) < new Date();
      const attemptsLeft = s ? h.max_attempts - s.attempt : h.max_attempts;
      const canHandIn = !s ? (!overdue || h.allow_late) : s.status === "returned" ? attemptsLeft > 0 : s.status === "submitted" && h.allow_resubmit && attemptsLeft > 0 && (!overdue || h.allow_late);
      return (
        <li key={h.id} className="card p-4 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span><b>{h.title}</b> <span className="text-slate-500">{h.subjects?.name}</span><br />
              <span className="text-xs text-slate-500">Due {fmtDate(h.due_at, true)}{h.late_penalty_pct > 0 ? ` · late work loses ${h.late_penalty_pct}% a day (up to ${h.late_penalty_max}%)` : ""}{h.max_attempts > 1 ? ` · up to ${h.max_attempts} tries` : ""}</span></span>
            {s?.status === "marked" ? <Badge tone="green">Marked{s.score !== null ? `: ${s.score}${h.max_score ? `/${h.max_score}` : ""}` : ""}</Badge>
              : s?.status === "returned" ? <Badge tone="amber">Sent back to improve</Badge>
              : s ? <Badge tone="blue">Handed in{s.attempt > 1 ? ` (try ${s.attempt})` : ""}</Badge>
              : overdue ? <Badge tone="red">Overdue</Badge> : <Badge tone="amber">To do</Badge>}
          </div>
          {s?.status === "returned" && s.returned_note && <p className="mt-2 rounded bg-amber-50 p-2 text-xs"><b>Your teacher says:</b> {s.returned_note}</p>}
          {s?.status === "marked" && s.penalty_pct > 0 && s.raw_score !== null && <p className="mt-1 text-xs text-slate-600">{s.raw_score} before the late penalty of {s.penalty_pct}%.</p>}
          {s?.feedback && <p className="mt-2 rounded bg-emerald-50 p-2 text-xs"><b>Feedback:</b> {s.feedback}</p>}
          {s && s.feedback_media.length > 0 && (
            <div className="mt-2 space-y-1">{s.feedback_media.map(m => m.type.startsWith("video")
              ? <video key={m.index} controls preload="none" className="max-h-60 w-full rounded" src={`/api/homework/submission?sub=${s.id}&media=${m.index}`} />
              : <audio key={m.index} controls preload="none" className="w-full" src={`/api/homework/submission?sub=${s.id}&media=${m.index}`} />)}</div>
          )}
          <button className="mt-2 text-xs text-brand-700 underline" onClick={() => { setOpen(open === h.id ? null : h.id); setText(s?.status === "returned" ? s.body ?? "" : ""); setMsg(null); }}>{open === h.id ? "Close" : s ? "Open" : "Start"}</button>
          {open === h.id && (
            <div className="mt-2 space-y-2">
              {h.instructions && <div className="rounded bg-slate-50 p-2"><RichText text={h.instructions} /></div>}
              {h.attachment_url && <a className="text-xs text-brand-700 underline" href={h.attachment_url} target="_blank" rel="noreferrer">Open attachment</a>}
              {s?.body && <div><p className="text-xs font-semibold text-slate-500">Your answer</p><AnnotatedAnswer text={s.body} notes={s.annotations} /></div>}
              {s && s.files.length > 0 && (
                <ul className="space-y-1">{s.files.map(f => {
                  const pins = s.annotations.filter(n => n.kind === "pin" && n.file_index === f.index);
                  return (
                    <li key={f.index}>
                      <a className="text-xs text-brand-700 underline" href={`/api/homework/submission?sub=${s.id}&file=${f.index}`} target="_blank" rel="noreferrer">{f.name}</a>
                      {f.type.startsWith("image/") && pins.length > 0 && (
                        <div className="relative mt-1 inline-block max-w-full">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={`/api/homework/submission?sub=${s.id}&file=${f.index}`} alt={f.name} className="max-h-96 rounded" />
                          {pins.map((p, i) => <span key={p.id} className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-white" style={{ left: `${p.x}%`, top: `${p.y}%` }} title={p.comment}>{i + 1}</span>)}
                          <ol className="mt-1 list-decimal pl-5 text-xs text-amber-900">{pins.map(p => <li key={p.id}>{p.comment}</li>)}</ol>
                        </div>
                      )}
                    </li>
                  );
                })}</ul>
              )}
              {canHandIn && (
                <form className="space-y-2" onSubmit={async e => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  fd.set("homework_id", h.id);
                  fd.set("body", text);
                  setBusy(true);
                  const r = await fetch("/api/homework/submission", { method: "POST", body: fd });
                  const j = await r.json().catch(() => ({}));
                  setBusy(false);
                  setMsg({ ok: r.ok, text: r.ok ? (j.late_days ? `Handed in ${j.late_days} day${j.late_days === 1 ? "" : "s"} late${j.penalty_pct ? ` (${j.penalty_pct}% penalty)` : ""}.` : "Handed in.") : j.error ?? "failed" });
                  if (r.ok) { setText(""); reload(); }
                }}>
                  {s && <p className="text-xs text-slate-500">This will be try {s.attempt + 1} of {h.max_attempts}. Your earlier try is kept.</p>}
                  <textarea className="input h-32" value={text} onChange={e => setText(e.target.value)} placeholder="Type your answer" aria-label="Your answer" />
                  {h.accept_files && <input className="input" type="file" name="files" multiple accept="application/pdf,image/*,audio/*,video/*,.docx,.pptx" aria-label="Attach work (up to 5 files, 20 MB each)" />}
                  <div className="flex flex-wrap items-center gap-2">
                    <button className="btn btn-primary" disabled={busy}>{busy ? "Sending…" : s ? "Hand in again" : "Hand in"}</button>

                  </div>
                </form>
              )}
              {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
            </div>
          )}
        </li>
      );
    })}</ul>
  );
}
