// Phase 14q: build the whole Synergy Swift database in a STAGING Supabase project, in order,
// one transaction per migration (every migration is idempotent, so it can be run again).
// It refuses to run against the live project and leaves out the demo seed.
//
//   STAGING=yes STAGING_DB_URL='postgresql://postgres.<staging-ref>:<password>@aws-1-<region>.pooler.supabase.com:5432/postgres' \
//     node scripts/load/setup-staging.mjs
//
// Use the session pooler address from Supabase → Connect (the direct db.<ref> host is IPv6 only).
// The password is read from the environment and never printed.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const LIVE_REF = "zltofhayjsvtktmmlqmh";
const url = process.env.STAGING_DB_URL ?? "";
if (process.env.STAGING !== "yes" || !/^postgres(ql)?:\/\//.test(url)) { console.error("Set STAGING=yes and STAGING_DB_URL (the staging project's session pooler URL)."); process.exit(1); }
if (url.includes(LIVE_REF)) { console.error("This is the live project. Use a staging copy."); process.exit(1); }

let pg;
try { pg = (await import("pg")).default; } catch { console.error("Install the database client first: npm install"); process.exit(1); }

const root = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const dir = path.join(root, "supabase", "migrations");
const files = fs.readdirSync(dir).filter(f => f.endsWith(".sql") && !/_seed\.sql$/.test(f)).sort();

const db = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false }, statement_timeout: 0 });
await db.connect();
console.log(`connected; applying ${files.length} migrations`);
for (const f of files) {
  const [version, ...rest] = f.replace(/\.sql$/, "").split("_");
  const t = Date.now();
  try {
    await db.query("begin");
    await db.query(fs.readFileSync(path.join(dir, f), "utf8"));
    await db.query("create schema if not exists supabase_migrations; create table if not exists supabase_migrations.schema_migrations (version text primary key, name text)");
    await db.query("insert into supabase_migrations.schema_migrations(version, name) values ($1, $2) on conflict (version) do nothing", [version, rest.join("_")]);
    await db.query("commit");
    console.log(`ok   ${f} (${Date.now() - t} ms)`);
  } catch (e) {
    await db.query("rollback").catch(() => {});
    console.error(`FAIL ${f}: ${e.message}${e.where ? `\n  ${e.where}` : ""}`);
    await db.end();
    process.exit(2);
  }
}
await db.query("notify pgrst, 'reload schema'");
await db.end();
console.log("done. Next: in Supabase → Settings → API, add `live` to Exposed schemas and set Max rows to 50000, then run seed-staging.mjs.");
