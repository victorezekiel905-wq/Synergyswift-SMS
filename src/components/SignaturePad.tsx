"use client";
import { useEffect, useRef, useState } from "react";

/** Draw a signature with a finger, stylus or mouse. Calls onChange with a PNG data URL (or null when cleared). */
export default function SignaturePad({ onChange, height = 160 }: { onChange: (png: string | null) => void; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);
  useEffect(() => {
    const c = ref.current!;
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    c.width = c.offsetWidth * ratio; c.height = height * ratio;
    const ctx = c.getContext("2d")!;
    ctx.scale(ratio, ratio); ctx.lineWidth = 2.2; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#0f172a";
  }, [height]);
  const pos = (e: React.PointerEvent) => { const r = ref.current!.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  function down(e: React.PointerEvent) {
    ref.current!.setPointerCapture(e.pointerId);
    drawing.current = true;
    const [x, y] = pos(e); const ctx = ref.current!.getContext("2d")!; ctx.beginPath(); ctx.moveTo(x, y);
  }
  function move(e: React.PointerEvent) {
    if (!drawing.current) return;
    const [x, y] = pos(e); const ctx = ref.current!.getContext("2d")!; ctx.lineTo(x, y); ctx.stroke();
    if (empty) setEmpty(false);
  }
  function up() {
    if (!drawing.current) return;
    drawing.current = false;
    if (!empty) onChange(ref.current!.toDataURL("image/png"));
  }
  function clear() {
    const c = ref.current!; c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    setEmpty(true); onChange(null);
  }
  return (
    <div>
      <canvas ref={ref} style={{ height, touchAction: "none" }} className="w-full rounded-lg border-2 border-dashed border-slate-300 bg-white"
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} aria-label="Draw your signature here" />
      <div className="mt-1 flex justify-between text-xs text-slate-500"><span>{empty ? "Draw your signature above (optional)" : "Signature drawn"}</span><button type="button" className="underline" onClick={clear}>Clear</button></div>
    </div>
  );
}
