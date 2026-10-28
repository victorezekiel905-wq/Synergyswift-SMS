// Class privacy in the learning space (migration 8300): teachers see only the classes they teach.
export default async function ({ db, expectRows, U, T }) {
  console.log("\nLearning space: only your own classes");
  // A new class that only Teacher A teaches (earlier tests attach Teacher A2 to JSS1).
  const cls = "a2300000-0000-0000-0000-000000000001";
  const hw = "a2100000-0000-0000-0000-000000000001", forum = "a2200000-0000-0000-0000-000000000001", sch = "a2200000-0000-0000-0000-000000000002";
  await db.exec(`
    insert into class_groups (id, tenant_id, name) values ('${cls}', '${T.A}', 'Scope test class');
    insert into subject_offerings (tenant_id, class_group_id, subject_id, teacher_id) values ('${T.A}', '${cls}', 'a3000000-0000-0000-0000-000000000000', '${U.teacherA}');
    insert into homework (id, tenant_id, class_group_id, set_by, title, due_at) values ('${hw}', '${T.A}', '${cls}', '${U.teacherA}', 'Fractions', now() + interval '2 days');
    insert into forums (id, tenant_id, kind, class_group_id, title) values ('${forum}', '${T.A}', 'class', '${cls}', 'JSS1 discussion'), ('${sch}', '${T.A}', 'school', null, 'Whole school');
    insert into tenant_settings (tenant_id) values ('${T.A}') on conflict (tenant_id) do nothing;`);
  await expectRows("the class's own teacher sees its homework", U.teacherA, `select id from homework where id = '${hw}'`, 1);
  await expectRows("a teacher who doesn't teach the class does not", U.teacherA2, `select id from homework where id = '${hw}'`, 0);
  await expectRows("the school admin sees every class's homework", U.adminA, `select id from homework where id = '${hw}'`, 1);
  await expectRows("the class's teacher sees its discussion", U.teacherA, `select id from forums where id = '${forum}'`, 1);
  await expectRows("another teacher does not see that class's discussion", U.teacherA2, `select id from forums where id = '${forum}'`, 0);
  await expectRows("…but every member of staff sees the whole-school forum", U.teacherA2, `select id from forums where id = '${sch}'`, 1);
  await db.exec(`update students set class_group_id = '${cls}' where id = 'a8000000-0000-0000-0000-000000000001'`);
  await expectRows("a student in the class sees its discussion", U.studentA, `select id from forums where id = '${forum}'`, 1);

  // The school lets bursars see every class (e.g. a head of studies role).
  await db.exec(`update tenant_settings set all_classes_roles = array['school_admin','principal','teacher'] where tenant_id = '${T.A}'`);
  await expectRows("a role the school lists sees every class", U.teacherA2, `select id from homework where id = '${hw}'`, 1);
  await db.exec(`update tenant_settings set all_classes_roles = array['school_admin','principal'] where tenant_id = '${T.A}';
    delete from forums where id in ('${forum}', '${sch}'); delete from homework where id = '${hw}';
    update students set class_group_id = 'a2000000-0000-0000-0000-000000000000' where id = 'a8000000-0000-0000-0000-000000000001';
    delete from subject_offerings where class_group_id = '${cls}'; delete from class_groups where id = '${cls}';`);
}
