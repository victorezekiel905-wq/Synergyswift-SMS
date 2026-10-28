// The weekly report to parents (migration 8100): on by default, each school's week claimed once, runs hidden from schools.
export default async function ({ db, q, expectError, check, U, T }) {
  console.log("\nWeekly report to parents");
  await db.exec(`insert into tenant_settings (tenant_id) values ('${T.A}') on conflict (tenant_id) do nothing;`);
  const s = await q(`select weekly_parent_report from tenant_settings where tenant_id = '${T.A}'`);
  check("schools get the weekly report unless they switch it off", s[0]?.weekly_parent_report === true, s);
  await q(`insert into weekly_report_runs (tenant_id, week_key) values ('${T.A}', '2026-W44')`);
  let twice = false;
  try { await q(`insert into weekly_report_runs (tenant_id, week_key) values ('${T.A}', '2026-W44')`); } catch { twice = true; }
  check("a school's week can only be claimed once", twice);
  let bad = false;
  try { await q(`insert into weekly_report_runs (tenant_id, week_key) values ('${T.A}', 'last week')`); } catch { bad = true; }
  check("week keys look like 2026-W44", bad);
  await expectError("signed-in people can't read or forge the runs", U.adminA, `select count(*) from weekly_report_runs`, /permission denied/);
  await db.exec(`delete from weekly_report_runs`);
}
