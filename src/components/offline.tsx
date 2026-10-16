"use client";
import { useEffect, useState } from "react";
import { useApi, fmtDate, fmtTime } from "@/components/ui";

/**
 * Offline copies of a person's own "today" views. Kept in this browser
 * only, under the signed-in person's id, and removed on sign-out or when
 * someone else signs in on the device.
 */
const PREFIX = "educlass:offline:";
export const OWNER_KEY = "educlass:owner";

const keyFor = (url: string) => {
  let owner = "anon";
  try { owner = localStorage.getItem(OWNER_KEY) || "anon"; } catch { /* storage blocked */ }
  return `${PREFIX}${owner}:${url}`;
};

/** Called by the app shell once it knows who is signed in. */
export function claimDevice(userId: string) {
  try {
    const prev = localStorage.getItem(OWNER_KEY);
    if (prev && prev !== userId) Object.keys(localStorage).filter(k => k.startsWith(PREFIX)).forEach(k => localStorage.removeItem(k));
    localStorage.setItem(OWNER_KEY, userId);
  } catch { /* storage blocked */ }
}

/** Like useApi, but falls back to the last copy saved on this device when there is no connection. */
export function useOfflineApi<T>(url: string | null) {
  const api = useApi<T>(url);
  const [saved, setSaved] = useState<{ at: number; data: T } | null>(null);
  useEffect(() => {
    if (!url || !api.data) return;
    try { localStorage.setItem(keyFor(url), JSON.stringify({ at: Date.now(), data: api.data })); } catch { /* full or blocked */ }
  }, [url, api.data]);
  useEffect(() => {
    if (!url || api.data || !api.error) return;
    try { const raw = localStorage.getItem(keyFor(url)); if (raw) setSaved(JSON.parse(raw)); } catch { /* blocked or corrupt */ }
  }, [url, api.data, api.error]);
  const offline = !api.data && saved ? saved.at : null;
  return { data: api.data ?? (offline ? saved!.data : null), error: offline ? null : api.error, offlineAt: offline, reload: api.reload };
}

/** "Offline: showing what was saved at …" */
export function OfflineNote({ at, onRetry }: { at: number | null; onRetry?: () => void }) {
  if (!at) return null;
  const iso = new Date(at).toISOString();
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="status">
      <span className="mr-auto">No connection. Showing what was saved on this device on {fmtDate(iso)} at {fmtTime(iso)}.</span>
      {onRetry && <button className="btn btn-outline px-2 py-1 text-xs" onClick={onRetry}>Try again</button>}
    </div>
  );
}
