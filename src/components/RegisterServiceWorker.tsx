"use client";
import { useEffect } from "react";

/**
 * Registers the service worker (production only) so the app can be installed on phones,
 * and sends answers saved offline from any page as soon as the connection is back
 * (not only while the lesson that saved them is open).
 */
export default function RegisterServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => { /* optional feature */ });
  }, []);
  useEffect(() => {
    const sync = () => {
      import("@/live/lib/offline-queue").then((q) => { if (q.hasQueued()) void q.flushQueue(); }).catch(() => { /* next time */ });
    };
    window.addEventListener("online", sync);
    const t = window.setInterval(sync, 30_000);
    sync();
    return () => { window.removeEventListener("online", sync); window.clearInterval(t); };
  }, []);
  return null;
}
