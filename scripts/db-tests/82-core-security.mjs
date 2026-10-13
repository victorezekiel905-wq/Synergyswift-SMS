// Core platform and security: roles, sign-in rules enforced in the database, change history, sections, consent.
export default async function ({ db, q, as, expectRows, expectError, expectOk, check, setClaims, U, T }) {
  const COUNS = "a0000000-0000-0000-0000-0000000000c1", ALUM = "a0000000-0000-0000-0000-0000000000c2";
  const KID = "a8000000-0000-0000-0000-000000000001", G = "a9000000-0000-0000-0000-000000000001";
  const S1 = "c1000000-0000-0000-0000-000000000001", S2 = "c1000000-0000-0000-0000-000000000002", S3 = "c1000000-0000-0000-0000-000000000003";
  const state = async uid => (await as(uid, () => q("select my_account_state() s")))[0].s.state;
  const settings = sql => db.exec(`insert into tenant_settings (tenant_id) values ('${T.A}') on conflict (tenant_id) do nothing; update tenant_settings set ${sql} where tenant_id = '${T.A}';`);
  const reset = () => settings(`password_max_age_days = 0, sso_policy = 'optional', session_max_hours = 0, staff_access_mode = 'off', staff_access_roles = 'except_admins', staff_ip_allowlist = '{}'`);

  console.log("\nRoles");
  await db.exec(`insert into auth.users (id) values ('${COUNS}'), ('${ALUM}');
    insert into users (id, tenant_id, email, full_name, role) values ('${COUNS}', '${T.A}', 'c@a', 'Counsellor A', 'counsellor'), ('${ALUM}', '${T.A}', 'old@a', 'Old Student', 'alumni');
    insert into medical_profiles (tenant_id, student_id, allergies) values ('${T.A}', '${KID}', 'peanuts') on conflict (student_id) do nothing;`);
  await expectRows("a counsellor counts as staff and sees students", COUNS, "select count(*) n from students", 2);
  await expectRows("a counsellor reads health records", COUNS, "select count(*) n from medical_profiles", 1);
  await expectRows("…but cannot change them", COUNS, `with u as (update medical_profiles set allergies = 'none' where student_id = '${KID}' returning 1) select count(*) n from u`, 0);
  await expectRows("an alumni account sees no school data", ALUM, "select (select count(*) from students) + (select count(*) from users) + (select count(*) from school_events) n", 0);
  check("alumni are told to use the alumni page", (await state(ALUM)) === "alumni");
  await expectRows("other accounts do not see alumni accounts in the staff list", U.studentA, `select count(*) n from users where id = '${ALUM}'`, 0);

  console.log("\nPassword and sign-on rules");
  await expectError("nobody moves their own password clock", U.teacherA, `update users set password_changed_at = now() where id = '${U.teacherA}'`, /set by the server/);
  await settings(`password_max_age_days = 30`);
  await db.exec(`update users set password_changed_at = now() - interval '40 days' where id in ('${U.teacherA}', '${U.parentA}')`);
  check("an expired staff password locks the school's data", (await state(U.teacherA)) === "password_expired");
  await expectRows("…so the teacher sees nothing", U.teacherA, "select count(*) n from students", 0);
  await expectRows("parents are not affected when the rule is for staff", U.parentA, `select count(*) n from students where id = '${KID}'`, 1);
  await settings(`password_policy_scope = 'all'`);
  check("…but are when it covers everyone", (await state(U.parentA)) === "password_expired");
  await db.exec(`update users set password_changed_at = now() where id in ('${U.teacherA}', '${U.parentA}')`);
  check("a new password restores access", (await state(U.teacherA)) === "active");
  await settings(`password_policy_scope = 'staff'`);
  await reset();

  await settings(`sso_policy = 'required_staff'`);
  check("staff signed in with a password are stopped when single sign-on is required", (await state(U.teacherA)) === "sso_required");
  setClaims({ amr: [{ method: "oauth", timestamp: 1 }] });
  await expectRows("…and let in after Google or Microsoft sign-in", U.teacherA, "select count(*) n from students", 2);
  setClaims({});
  await expectRows("parents still sign in with a password", U.parentA, `select count(*) n from students where id = '${KID}'`, 1);
  await reset();

  console.log("\nSessions");
  await db.exec(`insert into auth.sessions (id, user_id, created_at, updated_at, user_agent) values
    ('${S1}', '${U.teacherA}', now() - interval '10 hours', now(), 'Chrome'), ('${S2}', '${U.teacherA}', now() - interval '1 hour', now(), 'Safari'),
    ('${S3}', '${U.teacherA2}', now(), now(), 'Edge')`);
  await settings(`session_max_hours = 8`);
  setClaims({ session_id: S1 });
  check("a session older than the school's limit must sign in again", (await state(U.teacherA)) === "session_expired");
  setClaims({ session_id: S2 });
  await expectRows("a newer session carries on", U.teacherA, "select count(*) n from students", 2);
  await reset();
  await expectRows("people see their own signed-in devices", U.teacherA, "select count(*) n from my_sessions()", 2);
  await expectRows("…and sign the others out", U.teacherA, "select end_my_sessions(null, true) n", 1);
  await expectRows("…leaving this one", U.teacherA, "select count(*) n from my_sessions() where current", 1);
  setClaims({});
  await expectError("teachers cannot sign other people out", U.teacherA, `select end_user_sessions('${U.teacherA2}')`, /not allowed/);
  await expectRows("admins can sign a member of staff out everywhere", U.adminA, `select end_user_sessions('${U.teacherA2}') n`, 1);
  await expectError("…but not someone at another school", U.adminB, `select end_user_sessions('${U.teacherA}')`, /not allowed/);

  console.log("\nStaff network and device rule");
  await settings(`staff_access_mode = 'ip', staff_ip_allowlist = '{41.58.0.0/16}'`);
  setClaims({ session_id: S2 });
  check("without a check by the server, a teacher's session is restricted", (await state(U.teacherA)) === "access_restricted");
  await expectRows("…and sees nothing", U.teacherA, "select count(*) n from students", 0);
  await expectRows("admins are spared by default", U.adminA, "select count(*) n from students", 2);
  await db.exec(`insert into access_grants (user_id, session_id, tenant_id, expires_at) values ('${U.teacherA}', '${S2}', '${T.A}', now() + interval '20 minutes')`);
  await expectRows("a grant from the server opens this session", U.teacherA, "select count(*) n from students", 2);
  setClaims({ session_id: S1 });
  await expectRows("…but not another session", U.teacherA, "select count(*) n from students", 0);
  setClaims({ session_id: S2 });
  await db.exec(`update access_grants set expires_at = now() - interval '1 minute' where user_id = '${U.teacherA}'`);
  await expectRows("expired grants stop working", U.teacherA, "select count(*) n from students", 0);
  await expectRows("parents are never restricted", U.parentA, `select count(*) n from students where id = '${KID}'`, 1);
  setClaims({});
  await reset();
  await expectError("nobody reads access grants directly", U.adminA, "select * from access_grants", /permission denied/);
  await expectError("…or sign-in codes", U.adminA, "select * from phone_login_codes", /permission denied/);
  await db.exec(`insert into staff_devices (tenant_id, user_id, device_hash, label) values ('${T.A}', '${U.teacherA}', 'h1', 'Chrome'), ('${T.A}', '${U.teacherA2}', 'h2', 'Edge')`);
  await expectRows("staff see only their own devices", U.teacherA, "select count(*) n from staff_devices", 1);
  await expectRows("admins see every device", U.adminA, "select count(*) n from staff_devices", 2);
  await expectError("staff cannot approve their own device", U.teacherA, `insert into staff_devices (tenant_id, user_id, device_hash, status) values ('${T.A}', '${U.teacherA}', 'h3', 'approved')`, /row-level security/);

  console.log("\nChange history");
  const base = (await q(`select count(*)::int n from data_changes where table_name = 'students' and row_id = '${KID}'`))[0].n;
  const all = (await q(`select count(*)::int n from data_changes where table_name = 'students' and tenant_id = '${T.A}'`))[0].n;
  await as(U.adminA, () => q(`update students set other_names = 'Chiamaka' where id = '${KID}'`));
  const ch = await q(`select op, actor_id, actor, changes from data_changes where table_name = 'students' and row_id = '${KID}' order by id desc limit 1`);
  check("an edit is recorded with who made it and the old and new values", ch[0]?.op === "update" && ch[0].actor_id === U.adminA && JSON.stringify(ch[0].changes.other_names) === JSON.stringify([null, "Chiamaka"]), ch[0]);
  await db.exec(`select set_config('request.jwt.claims', '{"role":"service_role"}', false); select set_config('request.headers', '{"x-actor":"user:${U.bursarA}"}', false);
    update students set address = 'Lekki' where id = '${KID}';
    select set_config('request.jwt.claims', '', false); select set_config('request.headers', '', false);`);
  const sv = await q(`select actor_id from data_changes where table_name = 'students' and row_id = '${KID}' order by id desc limit 1`);
  check("a server write names the person it acted for", sv[0]?.actor_id === U.bursarA, sv[0]);
  await db.exec(`select set_config('request.headers', '{"x-actor":"user:${U.adminB}"}', false); update students set address = 'Ikeja' where id = '${KID}'; select set_config('request.headers', '', false);`);
  const forged = await q(`select actor_id, actor from data_changes where table_name = 'students' and row_id = '${KID}' order by id desc limit 1`);
  check("…but the header is ignored unless the server sent it", forged[0]?.actor_id === null && forged[0].actor === "system", forged[0]);
  await db.exec(`update guardians set portal_token = encode(gen_random_bytes(24), 'hex') where id = '${G}'`);
  const tok = await q(`select changes from data_changes where table_name = 'guardians' and row_id = '${G}' order by id desc limit 1`);
  check("secret tokens are never stored in the history", tok[0]?.changes.portal_token === "[hidden]", tok[0]);
  await db.exec(`update students set other_names = other_names where id = '${KID}'`);
  const noop = await q(`select count(*)::int n from data_changes where table_name = 'students' and row_id = '${KID}'`);
  check("saving without changes adds nothing", noop[0].n === base + 3, { ...noop[0], base });
  await expectRows("admins read the history", U.adminA, `select count(*) n from data_changes where table_name = 'students'`, all + 3);
  await expectRows("teachers do not", U.teacherA, "select count(*) n from data_changes", 0);
  await expectRows("another school does not", U.adminB, `select count(*) n from data_changes where tenant_id = '${T.A}'`, 0);
  await expectError("nobody edits the history", U.adminA, "delete from data_changes", /permission denied/);

  console.log("\nSections and consent");
  await expectOk("an admin adds a section", U.adminA, `insert into school_sections (tenant_id, name, kind, curriculum) values ('${T.A}', 'Junior Secondary', 'secondary', 'ng_jss')`);
  await expectOk("and puts a class in it", U.adminA, `update class_groups set section_id = (select id from school_sections where name = 'Junior Secondary'), curriculum = 'uk_ks3' where tenant_id = '${T.A}'`);
  await expectRows("staff see sections", U.teacherA, "select count(*) n from school_sections", 1);
  await expectError("teachers cannot add sections", U.teacherA, `insert into school_sections (tenant_id, name) values ('${T.A}', 'Primary')`, /row-level security/);
  await db.exec(`insert into consent_purposes (id, tenant_id, key, title, per_child) values ('c2000000-0000-0000-0000-000000000001', '${T.A}', 'photos_public', 'Photos', true)`);
  await expectOk("an admin records a paper consent", U.adminA, `insert into consent_records (tenant_id, purpose_id, version, student_id, granted, method, recorded_by)
    values ('${T.A}', 'c2000000-0000-0000-0000-000000000001', 1, '${KID}', false, 'paper', '${U.adminA}')`);
  await expectError("…but cannot pose as a parent's own answer", U.adminA, `insert into consent_records (tenant_id, purpose_id, version, student_id, granted, method, recorded_by)
    values ('${T.A}', 'c2000000-0000-0000-0000-000000000001', 1, '${KID}', true, 'portal', '${U.adminA}')`, /row-level security/);
  await expectRows("teachers can check photo permission", U.teacherA, "select count(*) n from consent_records", 1);
  await expectError("teachers cannot record consent", U.teacherA, `insert into consent_records (tenant_id, purpose_id, version, student_id, granted, method, recorded_by)
    values ('${T.A}', 'c2000000-0000-0000-0000-000000000001', 1, '${KID}', true, 'staff', '${U.teacherA}')`, /row-level security/);
  await expectRows("parents do not read the register directly", U.parentA, "select count(*) n from consent_records", 0);
}
