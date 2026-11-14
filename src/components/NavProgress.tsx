"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

/** Requests that run in the background on their own and should not move the bar. */
const QUIET = /^\/api\/(me|vitals|notices\/mine|student\/waiting)(\?|$)|^\/api\/swift\/live\//;
/** Only show the bar for things that take a moment, so quick clicks don't flicker. */
const DELAY_MS = 250;

/**
 * A thin bar across the top whenever something takes a moment: opening another page (a link or
 * a menu), or the page waiting on the server (loading or saving). It appears after a quarter of a
 * second, creeps forward while waiting, and finishes when everything is done.
 */
export default function NavProgress() {
  const pathname = usePathname();
  const [width, setWidth] = useState(0);      // 0 = hidden
  const [done, setDone] = useState(false);
  const pending = useRef(0);                  // requests in flight
  const navigating = useRef(false);
  const showTimer = useRef<number | null>(null);
  const creep = useRef<number | null>(null);

  const busy = () => navigating.current || pending.current > 0;
  const start = () => {
    if (showTimer.current || creep.current) return;
    showTimer.current = window.setTimeout(() => {
      showTimer.current = null;
      if (!busy()) return;
      setDone(false); setWidth(12);
      creep.current = window.setInterval(() => setWidth(w => (w < 85 ? w + (90 - w) * 0.08 : w)), 200);
    }, DELAY_MS);
  };
  const stop = () => {
    if (busy()) return;
    if (showTimer.current) { window.clearTimeout(showTimer.current); showTimer.current = null; }
    if (creep.current) {
      window.clearInterval(creep.current); creep.current = null;
      setWidth(100); setDone(true);
      window.setTimeout(() => { if (!busy()) { setWidth(0); setDone(false); } }, 300);
    }
  };

  // Every request the page makes to the server (loading, saving), except quiet background checks.
  useEffect(() => {
    const w = window as typeof window & { __ssProgress?: boolean };
    if (w.__ssProgress) return;
    w.__ssProgress = true;
    const original = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      let path = url;
      try { const u = new URL(url, window.location.href); path = u.origin === window.location.origin ? u.pathname + u.search : ""; } catch { path = ""; }
      const counted = Boolean(path) && path.startsWith("/api/") && !QUIET.test(path);
      if (counted) { pending.current++; start(); }
      try { return await original(input, init); }
      finally { if (counted) { pending.current = Math.max(0, pending.current - 1); stop(); } }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A link to another page in the app: the bar runs until that page is on screen.
  useEffect(() => {
    const click = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target && a.target !== "_self" || a.hasAttribute("download")) return;
      let u: URL;
      try { u = new URL(a.href, window.location.href); } catch { return; }
      if (u.origin !== window.location.origin || (u.pathname === window.location.pathname && u.search === window.location.search)) return;
      navigating.current = true; start();
      // Never stuck: if the page never arrives (offline), the bar goes after a while.
      window.setTimeout(() => { if (navigating.current) { navigating.current = false; stop(); } }, 15_000);
    };
    document.addEventListener("click", click, true);
    return () => document.removeEventListener("click", click, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The new page is here.
  useEffect(() => { if (navigating.current) { navigating.current = false; stop(); } }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!width) return null;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-[3px] print:hidden">
      <div className="h-full bg-brand-600 shadow-[0_0_6px_rgb(var(--brand-600))]"
        style={{ width: `${width}%`, transition: done ? "width 200ms ease-out, opacity 300ms ease 100ms" : "width 200ms linear", opacity: done ? 0 : 1 }} />
    </div>
  );
}
