"use client";
import { useEffect, useRef, useState } from "react";
import { send, Alert, Badge, fmtDate } from "@/components/ui";
import { penalisedScore } from "@/lib/lms";

type Note = { id: string; kind: "text" | "pin"; start_offset: number | null; end_offset: number | null; quote: string | null; file_index: number | null; x: number | null; y: number | null; comment: string; author_id: string };
export type Submission = {
  id: string; body: string | null; files: { path: string; name: string; type: string; size: number }[]; submitted_at: string; late: boolean; attempt: number; status: string;
  score: number | null; raw_score: number | null; penalty_pct: number; feedback: string | null; returned_note: string | null;
  feedback_media: { type: string; seconds: number; created_at: string }[];
  originality: { similarity: number; matches: { student_id: string; share: number; passages: string[] }[]; style: { score: number; notes: string[] } | null; checked_at: string } | null;
  homework_submission_versions: { attempt: number; submitted_at: string; late: boolean; score: number | null }[];
};

/** Marking one student's work: comments on the text and on photos, a voice or video note, a drafted comment, originality, score with the late penalty. */
export default function MarkSubmission({ sub, maxScore, names, onSaved, canDraft }: { sub: Submission; maxScore: number | null; names: Record<string, string>; onSaved: () => void; canDraft: boolean }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [score, setScore] = useState(sub.raw_score != null ? String(sub.raw_score) : "");
  const [feedback, setFeedback] = useState(sub.feedback ?? "");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [sel, setSel] = useState<{ start: number; end: number; quote: string } | null>(null);
  const [pin, setPin] = useState<{ file: number; x: number; y: number } | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [orig, setOrig] = useState(sub.originality);
  const answerRef = useRef<HTMLDivElement>(null);

  const loadNotes = async () => {
    const r = await fetch(`/api/homework/annotations?sub=${sub.id}`).then(x => x.json()).catch(() => ({ items: [] }));
    setNotes(r.items ?? []);
  };
  // Reset the panel when a different submission is opened.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadNotes(); setScore(sub.raw_score != null ? String(sub.raw_score) : ""); setFeedback(sub.feedback ?? ""); setOrig(sub.originality); }, [sub.id]);
  const say = (ok: boolean, text: string) => setMsg({ ok, text });

  // Character offsets of the selection inside the answer.
  const onSelect = () => {
    const s = window.getSelection();
    const root = answerRef.current;
    if (!s || !root || s.isCollapsed || !root.contains(s.anchorNode)) return;
    const range = s.getRangeAt(0);
    const pre = range.cloneRange();
    pre.selectNodeContents(root);
    pre.setEnd(range.startContainer, range.startOffset);
    const start = pre.toString().length;
    const quote = range.toString();
    if (quote.trim()) { setSel({ start, end: start + quote.length, quote }); setPin(null); }
  };
  const addNote = async () => {
    if (!comment.trim()) return;
    const body = sel ? { kind: "text", start_offset: sel.start, end_offset: sel.end, quote: sel.quote.slice(0, 1000) } : pin ? { kind: "pin", file_index: pin.file, x: pin.x, y: pin.y } : null;
    if (!body) return;
    const r = await send("/api/homework/submission", { action: "annotate", submission_id: sub.id, ...body, comment });
    if (!r.ok) { say(false, r.error ?? "failed"); return; }
    setComment(""); setSel(null); setPin(null); loadNotes();
  };
  const textNotes = notes.filter(n => n.kind === "text").sort((a, b) => (a.start_offset ?? 0) - (b.start_offset ?? 0));
  const body = sub.body ?? "";
  const highlighted: React.ReactNode[] = [];
  let at = 0;
  textNotes.forEach((n, i) => {
    if ((n.start_offset ?? 0) < at) return;
    highlighted.push(body.slice(at, n.start_offset!));
    highlighted.push(<mark key={n.id} className="rounded bg-amber-100" title={n.comment}>{body.slice(n.start_offset!, n.end_offset!)}<sup className="text-[10px] font-bold text-amber-800">{i + 1}</sup></mark>);
    at = n.end_offset!;
  });
  highlighted.push(body.slice(at));
  const final = score === "" ? null : penalisedScore(Number(score), Number(sub.penalty_pct));

  return (
    <div className="space-y-3 text-sm">
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      <p className="text-xs text-slate-500">Handed in {fmtDate(sub.submitted_at, true)}{sub.late ? ` · late (${sub.penalty_pct}% penalty)` : ""}{sub.attempt > 1 ? ` · try ${sub.attempt}` : ""}
        {sub.homework_submission_versions?.length ? ` · earlier tries: ${sub.homework_submission_versions.map(v => `#${v.attempt}${v.score != null ? ` (${v.score})` : ""}`).join(", ")}` : ""}</p>
      {orig && (orig.similarity >= 0.15 || (orig.style && orig.style.score >= 0.5)) && (
        <Alert tone="amber">
          {orig.similarity >= 0.15 && <p><b>{Math.round(orig.similarity * 100)}% of this answer also appears in {orig.matches.length > 1 ? `${orig.matches.length} classmates' answers` : names[orig.matches[0]?.student_id] ?? "a classmate's answer"}.</b>
            {orig.matches[0]?.passages[0] && <span className="block text-xs">Shared passage: “{orig.matches[0].passages[0].slice(0, 200)}…”</span>}</p>}
          {orig.style && orig.style.score >= 0.5 && <p className="mt-1"><b>The writing style is unlike this student&apos;s earlier work.</b> <span className="block text-xs">{orig.style.notes.join("; ")}</span></p>}
          <p className="mt-1 text-xs">These are prompts to talk with the student, not proof of copying or of using a writing tool.</p>
        </Alert>
      )}
      {body && (
        <div>
          <p className="text-xs font-semibold text-slate-500">Answer: select words to comment on them</p>
          <div ref={answerRef} onMouseUp={onSelect} onTouchEnd={onSelect} className="whitespace-pre-wrap rounded border border-slate-200 bg-white p-3 leading-relaxed">{highlighted}</div>
        </div>
      )}
      {sub.files.map((f, i) => (
        <div key={i}>
          <a className="text-xs text-brand-700 underline" href={`/api/homework/submission?sub=${sub.id}&file=${i}`} target="_blank" rel="noreferrer">{f.name}</a>
          {f.type.startsWith("image/") && (
            <div className="relative mt-1 inline-block max-w-full cursor-crosshair" onClick={e => { const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect(); setPin({ file: i, x: Math.round(((e.clientX - r.left) / r.width) * 1000) / 10, y: Math.round(((e.clientY - r.top) / r.height) * 1000) / 10 }); setSel(null); }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/homework/submission?sub=${sub.id}&file=${i}`} alt={f.name} className="max-h-[32rem] rounded" />
              {notes.filter(n => n.kind === "pin" && n.file_index === i).map((p, k) => <span key={p.id} className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-white" style={{ left: `${p.x}%`, top: `${p.y}%` }} title={p.comment}>{k + 1}</span>)}
              {pin?.file === i && <span className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-brand-600 bg-white" style={{ left: `${pin.x}%`, top: `${pin.y}%` }} />}
            </div>
          )}
          {f.type.startsWith("audio/") && <audio controls preload="none" className="mt-1 w-full" src={`/api/homework/submission?sub=${sub.id}&file=${i}`} />}
          {f.type.startsWith("video/") && <video controls preload="none" className="mt-1 max-h-72 w-full rounded" src={`/api/homework/submission?sub=${sub.id}&file=${i}`} />}
        </div>
      ))}
      {(sel || pin) && (
        <div className="flex gap-2 rounded-lg bg-amber-50 p-2">
          <span className="text-xs">{sel ? `On “${sel.quote.slice(0, 60)}${sel.quote.length > 60 ? "…" : ""}”` : "On the marked spot"}</span>
          <input className="input flex-1 py-1" value={comment} onChange={e => setComment(e.target.value)} placeholder="Your comment" autoFocus aria-label="Comment" onKeyDown={e => e.key === "Enter" && addNote()} />
          <button className="btn btn-primary px-2 py-1 text-xs" onClick={addNote}>Add</button>
          <button className="text-xs" onClick={() => { setSel(null); setPin(null); }}>Cancel</button>
        </div>
      )}
      {notes.length > 0 && (
        <ol className="list-decimal space-y-0.5 pl-5 text-xs">{[...textNotes, ...notes.filter(n => n.kind === "pin")].map(n => (
          <li key={n.id}>{n.kind === "text" ? <i>“{(n.quote ?? "").slice(0, 50)}”</i> : <i>photo {(n.file_index ?? 0) + 1}</i>}: {n.comment}
            <button className="ml-2 text-rose-600" onClick={async () => { await send("/api/homework/submission", { action: "delete_annotation", id: n.id }); loadNotes(); }} aria-label="Delete comment">✕</button></li>
        ))}</ol>
      )}

      <Recorder submissionId={sub.id} existing={sub.feedback_media} onSaved={onSaved} say={say} />

      <div className="grid gap-2 sm:grid-cols-[8rem,1fr]">
        <label className="text-xs">Score{maxScore != null ? ` / ${maxScore}` : ""}
          <input className="input" type="number" min={0} max={maxScore ?? undefined} step="0.5" value={score} onChange={e => setScore(e.target.value)} />
          {sub.penalty_pct > 0 && final != null && <span className="block text-[11px] text-amber-800">After {sub.penalty_pct}% late penalty: {final}</span>}</label>
        <label className="text-xs">Feedback to the student<textarea className="input min-h-20" value={feedback} onChange={e => setFeedback(e.target.value)} maxLength={5000} /></label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="btn btn-primary" disabled={busy} onClick={async () => {
          setBusy(true);
          const r = await send("/api/homework", { action: "mark", submission_id: sub.id, score: score === "" ? null : Number(score), feedback: feedback || null });
          setBusy(false); say(r.ok, r.ok ? "Marked." : r.error ?? "failed"); if (r.ok) onSaved();
        }}>Save mark</button>
        <button className="btn btn-outline" disabled={busy} onClick={async () => {
          const note = prompt("What should the student improve before handing in again?", feedback);
          if (!note) return;
          const r = await send("/api/homework", { action: "return", submission_id: sub.id, note });
          say(r.ok, r.ok ? "Sent back. The student can hand in again." : r.error ?? "failed"); if (r.ok) onSaved();
        }}>Send back to improve</button>
        {canDraft && body.trim() && <button className="btn btn-outline" disabled={busy} onClick={async () => {
          setBusy(true);
          const r = await send<{ feedback: string; strengths: string[]; next_steps: string[]; suggested_score: number | null; note_for_teacher: string }>("/api/homework/submission", { action: "draft_feedback", submission_id: sub.id });
          setBusy(false);
          if (!r.ok) { say(false, r.error ?? "failed"); return; }
          setFeedback([r.data.feedback, r.data.next_steps.length ? `Next: ${r.data.next_steps.join(" ")}` : ""].filter(Boolean).join("\n\n"));
          if (r.data.suggested_score != null && score === "") setScore(String(r.data.suggested_score));
          say(true, `Draft added below: read and edit it before saving.${r.data.note_for_teacher ? ` Check: ${r.data.note_for_teacher}` : ""}`);
        }}>{busy ? "Working…" : "Draft feedback"}</button>}
        {body.trim() && <button className="btn btn-ghost text-xs" onClick={async () => { const r = await send<Submission["originality"]>("/api/homework/submission", { action: "check_originality", submission_id: sub.id }); if (r.ok) { setOrig(r.data); say(true, r.data && (r.data.similarity >= 0.15 || (r.data.style?.score ?? 0) >= 0.5) ? "Checked: see the note above." : "Checked: nothing unusual found."); } }}>Check originality</button>}
      </div>
    </div>
  );
}

/** Record a voice or video note for the student (up to five minutes). */
function Recorder({ submissionId, existing, onSaved, say }: { submissionId: string; existing: Submission["feedback_media"]; onSaved: () => void; say: (ok: boolean, t: string) => void }) {
  const [rec, setRec] = useState<MediaRecorder | null>(null);
  const [video, setVideo] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const chunks = useRef<Blob[]>([]);
  const started = useRef(0);
  const timer = useRef<number | null>(null);
  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(video ? { audio: true, video: { width: 640, height: 360 } } : { audio: true });
      const type = video ? (MediaRecorder.isTypeSupported("video/webm") ? "video/webm" : "video/mp4") : (MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4");
      const r = new MediaRecorder(stream, { mimeType: type, audioBitsPerSecond: 48_000, videoBitsPerSecond: 500_000 });
      chunks.current = [];
      r.ondataavailable = e => e.data.size && chunks.current.push(e.data);
      r.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        if (timer.current) window.clearInterval(timer.current);
        const blob = new Blob(chunks.current, { type: r.mimeType });
        const fd = new FormData();
        fd.set("submission_id", submissionId);
        fd.set("seconds", String(Math.round((Date.now() - started.current) / 1000)));
        fd.set("file", new File([blob], `feedback.${blob.type.includes("mp4") ? "mp4" : "webm"}`, { type: blob.type }));
        const res = await fetch("/api/homework/submission", { method: "POST", body: fd });
        const j = await res.json().catch(() => ({}));
        say(res.ok, res.ok ? "Recording saved. The student hears it once the work is marked or sent back." : j.error ?? "the recording was not saved");
        setRec(null); setSeconds(0);
        if (res.ok) onSaved();
      };
      started.current = Date.now();
      r.start(1000);
      setRec(r);
      timer.current = window.setInterval(() => {
        const s = Math.round((Date.now() - started.current) / 1000);
        setSeconds(s);
        if (s >= 300) r.stop();
      }, 500);
    } catch { say(false, "Allow the microphone (and camera for video) to record feedback."); }
  };
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 p-2">
      <span className="text-xs font-semibold">Spoken feedback</span>
      {existing.map((m, i) => <span key={i} className="flex items-center gap-1">
        {m.type.startsWith("video") ? <video controls preload="none" className="h-24 rounded" src={`/api/homework/submission?sub=${submissionId}&media=${i}`} /> : <audio controls preload="none" className="h-8" src={`/api/homework/submission?sub=${submissionId}&media=${i}`} />}
        <button className="text-xs text-rose-600" onClick={async () => { await send("/api/homework/submission", { action: "delete_media", submission_id: submissionId, index: i }); onSaved(); }} aria-label="Delete recording">✕</button></span>)}
      {rec ? <button className="btn btn-outline px-2 py-1 text-xs text-rose-700" onClick={() => rec.stop()}>Stop ({seconds}s)</button> : existing.length < 3 && <>
        <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={video} onChange={e => setVideo(e.target.checked)} /> with video</label>
        <button className="btn btn-outline px-2 py-1 text-xs" onClick={start}>Record</button></>}
      {rec && <Badge tone="red">recording</Badge>}
    </div>
  );
}
