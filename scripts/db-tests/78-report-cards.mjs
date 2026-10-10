// Report cards: mid-term next to end-of-term, per-subject notes, comment bank.
export default async function ({ expectRows, expectError, expectOk, U, T }) {
  const TERM = "a5000000-0000-0000-0000-000000000000", S1 = "a8000000-0000-0000-0000-000000000001", SUBJ = "a3000000-0000-0000-0000-000000000000";
  console.log("\nReport cards (mid-term, notes, comment bank)");
  await expectOk("a mid-term card can sit next to the end-of-term card", U.adminA,
    `insert into report_cards (tenant_id, term_id, student_id, kind) values ('${T.A}', '${TERM}', '${S1}', 'midterm')`);
  await expectError("but only one card of each kind per term", U.adminA,
    `insert into report_cards (tenant_id, term_id, student_id, kind) values ('${T.A}', '${TERM}', '${S1}', 'midterm')`, /duplicate key/);
  await expectError("unknown report kinds are rejected", U.adminA,
    `insert into report_cards (tenant_id, term_id, student_id, kind) values ('${T.A}', '${TERM}', '${S1}', 'weekly')`, /check constraint/);
  await expectRows("parents still see only published cards", U.parentA, "select count(*) n from report_cards", 1);

  await expectOk("the subject teacher writes a subject comment", U.teacherA,
    `insert into report_subject_comments (tenant_id, term_id, student_id, subject_id, comment, effort, target_grade) values ('${T.A}', '${TERM}', '${S1}', '${SUBJ}', 'Strong algebra', '1', 'A1')`);
  await expectError("a teacher who does not teach the subject cannot", U.bursarA,
    `insert into report_subject_comments (tenant_id, term_id, student_id, subject_id, comment) values ('${T.A}', '${TERM}', 'a8000000-0000-0000-0000-000000000002', '${SUBJ}', 'x')`, /row-level security/);
  await expectRows("students cannot read teachers' notes before publishing", U.studentA, "select count(*) n from report_subject_comments", 0);

  await expectOk("a teacher saves a shared bank comment", U.teacherA, `insert into comment_bank (tenant_id, role, text, created_by) values ('${T.A}', 'form_teacher', 'A fine term.', '${U.teacherA}')`);
  await expectOk("and a private one", U.teacherA, `insert into comment_bank (tenant_id, role, text, shared, created_by) values ('${T.A}', 'form_teacher', 'Just for me.', false, '${U.teacherA}')`);
  await expectRows("colleagues see only the shared comment", U.teacherA2, "select count(*) n from comment_bank", 1);
  await expectRows("the author sees both", U.teacherA, "select count(*) n from comment_bank", 2);
  await expectRows("a colleague cannot delete it", U.teacherA2, `with d as (delete from comment_bank returning 1) select count(*) n from d`, 0);
  await expectRows("students cannot read the bank", U.studentA, "select count(*) n from comment_bank", 0);
  await expectError("nobody saves comments in someone else's name", U.teacherA2, `insert into comment_bank (tenant_id, role, text, created_by) values ('${T.A}', 'principal', 'x y', '${U.teacherA}')`, /row-level security/);
}
