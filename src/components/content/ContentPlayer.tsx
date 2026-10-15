"use client";
import { useEffect, useRef, useState } from "react";
import { send, Alert, Loading } from "@/components/ui";

type Launch = { url: string; nonce: string; token: string; kind: string; preview: boolean; title: string };
type Pending = { values: Record<string, string>; finish: boolean };

/**
 * Plays a content package in a sandboxed frame. SCORM progress comes to this
 * page by message and is saved with the student's session; when the
 * connection drops it is kept on the device and sent when it returns.
 */
export default function ContentPlayer({ packageId, onClose }: { packageId: string; onClose: (changed: boolean) => void }) {
  const [launch, setLaunch] = useState<Launch | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const changed = useRef(false);

  useEffect(() => {
    let off = false;
    const cacheKey = `ecf-launch:${packageId}`;
    send<Launch>("/api/content/launch", { package_id: packageId }).then(r => {
      if (off) return;
      if (r.ok) { setLaunch(r.data); try { localStorage.setItem(cacheKey, JSON.stringify(r.data)); } catch { /* storage full */ } return; }
      // Offline: reopen with the last link if this package was kept on the device.
      let saved: Launch | null = null;
      try { saved = JSON.parse(localStorage.getItem(cacheKey) ?? "null"); } catch { /* unreadable */ }
      if (!navigator.onLine && saved) { setLaunch(saved); setStatus("You are offline. Your progress will be saved when you reconnect."); }
      else setErr(r.error ?? "could not open this content");
    });
    return () => { off = true; };
  }, [packageId]);

  useEffect(() => {
    if (!launch || launch.preview || !launch.kind.startsWith("scorm")) return;
    const key = `ecf-scorm-q:${launch.nonce}`;
    const read = (): Pending | null => { try { return JSON.parse(localStorage.getItem(key) ?? "null"); } catch { return null; } };
    const write = (p: Pending | null) => { try { if (p) localStorage.setItem(key, JSON.stringify(p)); else localStorage.removeItem(key); } catch { /* storage unavailable */ } };
    let busy = false;
    const flush = async () => {
      if (busy) return;
      const p = read();
      if (!p) return;
      busy = true;
      try {
        const r = await fetch("/api/content/runtime", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: launch.token, ...p }) });
        const j = await r.json().catch(() => ({}));
        // Only clear what was sent; anything newer stays queued.
        const now = read();
        if (now && JSON.stringify(now) === JSON.stringify(p)) write(null);
        if (r.ok) { changed.current = true; setStatus(j.status === "passed" ? "Passed. Well done!" : j.status === "completed" ? "Completed." : "Progress saved."); }
        else setStatus(j.error ?? "Progress could not be saved.");
      } catch {
        setStatus("You are offline. Your progress is kept on this device and will be sent when you reconnect.");
      } finally { busy = false; }
    };
    const onMessage = (e: MessageEvent) => {
      const d = e.data;
      if (!d || d.type !== "ecf-scorm" || d.n !== launch.nonce) return;
      const values = d.values && typeof d.values === "object" ? d.values as Record<string, string> : {};
      if (!Object.keys(values).length && !d.finish) return;
      const prev = read();
      write({ values: { ...(prev?.values ?? {}), ...values }, finish: Boolean(prev?.finish || d.finish) });
      void flush();
    };
    window.addEventListener("message", onMessage);
    window.addEventListener("online", flush);
    void flush();
    return () => { window.removeEventListener("message", onMessage); window.removeEventListener("online", flush); };
  }, [launch]);

  if (err) return <Alert>{err}</Alert>;
  if (!launch) return <Loading label="Opening…" />;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <b className="mr-auto">{launch.title}</b>
        {launch.preview && <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">Preview: nothing is saved</span>}
        {status && <span className="text-xs text-slate-600" role="status">{status}</span>}
        <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => onClose(changed.current)}>Close</button>
      </div>
      <iframe src={launch.url} title={launch.title} className="h-[75vh] w-full rounded-lg border border-slate-200 bg-white"
        sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads allow-presentation allow-pointer-lock"
        allow="fullscreen; autoplay" allowFullScreen />
    </div>
  );
}

/** Keeps a package's files on this device so it opens without a connection. */
export async function keepOffline(packageId: string, onProgress?: (done: number, total: number) => void): Promise<{ ok: boolean; error?: string }> {
  if (!("caches" in window)) return { ok: false, error: "this browser cannot keep content offline" };
  const r = await send<{ files: { p: string; s: number }[] }>(`/api/content?id=${packageId}`, undefined, "GET");
  const l = await send<Launch>("/api/content/launch", { package_id: packageId });
  if (!r.ok || !l.ok) return { ok: false, error: r.error ?? l.error ?? "could not prepare the download" };
  try { localStorage.setItem(`ecf-launch:${packageId}`, JSON.stringify(l.data)); } catch { /* storage full */ }
  const files = r.data.files ?? [];
  if (files.reduce((a, f) => a + f.s, 0) > 150 * 1024 * 1024) return { ok: false, error: "this package is too large to keep offline" };
  const base = l.data.url.replace(/\/[^/]*$/, "").replace(/(\/pkg\/[^/]+).*$/, "$1");
  const cache = await caches.open(`ecf-content-${packageId}`);
  let done = 0;
  for (const f of files) {
    const res = await fetch(`${base}/${f.p.split("/").map(encodeURIComponent).join("/")}`, { cache: "reload" });
    if (res.ok) await cache.put(`/__pkg/${packageId}/${f.p}`, res);
    onProgress?.(++done, files.length);
  }
  return { ok: true };
}

export async function isKeptOffline(packageId: string): Promise<boolean> {
  return "caches" in window ? caches.has(`ecf-content-${packageId}`) : false;
}
export async function forgetOffline(packageId: string) {
  if ("caches" in window) await caches.delete(`ecf-content-${packageId}`);
}
