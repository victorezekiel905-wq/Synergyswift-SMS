// Phase 14b: platform owner, plans and invoices only the platform writes, custom roles kept inside each school.
export default async function ({ db, q, as, expectRows, expectError, expectOk, check, U, T }) {
  const OWNER = "c0000000-0000-0000-0000-0000000000aa", ROLE_A = "f6000000-0000-0000-0000-000000000001", ROLE_B = "f6000000-0000-0000-0000-000000000002";
  const server = async (name, sql, re) => {
    try { await q(sql); check(name, !re, re ? "expected an error" : null); }
    catch (e) { check(name, Boolean(re && re.test(e.message)), e.message); }
  };
  console.log("\nPlatform owner and team");
  await q(`insert into auth.users (id, email) values ('${OWNER}', 'EkwuemeVictor39@gmail.com')`);
  const own = await q(`select role from platform_admins where user_id = '${OWNER}'`);
  check("the owner email is made platform owner when its account is created", own[0]?.role === "owner", own[0]);
  await server("the owner cannot be removed", `delete from platform_admins where user_id = '${OWNER}'`, /cannot be removed/);
  await server("the owner cannot be demoted", `update platform_admins set role = 'support' where user_id = '${OWNER}'`, /cannot be demoted/);
  const pr = await as(OWNER, () => q("select public.platform_role() r"));
  check("platform_role() tells the owner their role", pr[0]?.r === "owner", pr[0]);
  const none = await as(U.adminA, () => q("select public.platform_role() r"));
  check("a school admin has no platform role", none[0]?.r === null, none[0]);
  await expectError("schools cannot read the platform team", U.adminA, "select count(*) n from platform_admins", /permission denied/);
  await expectError("schools cannot read platform settings or prices behind them", U.adminA, "select * from platform_settings", /permission denied/);

  console.log("\nSubscriptions and invoices");
  await q(`insert into subscriptions (tenant_id, plan, status) values ('${T.A}', 'Growth', 'active') on conflict (tenant_id) do nothing`);
  await q(`insert into invoices (tenant_id, amount_cents, status, number) values ('${T.A}', 80000000, 'open', public.next_platform_invoice_number())`);
  const num = await q(`select number from invoices where tenant_id = '${T.A}' order by created_at desc limit 1`);
  check("invoices are numbered SS-year-00001", /^SS-\d{4}-\d{5}$/.test(num[0]?.number ?? ""), num[0]);
  await expectRows("the school admin sees their subscription", U.adminA, "select count(*) n from subscriptions", 1);
  await expectRows("a teacher does not", U.teacherA, "select count(*) n from subscriptions", 0);
  await expectRows("the school admin sees their invoices", U.adminA, "select count(*) n from invoices", 1);
  await expectRows("another school sees none of them", U.adminB, "select count(*) n from invoices", 0);
  await expectError("staff cannot write invoices any more", U.adminA, `insert into invoices (tenant_id, amount_cents, status) values ('${T.A}', 1, 'paid')`, /row-level security/);
  await expectOk("…nor change their subscription (nothing happens)", U.adminA, `update subscriptions set status = 'active', discount_pct = 100 where tenant_id = '${T.A}'`);
  const sub = await q(`select discount_pct from subscriptions where tenant_id = '${T.A}'`);
  check("…so the discount is unchanged", Number(sub[0].discount_pct) === 0, sub[0]);
  await expectOk("schools cannot set their own module overrides (nothing happens)", U.adminA, `insert into tenant_module_overrides (tenant_id, module, mode) select '${T.A}', 'fees', 'on' where false`);
  await expectError("…and a direct insert is refused", U.adminA, `insert into tenant_module_overrides (tenant_id, module, mode) values ('${T.A}', 'fees', 'on')`, /row-level security/);

  console.log("\nModule requests");
  await expectOk("a school admin asks for a module", U.adminA, `insert into module_requests (tenant_id, module, action, requested_by) values ('${T.A}', 'transport', 'add', '${U.adminA}')`);
  await expectError("…but cannot mark it done", U.adminA, `insert into module_requests (tenant_id, module, action, requested_by, status) values ('${T.A}', 'library', 'add', '${U.adminA}', 'done')`, /row-level security/);
  await expectError("a teacher cannot ask", U.teacherA, `insert into module_requests (tenant_id, module, action, requested_by) values ('${T.A}', 'library', 'add', '${U.teacherA}')`, /row-level security/);
  await expectRows("another school cannot see the request", U.adminB, "select count(*) n from module_requests", 0);

  console.log("\nCustom roles");
  await expectOk("a school admin makes a custom role", U.adminA, `insert into tenant_roles (id, tenant_id, name, grants, deny_permissions) values ('${ROLE_A}', '${T.A}', 'Exams officer', '{qa_officer}', '{results.publish}')`);
  await expectError("a teacher cannot", U.teacherA, `insert into tenant_roles (tenant_id, name) values ('${T.A}', 'Boss')`, /row-level security/);
  await expectError("no role may grant platform admin", U.adminA, `insert into tenant_roles (tenant_id, name, grants) values ('${T.A}', 'Sneaky', '{platform_admin}')`, /check constraint/);
  await expectRows("staff can read their school's roles", U.teacherA, "select count(*) n from tenant_roles", 1);
  await expectRows("another school cannot", U.adminB, "select count(*) n from tenant_roles", 0);
  await expectOk("the admin gives a teacher the role", U.adminA, `update users set custom_role_id = '${ROLE_A}' where id = '${U.teacherA}'`);
  const tr = await q(`select custom_role_id from users where id = '${U.teacherA}'`);
  check("…and it sticks", tr[0].custom_role_id === ROLE_A, tr[0]);
  await expectError("a teacher cannot give themselves a role", U.teacherA2, `update users set custom_role_id = '${ROLE_A}' where id = '${U.teacherA2}'`, /cannot change your own role/);
  await q(`insert into tenant_roles (id, tenant_id, name) values ('${ROLE_B}', '${T.B}', 'Other school role')`);
  await server("a role from another school cannot be given", `update users set custom_role_id = '${ROLE_B}' where id = '${U.teacherA}'`, /another school/);
  await q(`update users set custom_role_id = null where id = '${U.teacherA}'`);
  await db.exec(`delete from tenant_roles where id in ('${ROLE_A}', '${ROLE_B}'); delete from module_requests; delete from invoices where tenant_id = '${T.A}';`);
}
