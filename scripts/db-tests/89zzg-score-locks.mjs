// Score locks (migration 10900): the admin locks the mid-term scores (only the mid-term parts) and the
// end of term scores (every part) of a term; nobody, admins included, changes a locked score.
export default async function ({ q, as, expectError, expectOk, check, U, T }) {
  console.log("\nScore locks: mid-term and end of term");
  const TERM = "a5000000-0000-0000-0000-000000000000", SUBJ = "a3000000-0000-0000-0000-000000000000";
  const SCHEME = "a6000000-0000-0000-0000-000000000000", STU = "a8000000-0000-0000-0000-000000000001";
  const CA = "a7900000-0000-0000-0000-0000000000c1", EXAM = "a7900000-0000-0000-0000-0000000000e1";
  await q(`insert into grading_components (id, scheme_id, name, max_score, weight, midterm) values
    ('${CA}', '${SCHEME}', 'CA test', 20, 20, true), ('${EXAM}', '${SCHEME}', 'Exam test', 80, 80, false) on conflict do nothing`);
  const enter = (who, comp, score) => `insert into score_entries (tenant_id, term_id, student_id, subject_id, component_id, score)
    values ('${T.A}', '${TERM}', '${STU}', '${SUBJ}', '${comp}', ${score}) on conflict (term_id, student_id, subject_id, component_id) do update set score = excluded.score`;
  const lock = (kind, on) => `select set_scores_lock('${TERM}', '${kind}', ${on})`;

  await expectOk("the teacher enters a mid-term score", U.teacherA, enter(U.teacherA, CA, 15));
  await expectError("a teacher cannot lock scores", U.teacherA, lock("midterm", true), /only a school admin/);
  await expectOk("the admin locks the mid-term scores", U.adminA, lock("midterm", true));
  await expectError("…then a mid-term score cannot be changed", U.teacherA, enter(U.teacherA, CA, 18), /mid-term scores are locked/);
  await expectError("…not even by the admin", U.adminA, enter(U.adminA, CA, 18), /mid-term scores are locked/);
  await expectError("…or removed", U.teacherA, `delete from score_entries where component_id = '${CA}' and student_id = '${STU}'`, /mid-term scores are locked/);
  await expectOk("…but the end of term parts can still be entered", U.teacherA, enter(U.teacherA, EXAM, 60));

  await expectOk("the admin locks the end of term scores", U.adminA, lock("term", true));
  await expectError("…then no score of the term can be changed", U.teacherA, enter(U.teacherA, EXAM, 70), /end of term scores are locked/);
  const t = (await q(`select midterm_scores_locked_at is not null m, term_scores_locked_at is not null e, term_scores_locked_by from terms where id = '${TERM}'`))[0];
  check("the term shows both locks and who locked them", t.m && t.e && t.term_scores_locked_by === U.adminA, t);
  const logged = (await q(`select count(*)::int n from audit_logs where action = 'scores.locked' and target = '${TERM}'`))[0].n;
  check("each lock is recorded", logged >= 2, logged);

  await expectOk("the admin unlocks the end of term scores", U.adminA, lock("term", false));
  await expectOk("…and the mid-term scores", U.adminA, lock("midterm", false));
  await expectOk("…and scores can be changed again", U.teacherA, enter(U.teacherA, CA, 19));
  const s = (await q(`select score from score_entries where component_id = '${CA}' and student_id = '${STU}'`))[0];
  check("the change is saved", Number(s.score) === 19, s);

  // Removing a part while the term is locked removes its scores with it (not an edit).
  await expectOk("the admin locks the term again", U.adminA, lock("term", true));
  await expectOk("an admin deletes an assessment part while the term is locked", U.adminA, `delete from grading_components where id = '${EXAM}'`);
  const left = (await q(`select count(*)::int n from score_entries where component_id = '${EXAM}'`))[0].n;
  check("deleting a part still removes its scores while the term is locked", left === 0, left);
  await as(U.adminA, () => q(lock("term", false)));
  await q(`delete from score_entries where component_id = '${CA}'`);
  await q(`delete from grading_components where id = '${CA}'`);
}
