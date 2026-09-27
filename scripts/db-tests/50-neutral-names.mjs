// Drafting features use neutral names in the schema and the audit log.
import fs from "fs";
export default async function ({ db, q, check }) {
  console.log("\nNeutral names");
  const cols = await q(`select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'lesson_notes' and column_name in ('ai_generated', 'drafted')`);
  check("lesson notes record 'drafted' (old column renamed)", cols.length === 1 && cols[0].column_name === "drafted", cols);

  await db.exec(`insert into audit_logs (action) values ('ai.report_comments'), ('ai.lesson_note_generated')`);
  // Re-running the migration renames entries written before it (and is safe to repeat).
  await db.exec(fs.readFileSync(new URL("../../supabase/migrations/20260101002100_neutral_names.sql", import.meta.url), "utf8"));
  const old = await q("select count(*) n from audit_logs where action like 'ai.%'");
  check("old audit entries are renamed", Number(old[0].n) === 0, old[0]);
}
