/**
 * Inserts of several rows at once use each column's default for a field a row leaves out.
 *
 * Rows inserted together are sent with one column list (every key any row has). Without this, a row
 * missing one of those keys is given null, so a NOT NULL column with a default (template_params,
 * status, created_at...) refused the whole batch: "null value in column ... violates not-null
 * constraint". It happened to parents' messages when email and WhatsApp went out together, and can
 * happen to any list saved in one go (imports, class lists, score sheets).
 *
 * Only plain inserts: an upsert's update part is left exactly as before. Safe for the browser too.
 */
export function withInsertDefaults(input: RequestInfo | URL, init?: RequestInit): RequestInit | undefined {
  if (!init || String(init.method ?? "GET").toUpperCase() !== "POST") return init;
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.includes("/rest/v1/") || url.includes("/rest/v1/rpc/")) return init;
  const headers = new Headers(init.headers);
  const prefer = headers.get("Prefer") ?? "";
  if (/resolution=|missing=/.test(prefer)) return init;
  headers.set("Prefer", prefer ? `${prefer},missing=default` : "missing=default");
  return { ...init, headers };
}

/** A fetch that applies withInsertDefaults before calling the given one. */
export function insertDefaultsFetch(base: typeof fetch = (i, n) => fetch(i, n)): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => base(input, withInsertDefaults(input, init))) as typeof fetch;
}
