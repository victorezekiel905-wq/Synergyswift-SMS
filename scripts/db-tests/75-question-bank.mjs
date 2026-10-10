// Question bank and practice: who can read and change what.
export default async function ({ db, expectRows, expectError, expectOk, U, T }) {
  const SUBJ = "a3000000-0000-0000-0000-000000000000", EXAM = "ab000000-0000-0000-0000-000000000000";
  const QB = "ad000000-0000-0000-0000-000000000001";
  console.log("\nQuestion bank");
  await expectOk("teacher adds a bank question", U.teacherA,
    `insert into question_bank (id, tenant_id, created_by, subject_id, type, prompt, data, answer, exam_body, exam_year, practice)
     values ('${QB}', '${T.A}', '${U.teacherA}', '${SUBJ}', 'mcq_single', '2 + 2 = ?', '{"options":[{"id":"a","text":"4"},{"id":"b","text":"5"}]}', '{"correct":"a"}', 'WAEC', 2019, true)`);
  await expectError("teacher cannot add a question in someone else's name", U.teacherA2,
    `insert into question_bank (tenant_id, created_by, type, prompt) values ('${T.A}', '${U.teacherA}', 'true_false', 'x')`, /row-level security/);
  await expectRows("colleagues can read the bank", U.teacherA2, "select count(*) n from question_bank", 1);
  await expectRows("a colleague cannot edit someone else's question", U.teacherA2,
    `with u as (update question_bank set prompt = 'changed' where id = '${QB}' returning 1) select count(*) n from u`, 0);
  await expectRows("an admin can edit any question", U.adminA,
    `with u as (update question_bank set topic = 'Addition' where id = '${QB}' returning 1) select count(*) n from u`, 1);
  await expectRows("students cannot read the bank (answer keys)", U.studentA, "select count(*) n from question_bank", 0);
  await expectRows("parents cannot read the bank", U.parentA, "select count(*) n from question_bank", 0);
  await expectRows("another school cannot read the bank", U.adminB, "select count(*) n from question_bank", 0);
  await expectError("bank rejects unknown question types", U.teacherA,
    `insert into question_bank (tenant_id, created_by, type, prompt) values ('${T.A}', '${U.teacherA}', 'poll', 'x')`, /check constraint/);
  await expectOk("exams accept maths-input questions", U.teacherA,
    `insert into exam_questions (exam_id, type, prompt, answer, bank_question_id, topic) values ('${EXAM}', 'math', 'Expand (x+1)^2', '{"expression":"x^2+2x+1"}', '${QB}', 'Algebra')`);
  await expectOk("exams accept drag-and-drop questions", U.teacherA,
    `insert into exam_questions (exam_id, type, prompt) values ('${EXAM}', 'drag_drop', 'Sort the animals')`);

  console.log("\nPractice sessions");
  await db.exec(`insert into practice_sessions (tenant_id, student_user_id, question_ids) values ('${T.A}', '${U.studentA}', '["${QB}"]')`);
  await expectRows("a student sees their own practice", U.studentA, "select count(*) n from practice_sessions", 1);
  await expectRows("teachers see practice in their school", U.teacherA, "select count(*) n from practice_sessions", 1);
  await expectRows("parents do not see practice rows", U.parentA, "select count(*) n from practice_sessions", 0);
  await expectError("students cannot write practice scores directly", U.studentA,
    `insert into practice_sessions (tenant_id, student_user_id, score) values ('${T.A}', '${U.studentA}', 999)`, /row-level security/);
}
