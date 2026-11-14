// Class sign-up codes (migration 10300): every class has one shared code; students who use it
// wait in class_signups until the class teacher confirms them. Only the server reads either table.
export default async function ({ q, expectError, check, U, T }) {
  console.log("\nClass sign-up codes: one per class, server only");
  const one = async sql => (await q(sql))[0];

  const existing = await one(`select count(*)::int n from class_groups g where not exists (select 1 from class_signup_codes c where c.class_group_id = g.id)`);
  check("every class already there has a code", existing.n === 0, existing);

  const CG = "a7c00000-0000-0000-0000-000000000001";
  await q(`insert into class_groups (id, tenant_id, name) values ('${CG}', '${T.A}', 'Code Class 1')`);
  const c1 = (await one(`select code, tenant_id from class_signup_codes where class_group_id = '${CG}'`)) ?? {};
  check("a new class gets its code at once", /^[A-HJ-NP-Z2-9]{8}$/.test(c1.code ?? "") && c1.tenant_id === T.A, c1);
  check("a class code is never the same as a personal code", !(await one(`select 1 x from account_codes where code = '${c1.code}'`)));

  const c2 = (await one(`select issue_class_code('${CG}') c`)).c;
  const now = await one(`select code from class_signup_codes where class_group_id = '${CG}'`);
  check("a new class code replaces the old one", c2 !== c1.code && now.code === c2);

  // A waiting request, as the sign-up page makes it.
  const SU = "a7c10000-0000-0000-0000-000000000001";
  await q(`insert into auth.users (id, email) values ('${SU}', 'kid.one@students.test')`);
  await q(`insert into class_signups (tenant_id, class_group_id, user_id, full_name, username, email) values ('${T.A}', '${CG}', '${SU}', 'Kid One', 'kid.one', 'kid.one@students.test')`);
  check("a waiting request starts as pending", (await one(`select status from class_signups where user_id = '${SU}'`)).status === "pending");
  try { await q(`insert into class_signups (tenant_id, class_group_id, user_id, full_name, email) values ('${T.A}', '${CG}', '${SU}', 'Again', 'x@y.z')`); check("one request per sign-in", false); }
  catch (e) { check("one request per sign-in", /unique|duplicate/i.test(e.message), e.message); }

  await expectError("students can't read class codes", U.studentA, "select * from class_signup_codes", /permission denied/);
  await expectError("parents can't read class codes", U.parentA, "select * from class_signup_codes", /permission denied/);
  await expectError("staff read requests only through the server", U.teacherA, "select * from class_signups", /permission denied/);
  await expectError("nobody signed in can make a class code", U.adminA, `select issue_class_code('${CG}')`, /permission denied/);

  const col = await one(`select column_default, is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'tenant_settings' and column_name = 'class_signup_enabled'`);
  check("class codes are off unless the school turns them on (students use their own code)", col?.column_default === "false" && col?.is_nullable === "NO", col);

  await q(`delete from class_groups where id = '${CG}'`);
  check("deleting the class removes its code and its waiting requests",
    !(await one(`select 1 x from class_signup_codes where class_group_id = '${CG}'`)) && !(await one(`select 1 x from class_signups where class_group_id = '${CG}'`)));
  check("…and neither is kept in the recycle bin", !(await one(`select 1 x from recycle_bin where table_name in ('class_signup_codes', 'class_signups')`)));
}
