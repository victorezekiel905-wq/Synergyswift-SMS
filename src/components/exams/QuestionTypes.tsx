"use client";
import { useEffect, useRef, useState } from "react";
import { passageWords } from "@/lib/exams/words";
import { formatFormula, CHEM_KEYS } from "@/lib/exams/chem";

type Opt = { id: string; text: string };

/* ---------------- Grid (matrix) ---------------- */

export function MatrixInput({ rows, cols, value, onChange, disabled }: { rows: Opt[]; cols: Opt[]; value: Record<string, string>; onChange: (v: Record<string, string>) => void; disabled?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] border-collapse text-sm">
        <thead>
          <tr><th className="p-2 text-left font-medium text-slate-500" />{cols.map(c => <th key={c.id} className="p-2 text-center font-semibold">{c.text}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id} className="border-t border-slate-200">
              <td className="p-2">{r.text}</td>
              {cols.map(c => (
                <td key={c.id} className="p-2 text-center">
                  <input type="radio" name={`m-${r.id}`} checked={value?.[r.id] === c.id} disabled={disabled} aria-label={`${r.text}: ${c.text}`}
                    className="h-5 w-5" onChange={() => onChange({ ...(value ?? {}), [r.id]: c.id })} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------- Select words ---------------- */

export function HighlightInput({ text, instruction, value, onChange, disabled }: { text: string; instruction?: string | null; value: number[]; onChange: (v: number[]) => void; disabled?: boolean }) {
  const words = passageWords(text);
  const chosen = new Set(Array.isArray(value) ? value : []);
  return (
    <div>
      <p className="mb-2 text-xs text-slate-500">{instruction || "Click the words to select them. Click again to unselect."}</p>
      <p className="rounded-lg border border-slate-200 bg-white p-4 text-base leading-loose">
        {words.map((w, i) => (
          <span key={i}>
            <button type="button" disabled={disabled} aria-pressed={chosen.has(i)} onClick={() => { const n = new Set(chosen); n.has(i) ? n.delete(i) : n.add(i); onChange([...n].sort((a, b) => a - b)); }}
              className={"rounded px-0.5 " + (chosen.has(i) ? "bg-amber-200 text-slate-900 ring-1 ring-amber-400" : "hover:bg-slate-100")}>{w}</button>{" "}
          </span>
        ))}
      </p>
      <p className="mt-1 text-xs text-slate-500">{chosen.size} selected</p>
    </div>
  );
}

/* ---------------- Label the diagram ---------------- */

export function LabelImageInput({ image, pins, labels, value, onChange, disabled }: { image: string | null; pins: { id: string; x: number; y: number }[]; labels: Opt[]; value: Record<string, string>; onChange: (v: Record<string, string>) => void; disabled?: boolean }) {
  if (!image) return <p className="text-sm text-slate-500">Diagram missing.</p>;
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
      <div className="relative inline-block max-w-full self-start">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image} alt="Diagram to label" className="max-h-[460px] max-w-full rounded border border-slate-200" draggable={false} />
        {pins.map((p, i) => (
          <span key={p.id} className="absolute grid h-7 w-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-white bg-brand-700 text-xs font-bold text-white shadow" style={{ left: `${p.x}%`, top: `${p.y}%` }}>{i + 1}</span>
        ))}
      </div>
      <ol className="space-y-2">
        {pins.map((p, i) => (
          <li key={p.id} className="flex items-center gap-2">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-700 text-xs font-bold text-white">{i + 1}</span>
            <select className="input" disabled={disabled} value={value?.[p.id] ?? ""} aria-label={`Label for point ${i + 1}`} onChange={e => onChange({ ...(value ?? {}), [p.id]: e.target.value })}>
              <option value="">Choose a label…</option>
              {labels.map(l => <option key={l.id} value={l.id}>{l.text}</option>)}
            </select>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ---------------- Plot points ---------------- */

type Pt = { x: number; y: number };
type GraphData = { x_min: number; x_max: number; y_min: number; y_max: number; step: number; snap: boolean; join: boolean; x_label: string; y_label: string; count?: number };

export function GraphPlotInput({ d, value, onChange, disabled }: { d: GraphData; value: Pt[]; onChange: (v: Pt[]) => void; disabled?: boolean }) {
  const pts: Pt[] = Array.isArray(value) ? value : [];
  const W = 560, H = 420, pad = 36;
  const sx = (x: number) => pad + ((x - d.x_min) / (d.x_max - d.x_min)) * (W - 2 * pad);
  const sy = (y: number) => H - pad - ((y - d.y_min) / (d.y_max - d.y_min)) * (H - 2 * pad);
  const step = d.step > 0 ? d.step : 1;
  const ticks = (lo: number, hi: number) => { const out: number[] = []; const first = Math.ceil(lo / step) * step; for (let v = first; v <= hi + 1e-9 && out.length < 201; v += step) out.push(Math.round(v * 1e6) / 1e6); return out; };
  const xs = ticks(d.x_min, d.x_max), ys = ticks(d.y_min, d.y_max);
  const labelEvery = Math.max(1, Math.ceil(xs.length / 12)), labelEveryY = Math.max(1, Math.ceil(ys.length / 12));
  const round = (v: number) => (d.snap ? Math.round(v / step) * step : Math.round(v * 100) / 100);
  const click = (e: React.MouseEvent<SVGSVGElement>) => {
    if (disabled) return;
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W, py = ((e.clientY - r.top) / r.height) * H;
    const x = round(d.x_min + ((px - pad) / (W - 2 * pad)) * (d.x_max - d.x_min));
    const y = round(d.y_min + ((H - pad - py) / (H - 2 * pad)) * (d.y_max - d.y_min));
    if (x < d.x_min || x > d.x_max || y < d.y_min || y > d.y_max) return;
    const near = pts.findIndex(p => Math.abs(sx(p.x) - sx(x)) < 8 && Math.abs(sy(p.y) - sy(y)) < 8);
    if (near >= 0) onChange(pts.filter((_, i) => i !== near));
    else onChange([...pts, { x: Math.round(x * 1e6) / 1e6, y: Math.round(y * 1e6) / 1e6 }]);
  };
  const line = [...pts].sort((a, b) => a.x - b.x).map(p => `${sx(p.x)},${sy(p.y)}`).join(" ");
  const axisX = d.y_min <= 0 && d.y_max >= 0 ? sy(0) : H - pad, axisY = d.x_min <= 0 && d.x_max >= 0 ? sx(0) : pad;
  return (
    <div>
      {!disabled && <p className="mb-2 text-xs text-slate-500">Click the grid to plot a point{d.count ? ` (${d.count} needed)` : ""}. Click a point again to remove it.{d.snap ? " Points snap to the grid." : ""}</p>}
      <svg viewBox={`0 0 ${W} ${H}`} className={"w-full max-w-[640px] touch-manipulation rounded-lg border border-slate-200 bg-white " + (disabled ? "" : "cursor-crosshair")} onClick={click} role="img" aria-label="Graph paper">
        {xs.map(v => <line key={`x${v}`} x1={sx(v)} x2={sx(v)} y1={pad} y2={H - pad} stroke={Math.round(v / step) % 5 === 0 ? "#cbd5e1" : "#e8edf3"} />)}
        {ys.map(v => <line key={`y${v}`} y1={sy(v)} y2={sy(v)} x1={pad} x2={W - pad} stroke={Math.round(v / step) % 5 === 0 ? "#cbd5e1" : "#e8edf3"} />)}
        <line x1={pad} x2={W - pad} y1={axisX} y2={axisX} stroke="#334155" strokeWidth={1.5} />
        <line y1={pad} y2={H - pad} x1={axisY} x2={axisY} stroke="#334155" strokeWidth={1.5} />
        {xs.filter((_, i) => i % labelEvery === 0).map(v => <text key={`lx${v}`} x={sx(v)} y={Math.min(H - 8, axisX + 14)} fontSize="10" textAnchor="middle" fill="#64748b">{v}</text>)}
        {ys.filter((_, i) => i % labelEveryY === 0).map(v => v !== 0 && <text key={`ly${v}`} x={Math.max(14, axisY - 6)} y={sy(v) + 3} fontSize="10" textAnchor="end" fill="#64748b">{v}</text>)}
        <text x={W - pad} y={axisX - 6} fontSize="12" textAnchor="end" fill="#0f172a" fontStyle="italic">{d.x_label}</text>
        <text x={axisY + 6} y={pad - 8} fontSize="12" fill="#0f172a" fontStyle="italic">{d.y_label}</text>
        {d.join && pts.length > 1 && <polyline points={line} fill="none" stroke="#2f4f8f" strokeWidth={2} />}
        {pts.map((p, i) => (
          <g key={i}>
            <line x1={sx(p.x) - 5} x2={sx(p.x) + 5} y1={sy(p.y) - 5} y2={sy(p.y) + 5} stroke="#be123c" strokeWidth={2.5} />
            <line x1={sx(p.x) - 5} x2={sx(p.x) + 5} y1={sy(p.y) + 5} y2={sy(p.y) - 5} stroke="#be123c" strokeWidth={2.5} />
          </g>
        ))}
      </svg>
      <p className="mt-1 text-xs text-slate-600">Plotted: {pts.length ? pts.map(p => `(${p.x}, ${p.y})`).join("  ") : "none yet"}</p>
    </div>
  );
}

/* ---------------- Chemical equation ---------------- */

export function FormulaText({ text }: { text: string }) {
  return <>{formatFormula(text).map((p, i) => p.sub ? <sub key={i}>{p.t}</sub> : p.sup ? <sup key={i}>{p.t}</sup> : <span key={i}>{p.t}</span>)}</>;
}

export function ChemEquationInput({ value, onChange, disabled, hint }: { value: string; onChange: (v: string) => void; disabled?: boolean; hint?: string | null }) {
  const ref = useRef<HTMLInputElement>(null);
  const insert = (s: string) => {
    const el = ref.current, v = value ?? "";
    if (!el) return onChange(v + s);
    const a = el.selectionStart ?? v.length, b = el.selectionEnd ?? v.length;
    onChange(v.slice(0, a) + s + v.slice(b));
    requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = a + s.length; });
  };
  return (
    <div className="space-y-2">
      {hint && <p className="text-sm text-slate-600">{hint}</p>}
      <input ref={ref} className="input max-w-2xl font-mono text-lg" value={value ?? ""} disabled={disabled} autoComplete="off" spellCheck={false}
        placeholder="For example 2H2 + O2 → 2H2O" aria-label="Your equation" onChange={e => onChange(e.target.value)} />
      {!disabled && (
        <div className="flex flex-wrap gap-1" aria-label="Chemistry keys">
          {CHEM_KEYS.map(([label, t]) => <button key={label} type="button" className="btn btn-ghost border border-slate-200 px-2.5 py-1 font-mono text-sm" onClick={() => insert(t)}>{label}</button>)}
        </div>
      )}
      {value && <p className="text-lg" aria-label="How your equation reads"><span className="mr-2 text-xs text-slate-500">Reads as:</span><FormulaText text={value} /></p>}
      {!disabled && <p className="text-xs text-slate-500">Type numbers normally (H2O); they show as subscripts. Write charges with ^, for example Fe^3+ or SO4^2-.</p>}
    </div>
  );
}

/* ---------------- Rating ---------------- */

export function RatingInput({ min, max, minLabel, maxLabel, value, onChange, disabled }: { min: number; max: number; minLabel?: string | null; maxLabel?: string | null; value: number | null; onChange: (v: number) => void; disabled?: boolean }) {
  const vals = Array.from({ length: Math.max(0, Math.min(11, max - min + 1)) }, (_, i) => min + i);
  return (
    <div>
      <div className="flex flex-wrap gap-2" role="radiogroup">
        {vals.map(v => (
          <button key={v} type="button" role="radio" aria-checked={value === v} disabled={disabled} onClick={() => onChange(v)}
            className={"h-11 min-w-[44px] rounded-lg border px-3 text-base font-semibold " + (value === v ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 bg-white hover:border-brand-400")}>{v}</button>
        ))}
      </div>
      {(minLabel || maxLabel) && <div className="mt-1 flex max-w-md justify-between text-xs text-slate-500"><span>{minLabel}</span><span>{maxLabel}</span></div>}
    </div>
  );
}

/* ---------------- Drawing pad (answers and rough work) ---------------- */

export type Stroke = { t: "pen" | "line" | "circle" | "rect" | "text"; c: string; p: number[]; s?: string };
export type Drawing = { w: number; h: number; strokes: Stroke[] };

const DW = 800, DH = 520, UNIT = 40; // one grid square = 40 px = "1 unit" (1 cm on the grid)
const COLOURS = ["#0f172a", "#2f4f8f", "#be123c", "#15803d"];

function strokeSvg(s: Stroke, k: number) {
  const p = s.p;
  if (s.t === "pen") return <polyline key={k} points={p.join(" ")} fill="none" stroke={s.c} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />;
  if (s.t === "line") return <line key={k} x1={p[0]} y1={p[1]} x2={p[2]} y2={p[3]} stroke={s.c} strokeWidth={2} />;
  if (s.t === "circle") return <circle key={k} cx={p[0]} cy={p[1]} r={Math.hypot(p[2] - p[0], p[3] - p[1])} fill="none" stroke={s.c} strokeWidth={2} />;
  if (s.t === "rect") return <rect key={k} x={Math.min(p[0], p[2])} y={Math.min(p[1], p[3])} width={Math.abs(p[2] - p[0])} height={Math.abs(p[3] - p[1])} fill="none" stroke={s.c} strokeWidth={2} />;
  return <text key={k} x={p[0]} y={p[1]} fill={s.c} fontSize={20} fontFamily="inherit">{s.s}</text>;
}

/** Measurements while drawing: length in grid units, angle from the horizontal. */
function measure(p: number[]) {
  const dx = p[2] - p[0], dy = p[3] - p[1];
  const len = Math.hypot(dx, dy) / UNIT;
  let ang = (Math.atan2(-dy, dx) * 180) / Math.PI;
  if (ang < 0) ang += 360;
  return { len: Math.round(len * 10) / 10, ang: Math.round(ang) };
}

export function DrawingPad({ value, onChange, disabled, grid = "square", background, maxBytes = 120_000, label = "Drawing area" }: { value: Drawing | null; onChange: (v: Drawing) => void; disabled?: boolean; grid?: string; background?: string | null; maxBytes?: number; label?: string }) {
  const strokes: Stroke[] = value?.strokes ?? [];
  const [tool, setTool] = useState<Stroke["t"]>("pen");
  const [colour, setColour] = useState(COLOURS[0]);
  const [draft, setDraft] = useState<Stroke | null>(null);
  const [full, setFull] = useState(false);
  const [words, setWords] = useState("");
  const [armClear, setArmClear] = useState(false);
  const [warn, setWarn] = useState<string | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const pos = (e: React.PointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    return [Math.round(((e.clientX - r.left) / r.width) * DW), Math.round(((e.clientY - r.top) / r.height) * DH)];
  };
  const commit = (s: Stroke) => {
    const next = { w: DW, h: DH, strokes: [...strokes, s] };
    // No alert/prompt/confirm here: browser dialogs take focus and would count as leaving the exam.
    if (JSON.stringify(next).length > maxBytes) { setWarn("The drawing is full. Use Undo or Clear to make room."); return; }
    setWarn(null);
    onChange(next);
  };
  const down = (e: React.PointerEvent) => {
    if (disabled) return;
    const [x, y] = pos(e);
    if (tool === "text") {
      if (words.trim()) commit({ t: "text", c: colour, p: [x, y], s: words.trim().slice(0, 80) });
      else setWarn("Type the text first, then click where it goes.");
      return;
    }
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDraft({ t: tool, c: colour, p: tool === "pen" ? [x, y] : [x, y, x, y] });
  };
  const move = (e: React.PointerEvent) => {
    if (!draft) return;
    const [x, y] = pos(e);
    if (draft.t === "pen") {
      const p = draft.p, lx = p[p.length - 2], ly = p[p.length - 1];
      if (Math.hypot(x - lx, y - ly) >= 3) setDraft({ ...draft, p: [...p, x, y] });
    } else setDraft({ ...draft, p: [draft.p[0], draft.p[1], x, y] });
  };
  const up = () => {
    if (!draft) return;
    const p = draft.p;
    const tiny = draft.t !== "pen" && Math.hypot(p[2] - p[0], p[3] - p[1]) < 3;
    if (!tiny && p.length >= 4) commit(draft);
    setDraft(null);
  };
  const m = draft && draft.t !== "pen" && draft.p.length === 4 ? measure(draft.p) : null;
  const gridLines = grid === "none" ? null : (
    <g>
      {Array.from({ length: Math.floor(DW / (UNIT / (grid === "graph" ? 4 : 1))) + 1 }, (_, i) => i * (UNIT / (grid === "graph" ? 4 : 1))).map((x, i) => <line key={`gx${i}`} x1={x} x2={x} y1={0} y2={DH} stroke={grid === "graph" && i % 4 ? "#f1f5f9" : "#e2e8f0"} />)}
      {Array.from({ length: Math.floor(DH / (UNIT / (grid === "graph" ? 4 : 1))) + 1 }, (_, i) => i * (UNIT / (grid === "graph" ? 4 : 1))).map((y, i) => <line key={`gy${i}`} y1={y} y2={y} x1={0} x2={DW} stroke={grid === "graph" && i % 4 ? "#f1f5f9" : "#e2e8f0"} />)}
    </g>
  );
  const TOOLS: [Stroke["t"], string][] = [["pen", "Pen"], ["line", "Ruler line"], ["circle", "Compass circle"], ["rect", "Rectangle"], ["text", "Text"]];
  return (
    <div className={full ? "fixed inset-0 z-50 overflow-auto bg-white p-4" : ""}>
      {!disabled && (
        <div className="mb-2 flex flex-wrap items-center gap-1">
          {TOOLS.map(([t, l]) => <button key={t} type="button" onClick={() => setTool(t)} aria-pressed={tool === t} className={"btn px-2.5 py-1 text-xs " + (tool === t ? "btn-primary" : "btn-ghost border border-slate-200")}>{l}</button>)}
          <span className="mx-1 h-5 w-px bg-slate-200" />
          {COLOURS.map(c => <button key={c} type="button" onClick={() => setColour(c)} aria-label={`Colour ${c}`} aria-pressed={colour === c} className={"h-6 w-6 rounded-full border-2 " + (colour === c ? "border-brand-600" : "border-white ring-1 ring-slate-300")} style={{ background: c }} />)}
          <span className="mx-1 h-5 w-px bg-slate-200" />
          <button type="button" className="btn btn-ghost border border-slate-200 px-2.5 py-1 text-xs" disabled={!strokes.length} onClick={() => onChange({ w: DW, h: DH, strokes: strokes.slice(0, -1) })}>Undo</button>
          <button type="button" className={"btn border px-2.5 py-1 text-xs " + (armClear ? "border-rose-300 bg-rose-50 text-rose-700" : "btn-ghost border-slate-200")} disabled={!strokes.length}
            onClick={() => { if (armClear) { onChange({ w: DW, h: DH, strokes: [] }); setArmClear(false); } else { setArmClear(true); setTimeout(() => setArmClear(false), 3000); } }}>{armClear ? "Tap again to clear" : "Clear"}</button>
          <button type="button" className="btn btn-ghost border border-slate-200 px-2.5 py-1 text-xs" onClick={() => setFull(f => !f)}>{full ? "Exit full screen" : "Bigger"}</button>
          {tool === "text" && <input className="input w-40 py-1 text-xs" value={words} maxLength={80} onChange={e => setWords(e.target.value)} placeholder="Text, then click" aria-label="Text to place" />}
          {m && <span className="ml-2 rounded bg-slate-900 px-2 py-0.5 font-mono text-xs text-white">{draft?.t === "circle" ? `radius ${m.len}` : `${m.len} units · ${m.ang}°`}</span>}
        </div>
      )}
      <svg ref={svg} viewBox={`0 0 ${DW} ${DH}`} aria-label={label} role="img"
        className={"w-full touch-none rounded-lg border border-slate-300 bg-white " + (disabled ? "" : "cursor-crosshair")}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}>
        {background && <image href={background} x={0} y={0} width={DW} height={DH} preserveAspectRatio="xMidYMid meet" />}
        {gridLines}
        {strokes.map(strokeSvg)}
        {draft && strokeSvg(draft, -1)}
      </svg>
      {warn && <p className="mt-1 text-xs text-rose-600">{warn}</p>}
      {!disabled && <p className="mt-1 text-xs text-slate-500">One grid square is 1 unit. Lines show their length and angle as you draw; circles show their radius.</p>}
    </div>
  );
}

/* ---------------- Spoken answer ---------------- */

export function AudioAnswer({ maxSeconds, value, disabled, onUpload, playUrl }: { maxSeconds: number; value: { name?: string; size?: number; seconds?: number } | null; disabled?: boolean; onUpload?: (f: File) => Promise<void>; playUrl?: string | null }) {
  const [rec, setRec] = useState<MediaRecorder | null>(null);
  const [secs, setSecs] = useState(0);
  const [local, setLocal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const chunks = useRef<Blob[]>([]);
  const started = useRef(0);
  useEffect(() => {
    if (!rec) return;
    const t = setInterval(() => {
      const s = Math.floor((Date.now() - started.current) / 1000);
      setSecs(s);
      if (s >= maxSeconds) rec.stop();
    }, 250);
    return () => clearInterval(t);
  }, [rec, maxSeconds]);
  useEffect(() => () => { if (local) URL.revokeObjectURL(local); }, [local]);

  async function start() {
    setErr(null);
    if (!onUpload) { setErr("Recording is not available here."); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find(t => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) ?? "";
      const r = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      chunks.current = [];
      r.ondataavailable = e => { if (e.data.size) chunks.current.push(e.data); };
      r.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        setRec(null);
        const blob = new Blob(chunks.current, { type: r.mimeType || "audio/webm" });
        const ext = blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm";
        setLocal(URL.createObjectURL(blob));
        setBusy(true);
        try { await onUpload(new File([blob], `answer-${Math.min(maxSeconds, Math.round((Date.now() - started.current) / 1000))}s.${ext}`, { type: blob.type })); }
        catch (e) { setErr((e as Error).message); }
        setBusy(false);
      };
      started.current = Date.now(); setSecs(0);
      r.start(1000);
      setRec(r);
    } catch { setErr("Allow microphone access in your browser, then try again."); }
  }
  const src = local ?? playUrl ?? null;
  return (
    <div className="space-y-2">
      {!disabled && (
        <div className="flex flex-wrap items-center gap-3">
          {rec
            ? <button type="button" className="btn bg-rose-600 text-white hover:bg-rose-700" onClick={() => rec.stop()}>Stop recording</button>
            : <button type="button" className="btn btn-primary" disabled={busy} onClick={start}>{value?.name ? "Record again" : "Start recording"}</button>}
          <span className="font-mono text-sm tabular-nums">{rec ? `● ${secs}s / ${maxSeconds}s` : busy ? "Saving…" : value?.name ? "Saved" : `Up to ${maxSeconds} seconds`}</span>
        </div>
      )}
      {src && <audio controls src={src} className="w-full max-w-md" />}
      {!src && disabled && <p className="text-sm text-slate-500">{value?.name ? "Recording saved." : "No recording."}</p>}
      {err && <p className="text-sm text-rose-600">{err}</p>}
    </div>
  );
}
