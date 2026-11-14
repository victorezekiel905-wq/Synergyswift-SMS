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

/**
 * The website's security service (Cloudflare, in front of the server) sometimes asks a browser
 * to prove it is a person. A request made in the background then gets that check instead of
 * data. Only a full page load can show it, so the person is told and offered a reload; the
 * page is never reloaded by itself, so nothing typed is lost without warning.
 */
export const SECURITY_CHECK_EVENT = "ss-security-check";

export function isSecurityCheck(r: { status: number; headers: { get(name: string): string | null } }): boolean {
  return r.headers.get("cf-mitigated") === "challenge" || ((r.status === 403 || r.status === 503) && /text\/html/i.test(r.headers.get("content-type") ?? "") && Boolean(r.headers.get("cf-ray")));
}

export function announceSecurityCheck() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(SECURITY_CHECK_EVENT));
}

export const SECURITY_CHECK_TEXT = "The website's security check needs you to confirm you are a person. Reload the page, tick the box, and carry on.";