"use client";
import { useEffect, useRef, useState } from "react";

type Detector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> };

/**
 * A text box that takes a barcode: a USB scanner types the code and presses Enter, or tap the camera
 * button to read it with the phone's camera (where the browser can read barcodes).
 */
export default function ScanInput({ onCode, placeholder, autoFocus }: { onCode: (code: string) => void; placeholder: string; autoFocus?: boolean }) {
  const [v, setV] = useState("");
  const [cam, setCam] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const supported = typeof window !== "undefined" && "BarcodeDetector" in window;

  useEffect(() => {
    if (!cam) return;
    let stop = false;
    (async () => {
      try {
        const Ctor = (window as unknown as { BarcodeDetector: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
        const det = new Ctor({ formats: ["ean_13", "ean_8", "code_128", "code_39", "qr_code", "upc_a"] });
        stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (!video.current) return;
        video.current.srcObject = stream.current;
        await video.current.play();
        while (!stop && video.current) {
          const found = await det.detect(video.current).catch(() => []);
          if (found[0]?.rawValue) { onCode(found[0].rawValue); setCam(false); break; }
          await new Promise(r => setTimeout(r, 250));
        }
      } catch (e) { setErr((e as Error).message || "The camera could not start."); setCam(false); }
    })();
    return () => { stop = true; stream.current?.getTracks().forEach(t => t.stop()); stream.current = null; };
  }, [cam, onCode]);

  return (
    <div className="space-y-1">
      <form className="flex gap-2" onSubmit={e => { e.preventDefault(); if (v.trim()) { onCode(v.trim()); setV(""); } }}>
        <input className="input" value={v} onChange={e => setV(e.target.value)} placeholder={placeholder} autoFocus={autoFocus} aria-label={placeholder} />
        {supported && <button type="button" className="btn btn-outline" onClick={() => { setErr(null); setCam(!cam); }} aria-pressed={cam}>{cam ? "Stop" : "Camera"}</button>}
        <button className="btn btn-primary">Go</button>
      </form>
      {cam && <video ref={video} className="w-full max-w-sm rounded-lg bg-black" muted playsInline />}
      {err && <p className="text-xs text-rose-700">{err}</p>}
    </div>
  );
}
