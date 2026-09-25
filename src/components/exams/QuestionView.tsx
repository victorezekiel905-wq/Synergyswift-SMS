"use client";
import { useState } from "react";

export type PublicQuestion = {
  id: string; type: string; prompt: string; points: number; media_url: string | null; section: string | null;
  data: Record<string, any>;
};

type Props = {
  q: PublicQuestion;
  value: any;
  onChange: (v: any) => void;
  disabled?: boolean;
  spellcheck?: boolean;
  onUpload?: (file: File) => Promise<void>;
};

const wc = (s: string) => String(s ?? "").trim().split(/\s+/).filter(Boolean).length;

/** Renders one question for answering (or read-only when disabled). */
export default function QuestionView({ q, value, onChange, disabled, spellcheck, onUpload }: Props) {
  const d = q.data ?? {};
  return (
    <div>
      <p className="whitespace-pre-wrap text-base leading-relaxed text-slate-900">{q.prompt}</p>
      {q.media_url && q.type !== "hotspot" && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={q.media_url} alt="" className="mt-3 max-h-80 max-w-full rounded border border-slate-200" />
      )}
      <div className="mt-4">
        {q.type === "mcq_single" && (
          <div className="space-y-2" role="radiogroup">
            {(d.options ?? []).map((o: { id: string; text: string }, i: number) => (
              <label key={o.id} className={"flex cursor-pointer items-center gap-3 rounded-lg border p-3 " + (value === o.id ? "border-brand-500 bg-brand-50" : "border-slate-200 hover:bg-slate-50")}>
                <input type="radio" name={q.id} checked={value === o.id} disabled={disabled} onChange={() => onChange(o.id)} />
                <span className="w-5 font-bold text-slate-400">{String.fromCharCode(65 + i)}</span><span>{o.text}</span>
              </label>
            ))}
          </div>
        )}
        {q.type === "mcq_multi" && (
          <div className="space-y-2">
            <p className="text-xs text-slate-500">Select all that apply.</p>
            {(d.options ?? []).map((o: { id: string; text: string }, i: number) => {
              const arr: string[] = Array.isArray(value) ? value : [];
              const on = arr.includes(o.id);
              return (
                <label key={o.id} className={"flex cursor-pointer items-center gap-3 rounded-lg border p-3 " + (on ? "border-brand-500 bg-brand-50" : "border-slate-200 hover:bg-slate-50")}>
                  <input type="checkbox" checked={on} disabled={disabled} onChange={e => onChange(e.target.checked ? [...arr, o.id] : arr.filter(x => x !== o.id))} />
                  <span className="w-5 font-bold text-slate-400">{String.fromCharCode(65 + i)}</span><span>{o.text}</span>
                </label>
              );
            })}
          </div>
        )}
        {q.type === "true_false" && (
          <div className="flex gap-3">
            {[true, false].map(b => (
              <label key={String(b)} className={"flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border p-4 font-semibold " + (value === b ? "border-brand-500 bg-brand-50" : "border-slate-200")}>
                <input type="radio" name={q.id} checked={value === b} disabled={disabled} onChange={() => onChange(b)} /> {b ? "True" : "False"}
              </label>
            ))}
          </div>
        )}
        {q.type === "short_answer" && (
          <input className="input max-w-xl" value={value ?? ""} maxLength={d.max_length ?? 200} disabled={disabled} spellCheck={spellcheck} autoComplete="off"
            onChange={e => onChange(e.target.value)} aria-label="Your answer" />
        )}
        {q.type === "numeric" && (
          <div className="flex items-center gap-2">
            <input className="input max-w-[220px]" inputMode="decimal" value={value ?? ""} disabled={disabled} autoComplete="off" onChange={e => onChange(e.target.value)} aria-label="Your answer" />
            {d.unit && <span className="text-slate-600">{d.unit}</span>}
          </div>
        )}
        {q.type === "fill_blanks" && <FillBlanks text={d.text ?? ""} value={Array.isArray(value) ? value : []} onChange={onChange} disabled={disabled} spellcheck={spellcheck} />}
        {q.type === "matching" && (
          <div className="space-y-2">
            {(d.left ?? []).map((l: { id: string; text: string }) => (
              <div key={l.id} className="grid grid-cols-1 items-center gap-2 sm:grid-cols-2">
                <span className="rounded bg-slate-100 px-3 py-2">{l.text}</span>
                <select className="input" disabled={disabled} value={value?.[l.id] ?? ""} onChange={e => onChange({ ...(value ?? {}), [l.id]: e.target.value })} aria-label={`Match for ${l.text}`}>
                  <option value="">Choose…</option>
                  {(d.right ?? []).map((r: { id: string; text: string }) => <option key={r.id} value={r.id}>{r.text}</option>)}
                </select>
              </div>
            ))}
          </div>
        )}
        {q.type === "ordering" && <Ordering items={d.items ?? []} value={Array.isArray(value) && value.length ? value : (d.items ?? []).map((i: { id: string }) => i.id)} onChange={onChange} disabled={disabled} />}
        {q.type === "hotspot" && <Hotspot image={d.image_url ?? q.media_url} value={value} onChange={onChange} disabled={disabled} />}
        {q.type === "essay" && (
          <div>
            <textarea className="input min-h-[280px] text-base leading-relaxed" value={value ?? ""} disabled={disabled} spellCheck={spellcheck}
              onChange={e => onChange(e.target.value)} aria-label="Your answer" />
            <p className={"mt-1 text-xs " + ((d.max_words && wc(value) > d.max_words) || (d.min_words && wc(value) < d.min_words) ? "text-amber-600" : "text-slate-500")}>
              {wc(value)} words{d.min_words ? ` · minimum ${d.min_words}` : ""}{d.max_words ? ` · maximum ${d.max_words}` : ""}
            </p>
          </div>
        )}
        {q.type === "code" && (
          <textarea className="input min-h-[280px] bg-slate-900 font-mono text-sm text-emerald-100" spellCheck={false} disabled={disabled}
            value={value ?? d.starter ?? ""} aria-label={`Your ${d.language} code`}
            onChange={e => onChange(e.target.value)}
            onKeyDown={e => {
              if (e.key !== "Tab") return;
              e.preventDefault();
              const t = e.currentTarget, s = t.selectionStart, v = t.value;
              onChange(v.slice(0, s) + "    " + v.slice(t.selectionEnd));
              requestAnimationFrame(() => { t.selectionStart = t.selectionEnd = s + 4; });
            }} />
        )}
        {q.type === "file_upload" && <Upload accept={d.accept} maxMb={d.max_mb} value={value} disabled={disabled} onUpload={onUpload} />}
      </div>
    </div>
  );
}

function FillBlanks({ text, value, onChange, disabled, spellcheck }: { text: string; value: string[]; onChange: (v: string[]) => void; disabled?: boolean; spellcheck?: boolean }) {
  const parts = text.split(/(\[\[\d+\]\])/g);
  return (
    <p className="leading-[2.6]">
      {parts.map((p, i) => {
        const m = p.match(/^\[\[(\d+)\]\]$/);
        if (!m) return <span key={i} className="whitespace-pre-wrap">{p}</span>;
        const idx = Number(m[1]) - 1;
        return <input key={i} className="mx-1 inline-block w-36 rounded border-b-2 border-slate-400 bg-slate-50 px-2 py-0.5 focus:border-brand-600 focus:outline-none"
          value={value[idx] ?? ""} disabled={disabled} spellCheck={spellcheck} autoComplete="off" aria-label={`Blank ${idx + 1}`}
          onChange={e => { const n = [...value]; n[idx] = e.target.value; onChange(n); }} />;
      })}
    </p>
  );
}

function Ordering({ items, value, onChange, disabled }: { items: { id: string; text: string }[]; value: string[]; onChange: (v: string[]) => void; disabled?: boolean }) {
  const byId = new Map(items.map(i => [i.id, i]));
  const move = (i: number, d: number) => { const n = [...value]; const j = i + d; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j], n[i]]; onChange(n); };
  return (
    <ol className="space-y-2">
      {value.map((id, i) => (
        <li key={id} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-2">
          <span className="w-6 text-center font-bold text-slate-400">{i + 1}</span>
          <span className="flex-1">{byId.get(id)?.text}</span>
          <button type="button" className="btn btn-ghost px-2 py-1" disabled={disabled || i === 0} onClick={() => move(i, -1)} aria-label="Move up">↑</button>
          <button type="button" className="btn btn-ghost px-2 py-1" disabled={disabled || i === value.length - 1} onClick={() => move(i, 1)} aria-label="Move down">↓</button>
        </li>
      ))}
    </ol>
  );
}

function Hotspot({ image, value, onChange, disabled }: { image: string | null; value: { x: number; y: number } | null; onChange: (v: { x: number; y: number }) => void; disabled?: boolean }) {
  if (!image) return <p className="text-sm text-slate-500">Image missing.</p>;
  return (
    <div className="relative inline-block max-w-full cursor-crosshair" onClick={e => {
      if (disabled) return;
      const r = e.currentTarget.getBoundingClientRect();
      onChange({ x: Math.round(((e.clientX - r.left) / r.width) * 1000) / 10, y: Math.round(((e.clientY - r.top) / r.height) * 1000) / 10 });
    }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={image} alt="Click the correct area" className="max-h-[460px] max-w-full select-none" draggable={false} />
      {value && <span className="absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-rose-600 shadow" style={{ left: `${value.x}%`, top: `${value.y}%` }} />}
      <p className="mt-1 text-xs text-slate-500">Click on the image to place your answer.</p>
    </div>
  );
}

function Upload({ accept, maxMb, value, disabled, onUpload }: { accept: string; maxMb: number; value: { name: string; size: number } | null; disabled?: boolean; onUpload?: (f: File) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      {value?.name && <p className="text-sm">Uploaded: <b>{value.name}</b> ({Math.round((value.size ?? 0) / 1024)} KB)</p>}
      {!disabled && (
        <input type="file" accept={accept} disabled={busy} aria-label="Upload file" onChange={async e => {
          const f = e.target.files?.[0];
          if (!f || !onUpload) return;
          if (f.size > maxMb * 1024 * 1024) { setErr(`File is larger than ${maxMb} MB.`); return; }
          setBusy(true); setErr(null);
          try { await onUpload(f); } catch (x) { setErr((x as Error).message); }
          setBusy(false);
        }} />
      )}
      <p className="text-xs text-slate-500">Allowed: {accept} · up to {maxMb} MB{busy ? " · uploading…" : ""}</p>
      {err && <p className="text-sm text-rose-600">{err}</p>}
    </div>
  );
}
