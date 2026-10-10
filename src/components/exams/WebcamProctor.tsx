"use client";
import { useEffect, useRef, useState } from "react";
import { faceCounter } from "@/lib/exams/faces";

/** Asks for the camera. Call from a click so browsers show the prompt. */
export async function requestCamera(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser cannot use a camera. Use Chrome, Edge, Firefox or Safari.");
  return navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 320 }, height: { ideal: 240 }, facingMode: "user" }, audio: false });
}

/**
 * Webcam proctoring during an exam: a small preview in the corner and a photo
 * every `intervalSec` seconds sent to the server. If the camera stops, the
 * exam is covered until it is back on, and the event is recorded.
 * Each photo is checked for faces (in every modern browser); photos with no
 * face or several faces are flagged for the teacher, never locked automatically.
 */
export default function WebcamProctor({ examId, intervalSec, initialStream, onEvent }: {
  examId: string; intervalSec: number; initialStream?: MediaStream | null;
  onEvent: (kind: string, meta?: Record<string, unknown>) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(initialStream ?? null);
  const [problem, setProblem] = useState<string | null>(null);
  const reported = useRef(false);

  // Start (or restart after a reload) the camera.
  useEffect(() => {
    if (stream) return;
    requestCamera().then(setStream).catch(() => setProblem("Turn on your camera to continue the exam."));
  }, [stream]);

  useEffect(() => {
    if (!stream || !video.current) return;
    video.current.srcObject = stream;
    video.current.play().catch(() => {});
    const track = stream.getVideoTracks()[0];
    const ended = () => {
      setStream(null); setProblem("Your camera stopped. Turn it back on to continue.");
      if (!reported.current) { reported.current = true; onEvent("camera_off"); }
    };
    track?.addEventListener("ended", ended);
    reported.current = false;
    setProblem(null);
    return () => track?.removeEventListener("ended", ended);
  }, [stream, onEvent]);

  // Periodic photo.
  useEffect(() => {
    if (!stream) return;
    const counting = faceCounter();
    const snap = async () => {
      const v = video.current;
      if (!v || v.readyState < 2) return;
      const c = document.createElement("canvas");
      c.width = 320; c.height = Math.round((320 * (v.videoHeight || 240)) / (v.videoWidth || 320));
      c.getContext("2d")?.drawImage(v, 0, 0, c.width, c.height);
      let faces = -1;
      try { faces = await (await counting)(c); } catch { faces = -1; }
      if (faces === 0) onEvent("no_face");
      if (faces > 1) onEvent("multiple_faces", { faces });
      const blob: Blob | null = await new Promise(res => c.toBlob(res, "image/jpeg", 0.6));
      if (!blob) return;
      const fd = new FormData(); fd.set("photo", blob, "snap.jpg"); fd.set("faces", String(faces));
      await fetch(`/api/student/exams/${examId}/snapshot`, { method: "POST", body: fd }).catch(() => {});
    };
    const first = setTimeout(snap, 3000);
    const t = setInterval(snap, Math.max(15, intervalSec) * 1000);
    return () => { clearTimeout(first); clearInterval(t); };
  }, [stream, examId, intervalSec, onEvent]);

  // Stop the camera when the exam ends.
  useEffect(() => () => { stream?.getTracks().forEach(t => t.stop()); }, [stream]);

  return (
    <>
      <video ref={video} muted playsInline aria-label="Your camera" className="fixed bottom-3 left-3 z-30 h-24 w-32 rounded-lg border-2 border-white bg-black object-cover shadow-lg" />
      {problem && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/95 p-6 text-center text-white">
          <div>
            <p className="text-xl font-semibold">{problem}</p>
            <p className="mt-2 text-sm opacity-80">This exam takes a photo from your camera every {intervalSec} seconds. Your answers are safe.</p>
            <button className="btn btn-primary mt-4" onClick={() => requestCamera().then(setStream).catch(() => setProblem("The camera is blocked. Allow it in the browser's address bar, then try again."))}>Turn camera on</button>
          </div>
        </div>
      )}
    </>
  );
}
