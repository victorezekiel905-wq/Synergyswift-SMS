// Report cards: who may change grades, comments and published cards.
export default async function ({ db, expectRows, expectError, expectOk, U, T }) {
  const CG = "a2000000-0000-0000-0000-000000000000";
  const PUB = "a8000000-0000-0000-0000-000000000001", DRAFT = "a8000000-0000-0000-0000-000000000002";
  console.log("\nReport card guard");
  // teacherA teaches Maths in JSS1; teacherA2 is JSS1's form teacher.
  await db.exec(`update class_groups set form_teacher_id = '${U.teacherA2}' where id = '${CG}';
    update report_cards set class_group_id = '${CG}' where tenant_id = '${T.A}';`);

  await expectError("bursar cannot rewrite a student's average", U.bursarA,
    `update report_cards set average = 99 where student_id = '${DRAFT}'`, /form teacher or a school admin/);
  await expectError("subject teacher cannot rewrite grades", U.teacherA,
    `update report_cards set data = '{}'::jsonb where student_id = '${DRAFT}'`, /form teacher or a school admin/);
  await expectOk("form teacher can recompile a draft card", U.teacherA2,
    `update report_cards set average = 61.5 where student_id = '${DRAFT}'`);
  await expectOk("form teacher can write the form teacher's comment", U.teacherA2,
    `update report_cards set teacher_comment = 'Keep it up' where student_id = '${DRAFT}'`);
  await expectError("form teacher cannot write the principal's comment", U.teacherA2,
    `update report_cards set principal_comment = 'Promoted' where student_id = '${DRAFT}'`, /principal's comment/);
  await expectError("form teacher cannot change a published card", U.teacherA2,
    `update report_cards set average = 99 where student_id = '${PUB}'`, /published report card/);
  await expectError("form teacher cannot file a card under another class", U.teacherA2,
    `update report_cards set class_group_id = null where student_id = '${DRAFT}'`, /form teacher or a school admin/);
  await expectRows("teachers cannot delete report cards", U.teacherA2,
    `with d as (delete from report_cards where tenant_id = '${T.A}' returning 1) select count(*) n from d`, 0);
  await expectOk("admin can still change a published card", U.adminA,
    `update report_cards set principal_comment = 'Well done' where student_id = '${PUB}'`);
  await expectRows("both cards still exist", U.adminA, `select count(*) n from report_cards where tenant_id = '${T.A}'`, 2);
}
