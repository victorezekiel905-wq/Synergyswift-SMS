"use client";
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { EXAM_TOOLS, type ToolId } from "@/lib/exams/tools";
import { samplePlot } from "@/lib/exams/calc";
import { DrawingPad, type Drawing } from "../QuestionTypes";

// Each tool loads only when a student opens it, so the exam page itself stays small and fast.
const wait = () => <p className="w-48 text-sm text-slate-500">Loading…</p>;
const BasicCalculator = dynamic(() => import("./Calculators").then(m => m.BasicCalculator), { ssr: false, loading: wait });
const ScientificCalculator = dynamic(() => import("./Calculators").then(m => m.ScientificCalculator), { ssr: false, loading: wait });
const FourFigureTables = dynamic(() => import("./TablesTool").then(m => m.FourFigureTables), { ssr: false, loading: wait });
const NormalTable = dynamic(() => import("./TablesTool").then(m => m.NormalTable), { ssr: false, loading: wait });
const PeriodicTable = dynamic(() => import("./DataSheets").then(m => m.PeriodicTable), { ssr: false, loading: wait });
const ChemistryData = dynamic(() => import("./DataSheets").then(m => m.ChemistryData), { ssr: false, loading: wait });
const PhysicsData = dynamic(() => import("./DataSheets").then(m => m.PhysicsData), { ssr: false, loading: wait });
const MathFormulae = dynamic(() => import("./DataSheets").then(m => m.MathFormulae), { ssr: false, loading: wait });
const UnitConverter = dynamic(() => import("./DataSheets").then(m => m.UnitConverter), { ssr: false, loading: wait });
const MathSymbolsPad = dynamic(() => import("./DataSheets").then(m => m.MathSymbolsPad), { ssr: false, loading: wait });
const LanguagePad = dynamic(() => import("./DataSheets").then(m => m.LanguagePad), { ssr: false, loading: wait });
const GeometrySet = dynamic(() => import("./GeometrySet").then(m => m.GeometrySet), { ssr: false, loading: wait });

/* ---------- typing into the student's answer box ---------- */

let lastField: HTMLInputElement | HTMLTextAreaElement | null = null;

function trackFocus(e: FocusEvent) {
  const t = e.target as HTMLElement;
  if ((t instanceof HTMLInputElement && ["text", "search", ""].includes(t.type)) || t instanceof HTMLTextAreaElement) {
    if (!t.closest("[data-exam-tool]") && !t.dataset.examTool) lastField = t;
  }
}

/** Inserts text at the cursor of the last answer box and tells React about it. */
export function insertIntoAnswer(text: string) {
  const el = lastField;
  if (!el || !document.contains(el)) return false;
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  const a = el.selectionStart ?? el.value.length, b = el.selectionEnd ?? el.value.length;
  setter?.call(el, el.value.slice(0, a) + text + el.value.slice(b));
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.focus();
  el.setSelectionRange(a + text.length, a + text.length);
  return true;
}

/* ---------- small tools ---------- */

function GraphPlotter() {
  const [fns, setFns] = useState(["x^2 - 2x - 3", "", ""]);
  const [win, setWin] = useState({ x0: -10, x1: 10, y0: -10, y1: 10 });
  const [angle, setAngle] = useState<"rad" | "deg">("rad");
  const W = 420, H = 320;
  const sx = (x: number) => ((x - win.x0) / (win.x1 - win.x0)) * W, sy = (y: number) => H - ((y - win.y0) / (win.y1 - win.y0)) * H;
  const colours = ["#2f4f8f", "#be123c", "#15803d"];
  const paths = fns.map(f => {
    if (!f.trim()) return "";
    const pts = samplePlot(f, win.x0, win.x1, 400, angle, (win.y1 - win.y0) * 50);
    let d = "", pen = false;
    for (const p of pts) {
      if (!Number.isFinite(p.y)) { pen = false; continue; }
      d += `${pen ? "L" : "M"}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`;
      pen = true;
    }
    return d;
  });
  const zoom = (k: number) => setWin(w => { const cx = (w.x0 + w.x1) / 2, cy = (w.y0 + w.y1) / 2, hx = ((w.x1 - w.x0) / 2) * k, hy = ((w.y1 - w.y0) / 2) * k; return { x0: cx - hx, x1: cx + hx, y0: cy - hy, y1: cy + hy }; });
  return (
    <div className="w-[440px] max-w-[92vw] space-y-2">
      {fns.map((f, i) => (
        <label key={i} className="flex items-center gap-2 text-sm"><span className="w-10 font-mono" style={{ color: colours[i] }}>y{i + 1} =</span>
          <input className="input py-1 font-mono text-sm" value={f} onChange={e => setFns(fns.map((x, k) => (k === i ? e.target.value : x)))} aria-label={`Function ${i + 1}`} data-exam-tool="1" /></label>
      ))}
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded border border-slate-200 bg-white">
        {Array.from({ length: 21 }, (_, k) => win.x0 + ((win.x1 - win.x0) * k) / 20).map((x, k) => <line key={`x${k}`} x1={sx(x)} x2={sx(x)} y1={0} y2={H} stroke="#f1f5f9" />)}
        {Array.from({ length: 21 }, (_, k) => win.y0 + ((win.y1 - win.y0) * k) / 20).map((y, k) => <line key={`y${k}`} y1={sy(y)} y2={sy(y)} x1={0} x2={W} stroke="#f1f5f9" />)}
        {win.y0 <= 0 && win.y1 >= 0 && <line x1={0} x2={W} y1={sy(0)} y2={sy(0)} stroke="#475569" />}
        {win.x0 <= 0 && win.x1 >= 0 && <line y1={0} y2={H} x1={sx(0)} x2={sx(0)} stroke="#475569" />}
        {paths.map((d, i) => d && <path key={i} d={d} fill="none" stroke={colours[i]} strokeWidth={2} />)}
      </svg>
      <div className="flex flex-wrap items-center gap-1 text-xs">
        <span className="text-slate-500">x {win.x0.toFixed(1)} to {win.x1.toFixed(1)}, y {win.y0.toFixed(1)} to {win.y1.toFixed(1)}</span>
        <button type="button" className="btn btn-ghost ml-auto border border-slate-200 px-2 py-0.5" onClick={() => zoom(0.5)}>Zoom in</button>
        <button type="button" className="btn btn-ghost border border-slate-200 px-2 py-0.5" onClick={() => zoom(2)}>Zoom out</button>
        <button type="button" className="btn btn-ghost border border-slate-200 px-2 py-0.5" onClick={() => setWin({ x0: -10, x1: 10, y0: -10, y1: 10 })}>Reset</button>
        <button type="button" className="btn btn-ghost border border-slate-200 px-2 py-0.5" onClick={() => setAngle(a => (a === "rad" ? "deg" : "rad"))}>{angle === "rad" ? "Radians" : "Degrees"}</button>
      </div>
    </div>
  );
}

function RoughWork({ storageKey }: { storageKey: string }) {
  const read = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(`${storageKey}:${k}`); return v ? JSON.parse(v) : d; } catch { return d; } };
  const [tab, setTab] = useState<"notes" | "sketch">("notes");
  const [notes, setNotes] = useState<string>(() => read("notes", ""));
  const [sketch, setSketch] = useState<Drawing | null>(() => read("sketch", null));
  useEffect(() => { try { localStorage.setItem(`${storageKey}:notes`, JSON.stringify(notes)); } catch { /* full */ } }, [notes, storageKey]);
  useEffect(() => { try { localStorage.setItem(`${storageKey}:sketch`, JSON.stringify(sketch)); } catch { /* full */ } }, [sketch, storageKey]);
  return (
    <div className="w-[min(92vw,560px)] space-y-2">
      <div className="flex gap-1">{(["notes", "sketch"] as const).map(t => <button key={t} type="button" onClick={() => setTab(t)} className={"rounded-full px-3 py-1 text-xs " + (tab === t ? "bg-brand-600 text-white" : "bg-slate-100")}>{t === "notes" ? "Notes" : "Sketch"}</button>)}</div>
      {tab === "notes"
        ? <textarea className="input h-60 font-mono text-sm" value={notes} onChange={e => setNotes(e.target.value)} aria-label="Rough work notes" data-exam-tool="1" spellCheck={false} />
        : <DrawingPad value={sketch} onChange={setSketch} grid="square" label="Rough sketch" maxBytes={300_000} />}
      <p className="text-[11px] text-slate-500">Rough work stays on this device. It is not marked and your teacher does not see it.</p>
    </div>
  );
}

function ReadAloud({ getText }: { getText: () => string }) {
  const [speaking, setSpeaking] = useState(false);
  const [rate, setRate] = useState(0.9);
  const ok = typeof window !== "undefined" && "speechSynthesis" in window;
  useEffect(() => () => { if (ok) window.speechSynthesis.cancel(); }, [ok]);
  if (!ok) return <p className="w-64 text-sm">This browser cannot read aloud.</p>;
  const speak = () => {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(getText());
    u.rate = rate; u.lang = "en-GB";
    u.onend = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(u);
  };
  return (
    <div className="w-64 space-y-2 text-sm">
      <div className="flex gap-2">
        <button type="button" className="btn btn-primary" onClick={speak}>{speaking ? "Read again" : "Read this question"}</button>
        {speaking && <button type="button" className="btn btn-ghost border border-slate-200" onClick={() => { window.speechSynthesis.cancel(); setSpeaking(false); }}>Stop</button>}
      </div>
      <label className="flex items-center gap-2 text-xs">Speed <input type="range" min={0.6} max={1.3} step={0.1} value={rate} onChange={e => setRate(Number(e.target.value))} /></label>
      <p className="text-[11px] text-slate-500">Use headphones so you do not disturb others.</p>
    </div>
  );
}

function TextSize() {
  const [size, setSize] = useState(100);
  const [contrast, setContrast] = useState(false);
  useEffect(() => {
    document.documentElement.style.fontSize = `${size}%`;
    document.documentElement.toggleAttribute("data-high-contrast", contrast);
  }, [size, contrast]);
  useEffect(() => () => { document.documentElement.style.fontSize = ""; document.documentElement.removeAttribute("data-high-contrast"); }, []);
  return (
    <div className="w-60 space-y-3 text-sm">
      <div className="flex items-center gap-2">
        <button type="button" className="btn btn-ghost border border-slate-200" onClick={() => setSize(s => Math.max(90, s - 10))} aria-label="Smaller text">A−</button>
        <span className="w-12 text-center tabular-nums">{size}%</span>
        <button type="button" className="btn btn-ghost border border-slate-200" onClick={() => setSize(s => Math.min(160, s + 10))} aria-label="Larger text">A+</button>
      </div>
      <label className="flex items-center gap-2"><input type="checkbox" checked={contrast} onChange={e => setContrast(e.target.checked)} /> High contrast</label>
    </div>
  );
}

/* ---------- the window and the menu ---------- */

function ToolWindow({ title, onClose, children, index }: { title: string; onClose: () => void; children: React.ReactNode; index: number }) {
  // Open side by side where the screen is wide enough, otherwise cascade.
  const [pos, setPos] = useState(() => ({ x: typeof window === "undefined" ? 24 : Math.max(8, Math.min(24 + index * 360, window.innerWidth - 360)), y: 76 + index * 24 }));
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  return (
    <div data-exam-tool="1" className="fixed z-40 max-h-[86vh] overflow-auto rounded-xl border border-slate-300 bg-white shadow-pop" style={{ left: pos.x, top: pos.y }} role="dialog" aria-label={title}>
      <div className="sticky top-0 z-10 flex cursor-move items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-1.5" style={{ touchAction: "none" }}
        onPointerDown={e => { (e.currentTarget as Element).setPointerCapture(e.pointerId); drag.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y }; }}
        onPointerMove={e => { const d = drag.current; if (d) setPos({ x: Math.max(0, Math.min(window.innerWidth - 120, d.ox + e.clientX - d.sx)), y: Math.max(0, Math.min(window.innerHeight - 40, d.oy + e.clientY - d.sy)) }); }}
        onPointerUp={() => (drag.current = null)}>
        <span className="text-sm font-semibold">{title}</span>
        <button type="button" className="ml-auto rounded px-1.5 text-slate-500 hover:bg-slate-200" onPointerDown={e => e.stopPropagation()} onClick={onClose} aria-label={`Close ${title}`}>✕</button>
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

/**
 * The exam room's tool menu. Only the tools the teacher switched on appear.
 * Tools never send anything to the server.
 */
export default function ExamTools({ tools, referenceText, getQuestionText, storageKey }: { tools: ToolId[]; referenceText?: string | null; getQuestionText: () => string; storageKey: string }) {
  const [open, setOpen] = useState<ToolId[]>([]);
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    document.addEventListener("focusin", trackFocus);
    return () => document.removeEventListener("focusin", trackFocus);
  }, []);
  if (!tools.length) return null;
  const insert = (s: string) => { insertIntoAnswer(s); };
  const toggle = (t: ToolId) => { setOpen(o => (o.includes(t) ? o.filter(x => x !== t) : [...o, t])); setMenu(false); };
  const body = (t: ToolId) => {
    switch (t) {
      case "calc_basic": return <BasicCalculator />;
      case "calc_scientific": return <ScientificCalculator />;
      case "graph_plotter": return <GraphPlotter />;
      case "four_figure_tables": return <FourFigureTables />;
      case "statistical_tables": return <NormalTable />;
      case "geometry_set": return <GeometrySet />;
      case "math_formulae": return <MathFormulae />;
      case "math_symbols": return <MathSymbolsPad insert={insert} />;
      case "periodic_table": return <PeriodicTable />;
      case "chemistry_data": return <ChemistryData />;
      case "physics_data": return <PhysicsData />;
      case "unit_converter": return <UnitConverter />;
      case "special_characters": return <LanguagePad insert={insert} />;
      case "read_aloud": return <ReadAloud getText={getQuestionText} />;
      case "text_size": return <TextSize />;
      case "rough_work": return <RoughWork storageKey={storageKey} />;
      case "reference_sheet": return <div className="max-h-[60vh] w-[min(92vw,520px)] overflow-auto whitespace-pre-wrap text-sm leading-relaxed">{referenceText || "Your teacher has not added a reference sheet."}</div>;
    }
  };
  const label = (t: ToolId) => EXAM_TOOLS.find(x => x.id === t)?.label ?? t;
  return (
    <>
      <div className="relative">
        <button type="button" className="btn btn-ghost border border-slate-200 px-2.5 py-1 text-xs" aria-expanded={menu} onClick={() => setMenu(m => !m)}>Tools ({tools.length})</button>
        {menu && (
          <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-xl border border-slate-200 bg-white p-1 shadow-pop" role="menu">
            {tools.map(t => (
              <button key={t} type="button" role="menuitemcheckbox" aria-checked={open.includes(t)} onClick={() => toggle(t)}
                className={"flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50 " + (open.includes(t) ? "font-semibold text-brand-700" : "")}>
                {label(t)}{open.includes(t) && <span className="text-xs">open</span>}
              </button>
            ))}
          </div>
        )}
      </div>
      {open.map((t, i) => <ToolWindow key={t} index={i} title={label(t)} onClose={() => toggle(t)}>{body(t)}</ToolWindow>)}
    </>
  );
}
