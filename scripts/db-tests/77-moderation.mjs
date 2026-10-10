// Score moderation: teacher submits → head of department → principal; scores lock while under review.
export default async function ({ db, q, expectRows, expectError, expectOk, check, U, T }) {
  const CG = "a2000000-0000-0000-0000-000000000000", SUBJ = "a3000000-0000-0000-0000-000000000000", TERM = "a5000000-0000-0000-0000-000000000000";
  const COMP = "a7000000-0000-0000-0000-000000000000", S1 = "a8000000-0000-0000-0000-000000000001", DEPT = "af000000-0000-0000-0000-000000000001";
  const call = (action, note = null) => `select status from moderate_score_sheet('${TERM}', '${CG}', '${SUBJ}', '${action}', ${note === null ? "null" : `'${note}'`})`;
  const score = (n) => `update score_entries set score = ${n} where student_id = '${S1}' and subject_id = '${SUBJ}'`;
  console.log("\nScore moderation");

  await expectError("students can no longer create departments", U.studentA, `insert into departments (tenant_id, name) values ('${T.A}', 'Fake')`, /row-level security/);
  await expectRows("a teacher cannot make themselves head of department", U.teacherA,
    `with u as (update departments set head_user_id = '${U.teacherA}' returning 1) select count(*) n from u`, 0);
  await expectOk("admin creates a department with a head", U.adminA, `insert into departments (id, tenant_id, name, head_user_id) values ('${DEPT}', '${T.A}', 'Sciences', '${U.teacherA2}')`);
  await expectOk("admin puts Maths in the department", U.adminA, `update subjects set department_id = '${DEPT}' where id = '${SUBJ}'`);
  await db.exec(`insert into tenant_settings (tenant_id, require_moderation) values ('${T.A}', true) on conflict (tenant_id) do update set require_moderation = true`);

  await expectError("staff who do not teach the class cannot submit", U.bursarA, call("submit"), /only the subject teacher/);
  await expectError("nobody writes sheets directly", U.teacherA, `insert into score_sheets (tenant_id, term_id, class_group_id, subject_id, status) values ('${T.A}', '${TERM}', '${CG}', '${SUBJ}', 'approved')`, /row-level security/);
  await expectRows("the subject teacher submits", U.teacherA, `select count(*) n from (${call("submit")}) x where status = 'submitted'`, 1);
  await expectError("submitted scores are locked for the teacher", U.teacherA, score(55), /locked/);
  await expectError("a teacher cannot approve their own scores", U.teacherA, call("hod_approve"), /head of this subject/);
  await expectError("returning needs a note", U.teacherA2, call("return"), /say what needs correcting/);
  await expectError("the head of department cannot give final approval", U.teacherA2, call("approve"), /principal/);
  await expectError("the principal must give a reason to skip the head of department", U.adminA, call("approve"), /head of department has not approved/);
  await expectRows("the head of department approves", U.teacherA2, `select count(*) n from (${call("hod_approve")}) x where status = 'hod_approved'`, 1);
  await expectRows("the principal gives final approval", U.adminA, `select count(*) n from (${call("approve")}) x where status = 'approved'`, 1);
  await expectError("approved scores stay locked for teachers", U.teacherA, score(60), /locked/);
  await expectOk("admins can still correct approved scores", U.adminA, score(71));
  await expectRows("the principal returns them with a note", U.adminA, `select count(*) n from (${call("return", "Recheck CA 2")}) x where status = 'returned'`, 1);
  await expectOk("returned scores can be edited again", U.teacherA, score(72));
  await expectRows("every step is logged", U.adminA, "select count(*) n from score_sheet_events", 4);
  // teacherA2 is both this class's form teacher and the head of department.
  await expectRows("a form teacher who heads the department can submit", U.teacherA2, `select count(*) n from (${call("submit")}) x where status = 'submitted'`, 1);
  await expectError("…but cannot approve scores they submitted", U.teacherA2, call("hod_approve"), /cannot approve scores you submitted/);
  await expectOk("the principal returns them", U.adminA, call("return", "Back to the subject teacher"));
  await expectRows("teachers can read sheet status", U.teacherA, "select count(*) n from score_sheets", 1);
  await expectRows("students cannot read sheet status", U.studentA, "select count(*) n from score_sheets", 0);
  await expectRows("another school sees no sheets", U.adminB, "select count(*) n from score_sheets", 0);
  const [{ n }] = await q(`select count(*) n from score_sheets where tenant_id = '${T.A}'`);
  check("one sheet per term, class and subject", Number(n) === 1, n);
  await db.exec(`update tenant_settings set require_moderation = false where tenant_id = '${T.A}'`);
}
