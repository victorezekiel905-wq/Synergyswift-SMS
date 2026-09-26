// Suspension and deactivation lock every module, including the older LMS tables.
export default async function ({ db, as, q, expectRows, check, U, T }) {
  console.log("\nSuspension and deactivation");
  await db.exec(`insert into lessons (id, tenant_id, owner_id, title) values ('b2000000-0000-0000-0000-000000000001', '${T.A}', '${U.teacherA}', 'Algebra')`);
  await expectRows("active school: teacher reads the LMS lesson", U.teacherA, "select count(*) n from lessons", 1);

  await db.exec(`update tenants set status = 'suspended' where id = '${T.A}'`);
  await expectRows("suspended school: LMS lessons are locked too", U.teacherA, "select count(*) n from lessons", 0);
  await expectRows("suspended school: no user rows visible", U.adminA, "select count(*) n from users", 0);
  await expectRows("suspended school: fees locked", U.bursarA, "select count(*) n from fee_invoices", 0);
  const state = await as(U.adminA, () => q("select my_account_state() s"));
  check("the app can still explain the suspension", state[0].s.state === "suspended", state[0].s);
  await expectRows("other schools are unaffected", U.adminB, "select count(*) n from students", 1);
  await db.exec(`update tenants set status = 'active' where id = '${T.A}'`);
  await expectRows("reactivated school: access restored", U.teacherA, "select count(*) n from lessons", 1);

  await db.exec(`update users set active = false where id = '${U.teacherA2}'`);
  await expectRows("deactivated staff member sees no students", U.teacherA2, "select count(*) n from students", 0);
  const st2 = await as(U.teacherA2, () => q("select my_account_state() s"));
  check("deactivated state is reported", st2[0].s.state === "deactivated", st2[0].s);
  await db.exec(`update users set active = true where id = '${U.teacherA2}'`);
  await expectRows("reactivated staff member sees students again", U.teacherA2, "select count(*) n from students", 2);
}
