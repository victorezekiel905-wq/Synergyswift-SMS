#!/usr/bin/env node
/**
 * Brings SwiftCipher's live-lesson engine (lessons, slides, activities, live
 * sessions, games, reports) into Synergy Swift as the "live" module.
 *
 * SwiftCipher's database lives in its own Postgres schema, `live` (helpers in
 * `live_app`), so none of its tables or functions touch Synergy Swift's
 * `public` schema. Its schools, users, classes, subject teachers and class
 * members are kept as copies of Synergy Swift's (triggers in the second
 * migration, 6110), so there are no separate rosters or accounts.
 *
 * Usage: node scripts/port-swiftcipher.mjs [path-to-swiftcipher]
 * Writes supabase/migrations/20260101006100_live_engine.sql. Re-run when the
 * SwiftCipher source changes; the output is committed.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";

const src = resolve(process.argv[2] ?? join(process.cwd(), "..", "swiftcipher"));
const dir = join(src, "supabase", "migrations");
const files = readdirSync(dir).filter(f => f.endsWith(".sql")).sort();
let commit = "unknown";
try { commit = execSync("git rev-parse --short HEAD", { cwd: src }).toString().trim(); } catch { /* not a git checkout */ }

/** Every change made to SwiftCipher's SQL, in order. Each must apply at least once or the run stops. */
const RULES = [
  // Tables, types and functions move from public to live.
  [/\bpublic\./g, "live."],
  // Blanket grants/revokes ("on all tables in schema public", default privileges) must only ever touch live.
  [/\bin schema public\b/g, "in schema live"],
  // Catalog queries that name the schema as text.
  [/(nspname|schemaname|table_schema) = 'public'/g, "$1 = 'live'"],
  // Helper schema app → live_app (also inside cron command strings).
  [/\bschema if not exists app\b/g, "schema if not exists live_app"],
  [/\bschema app\b/g, "schema live_app"],
  [/\bapp\./g, "live_app."],
  // Storage buckets shared with Synergy Swift's own names get a live- prefix.
  [/\('lesson-media', 'lesson-media',/g, "('live-lesson-media', 'live-lesson-media',"],
  [/\('submissions', 'submissions',/g, "('live-submissions', 'live-submissions',"],
  [/bucket_id = 'lesson-media'/g, "bucket_id = 'live-lesson-media'"],
  [/bucket_id = 'submissions'/g, "bucket_id = 'live-submissions'"],
  [/policy "lesson media /g, "policy \"live lesson media "],
  [/policy "submission /g, "policy \"live submission "],
  // Scheduled jobs.
  [/'swiftcipher-/g, "'synergy-live-"]
];

/**
 * Splits SQL into top-level statements, respecting quotes, dollar quotes and
 * comments, so each statement can be made safe to run twice.
 */
function statements(sql) {
  const out = [];
  let cur = "", i = 0, dollar = null;
  while (i < sql.length) {
    const ch = sql[i], two = sql.slice(i, i + 2);
    if (dollar) {
      if (sql.startsWith(dollar, i)) { cur += dollar; i += dollar.length; dollar = null; continue; }
      cur += ch; i++; continue;
    }
    if (two === "--") { const e = sql.indexOf("\n", i); const end = e < 0 ? sql.length : e; cur += sql.slice(i, end); i = end; continue; }
    if (two === "/*") { const e = sql.indexOf("*/", i + 2); const end = e < 0 ? sql.length : e + 2; cur += sql.slice(i, end); i = end; continue; }
    if (ch === "'") { let j = i + 1; while (j < sql.length && !(sql[j] === "'" && sql[j + 1] !== "'")) j += sql[j] === "'" ? 2 : 1; cur += sql.slice(i, j + 1); i = j + 1; continue; }
    if (ch === '"') { const j = sql.indexOf('"', i + 1); cur += sql.slice(i, j + 1); i = j + 1; continue; }
    if (ch === "$") { const m = /^\$[A-Za-z_]*\$/.exec(sql.slice(i)); if (m) { dollar = m[0]; cur += m[0]; i += m[0].length; continue; } }
    if (ch === ";") { out.push(cur + ";"); cur = ""; i++; continue; }
    cur += ch; i++;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** Strips leading comments/blank lines to see what a statement is. */
const head = s => s.replace(/^(\s|--[^\n]*\n)+/, "").toLowerCase();

/** Makes one statement safe to run again (the update file may be run twice). */
function idempotent(stmt) {
  const h = head(stmt);
  let m;
  if ((m = /^create table (live\.[a-z_0-9]+)/.exec(h))) return stmt.replace(/create table (live\.)/i, "create table if not exists $1");
  if ((m = /^create (unique )?index (?!if not exists)([a-z_0-9]+)/.exec(h))) return stmt.replace(/create (unique )?index /i, (_x, u) => `create ${u ?? ""}index if not exists `);
  if ((m = /^create policy ("[^"]+"|[a-z_0-9]+)\s+on\s+([a-z_.0-9]+)/.exec(h))) return `drop policy if exists ${m[1]} on ${m[2]};\n${stmt}`;
  if ((m = /^create trigger ([a-z_0-9]+)[\s\S]*?\bon\s+([a-z_]+\.[a-z_0-9]+)/.exec(h))) return `drop trigger if exists ${m[1]} on ${m[2]};\n${stmt}`;
  if ((m = /^alter table (?:only )?([a-z_.0-9]+)\s+add constraint ([a-z_0-9]+)/.exec(h))) return `alter table ${m[1]} drop constraint if exists ${m[2]};\n${stmt}`;
  if (/^alter table [a-z_.0-9]+\s+add column (?!if not exists)/.test(h)) return stmt.replace(/add column (?!if not exists)/gi, "add column if not exists ");
  if (/^create view /.test(h)) return stmt.replace(/create view /i, "create or replace view ");
  if (/^insert into /.test(h) && !/on conflict/i.test(stmt)) return stmt.replace(/;\s*$/, "\non conflict do nothing;");
  return stmt;
}

const used = new Map(RULES.map((_, i) => [i, 0]));
let out = `-- =========================================================================
-- Phase 14d-2: SwiftCipher's live-lesson engine as Synergy Swift's live module.
-- GENERATED by scripts/port-swiftcipher.mjs from SwiftCipher ${commit}
-- (${files.length} migrations). Do not edit by hand; change the source or the script.
--
-- Everything lives in schema "live" (helpers in "live_app"), apart from
-- Synergy Swift's "public" schema. Identity and classes are copied in by
-- 20260101006110_live_sync.sql.
--
-- Supabase needs "live" in Settings → API → Exposed schemas (once).
-- Apply AFTER 20260101006000. Safe to run again (the generator guards each statement).
-- =========================================================================

create schema if not exists live;
grant usage on schema live to anon, authenticated, service_role;
-- The same default privileges Supabase gives the public schema; the engine's
-- own revokes below then narrow them exactly as they do in SwiftCipher.
alter default privileges in schema live grant all on tables to anon, authenticated, service_role;
alter default privileges in schema live grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema live grant execute on functions to anon, authenticated, service_role;
`;

for (const f of files) {
  let sql = readFileSync(join(dir, f), "utf8").replace(/\r\n/g, "\n");
  RULES.forEach(([re, to], i) => {
    const n = (sql.match(re) ?? []).length;
    used.set(i, used.get(i) + n);
    sql = sql.replace(re, to);
  });
  sql = statements(sql).map(idempotent).join("");
  // Policies created inside DO blocks (e.g. on realtime.messages when it exists) get the same guard.
  sql = sql.replace(/(^|\n)([ \t]+)create policy ("[^"]+"|[a-z_0-9]+)\s+on\s+([a-z_.0-9]+)/g,
    (_m, nl, ind, name, table) => `${nl}${ind}drop policy if exists ${name} on ${table};\n${ind}create policy ${name} on ${table}`);
  out += `\n-- ===================== ${f} =====================\n${sql.trim()}\n`;
}

const unused = RULES.filter((_, i) => !used.get(i));
if (unused.length) { console.error("rules that matched nothing:", unused.map(r => String(r[0]))); process.exit(1); }
// Nothing from SwiftCipher may still point at Synergy Swift's public schema.
const leftover = out.split("\n").filter(l => (/\bpublic\.[a-z_]/.test(l) || /schema public\b/.test(l) || /'public'/.test(l)) && !l.trimStart().startsWith("--"));
if (leftover.length) { console.error("still mentions public.:", leftover.slice(0, 5)); process.exit(1); }

const target = join(process.cwd(), "supabase", "migrations", "20260101006100_live_engine.sql");
writeFileSync(target, out);
console.log(`port-swiftcipher: ${files.length} migrations, ${out.split("\n").length} lines → ${target}`);
console.log("rule hits:", RULES.map((r, i) => `${String(r[0]).slice(1, 28)}=${used.get(i)}`).join("  "));
