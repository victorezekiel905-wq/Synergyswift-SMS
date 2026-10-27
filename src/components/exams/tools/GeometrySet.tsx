"use client";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Mathematical set: ruler, protractor and two set squares drawn over the exam
 * screen. Drag the body to move, drag the round handle to turn. Scales are in
 * on-screen units (1 cm = 38 px), matching the squares on drawing questions.
 */
const CM = 38;
type Kind = "ruler" | "protractor" | "set45" | "set60";
type Inst = { kind: Kind; x: number; y: number; rot: number };

function Ruler() {
  const len = 15 * CM, h = 54;
  return (
    <svg width={len + 20} height={h} className="overflow-visible">
      <rect x={0} y={0} width={len + 20} height={h} rx={4} fill="rgba(255,250,205,0.85)" stroke="#a16207" />
      {Array.from({ length: 151 }, (_, i) => {
        const x = 10 + (i * CM) / 10, t = i % 10 === 0 ? 18 : i % 5 === 0 ? 12 : 7;
        return <g key={i}><line x1={x} x2={x} y1={0} y2={t} stroke="#422006" strokeWidth={i % 10 === 0 ? 1.2 : 0.7} />{i % 10 === 0 && <text x={x} y={30} fontSize={10} textAnchor="middle" fill="#422006">{i / 10}</text>}</g>;
      })}
      <text x={len / 2 + 10} y={47} fontSize={9} textAnchor="middle" fill="#713f12">cm</text>
    </svg>
  );
}

function Protractor() {
  const r = 4.5 * CM, cx = r + 8, cy = r + 8;
  return (
    <svg width={2 * r + 16} height={r + 26} className="overflow-visible">
      <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy} Z`} fill="rgba(224,242,254,0.8)" stroke="#0369a1" />
      {Array.from({ length: 181 }, (_, d) => {
        const a = (Math.PI * d) / 180, t = d % 10 === 0 ? 14 : d % 5 === 0 ? 9 : 5;
        const x1 = cx + r * Math.cos(Math.PI - a), y1 = cy - r * Math.sin(Math.PI - a);
        const x2 = cx + (r - t) * Math.cos(Math.PI - a), y2 = cy - (r - t) * Math.sin(Math.PI - a);
        return <g key={d}><line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#075985" strokeWidth={d % 10 === 0 ? 1 : 0.6} />
          {d % 10 === 0 && <><text x={cx + (r - 24) * Math.cos(Math.PI - a)} y={cy - (r - 24) * Math.sin(Math.PI - a) + 3} fontSize={8} textAnchor="middle" fill="#0c4a6e">{d}</text>
            <text x={cx + (r - 38) * Math.cos(Math.PI - a)} y={cy - (r - 38) * Math.sin(Math.PI - a) + 3} fontSize={7} textAnchor="middle" fill="#64748b">{180 - d}</text></>}</g>;
      })}
      <line x1={cx - r} x2={cx + r} y1={cy} y2={cy} stroke="#075985" />
      <line x1={cx} x2={cx} y1={cy} y2={cy - 12} stroke="#be123c" strokeWidth={1.5} />
      <circle cx={cx} cy={cy} r={2.5} fill="#be123c" />
    </svg>
  );
}

function SetSquare({ angle }: { angle: 45 | 60 }) {
  const a = 8 * CM, b = angle === 45 ? a : a * Math.tan(Math.PI / 6);
  return (
    <svg width={a + 10} height={b + 10} className="overflow-visible">
      <polygon points={`5,${b + 5} ${a + 5},${b + 5} 5,5`} fill="rgba(220,252,231,0.75)" stroke="#15803d" />
      {Array.from({ length: Math.floor(a / CM * 10) + 1 }, (_, i) => <line key={i} x1={5 + (i * CM) / 10} x2={5 + (i * CM) / 10} y1={b + 5} y2={b + 5 - (i % 10 === 0 ? 10 : 5)} stroke="#14532d" strokeWidth={0.6} />)}
      <text x={18} y={b - 4} fontSize={10} fill="#14532d">90°</text>
      <text x={a - 30} y={b - 4} fontSize={10} fill="#14532d">{angle === 45 ? "45°" : "30°"}</text>
      <text x={9} y={angle === 45 ? 40 : 34} fontSize={10} fill="#14532d">{angle === 45 ? "45°" : "60°"}</text>
    </svg>
  );
}

const LABELS: Record<Kind, string> = { ruler: "Ruler", protractor: "Protractor", set45: "Set square 45°", set60: "Set square 60°/30°" };

export function GeometrySet() {
  const [items, setItems] = useState<Inst[]>([]);
  const drag = useRef<{ i: number; mode: "move" | "turn"; sx: number; sy: number; ox: number; oy: number; cx: number; cy: number } | null>(null);
  const toggle = (kind: Kind) => setItems(list => list.some(x => x.kind === kind) ? list.filter(x => x.kind !== kind) : [...list, { kind, x: 160 + list.length * 30, y: 180 + list.length * 30, rot: 0 }]);
  const onDown = (i: number, mode: "move" | "turn") => (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const box = (e.currentTarget.closest("[data-inst]") as HTMLElement).getBoundingClientRect();
    drag.current = { i, mode, sx: e.clientX, sy: e.clientY, ox: items[i].x, oy: items[i].y, cx: box.left + box.width / 2, cy: box.top + box.height / 2 };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    setItems(list => list.map((it, k) => {
      if (k !== d.i) return it;
      if (d.mode === "move") return { ...it, x: d.ox + e.clientX - d.sx, y: d.oy + e.clientY - d.sy };
      const deg = (Math.atan2(e.clientY - d.cy, e.clientX - d.cx) * 180) / Math.PI;
      return { ...it, rot: Math.round(deg) };
    }));
  };
  return (
    <div className="w-64 space-y-2 text-sm">
      <p className="text-xs text-slate-600">Tick an instrument to place it on the screen. Drag it to move; drag the round handle to turn it.</p>
      {(Object.keys(LABELS) as Kind[]).map(k => (
        <label key={k} className="flex items-center gap-2"><input type="checkbox" checked={items.some(x => x.kind === k)} onChange={() => toggle(k)} /> {LABELS[k]}</label>
      ))}
      {typeof document !== "undefined" && createPortal(<>{items.map((it, i) => (
        <div key={it.kind} data-inst="1" className="fixed left-0 top-0 z-[60] select-none" style={{ transform: `translate(${it.x}px, ${it.y}px) rotate(${it.rot}deg)`, transformOrigin: "center" }}
          onPointerMove={onMove} onPointerUp={() => (drag.current = null)}>
          <div className="cursor-move" onPointerDown={onDown(i, "move")} style={{ touchAction: "none" }}>
            {it.kind === "ruler" ? <Ruler /> : it.kind === "protractor" ? <Protractor /> : <SetSquare angle={it.kind === "set45" ? 45 : 60} />}
          </div>
          <button type="button" aria-label={`Turn the ${LABELS[it.kind]}`} onPointerDown={onDown(i, "turn")} style={{ touchAction: "none" }}
            className="absolute -right-4 -top-4 grid h-7 w-7 cursor-grab place-items-center rounded-full border-2 border-white bg-brand-600 text-[10px] font-bold text-white shadow">{it.rot}°</button>
        </div>
      ))}</>, document.body)}
    </div>
  );
}
