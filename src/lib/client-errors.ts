/**
 * Errors in the browser. After a new version is deployed, a page that was already open asks for
 * the old version's files, which are gone: the fix is to load the page again (once). Anything
 * else is a real error, shown with its message so it can be reported.
 */
export function isStaleBuildError(e: { name?: string; message?: string } | null | undefined): boolean {
  const text = `${e?.name ?? ""} ${e?.message ?? ""}`;
  return /ChunkLoadError|Loading (CSS )?chunk [\w-]+ failed|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Failed to load chunk/i.test(text);
}

const KEY = "ss-reloaded-at";

/** Reload once for a stale build (not again within a minute, so a real fault can't loop). Returns whether it reloaded. */
export function reloadOnceForStaleBuild(e: { name?: string; message?: string } | null | undefined): boolean {
  if (typeof window === "undefined" || !isStaleBuildError(e)) return false;
  let last = 0;
  try { last = Number(sessionStorage.getItem(KEY) ?? 0); } catch { /* storage blocked */ }
  if (Date.now() - last < 60_000) return false;
  try { sessionStorage.setItem(KEY, String(Date.now())); } catch { /* storage blocked */ }
  window.location.reload();
  return true;
}
