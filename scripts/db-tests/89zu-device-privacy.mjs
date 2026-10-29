// Migration 8600: classroom devices stay inside their school, and the faster "students I teach" check gives the same answers.
export default async function ({ db, q, as, expectRows, check, U, T }) {
  console.log("\nClassroom devices stay inside their school");
  const kidB = "b0000000-0000-0000-0000-0000000000a1", clsB = "b2600000-0000-0000-0000-000000000001", sesB = "b2600000-0000-0000-0000-000000000002";
  const devB = "b2600000-0000-0000-0000-000000000003", cmdB = "b2600000-0000-0000-0000-000000000004";
  await db.exec(`
    insert into auth.users (id) values ('${kidB}');
    insert into users (id, tenant_id, email, full_name, role) values ('${kidB}', '${T.B}', 'k@b', 'Kid B', 'student');
    insert into classes (id, tenant_id, name, join_code, teacher_id) values ('${clsB}', '${T.B}', 'Beta ICT', 'DEVB01', '${U.adminB}');
    insert into class_sessions (id, class_id, join_code, state) values ('${sesB}', '${clsB}', 'DEVB02', 'live');
    insert into devices (id, tenant_id, device_uid, kind) values ('${devB}', '${T.B}', 'ext-beta-laptop', 'browser');
    insert into device_enrollments (device_id, student_id) values ('${devB}', '${kidB}');
    insert into teacher_commands (id, session_id, issued_by, target_student_id, kind, payload) values ('${cmdB}', '${sesB}', '${U.adminB}', '${kidB}', 'redirect', '{"url":"https://beta.example"}');`);

  await expectRows("another school's queued device commands can't be read", U.teacherA, `select id from teacher_commands where id = '${cmdB}'`, 0);
  await expectRows("…or changed", U.teacherA, `update teacher_commands set state = 'acked' where id = '${cmdB}' returning id`, 0);
  await expectRows("another school's device can't be edited or moved", U.parentA, `update devices set tenant_id = '${T.A}' where id = '${devB}' returning id`, 0);
  await expectRows("the school's own teacher still sees the command they sent", U.adminB, `select id from teacher_commands where id = '${cmdB}'`, 1);

  await as(U.parentA, () => q(`select public.device_ack_command('${cmdB}', 'ext-someone-else')`));
  check("a command isn't acknowledged by a device it wasn't sent to", (await q(`select state from teacher_commands where id = '${cmdB}'`))[0].state === "queued");
  await as(U.parentA, () => q(`select public.device_ack_command('${cmdB}', 'ext-beta-laptop')`));
  check("the student's own device acknowledges it", (await q(`select state from teacher_commands where id = '${cmdB}'`))[0].state === "acked");

  console.log("\nStudents a teacher teaches (subject teacher or form teacher)");
  const cls = "a2600000-0000-0000-0000-000000000001", kid = "a2600000-0000-0000-0000-000000000002";
  await db.exec(`
    insert into class_groups (id, tenant_id, name, form_teacher_id) values ('${cls}', '${T.A}', 'Form test class', '${U.teacherA2}');
    insert into students (id, tenant_id, admission_no, first_name, last_name, class_group_id) values ('${kid}', '${T.A}', 'FT1', 'Femi', 'Ojo', '${cls}');`);
  const taught = async uid => (await as(uid, () => q("select public.my_taught_students() s")))[0].s.slice().sort();
  const a = await taught(U.teacherA), a2 = await taught(U.teacherA2);
  check("a subject teacher gets the students of the classes they teach", a.includes("a8000000-0000-0000-0000-000000000001") && !a.includes(kid), a);
  check("a form teacher gets their form's students", a2.includes(kid), a2);
  check("no teacher gets another school's students", ![...a, ...a2].includes("b8000000-0000-0000-0000-000000000001"));
  check("a parent teaches no one", (await taught(U.parentA)).length === 0);

  console.log("\nOwner console: sign-in figures read the accounts once (migration 8600)");
  await db.exec(`update auth.users set last_sign_in_at = now() - interval '2 days' where id in ('${U.adminA}', '${U.parentA}', '${U.adminB}');
    update auth.users set last_sign_in_at = now() - interval '45 days' where id = '${U.teacherA}';`);
  const got = await q(`select tenant_id, staff_signed_in_30, users_signed_in_30, last_action_at from platform_customer_metrics() order by tenant_id`);
  const want = await q(`select t.id tenant_id,
      (select count(*) from users u join auth.users au on au.id = u.id where u.tenant_id = t.id and u.role not in ('student','parent','alumni') and au.last_sign_in_at > now() - interval '30 days')::int staff_signed_in_30,
      (select count(*) from users u join auth.users au on au.id = u.id where u.tenant_id = t.id and au.last_sign_in_at > now() - interval '30 days')::int users_signed_in_30,
      greatest((select max(a.ts) from audit_logs a where a.tenant_id = t.id), (select max(au.last_sign_in_at) from users u join auth.users au on au.id = u.id where u.tenant_id = t.id)) last_action_at
    from tenants t order by t.id`);
  check("every school's sign-in figures match the original formula", JSON.stringify(got) === JSON.stringify(want), { got: got.slice(0, 2), want: want.slice(0, 2) });
  check("…and they count what happened (Alpha: two signed in this month, one of them staff)",
    got.some(r => r.tenant_id === T.A && r.staff_signed_in_30 === 1 && r.users_signed_in_30 === 2), got.find(r => r.tenant_id === T.A));
  await db.exec(`update auth.users set last_sign_in_at = null where id in ('${U.adminA}', '${U.parentA}', '${U.adminB}', '${U.teacherA}')`);

  console.log("\nRow-level security reads the signed-in person once per query (migration 8700)");
  const perRow = await q(`select schemaname || '.' || tablename || ' ' || policyname p from pg_policies
    where schemaname in ('public', 'live') and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~* '(?<!select )(?<![a-z_.])auth\\.(uid|jwt|role)\\(\\)'`);
  check("no policy calls auth.uid(), auth.jwt() or auth.role() once per row", perRow.length === 0, perRow.slice(0, 5).map(r => r.p));

  console.log("\nEvery link between tables has an index behind it (migration 8800)");
  const bare = await q(`select c.conrelid::regclass::text || ' ' || c.conname l from pg_constraint c
    join pg_class t on t.oid = c.conrelid and t.relkind = 'r' join pg_namespace n on n.oid = t.relnamespace
    where c.contype = 'f' and n.nspname in ('public', 'live') and not exists (
      select 1 from pg_index i where i.indrelid = c.conrelid and i.indpred is null
        and (i.indkey::int2[])[0:cardinality(c.conkey) - 1] @> c.conkey and (i.indkey::int2[])[0:cardinality(c.conkey) - 1] <@ c.conkey)`);
  check("no foreign key without an index", bare.length === 0, bare.slice(0, 5).map(r => r.l));

  await db.exec(`delete from students where id = '${kid}'; delete from class_groups where id = '${cls}';
    delete from teacher_commands where id = '${cmdB}'; delete from devices where id = '${devB}';
    delete from class_sessions where id = '${sesB}'; delete from classes where id = '${clsB}';`);
}
