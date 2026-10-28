// Phase 14q: turn a k6 run into a plain-words report.
//   k6 run --summary-export scripts/load/out/k6-summary.json ... scripts/load/k6-school-day.js
//   node scripts/load/report.mjs [scripts/load/out/k6-summary.json] [--scale=2.5]
// Writes scripts/load/out/LOAD_RESULT.md: pass or fail against the targets, the slow spots, and what to change.
import fs from "fs";

const file = process.argv.find(a => a.endsWith(".json")) ?? "scripts/load/out/k6-summary.json";
const scale = Number((process.argv.find(a => a.startsWith("--scale=")) ?? "--scale=1").split("=")[1]) || 1;
if (!fs.existsSync(file)) { console.error(`No k6 summary at ${file}. Run k6 with --summary-export ${file} first.`); process.exit(1); }
const m = JSON.parse(fs.readFileSync(file, "utf8")).metrics ?? {};

const get = (name, stat) => m[name]?.values?.[stat] ?? m[name]?.[stat] ?? null;
const ms = v => (v === null ? "n/a" : `${Math.round(v)} ms`);
const pct = v => (v === null ? "n/a" : `${(v * 100).toFixed(2)}%`);

const p95api = get("http_req_duration{kind:api}", "p(95)") ?? get("http_req_duration", "p(95)");
const p95page = get("page_api_ms", "p(95)");
const failed = get("http_req_failed", "rate") ?? get("http_req_failed", "value");
const reqs = get("http_reqs", "count"), rps = get("http_reqs", "rate");
const vusMax = get("vus_max", "max") ?? get("vus_max", "value");

const checks = [
  ["Server answers (95% of API calls)", p95api, v => v !== null && v < 800, `${ms(p95api)}, target under 800 ms`],
  ["Pages' data (95%)", p95page, v => v === null || v < 800, `${ms(p95page)}, target under 800 ms`],
  ["Failed requests", failed, v => v !== null && v < 0.01, `${pct(failed)}, target under 1%`]
];
const pass = checks.every(([, v, ok]) => ok(v));

const advice = [];
if (failed !== null && failed >= 0.01) advice.push("Requests are failing. Look at Render's logs for 502/503 (the app is overloaded or restarting) and Supabase's logs for connection limits. Add Render instances first.");
if (p95api !== null && p95api >= 800) advice.push("Answers are slow. If Render's CPU is near 100%, add instances (or move from Starter to Standard). If Supabase CPU is high instead, raise its compute size.");
if (p95api !== null && p95api >= 2000) advice.push("Over 2 seconds is what people notice as broken. Do not take on this many users until this is fixed.");
if (!advice.length) advice.push("Comfortable at this size. Keep a 30% margin: test again at 1.3x before a busy term starts.");

const md = `# Synergy Swift load test result

**${pass ? "PASSED" : "NOT YET"}** at scale ${scale} (about ${(20_000 * scale).toLocaleString("en-GB")} accounts, up to ${vusMax ?? "?"} people active at the same moment).

| What | Result | Target | |
|---|---|---|---|
${checks.map(([n, v, ok, d]) => `| ${n} | ${d.split(",")[0]} | ${d.split(", target ")[1] ?? ""} | ${ok(v) ? "pass" : "**fail**"} |`).join("\n")}

${reqs ? `${Math.round(reqs).toLocaleString("en-GB")} requests in all, about ${Math.round(rps ?? 0)} a second.` : ""}

## What to do

${advice.map(a => `- ${a}`).join("\n")}

Read alongside Render's metrics (CPU, memory, instances) and Supabase's (CPU, connections, Realtime) for the same time window.
`;
fs.mkdirSync("scripts/load/out", { recursive: true });
fs.writeFileSync("scripts/load/out/LOAD_RESULT.md", md);
console.log(md);
console.log("written scripts/load/out/LOAD_RESULT.md");
process.exit(pass ? 0 : 1);
