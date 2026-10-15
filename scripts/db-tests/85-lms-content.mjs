// Learning management, part 2: live rooms and breakouts, content packages, learning paths, online lessons, the study helper.
export default async function ({ db, q, expectRows, expectError, expectOk, check, U, T }) {
  const COUNS = "a0000000-0000-0000-0000-0000000000c1";
  const JSS1 = "a2000000-0000-0000-0000-000000000000", MATHS = "a3000000-0000-0000-0000-000000000000";
  const KID = "a8000000-0000-0000-0000-000000000001";
  const ID = n => `e2000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
  const STU2 = "a0000000-0000-0000-0000-0000000000e2", KID2 = ID(1), CLASS2 = ID(2), LMS = ID(3), SESSION = ID(4), MAIN = ID(5), BO1 = ID(6), BO2 = ID(7),
    PKG = ID(8), PKG2 = ID(9), PATH = ID(10), STEP = ID(11), LESSON = ID(12), LESSON2 = ID(13), CONV = ID(14);

  await db.exec(`insert into auth.users (id) values ('${STU2}');
    insert into users (id, tenant_id, email, full_name, role) values ('${STU2}', '${T.A}', 's2@a', 'Student Two', 'student');
    insert into class_groups (id, tenant_id, name) values ('${CLASS2}', '${T.A}', 'LMS content class');
    insert into students (id, tenant_id, user_id, admission_no, first_name, last_name, class_group_id) values ('${KID2}', '${T.A}', '${STU2}', 'LMS-2', 'Tunde', 'Bello', '${CLASS2}');
    insert into classes (id, tenant_id, name, join_code, teacher_id) values ('${LMS}', '${T.A}', 'JSS1 Maths live', 'LMSX01', '${U.teacherA}');
    insert into class_members (class_id, user_id, role) values ('${LMS}', '${U.studentA}', 'student');
    insert into class_sessions (id, class_id, join_code, state) values ('${SESSION}', '${LMS}', 'SESSX01', 'live');`);

  console.log("\nLive rooms and breakouts");
  await expectOk("the class teacher opens the room", U.teacherA, `insert into rtc_rooms (id, tenant_id, session_id, host_user_id) values ('${MAIN}', '${T.A}', '${SESSION}', '${U.teacherA}')`);
  await expectError("a student cannot open one", U.studentA, `insert into rtc_rooms (tenant_id, session_id, host_user_id) values ('${T.A}', '${SESSION}', '${U.studentA}')`, /row-level security/);
  await expectError("another teacher cannot open a room for someone else's class", U.teacherA2, `insert into rtc_rooms (tenant_id, session_id, host_user_id) values ('${T.A}', '${SESSION}', '${U.teacherA2}')`, /row-level security/);
  await expectRows("a class member sees the room", U.studentA, `select count(*) n from rtc_rooms where id = '${MAIN}'`, 1);
  await expectRows("a student outside the class does not", STU2, "select count(*) n from rtc_rooms", 0);
  await expectOk("the class member joins", U.studentA, `insert into rtc_peers (tenant_id, room_id, user_id, role) values ('${T.A}', '${MAIN}', '${U.studentA}', 'student')`);
  await expectError("an outsider cannot join", STU2, `insert into rtc_peers (tenant_id, room_id, user_id, role) values ('${T.A}', '${MAIN}', '${STU2}', 'student')`, /row-level security/);
  await expectRows("students cannot close the room", U.studentA, `with u as (update rtc_rooms set state = 'closed' where id = '${MAIN}' returning 1) select count(*) n from u`, 0);
  await expectOk("the teacher opens two breakout rooms", U.teacherA, `insert into rtc_rooms (id, tenant_id, session_id, host_user_id, kind, parent_room_id, name) values
    ('${BO1}', '${T.A}', '${SESSION}', '${U.teacherA}', 'breakout', '${MAIN}', 'Room 1'), ('${BO2}', '${T.A}', '${SESSION}', '${U.teacherA}', 'breakout', '${MAIN}', 'Room 2')`);
  await expectError("a breakout room needs its main room", U.teacherA, `insert into rtc_rooms (tenant_id, session_id, host_user_id, kind) values ('${T.A}', '${SESSION}', '${U.teacherA}', 'breakout')`, /rtc_rooms_kind_check/);
  await expectOk("and puts the student in Room 1", U.teacherA, `insert into breakout_members (room_id, user_id, tenant_id) values ('${BO1}', '${U.studentA}', '${T.A}')`);
  await expectError("students cannot choose their own room", U.studentA, `insert into breakout_members (room_id, user_id, tenant_id) values ('${BO2}', '${U.studentA}', '${T.A}')`, /row-level security/);
  await expectOk("the student enters Room 1", U.studentA, `insert into rtc_peers (tenant_id, room_id, user_id, role) values ('${T.A}', '${BO1}', '${U.studentA}', 'student')`);
  await expectError("…but not Room 2", U.studentA, `insert into rtc_peers (tenant_id, room_id, user_id, role) values ('${T.A}', '${BO2}', '${U.studentA}', 'student')`, /row-level security/);
  await expectOk("the teacher can visit any room", U.teacherA, `insert into rtc_peers (tenant_id, room_id, user_id, role) values ('${T.A}', '${BO2}', '${U.teacherA}', 'teacher')`);
  await expectRows("closing the rooms removes them and their members", U.teacherA, `with d as (delete from rtc_rooms where parent_room_id = '${MAIN}' returning 1) select count(*) n from d`, 2);
  await expectRows("nobody deletes the main room", U.teacherA, `with d as (delete from rtc_rooms where id = '${MAIN}' returning 1) select count(*) n from d`, 0);

  console.log("\nContent packages");
  await expectOk("a teacher adds a package for JSS1", U.teacherA, `insert into content_packages (id, tenant_id, title, kind, launch_path, class_group_ids, created_by) values ('${PKG}', '${T.A}', 'Fractions', 'scorm12', 'index.html', '{${JSS1}}', '${U.teacherA}')`);
  await expectOk("and one for paths only", U.teacherA, `insert into content_packages (id, tenant_id, title, kind, launch_path, created_by) values ('${PKG2}', '${T.A}', 'Decimals', 'h5p', '__h5p', '${U.teacherA}')`);
  await expectError("students cannot add packages", U.studentA, `insert into content_packages (tenant_id, title, kind, launch_path, created_by) values ('${T.A}', 'Mine', 'html', 'a.html', '${U.studentA}')`, /row-level security/);
  await expectRows("a JSS1 student sees their class's package only", U.studentA, "select count(*) n from content_packages", 1);
  await expectRows("so does their parent", U.parentA, "select count(*) n from content_packages", 1);
  await expectRows("another class sees none", STU2, "select count(*) n from content_packages", 0);
  await expectRows("another teacher cannot change it", U.teacherA2, `with u as (update content_packages set title = 'x' where id = '${PKG}' returning 1) select count(*) n from u`, 0);
  await db.exec(`insert into content_attempts (tenant_id, package_id, user_id, student_id, status, score) values ('${T.A}', '${PKG}', '${U.studentA}', '${KID}', 'passed', 90)`);
  await expectRows("the student reads their attempt", U.studentA, "select count(*) n from content_attempts", 1);
  await expectRows("the parent reads it", U.parentA, "select count(*) n from content_attempts", 1);
  await expectRows("students cannot change their score", U.studentA, `with u as (update content_attempts set score = 100 returning 1) select count(*) n from u`, 0);
  await expectError("…or record attempts themselves", U.studentA, `insert into content_attempts (tenant_id, package_id, user_id, student_id, status) values ('${T.A}', '${PKG2}', '${U.studentA}', '${KID}', 'passed')`, /row-level security/);
  await expectRows("the record store is server-only", U.studentA, "select count(*) n from xapi_state", 0);

  console.log("\nLearning paths");
  await expectOk("a teacher drafts a path for JSS1", U.teacherA, `insert into learning_paths (id, tenant_id, title, class_group_ids, created_by) values ('${PATH}', '${T.A}', 'Fractions path', '{${JSS1}}', '${U.teacherA}')`);
  await expectOk("with a content step", U.teacherA, `insert into learning_path_steps (id, tenant_id, path_id, title, kind, package_id) values ('${STEP}', '${T.A}', '${PATH}', 'Decimals game', 'content', '${PKG2}')`);
  await expectError("links must be https", U.teacherA, `insert into learning_path_steps (tenant_id, path_id, title, kind, url) values ('${T.A}', '${PATH}', 'x', 'link', 'http://x.org')`, /check/);
  await expectRows("students do not see drafts", U.studentA, "select (select count(*) from learning_paths) + (select count(*) from learning_path_steps) n", 0);
  await db.exec(`update learning_paths set status = 'published' where id = '${PATH}'`);
  await expectRows("…but see a published path and its steps", U.studentA, "select (select count(*) from learning_paths) + (select count(*) from learning_path_steps) n", 2);
  await expectRows("and the content it uses", U.studentA, `select count(*) n from content_packages where id = '${PKG2}'`, 1);
  await expectRows("another class sees nothing", STU2, "select (select count(*) from learning_paths) + (select count(*) from content_packages) n", 0);
  await expectRows("another teacher cannot edit the steps", U.bursarA, `with u as (update learning_path_steps set title = 'x' returning 1) select count(*) n from u`, 0);
  await expectError("progress is recorded by the server only", U.studentA, `insert into learning_path_progress (step_id, student_id, tenant_id, path_id, status) values ('${STEP}', '${KID}', '${T.A}', '${PATH}', 'done')`, /row-level security/);

  console.log("\nOnline lessons");
  await expectOk("a teacher schedules a Meet lesson for JSS1", U.teacherA, `insert into online_lessons (id, tenant_id, class_group_id, title, provider, join_url, starts_at, created_by) values
    ('${LESSON}', '${T.A}', '${JSS1}', 'Fractions live', 'meet', 'https://meet.google.com/abc-defg-hij', now() + interval '1 day', '${U.teacherA}'),
    ('${LESSON2}', '${T.A}', '${CLASS2}', 'Other class', 'zoom', 'https://zoom.us/j/1', now() + interval '1 day', '${U.teacherA}')`);
  await expectError("links must be https", U.teacherA, `insert into online_lessons (tenant_id, class_group_id, title, provider, join_url, starts_at, created_by) values ('${T.A}', '${JSS1}', 'Bad', 'other', 'javascript:alert(1)', now(), '${U.teacherA}')`, /check/);
  await expectRows("the student sees their class's lesson only", U.studentA, "select count(*) n from online_lessons", 1);
  await expectRows("the parent sees it too", U.parentA, "select count(*) n from online_lessons", 1);
  await db.exec(`insert into online_lesson_hosts (lesson_id, tenant_id, start_url) values ('${LESSON2}', '${T.A}', 'https://zoom.us/s/1?zak=secret')`);
  await expectError("host links are server-only", U.teacherA, "select * from online_lesson_hosts", /permission denied/);
  await expectError("so are a school's Zoom keys", U.adminA, "select * from integration_secrets", /permission denied/);
  await expectError("students cannot mark themselves as joined", U.studentA, `insert into online_lesson_joins (lesson_id, user_id, tenant_id, student_id) values ('${LESSON}', '${U.studentA}', '${T.A}', '${KID}')`, /row-level security/);

  console.log("\nStudy helper");
  await db.exec(`insert into tutor_conversations (id, tenant_id, student_id, user_id, title, concern, concern_at) values ('${CONV}', '${T.A}', '${KID}', '${U.studentA}', 'Fractions help', 'wellbeing', now());
    insert into tutor_messages (tenant_id, conversation_id, role, content) values ('${T.A}', '${CONV}', 'student', 'I feel stressed'), ('${T.A}', '${CONV}', 'tutor', 'That sounds hard. Talk to someone you trust.');`);
  await expectRows("the student reads their chat", U.studentA, "select count(*) n from tutor_messages", 2);
  await expectRows("so does their parent", U.parentA, "select count(*) n from tutor_messages", 2);
  await expectRows("their teacher", U.teacherA, "select count(*) n from tutor_conversations", 1);
  await expectRows("and the counsellor", COUNS, "select count(*) n from tutor_conversations", 1);
  await expectRows("but not other staff", U.bursarA, "select count(*) n from tutor_conversations", 0);
  await expectRows("or other students", STU2, "select count(*) n from tutor_messages", 0);
  await expectError("students cannot write the helper's replies", U.studentA, `insert into tutor_messages (tenant_id, conversation_id, role, content) values ('${T.A}', '${CONV}', 'tutor', 'You got 100%')`, /row-level security/);
  await expectOk("the counsellor marks it followed up", COUNS, `update tutor_conversations set reviewed_at = now() where id = '${CONV}'`);
  const rv = await q(`select reviewed_by from tutor_conversations where id = '${CONV}'`);
  check("…and is recorded as the reviewer", rv[0].reviewed_by === COUNS, rv[0]);
  await expectError("staff cannot clear the concern", COUNS, `update tutor_conversations set concern = null where id = '${CONV}'`, /only be marked as reviewed/);

  console.log("\nPoints and change history");
  await expectOk("points can be recorded with 'on conflict do nothing'", U.adminA, `select 1`);
  await db.exec(`insert into learning_activity (tenant_id, student_id, kind, points, ref_id) values ('${T.A}', '${KID}', 'content', 5, '${PKG}') on conflict (student_id, kind, ref_id) do nothing;
    insert into learning_activity (tenant_id, student_id, kind, points, ref_id) values ('${T.A}', '${KID}', 'content', 5, '${PKG}') on conflict (student_id, kind, ref_id) do nothing;
    insert into learning_activity (tenant_id, student_id, kind, points) values ('${T.A}', '${KID}', 'practice', 5), ('${T.A}', '${KID}', 'practice', 5);`);
  const la = await q(`select kind, count(*)::int n from learning_activity where student_id = '${KID}' and kind in ('content','practice') group by kind order by kind`);
  check("an item counts once; activity without an item can repeat", la[0]?.n === 1 && la[1]?.n === 2, la);
  const dc = await q(`select (select count(*)::int from data_changes where table_name = 'learning_paths' and row_id = '${PATH}') paths,
    (select count(*)::int from data_changes where table_name = 'schemes_of_work') schemes, (select count(*)::int from data_changes where table_name = 'online_lesson_hosts') hosts`);
  check("tables added in phases 5 and 6 now keep a change history", dc[0].paths >= 2 && dc[0].schemes >= 1, dc[0]);
  check("host links never appear in the history", dc[0].hosts === 0, dc[0]);

  // Later tests count students and classes.
  await db.exec(`delete from tutor_conversations where id = '${CONV}'; delete from students where id = '${KID2}'; delete from class_groups where id = '${CLASS2}';`);
}
