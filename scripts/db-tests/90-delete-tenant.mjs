// Runs last: deleting a whole school removes all of its data and nothing else.
export default async function ({ db, q, as, check, expectRows, U, T }) {
  console.log("\nPausing a school");
  await db.exec(`update tenants set status = 'paused', status_message = 'Closed for the holidays' where id = '${T.A}'`);
  await expectRows("a paused school sees no data", U.adminA, "select count(*) n from students", 0);
  const st = await as(U.teacherA, () => q("select my_account_state() s"));
  check("users are told the school is paused, with the message", st[0].s.state === "paused" && st[0].s.message === "Closed for the holidays", st[0].s);
  await db.exec(`update tenants set status = 'active', status_message = null where id = '${T.A}'`);
  await expectRows("restarting restores access", U.adminA, "select count(*) n from students", 2);

  console.log("\nDeleting a school");
  await db.exec(`insert into platform_audit_logs (action, tenant_id) values ('tenant.created', '${T.A}')`);
  const before = await q(`select count(*) n from students where tenant_id = '${T.B}'`);
  try {
    await db.exec(`select platform_delete_tenant('${T.A}')`);
    check("a school with data in every module can be deleted", true);
  } catch (e) { check("a school with data in every module can be deleted", false, e.message); return; }
  const left = await q(`select count(*) n from tenants where id = '${T.A}'`);
  check("the school is gone", Number(left[0].n) === 0, left[0]);
  const users = await q(`select count(*) n from users where tenant_id = '${T.A}'`);
  check("its accounts are gone", Number(users[0].n) === 0, users[0]);
  const after = await q(`select count(*) n from students where tenant_id = '${T.B}'`);
  const hist = await q(`select count(*) n from platform_audit_logs where tenant_id = '${T.A}'`);
  check("the platform keeps its history of the school", Number(hist[0].n) >= 1, hist[0]);
  check("other schools keep all their data", Number(after[0].n) === Number(before[0].n), { before: before[0], after: after[0] });
}
