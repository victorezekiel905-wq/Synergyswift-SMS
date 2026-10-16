"use client";
import { useEffect, useState } from "react";

type PromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

/**
 * "Install the app" for phones and computers: the browser's own install
 * prompt where there is one (Android, Chrome, Edge), and the steps for
 * iPhone and iPad (Share → Add to Home Screen). Hidden once installed.
 */
export default function InstallApp() {
  const [evt, setEvt] = useState<PromptEvent | null>(null);
  const [state, setState] = useState<"hidden" | "prompt" | "ios" | "done">("hidden");
  useEffect(() => {
    const standalone = window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true
      || Boolean((window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.());
    if (standalone) return;
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent);
    if (ios) setState("ios");
    const h = (e: Event) => { e.preventDefault(); setEvt(e as PromptEvent); setState("prompt"); };
    const done = () => setState("done");
    window.addEventListener("beforeinstallprompt", h);
    window.addEventListener("appinstalled", done);
    return () => { window.removeEventListener("beforeinstallprompt", h); window.removeEventListener("appinstalled", done); };
  }, []);
  if (state === "hidden") return null;
  if (state === "done") return <p className="text-sm text-emerald-700">Installed. Open the app from your home screen.</p>;
  if (state === "ios") return (
    <p className="text-sm text-slate-600">To install on this iPhone or iPad: tap <b>Share</b> (the square with an arrow) and then <b>Add to Home Screen</b>. Notifications work once it is opened from the home screen.</p>
  );
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="mr-auto">Install the app on this device for quicker opening and notifications.</span>
      <button className="btn btn-primary px-3 py-1 text-xs" onClick={async () => { if (!evt) return; await evt.prompt(); const c = await evt.userChoice; setState(c.outcome === "accepted" ? "done" : "hidden"); }}>Install</button>
    </div>
  );
}
