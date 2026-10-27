// Phase 14d-1: classroom points, class teams with privileges, class story, and sign-in details kept server-side.
export default async function ({ db, q, expectRows, expectError, expectOk, check, U, T }) {
  const CG = "a2000000-0000-0000-0000-000000000000", ADA = "a8000000-0000-0000-0000-000000000001", BOLA = "a8000000-0000-0000-0000-000000000002", BETA = "b8000000-0000-0000-0000-000000000001";
  const [{ id: SKILL }] = await q(`select id from point_skills where tenant_id = '${T.A}' and name = 'Teamwork'`);
  const [{ id: NEG }] = await q(`select id from point_skills where tenant_id = '${T.A}' and kind = 'needs_work' limit 1`);
  const give = (who, kid, cg = CG, skill = SKILL) => `insert into point_events (tenant_id, student_id, class_group_id, skill_id, skill_name, points, given_by) values ('${T.A}', '${kid}', ${cg ? `'${cg}'` : "null"}, '${skill}', 'Teamwork', 1, '${who}')`;

  // Earlier tests make teacherA2 the form teacher; this test needs them outside the class.
  const [{ form_teacher_id: FORM }] = await q(`select form_teacher_id from class_groups where id = '${CG}'`);
  await db.exec(`update class_groups set form_teacher_id = null where id = '${CG}'`);

  console.log("\nClassroom points");
  check("every school starts with skills", Boolean(SKILL && NEG));
  await expectOk("the class's subject teacher gives a point", U.teacherA, give(U.teacherA, ADA));
  await expectError("a teacher who does not teach the class cannot", U.teacherA2, give(U.teacherA2, ADA), /row-level security/);
  await expectError("…nor give points in someone else's name", U.teacherA2, give(U.teacherA, ADA), /row-level security/);
  await expectError("points only for students in that class", U.teacherA, give(U.teacherA, BETA), /row-level security/);
  await expectRows("the parent sees their child's points", U.parentA, "select count(*) n from point_events", 1);
  await expectRows("the student sees their own", U.studentA, "select count(*) n from point_events", 1);
  await expectRows("another teacher does not", U.teacherA2, "select count(*) n from point_events", 0);
  await expectRows("another school does not", U.adminB, "select count(*) n from point_events", 0);
  await expectError("teachers cannot add school skills", U.teacherA, `insert into point_skills (tenant_id, name, kind, points) values ('${T.A}', 'Sneaky', 'positive', 5)`, /row-level security/);
  await expectError("a needs-work skill must take points away", U.adminA, `insert into point_skills (tenant_id, name, kind, points) values ('${T.A}', 'Bad', 'needs_work', 2)`, /check constraint/);

  console.log("\nClass teams");
  await expectError("a teacher cannot add themselves to a class", U.teacherA2, `insert into class_staff (tenant_id, class_group_id, user_id) values ('${T.A}', '${CG}', '${U.teacherA2}')`, /row-level security/);
  await expectOk("an admin adds an assistant who may post to the story but not give points", U.adminA,
    `insert into class_staff (tenant_id, class_group_id, user_id, role, can_give_points, can_post_story) values ('${T.A}', '${CG}', '${U.teacherA2}', 'assistant', false, true)`);
  await expectError("…so the assistant still cannot give points", U.teacherA2, give(U.teacherA2, BOLA), /row-level security/);
  await expectOk("…but can post to the class story", U.teacherA2, `insert into class_story_posts (tenant_id, class_group_id, author_id, body) values ('${T.A}', '${CG}', '${U.teacherA2}', 'We planted beans')`);
  await expectOk("the admin gives them points too", U.adminA, `update class_staff set can_give_points = true where user_id = '${U.teacherA2}'`);
  await expectOk("…and now they can", U.teacherA2, give(U.teacherA2, BOLA));
  await expectRows("…and see the class's points", U.teacherA2, "select count(*) n from point_events", 2);
  await expectOk("a teacher's undo of someone else's point does nothing", U.teacherA2, `delete from point_events where given_by = '${U.teacherA}'`);
  await expectRows("…so it is still there", U.teacherA, `select count(*) n from point_events where given_by = '${U.teacherA}'`, 1);
  await expectOk("the giver can undo their own point at once", U.teacherA, `delete from point_events where given_by = '${U.teacherA}'`);
  await expectRows("…and it is gone", U.adminA, `select count(*) n from point_events where given_by = '${U.teacherA}'`, 0);

  console.log("\nClass story");
  await expectRows("the parent sees the class story", U.parentA, "select count(*) n from class_story_posts", 1);
  await expectRows("the student sees it", U.studentA, "select count(*) n from class_story_posts", 1);
  await expectRows("another school does not", U.adminB, "select count(*) n from class_story_posts", 0);
  await expectError("a parent cannot post", U.parentA, `insert into class_story_posts (tenant_id, class_group_id, author_id, body) values ('${T.A}', '${CG}', '${U.parentA}', 'hi')`, /row-level security/);
  const [{ id: POST }] = await q(`select id from class_story_posts where class_group_id = '${CG}' limit 1`);
  await expectOk("the parent likes it", U.parentA, `insert into class_story_likes (post_id, user_id, tenant_id) values ('${POST}', '${U.parentA}', '${T.A}')`);
  await expectError("…but cannot like as someone else", U.parentA, `insert into class_story_likes (post_id, user_id, tenant_id) values ('${POST}', '${U.teacherA}', '${T.A}')`, /row-level security/);

  console.log("\nSign-in details");
  await db.exec(`update users set must_change_password = true where id = '${U.studentA}'`);
  await expectError("a student cannot clear 'must change password' themselves", U.studentA, `update users set must_change_password = false where id = '${U.studentA}'`, /set by the server/);
  await expectError("…nor change their username", U.studentA, `update users set username = 'boss' where id = '${U.studentA}'`, /set by the server/);
  await db.exec(`delete from class_story_likes; delete from class_story_posts; delete from point_events; delete from class_staff;
    update users set must_change_password = false where id = '${U.studentA}';
    update class_groups set form_teacher_id = ${FORM ? `'${FORM}'` : "null"} where id = '${CG}';`);
}
