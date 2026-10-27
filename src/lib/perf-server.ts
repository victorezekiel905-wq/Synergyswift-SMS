/**
 * Records slow database calls (phase 14l). Wraps the Supabase clients' fetch: a call that takes
 * longer than the budget is written to perf_samples straight through the REST API (not through a
 * wrapped client, so recording never records itself). At most 30 a minute per server.
 */
const SLOW_MS = 800;
let windowStart = 0, inWindow = 0;

function record(name: string, ms: number) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || key.includes("replace-with-")) return;
  const now = Date.now();
  if (now - windowStart > 60_000) { windowStart = now; inWindow = 0; }
  if (++inWindow > 30) return;
  void fetch(`${url}/rest/v1/perf_samples`, {
    method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ kind: "slow_call", name: name.slice(0, 60), value: Math.round(ms) })
  }).catch(() => null);
}

/** "…/rest/v1/exam_attempts?select=…" → "exam_attempts"; "…/rest/v1/rpc/my_tenant_id" → "rpc/my_tenant_id". */
export function callName(input: RequestInfo | URL): string | null {
  const u = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const m = u.match(/\/rest\/v1\/((?:rpc\/)?[A-Za-z0-9_]+)/);
  return m ? m[1]! : null;
}

export function timedFetch(base: typeof fetch = fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const start = Date.now();
    const res = await base(input, init);
    const ms = Date.now() - start;
    if (ms > SLOW_MS) { const name = callName(input); if (name && name !== "perf_samples") record(name, ms); }
    return res;
  }) as typeof fetch;
}
