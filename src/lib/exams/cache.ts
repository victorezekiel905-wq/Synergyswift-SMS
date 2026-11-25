import "server-only";

/**
 * A short memory for what a whole exam hall asks the server at the same moment (the exam, its
 * classes, its questions, who a student is). The first request does the database work; the others
 * that arrive while it runs, or within a few seconds after, share its answer. With 500 students
 * pressing Start together, the database is asked once instead of 500 times.
 *
 * Per server instance; entries expire quickly, so a teacher's change (closing the exam, a fixed
 * answer) is seen within seconds. A failed lookup is not remembered.
 */
const store = new Map<string, { at: number; p: Promise<unknown> }>();
const MAX = 2000;

export function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && now - hit.at < ttlMs) return hit.p as Promise<T>;
  const p = load();
  store.set(key, { at: now, p });
  p.catch(() => { if (store.get(key)?.p === p) store.delete(key); });
  if (store.size > MAX) {
    for (const [k, v] of store) { if (now - v.at > 60_000) store.delete(k); }
    if (store.size > MAX) store.delete(store.keys().next().value as string);
  }
  return p;
}

/** Forget an entry (for example after a teacher changes the exam on this server). */
export function forget(prefix: string) {
  for (const k of store.keys()) if (k.startsWith(prefix)) store.delete(k);
}
