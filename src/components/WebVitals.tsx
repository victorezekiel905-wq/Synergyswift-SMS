"use client";
import { useReportWebVitals } from "next/web-vitals";

// One page load in five reports its speed (phase 14l), decided once per visit.
const sampled = typeof window !== "undefined" && (() => {
  try { const k = "ss-vitals"; let v = sessionStorage.getItem(k); if (!v) { v = Math.random() < 0.2 ? "1" : "0"; sessionStorage.setItem(k, v); } return v === "1"; } catch { return false; }
})();

/** Sends real page-speed numbers (web vitals) for the super admin's performance budgets. Nothing personal is sent. */
export default function WebVitals() {
  useReportWebVitals(m => {
    if (!sampled || !["LCP", "INP", "CLS", "FCP", "TTFB"].includes(m.name)) return;
    const body = JSON.stringify({ name: m.name, value: m.value, rating: m.rating, path: window.location.pathname });
    if (navigator.sendBeacon) navigator.sendBeacon("/api/vitals", new Blob([body], { type: "application/json" }));
    else void fetch("/api/vitals", { method: "POST", body, headers: { "Content-Type": "application/json" }, keepalive: true }).catch(() => null);
  });
  return null;
}
