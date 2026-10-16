// Statutory returns: prepared and submitted by admins only, and kept exactly as sent once submitted.
export default async function ({ db, q, expectRows, expectError, expectOk, check, U, T }) {
  const R = "f0000000-0000-0000-0000-000000000001";
  console.log("\nStatutory returns");
  await expectOk("an admin prepares this year's school census", U.adminA,
    `insert into statutory_returns (id, tenant_id, period, data) values ('${R}', '${T.A}', '2026/2027', '{"enrolment": {"total": 2}}')`);
  await expectError("teachers cannot", U.teacherA, `insert into statutory_returns (tenant_id, period) values ('${T.A}', '2025/2026')`, /row-level security/);
  await expectRows("teachers cannot see returns", U.teacherA, "select count(*) n from statutory_returns", 0);
  await expectRows("the bursar cannot either", U.bursarA, "select count(*) n from statutory_returns", 0);
  await expectRows("another school sees nothing", U.adminB, "select count(*) n from statutory_returns", 0);
  await expectError("one census per year", U.adminA, `insert into statutory_returns (tenant_id, period) values ('${T.A}', '2026/2027')`, /duplicate|unique/);
  await expectOk("the admin corrects a figure while it is a draft", U.adminA, `update statutory_returns set data = '{"enrolment": {"total": 3}}' where id = '${R}'`);
  await expectOk("…and marks it submitted", U.adminA, `update statutory_returns set status = 'submitted' where id = '${R}'`);
  const s = await q(`select submitted_at is not null t, submitted_by = '${U.adminA}' b from statutory_returns where id = '${R}'`);
  check("…stamped with when and by whom", s[0].t && s[0].b, s[0]);
  await expectError("a submitted return cannot be changed", U.adminA, `update statutory_returns set data = '{}' where id = '${R}'`, /cannot be changed/);
  await expectError("…or put back to draft", U.adminA, `update statutory_returns set status = 'draft' where id = '${R}'`, /cannot be changed/);
  await expectOk("the ministry's reference can still be added", U.adminA, `update statutory_returns set reference = 'ASC-2026-0042' where id = '${R}'`);
  await expectError("a submitted return cannot be deleted", U.adminA, `delete from statutory_returns where id = '${R}'`, /cannot be deleted/);
  const d = await q(`select count(*) n from tenant_settings where census_profile = '{}'::jsonb`);
  check("schools start with an empty census profile", Number(d[0].n) >= 1, d[0]);
  await db.exec(`delete from statutory_returns where id = '${R}'`);
}
