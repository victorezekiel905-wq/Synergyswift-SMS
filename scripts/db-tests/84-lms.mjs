// Learning management, part 1: homework rules and feedback, learning groups, forums, badges, schemes of work.
export default async function ({ db, q, expectRows, expectError, expectOk, check, U, T }) {
  const CLASS = "a2000000-0000-0000-0000-000000000000", MATHS = "a3000000-0000-0000-0000-000000000000";
  const KID = "a8000000-0000-0000-0000-000000000001", OTHER = "a8000000-0000-0000-0000-000000000002";
  const ID = n => `e1000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
  const HW = ID(1), SUB = ID(2), GRP = ID(3), FORUM = ID(4), STAFF_F = ID(5), THREAD = ID(6), POST = ID(7), BADGE_AUTO = ID(8), BADGE_MAN = ID(9),
    OBJ1 = ID(10), OBJ2 = ID(11), SCHEME = ID(12), WEEK = ID(13), DEPT = ID(14), OTHER_CLASS = ID(15), OTHER_FORUM = ID(16);

  console.log("\nHomework: groups, attempts and feedback");
  await expectOk("a teacher makes a support group", U.teacherA, `insert into learning_groups (id, tenant_id, class_group_id, name, kind, created_by) values ('${GRP}', '${T.A}', '${CLASS}', 'Support', 'support', '${U.teacherA}')`);
  await expectOk("and puts a student in it", U.teacherA, `insert into learning_group_members (group_id, student_id, tenant_id) values ('${GRP}', '${OTHER}', '${T.A}')`);
  await expectRows("students cannot see learning groups", U.studentA, "select (select count(*) from learning_groups) + (select count(*) from learning_group_members) n", 0);
  await expectRows("parents cannot either", U.parentA, "select count(*) n from learning_groups", 0);
  await expectRows("another school cannot", U.adminB, "select count(*) n from learning_groups", 0);

  await db.exec(`insert into homework (id, tenant_id, class_group_id, subject_id, set_by, title, due_at, max_score, allow_resubmit, max_attempts, late_penalty_pct, group_ids)
      values ('${HW}', '${T.A}', '${CLASS}', '${MATHS}', '${U.teacherA}', 'Fractions', now() + interval '2 days', 20, true, 3, 10, '{}');
    insert into homework_submissions (id, homework_id, tenant_id, student_id, body, attempt) values ('${SUB}', '${HW}', '${T.A}', '${KID}', 'My answer is three quarters.', 2);
    insert into homework_submission_versions (tenant_id, submission_id, attempt, body, submitted_at) values ('${T.A}', '${SUB}', 1, 'First go', now() - interval '1 day');`);
  await expectError("late rules are checked", U.teacherA, `update homework set max_attempts = 11 where id = '${HW}'`, /homework_late_rules_check/);
  await expectRows("the student reads their earlier attempt", U.studentA, "select count(*) n from homework_submission_versions", 1);
  await expectRows("so does their parent", U.parentA, "select count(*) n from homework_submission_versions", 1);
  await expectError("nobody but the server writes earlier attempts", U.studentA, `insert into homework_submission_versions (tenant_id, submission_id, attempt, submitted_at) values ('${T.A}', '${SUB}', 9, now())`, /row-level security/);

  await expectOk("the teacher highlights part of the answer", U.teacherA, `insert into submission_annotations (tenant_id, submission_id, author_id, kind, start_offset, end_offset, quote, comment)
    values ('${T.A}', '${SUB}', '${U.teacherA}', 'text', 13, 27, 'three quarters', 'Show your working')`);
  await expectError("…but not in another teacher's name", U.teacherA, `insert into submission_annotations (tenant_id, submission_id, author_id, kind, comment) values ('${T.A}', '${SUB}', '${U.teacherA2}', 'text', 'x')`, /row-level security/);
  await expectError("pins stay on the image", U.teacherA, `insert into submission_annotations (tenant_id, submission_id, author_id, kind, x, y, comment) values ('${T.A}', '${SUB}', '${U.teacherA}', 'pin', 120, 5, 'x')`, /check/);
  await expectRows("the student does not see comments while marking is in progress", U.studentA, "select count(*) n from submission_annotations", 0);
  await db.exec(`update homework_submissions set status = 'returned', returned_note = 'Try again' where id = '${SUB}'`);
  await expectRows("…and sees them once the work is sent back", U.studentA, "select count(*) n from submission_annotations", 1);
  await expectRows("the parent sees them too", U.parentA, "select count(*) n from submission_annotations", 1);
  await expectError("students cannot add comments", U.studentA, `insert into submission_annotations (tenant_id, submission_id, author_id, kind, comment) values ('${T.A}', '${SUB}', '${U.studentA}', 'text', 'x')`, /row-level security/);
  await expectError("submission status is one of three", U.adminA, `update homework_submissions set status = 'lost' where id = '${SUB}'`, /status_check/);

  console.log("\nForums");
  await db.exec(`insert into class_groups (id, tenant_id, name) values ('${OTHER_CLASS}', '${T.A}', 'LMS other class')`);
  await expectOk("a teacher opens a class forum", U.teacherA, `insert into forums (id, tenant_id, kind, class_group_id, title, created_by) values ('${FORUM}', '${T.A}', 'class', '${CLASS}', 'JSS1 Maths', '${U.teacherA}')`);
  await expectOk("a staff-room forum", U.teacherA, `insert into forums (id, tenant_id, kind, title, created_by) values ('${STAFF_F}', '${T.A}', 'staff', 'Staff room', '${U.teacherA}')`);
  await expectOk("and another class's forum", U.teacherA, `insert into forums (id, tenant_id, kind, class_group_id, title) values ('${OTHER_FORUM}', '${T.A}', 'class', '${OTHER_CLASS}', 'JSS2 Maths')`);
  await expectError("a class forum needs a class", U.teacherA, `insert into forums (tenant_id, kind, title) values ('${T.A}', 'class', 'Nowhere')`, /check/);
  await expectError("students cannot open forums", U.studentA, `insert into forums (tenant_id, kind, title) values ('${T.A}', 'school', 'Mine')`, /row-level security/);
  await expectRows("the student sees their own class's forum only", U.studentA, "select count(*) n from forums", 1);
  await expectRows("parents see no forums", U.parentA, "select count(*) n from forums", 0);
  await expectRows("another school sees none", U.adminB, "select count(*) n from forums", 0);
  await expectOk("the student starts a thread", U.studentA, `insert into forum_threads (id, tenant_id, forum_id, author_id, title, body) values ('${THREAD}', '${T.A}', '${FORUM}', '${U.studentA}', 'Question 3?', 'How do I start?')`);
  await expectError("…but cannot pin it", U.studentA, `insert into forum_threads (tenant_id, forum_id, author_id, title, body, pinned) values ('${T.A}', '${FORUM}', '${U.studentA}', 'Look at me', 'x', true)`, /row-level security/);
  await expectError("…or post in another class's forum", U.studentA, `insert into forum_threads (tenant_id, forum_id, author_id, title, body) values ('${T.A}', '${OTHER_FORUM}', '${U.studentA}', 'Hi', 'x')`, /row-level security/);
  await expectError("…or the staff room", U.studentA, `insert into forum_threads (tenant_id, forum_id, author_id, title, body) values ('${T.A}', '${STAFF_F}', '${U.studentA}', 'Hi', 'x')`, /row-level security/);
  await expectOk("the teacher replies", U.teacherA, `insert into forum_posts (id, tenant_id, thread_id, author_id, body) values ('${POST}', '${T.A}', '${THREAD}', '${U.teacherA}', 'Find a common denominator.')`);
  const t1 = await q(`select post_count from forum_threads where id = '${THREAD}'`);
  check("replies are counted on the thread", t1[0].post_count === 1, t1[0]);
  await expectRows("the student cannot hide the teacher's reply", U.studentA, `with u as (update forum_posts set hidden = true where id = '${POST}' returning 1) select count(*) n from u`, 0);
  await expectOk("the student replies", U.studentA, `insert into forum_posts (tenant_id, thread_id, author_id, body) values ('${T.A}', '${THREAD}', '${U.studentA}', 'Thank you')`);
  await expectError("…and cannot hide their own post either", U.studentA, `update forum_posts set hidden = true where author_id = '${U.studentA}'`, /only staff can moderate/);
  await expectRows("…but can edit it", U.studentA, `with u as (update forum_posts set body = 'Thank you!' where author_id = '${U.studentA}' returning edited_at) select count(*) n from u where edited_at is not null`, 1);
  await expectRows("the teacher hides a post", U.teacherA, `with u as (update forum_posts set hidden = true, hidden_by = '${U.teacherA}' where id = '${POST}' returning 1) select count(*) n from u`, 1);
  await expectRows("hidden posts disappear for students", U.studentA, `select count(*) n from forum_posts where id = '${POST}'`, 0);
  await expectRows("staff still see them", U.teacherA2, `select count(*) n from forum_posts where id = '${POST}'`, 1);
  await db.exec(`update forum_threads set locked = true where id = '${THREAD}'`);
  await expectError("locked threads take no student posts", U.studentA, `insert into forum_posts (tenant_id, thread_id, author_id, body) values ('${T.A}', '${THREAD}', '${U.studentA}', 'Hello?')`, /closed/);
  await expectOk("staff can still post", U.teacherA, `insert into forum_posts (tenant_id, thread_id, author_id, body) values ('${T.A}', '${THREAD}', '${U.teacherA}', 'Closing this now.')`);
  await expectOk("a student reports a post", U.studentA, `insert into forum_reports (tenant_id, thread_id, reporter_id, reason) values ('${T.A}', '${THREAD}', '${U.studentA}', 'Off topic')`);
  await expectRows("students do not read reports", U.studentA, "select count(*) n from forum_reports", 0);
  await expectRows("staff do", U.teacherA2, "select count(*) n from forum_reports", 1);
  await expectRows("only admins delete posts", U.teacherA, `with d as (delete from forum_posts where thread_id = '${THREAD}' returning 1) select count(*) n from d`, 0);
  await expectRows("students cannot delete a thread that has replies", U.studentA, `with d as (delete from forum_threads where id = '${THREAD}' returning 1) select count(*) n from d`, 0);

  console.log("\nBadges and learning activity");
  await expectOk("an admin creates an automatic badge", U.adminA, `insert into badges (id, tenant_id, name, emoji, rule) values ('${BADGE_AUTO}', '${T.A}', 'On a roll', '🔥', '{"type":"streak","threshold":5}')`);
  await expectOk("and one teachers give", U.adminA, `insert into badges (id, tenant_id, name, emoji) values ('${BADGE_MAN}', '${T.A}', 'Star of the week', '⭐')`);
  await expectError("teachers cannot create badges", U.teacherA, `insert into badges (tenant_id, name) values ('${T.A}', 'Mine')`, /row-level security/);
  await expectOk("a teacher gives the manual badge", U.teacherA, `insert into student_badges (tenant_id, badge_id, student_id, awarded_by, reason) values ('${T.A}', '${BADGE_MAN}', '${KID}', '${U.teacherA}', 'Helping a classmate')`);
  await expectError("…but cannot hand out an automatic one", U.teacherA, `insert into student_badges (tenant_id, badge_id, student_id, awarded_by) values ('${T.A}', '${BADGE_AUTO}', '${OTHER}', '${U.teacherA}')`, /row-level security/);
  await expectError("students cannot award themselves", U.studentA, `insert into student_badges (tenant_id, badge_id, student_id, awarded_by) values ('${T.A}', '${BADGE_MAN}', '${KID}', '${U.studentA}')`, /row-level security/);
  await expectRows("the student and parent see the badge", U.parentA, "select count(*) n from student_badges", 1);
  await expectRows("another teacher cannot take it away", U.teacherA2, `with d as (delete from student_badges returning 1) select count(*) n from d`, 0);
  await db.exec(`insert into learning_activity (tenant_id, student_id, kind, points, ref_id) values ('${T.A}', '${KID}', 'homework', 10, '${HW}'), ('${T.A}', '${OTHER}', 'practice', 5, null)`);
  await expectError("an activity counts once", U.adminA, `insert into learning_activity (tenant_id, student_id, kind, points, ref_id) values ('${T.A}', '${KID}', 'homework', 10, '${HW}')`, /learning_activity_once|row-level security/);
  await expectRows("students see their own activity only", U.studentA, "select count(*) n from learning_activity", 1);
  await expectError("…and cannot add points", U.studentA, `insert into learning_activity (tenant_id, student_id, kind, points) values ('${T.A}', '${KID}', 'practice', 1000)`, /row-level security/);

  console.log("\nSchemes of work");
  await db.exec(`insert into departments (id, tenant_id, name, head_user_id) values ('${DEPT}', '${T.A}', 'Sciences', '${U.teacherA2}'); update subjects set department_id = '${DEPT}' where id = '${MATHS}';`);
  await expectOk("a teacher adds curriculum objectives", U.teacherA, `insert into curriculum_objectives (id, tenant_id, subject_id, level, code, statement) values
    ('${OBJ1}', '${T.A}', '${MATHS}', 'JSS 1', '1.1', 'Add fractions with unlike denominators'), ('${OBJ2}', '${T.A}', '${MATHS}', 'JSS 1', '1.2', 'Simplify fractions')`);
  await expectError("the bursar cannot", U.bursarA, `insert into curriculum_objectives (tenant_id, subject_id, level, statement) values ('${T.A}', '${MATHS}', 'JSS 1', 'Count money')`, /row-level security/);
  await expectRows("students do not read objectives", U.studentA, "select count(*) n from curriculum_objectives", 0);
  await expectOk("the teacher writes a scheme", U.teacherA, `insert into schemes_of_work (id, tenant_id, subject_id, level, title, owner_id) values ('${SCHEME}', '${T.A}', '${MATHS}', 'JSS 1', 'JSS 1 Maths, first term', '${U.teacherA}')`);
  await expectError("…only in their own name", U.teacherA, `insert into schemes_of_work (tenant_id, subject_id, level, title, owner_id) values ('${T.A}', '${MATHS}', 'JSS 1', 'Theirs', '${U.teacherA2}')`, /row-level security/);
  await expectError("…and not already approved", U.teacherA, `insert into schemes_of_work (tenant_id, subject_id, level, title, owner_id, status) values ('${T.A}', '${MATHS}', 'JSS 1', 'Mine', '${U.teacherA}', 'approved')`, /row-level security/);
  await expectOk("with a week mapped to an objective", U.teacherA, `insert into scheme_weeks (id, tenant_id, scheme_id, week_no, topic, objective_ids) values ('${WEEK}', '${T.A}', '${SCHEME}', 1, 'Adding fractions', '{${OBJ1}}')`);
  await expectRows("other staff cannot change the weeks", U.bursarA, `with u as (update scheme_weeks set topic = 'x' where id = '${WEEK}' returning 1) select count(*) n from u`, 0);
  await expectOk("the teacher submits it", U.teacherA, `update schemes_of_work set status = 'submitted' where id = '${SCHEME}'`);
  await expectError("…and cannot approve it themselves", U.teacherA, `update schemes_of_work set status = 'approved' where id = '${SCHEME}'`, /only the head of department/);
  await expectRows("staff outside the department cannot touch it", U.bursarA, `with u as (update schemes_of_work set status = 'approved' where id = '${SCHEME}' returning 1) select count(*) n from u`, 0);
  await expectOk("the head of department returns it with a note", U.teacherA2, `update schemes_of_work set status = 'returned', review_note = 'Add week 2' where id = '${SCHEME}'`);
  await expectOk("the head of department may add a week", U.teacherA2, `insert into scheme_weeks (tenant_id, scheme_id, week_no, topic, objective_ids) values ('${T.A}', '${SCHEME}', 2, 'Simplifying', '{${OBJ2}}')`);
  await expectOk("the principal or admin approves", U.adminA, `update schemes_of_work set status = 'approved' where id = '${SCHEME}'`);
  await expectOk("an admin writes a scheme of their own", U.adminA, `insert into schemes_of_work (tenant_id, subject_id, level, title, owner_id) values ('${T.A}', '${MATHS}', 'JSS 2', 'Admin scheme', '${U.adminA}')`);
  await expectError("…and cannot approve it, even as an admin", U.adminA, `update schemes_of_work set status = 'approved' where title = 'Admin scheme'`, /your own/);
  await expectError("teachers cannot hand a scheme to someone else", U.teacherA, `update schemes_of_work set owner_id = '${U.teacherA2}' where id = '${SCHEME}'`, /only admins/);
  await expectRows("the author marks a week as taught", U.teacherA, `with u as (update scheme_weeks set status = 'taught', taught_on = current_date where id = '${WEEK}' returning 1) select count(*) n from u`, 1);
  await expectRows("approved schemes cannot be deleted by their author", U.teacherA, `with d as (delete from schemes_of_work where id = '${SCHEME}' returning 1) select count(*) n from d`, 0);
  await expectOk("lesson notes link to a week", U.teacherA, `insert into lesson_notes (tenant_id, author_id, subject_id, topic, scheme_week_id) values ('${T.A}', '${U.teacherA}', '${MATHS}', 'Adding fractions', '${WEEK}')`);
  await expectRows("parents and students see no schemes", U.parentA, "select (select count(*) from schemes_of_work) + (select count(*) from scheme_weeks) n", 0);
  await expectRows("another school sees none", U.adminB, "select (select count(*) from schemes_of_work) + (select count(*) from curriculum_objectives) n", 0);

  // Later tests count rows in shared tables.
  await db.exec(`delete from lesson_notes where scheme_week_id = '${WEEK}'; delete from class_groups where id = '${OTHER_CLASS}'; update subjects set department_id = null where id = '${MATHS}'; delete from departments where id = '${DEPT}';`);
}
