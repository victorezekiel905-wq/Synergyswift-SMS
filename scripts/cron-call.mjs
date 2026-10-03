// Calls one of the app's scheduled endpoints. Used by the Render cron jobs.
// Usage: node scripts/cron-call.mjs /api/cron/dispatch
// Needs CRON_SECRET, and APP_URL (full URL) or APP_HOST (host name only).
const path = process.argv[2];
const base = process.env.APP_URL || (process.env.APP_HOST ? `https://${process.env.APP_HOST}` : "");
if (!path || !base || !process.env.CRON_SECRET) {
  console.error("usage: node scripts/cron-call.mjs <path>  (needs CRON_SECRET and APP_URL or APP_HOST)");
  process.exit(2);
}
const res = await fetch(new URL(path, base), {
  headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
  signal: AbortSignal.timeout(55_000)
}).catch(e => ({ ok: false, status: 0, text: async () => `${e} ${e?.cause?.code ?? ""}`.trim() }));
const body = await res.text();
console.log(res.status, body.slice(0, 500));
process.exit(res.ok ? 0 : 1);
