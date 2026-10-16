// Saved reports: private unless shared, owned by their author, and sent on a schedule only to staff of the same school.
export default async function ({ db, q, expectRows, expectError, expectOk, check, U, T }) {
  const R1 = "f1000000-0000-0000-0000-000000000001", R2 = "f1000000-0000-0000-0000-000000000002";
  console.log("\nSaved reports");
  await expectOk("a teacher saves a private report", U.teacherA,
    `insert into saved_reports (id, tenant_id, owner_id, name, dataset, spec) values ('${R1}', '${T.A}', '${U.teacherA}', 'My class attendance', 'attendance', '{"columns":["student","rate"]}')`);
  await expectError("…but not in someone else's name", U.teacherA,
    `insert into saved_reports (tenant_id, owner_id, name, dataset) values ('${T.A}', '${U.teacherA2}', 'Fake', 'students')`, /row-level security/);
  await expectError("parents cannot save reports", U.parentA,
    `insert into saved_reports (tenant_id, owner_id, name, dataset) values ('${T.A}', '${U.parentA}', 'Mine', 'students')`, /row-level security/);
  await expectRows("another teacher cannot see a private report", U.teacherA2, "select count(*) n from saved_reports", 0);
  await expectRows("the head can", U.adminA, "select count(*) n from saved_reports", 1);
  await expectOk("the author shares it", U.teacherA, `update saved_reports set shared = true where id = '${R1}'`);
  await expectRows("now colleagues see it", U.teacherA2, "select count(*) n from saved_reports", 1);
  await expectRows("students never do", U.studentA, "select count(*) n from saved_reports", 0);
  await expectOk("a colleague's change does nothing", U.teacherA2, `update saved_reports set name = 'Hijacked' where id = '${R1}'`);
  const n = await q(`select name from saved_reports where id = '${R1}'`);
  check("…so the name stands", n[0].name === "My class attendance", n[0]);
  await expectError("the author cannot hand it to someone else", U.teacherA, `update saved_reports set owner_id = '${U.teacherA2}' where id = '${R1}'`, /only admins/);

  console.log("\nScheduled reports");
  await expectOk("weekly on Mondays to two colleagues", U.adminA,
    `insert into saved_reports (id, tenant_id, owner_id, name, dataset, schedule, schedule_day, recipient_ids) values ('${R2}', '${T.A}', '${U.adminA}', 'Debtors', 'invoices', 'weekly', 1, array['${U.adminA}', '${U.bursarA}']::uuid[])`);
  await expectError("a schedule needs someone to send to", U.adminA, `update saved_reports set recipient_ids = '{}' where id = '${R2}'`, /check constraint/);
  await expectError("weekly needs a weekday", U.adminA, `update saved_reports set schedule_day = 9 where id = '${R2}'`, /check constraint/);
  await expectError("never to parents", U.adminA, `update saved_reports set recipient_ids = array['${U.parentA}']::uuid[] where id = '${R2}'`, /only be sent to staff/);
  await expectError("never to students", U.adminA, `update saved_reports set recipient_ids = array['${U.studentA}']::uuid[] where id = '${R2}'`, /only be sent to staff/);
  await expectError("never to another school's staff", U.adminA, `update saved_reports set recipient_ids = array['${U.adminB}']::uuid[] where id = '${R2}'`, /only be sent to staff/);
  await expectRows("another school sees no reports", U.adminB, "select count(*) n from saved_reports", 0);
  await expectOk("the author deletes their report", U.teacherA, `delete from saved_reports where id = '${R1}'`);
  await db.exec(`delete from saved_reports`);
}
