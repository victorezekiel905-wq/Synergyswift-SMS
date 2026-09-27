"use client";
import { useEffect, useRef, useState } from "react";
import { send, Icon } from "@/components/ui";

type Result = {
  person: { type: "student" | "staff"; name: string; photo_url: string | null; class_name: string | null };
  direction: "in" | "out"; late: boolean; duplicate: boolean; notified: number; at: string;
};

/**
 * Gate scanner. Works with:
 *  - USB / Bluetooth QR scanners (they type the code + Enter into the focused box)
 *  - the device camera via the browser BarcodeDetector API (Chrome, Edge, Android)
 *  - typing an admission / staff number by hand
 */
export default function GateScanner({ big = false, onRecorded }: { big?: boolean; onRecorded?: () => void }) {
  const [code, setCode] = useState("");
  const [direction, setDirection] = useState<"auto" | "in" | "out">("auto");
  const [last, setLast] = useState<Result | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [camera, setCamera] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const recent = useRef<Map<string, number>>(new Map());

  useEffect(() => { inputRef.current?.focus(); }, []);

  async function submit(raw: string) {
    const value = raw.trim();
    if (!value || busy) return;
    const seen = recent.current.get(value);
    if (seen && Date.now() - seen < 4000) return; // camera sees the same card many times a second
    recent.current.set(value, Date.now());
    setBusy(true); setErr(null);
    const r = await send<Result>("/api/gate/scan", { code: value, direction });
    setBusy(false); setCode("");
    if (!r.ok) { setErr(r.error); setLast(null); beep(220); }
    else { setLast(r.data); beep(r.data.direction === "in" ? 880 : 660); onRecorded?.(); }
    inputRef.current?.focus();
  }

  useEffect(() => {
    if (!camera) return;
    let stream: MediaStream | null = null;
    let stop = false;
    const Detector = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> } }).BarcodeDetector;
    if (!Detector) { setErr("This browser cannot scan with the camera. Use Chrome or Edge, or a USB QR scanner."); setCamera(false); return; }
    const detector = new Detector({ formats: ["qr_code"] });
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (!videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        const tick = async () => {
          if (stop || !videoRef.current) return;
          try { const codes = await detector.detect(videoRef.current); if (codes[0]?.rawValue) await submit(codes[0].rawValue); } catch { /* frame not ready */ }
          setTimeout(tick, 350);
        };
        tick();
      } catch { setErr("Camera permission was denied."); setCamera(false); }
    })();
    return () => { stop = true; stream?.getTracks().forEach(t => t.stop()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, direction]);

  return (
    <div className={big ? "space-y-6" : "space-y-4"}>
      <div className="flex flex-wrap items-center gap-2">
        {(["auto", "in", "out"] as const).map(d => (
          <button key={d} onClick={() => { setDirection(d); inputRef.current?.focus(); }}
            className={"btn " + (direction === d ? "btn-primary" : "btn-ghost border border-slate-200")}>
            {d === "auto" ? "Auto in/out" : d === "in" ? "Sign IN" : "Sign OUT"}
          </button>
        ))}
        <button className="btn btn-outline" onClick={() => setCamera(c => !c)}>{camera ? "Stop camera" : "Use camera"}</button>
      </div>
      <form onSubmit={e => { e.preventDefault(); submit(code); }} className="flex gap-2">
        <input ref={inputRef} value={code} onChange={e => setCode(e.target.value)} autoComplete="off"
          className={"input " + (big ? "py-4 text-2xl" : "")} placeholder="Scan ID card or type admission / staff number" aria-label="Card code or number" />
        <button className="btn btn-primary" disabled={busy}>{busy ? "…" : "Record"}</button>
      </form>
      {camera && <video ref={videoRef} className="w-full max-w-md rounded-lg bg-black" muted playsInline />}
      {err && <div role="alert" className={"rounded-xl bg-rose-600 p-5 text-white " + (big ? "text-2xl" : "text-lg")}><span className="inline-flex items-center gap-2"><Icon name="x" className="h-6 w-6 shrink-0" />{err}</span></div>}
      {last && (
        <div role="status" className={"flex items-center gap-4 rounded-xl p-5 text-white " + (last.direction === "in" ? "bg-emerald-600" : "bg-slate-700")}>
          {last.person.photo_url
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={last.person.photo_url} alt="" className="h-20 w-20 rounded-lg object-cover" />
            : <div className="grid h-20 w-20 place-items-center rounded-lg bg-white/20 text-3xl font-bold">{last.person.name[0]}</div>}
          <div>
            <p className={big ? "text-3xl font-bold" : "text-xl font-bold"}>{last.person.name}</p>
            <p className="opacity-90">{last.person.class_name ?? last.person.type}</p>
            <p className={big ? "text-2xl font-semibold" : "text-lg font-semibold"}>
              Signed {last.direction.toUpperCase()} {new Date(last.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
              {last.late && " · LATE"}{last.duplicate && " · already recorded"}
            </p>
            {last.person.type === "student" && !last.duplicate && <p className="text-sm opacity-90">{last.notified ? `Parents notified (${last.notified} messages)` : "No parent contact on file"}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function beep(freq: number) {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx(); const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.value = freq; o.connect(g); g.connect(ctx.destination); g.gain.value = 0.1;
    o.start(); o.stop(ctx.currentTime + 0.15);
  } catch { /* no audio */ }
}
