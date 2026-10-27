// Phase 14k: support access that the database stops honouring when it ends, the school's view of support visits, and the centre's service-only numbers.
export default async function ({ db, q, expectRows, expectError, check, U, T }) {
  const SUP = "ec000000-0000-0000-0000-000000000001", SESSION = "ec000000-0000-0000-0000-000000000002";
  const server = async (name, sql, re) => {
    try { await q(sql); check(name, !re, re ? "expected an error" : null); }
    catch (e) { check(name, Boolean(re && re.test(e.message)), e.message); }
  };
  await db.exec(`insert into auth.users (id) values ('${SUP}');
    insert into users (id, tenant_id, email, full_name, role, support_until) values ('${SUP}', '${T.A}', 'support-x@support.synergyswift.invalid', 'Synergy Swift support (Owner)', 'school_admin', now() + interval '30 minutes');
    insert into platform_support_sessions (id, tenant_id, support_user_id, started_by_name, reason, expires_at) values ('${SESSION}', '${T.A}', '${SUP}', 'Owner', 'Ticket 12: report cards missing positions', now() + interval '30 minutes');`);

  console.log("\nSuper admin centre: support access");
  await expectRows("an open support session works in its school", SUP, `select count(*) n from (select count(*) c from students) x where c > 0`, 1);
  await expectRows("…and sees nothing of another school", SUP, `select count(*) n from tenants where id = '${T.B}'`, 0);
  await q(`update tenant_settings set require_mfa = 'admins' where tenant_id = '${T.A}'`);
  await expectRows("the school's second-factor rule does not block the platform's one-time support sign-in", SUP, `select count(*) n from (select count(*) c from students) x where c > 0`, 1);
  await expectRows("…while it still applies to the school's own admins", U.adminA, `select count(*) n from students`, 0);
  await q(`update tenant_settings set require_mfa = 'off' where tenant_id = '${T.A}'`);
  await q(`update users set support_until = now() - interval '1 second' where id = '${SUP}'`);
  await expectRows("the moment the session ends, the database stops honouring it", SUP, `select count(*) n from students`, 0);
  await expectRows("…and it reads no school data", SUP, `select count(*) n from students`, 0);
  await expectRows("ordinary accounts are unaffected", U.adminA, `select count(*) n from (select count(*) c from students) x where c > 0`, 1);

  console.log("\nSuper admin centre: the school sees support visits");
  await expectRows("the school's admin sees the visit and its reason", U.adminA, `select count(*) n from my_support_sessions() where reason like 'Ticket 12%'`, 1);
  await expectRows("a teacher does not", U.teacherA, `select count(*) n from my_support_sessions()`, 0);
  await expectRows("another school sees nothing", U.adminB, `select count(*) n from my_support_sessions()`, 0);
  await expectError("nobody in a school reads the platform's session table", U.adminA, `select count(*) from platform_support_sessions`, /permission denied/);
  await server("a session lasts an hour at most", `insert into platform_support_sessions (tenant_id, started_by_name, reason, expires_at) values ('${T.A}', 'Owner', 'Too long a visit here', now() + interval '3 hours')`, /check/);

  console.log("\nSuper admin centre: numbers");
  const act = await q(`select module, tenants from platform_module_activity(30)`);
  check("module activity is measured for the main modules", act.some(a => a.module === "exams") && act.some(a => a.module === "gate"), act.map(a => a.module));
  const size = await q(`select platform_db_size() n`);
  check("the database size is known", Number(size[0]?.n) > 0, size);
  await expectError("schools cannot call the centre's functions", U.adminA, `select * from platform_module_activity(30)`, /permission denied/);
  await expectError("…or read the database size", U.adminA, `select platform_db_size()`, /permission denied/);

  await db.exec(`delete from platform_support_sessions where id = '${SESSION}'; delete from users where id = '${SUP}'; delete from auth.users where id = '${SUP}';`);
}
