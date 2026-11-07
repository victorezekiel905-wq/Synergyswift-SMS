"use client";
import { useCallback, useEffect, useState } from "react";
import { ActionError, NETWORK, rpc } from "./rpc";
import { createClient } from "./supabase/client";

/**
 * Low-bandwidth design (§33) / failure scenario (§30): answers are written to
 * localStorage first and flushed when the network is back, so a dropped
 * connection never loses submitted work.
 *
 * - Every job remembers who wrote it (`uid`). On a shared device only the
 *   signed-in person's jobs are sent; someone else's wait for them to sign in again,
 *   instead of being sent with the wrong account, rejected and dropped.
 * - A job the server refuses is kept in a separate "rejected" list on the device
 *   (never silently thrown away), so the work can still be recovered.
 * - Drafts (what a student has typed but not yet saved) are kept per attempt and
 *   question, so a reload, a crash or a dead battery does not lose them.
 */
type Job = { id: string; fn: string; args: Record<string, unknown>; at: number; uid?: string | null };
const KEY = "sc:answer-queue:v1";
const REJECTED_KEY = "sc:answer-rejected:v1";
const DRAFT_PREFIX = "sc:draft:v1:";
/** A request that hasn't answered after this long is treated as offline and queued. */
const SEND_TIMEOUT_MS = 20_000;

function read(): Job[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "[]") as Job[]; } catch { return []; }
}
function write(jobs: Job[]) {
  try { localStorage.setItem(KEY, JSON.stringify(jobs)); } catch { /* storage full/blocked */ }
  window.dispatchEvent(new Event("sc-queue"));
}
function keepRejected(job: Job, message: string) {
  try {
    const list = JSON.parse(localStorage.getItem(REJECTED_KEY) ?? "[]") as unknown[];
    localStorage.setItem(REJECTED_KEY, JSON.stringify([...list, { ...job, rejected: message, rejected_at: Date.now() }].slice(-100)));
  } catch { /* storage full/blocked */ }
}

/** The signed-in person, read from the local session (no network needed). */
async function currentUid(): Promise<string | null> {
  try { return (await createClient().auth.getSession()).data.session?.user.id ?? null; } catch { return null; }
}

// A request that never reached the server (queue and retry), as opposed to the
// server refusing it (report). Messages are made human-readable, so use the code.
function isNetworkError(e: unknown) {
  return !(e instanceof ActionError) || e.code === NETWORK;
}

let flushing: Promise<void> | null = null;
/** Sends queued jobs in order. Resolves when this round is done (joins a round already running). */
export function flushQueue(onRejected?: (job: Job, message: string) => void): Promise<void> {
  if (typeof navigator !== "undefined" && !navigator.onLine) return Promise.resolve();
  if (flushing) return flushing;
  flushing = (async () => {
    const uid = await currentUid();
    if (!uid) return; // signed out: keep everything until someone signs in
    for (const job of read()) {
      if (job.uid && job.uid !== uid) continue; // another person's work on this device
      try {
        await rpc(job.fn, job.args, { timeoutMs: SEND_TIMEOUT_MS });
        write(read().filter((j) => j.id !== job.id));
      } catch (e) {
        if (isNetworkError(e)) break;              // still offline: keep order, retry later
        const message = e instanceof Error ? e.message : "Rejected";
        keepRejected(job, message);
        write(read().filter((j) => j.id !== job.id)); // server refused it: report, keep a copy
        onRejected?.(job, message);
      }
    }
  })().finally(() => { flushing = null; });
  return flushing;
}

/** Jobs still waiting to be sent for one attempt (for the signed-in person). */
export function pendingFor(attemptId: string): number {
  return read().filter((j) => j.args.p_attempt === attemptId).length;
}

/** Try now; if offline (or the request hangs), queue it. Returns the RPC result or { queued: true }. */
export async function sendOrQueue<T>(fn: string, args: Record<string, unknown>): Promise<T | { queued: true }> {
  // Jobs already waiting go first, so answers reach the server in the order they were given.
  const attempt = args.p_attempt as string | undefined;
  if (navigator.onLine && attempt && pendingFor(attempt)) await flushQueue();
  if (navigator.onLine && !(attempt && pendingFor(attempt))) {
    try {
      return await rpc<T>(fn, args, { timeoutMs: SEND_TIMEOUT_MS });
    } catch (e) {
      if (!isNetworkError(e)) throw e;
    }
  }
  const uid = await currentUid();
  // Replace an older queued answer to the same question (finish_attempt has no question: one per attempt).
  const key = JSON.stringify([fn, args.p_attempt, args.p_question]);
  const jobs = read().filter((j) => JSON.stringify([j.fn, j.args.p_attempt, j.args.p_question]) !== key);
  write([...jobs, { id: crypto.randomUUID(), fn, args, at: Date.now(), uid }]);
  return { queued: true };
}

export function useOfflineQueue(onRejected?: (message: string) => void) {
  const [pending, setPending] = useState(0);
  const refresh = useCallback(() => setPending(read().length), []);
  useEffect(() => {
    refresh();
    const flush = () => void flushQueue((_, m) => onRejected?.(m)).then(refresh);
    const onVisible = () => { if (document.visibilityState === "visible") flush(); };
    window.addEventListener("online", flush);
    window.addEventListener("sc-queue", refresh);
    document.addEventListener("visibilitychange", onVisible);
    const id = window.setInterval(flush, 15_000);
    flush();
    return () => {
      window.removeEventListener("online", flush); window.removeEventListener("sc-queue", refresh);
      document.removeEventListener("visibilitychange", onVisible); window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { pending, flush: () => flushQueue().then(refresh) };
}

/** Is anything waiting to be sent? (Used by the app-wide background sync.) */
export function hasQueued(): boolean {
  return read().length > 0;
}

/* ---------------- Drafts: typed but not yet saved ---------------- */

export function saveDrafts(scope: string, drafts: Record<string, unknown>) {
  try {
    if (Object.keys(drafts).length) localStorage.setItem(DRAFT_PREFIX + scope, JSON.stringify({ at: Date.now(), drafts }));
    else localStorage.removeItem(DRAFT_PREFIX + scope);
  } catch { /* storage full/blocked */ }
}

export function loadDrafts<T = unknown>(scope: string): Record<string, T> {
  try { return (JSON.parse(localStorage.getItem(DRAFT_PREFIX + scope) ?? "null")?.drafts ?? {}) as Record<string, T>; } catch { return {}; }
}

export function clearDrafts(scope: string) {
  try { localStorage.removeItem(DRAFT_PREFIX + scope); } catch { /* storage blocked */ }
}

/* ---------------- An activity kept for opening without a connection ---------------- */

const START_PREFIX = "sc:started:v1:";

/** The last start/resume of an activity (its questions, never the answers' keys), so it opens offline. */
export function rememberStart(scope: string, uid: string, data: unknown) {
  try { localStorage.setItem(START_PREFIX + scope, JSON.stringify({ uid, at: Date.now(), data })); } catch { /* full/blocked */ }
}

export function recallStart<T>(scope: string, uid: string): T | null {
  try {
    const v = JSON.parse(localStorage.getItem(START_PREFIX + scope) ?? "null");
    return v && v.uid === uid ? (v.data as T) : null;
  } catch { return null; }
}
