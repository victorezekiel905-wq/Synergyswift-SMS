"use client";
import { useEffect } from "react";

/**
 * Tells the platform's error log (api/errors) when a page crashes in a browser: an uncaught error or a
 * promise nobody handled. At most 5 reports per page view and the same message once, so a broken loop
 * cannot send hundreds. Noise from browser extensions and lost connections is left out.
 */
const NOISE = /ResizeObserver loop|Script error\.?$|chrome-extension:|moz-extension:|Failed to fetch|NetworkError|Load failed|AbortError|The operation was aborted|cancelled/i;

export default function ErrorReporter() {
  useEffect(() => {
    let sent = 0;
    const said = new Set<string>();
    const report = (message: string, stack?: string | null) => {
      if (!message || NOISE.test(message) || (stack && NOISE.test(stack)) || sent >= 5 || said.has(message)) return;
      sent++; said.add(message);
      const body = JSON.stringify({ message: message.slice(0, 500), path: location.pathname, stack: stack ? stack.slice(0, 2000) : null });
      try {
        if (navigator.sendBeacon) navigator.sendBeacon("/api/errors", new Blob([body], { type: "application/json" }));
        else void fetch("/api/errors", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
      } catch { /* reporting must never break the page */ }
    };
    const onError = (e: ErrorEvent) => report(e.message || String(e.error ?? ""), e.error?.stack ?? `${e.filename ?? ""}:${e.lineno ?? ""}`);
    const onRejection = (e: PromiseRejectionEvent) => { const r = e.reason as { message?: string; stack?: string } | string; report(typeof r === "string" ? r : r?.message ?? String(r), typeof r === "string" ? null : r?.stack ?? null); };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => { window.removeEventListener("error", onError); window.removeEventListener("unhandledrejection", onRejection); };
  }, []);
  return null;
}
