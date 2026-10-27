// Phase 14j: the exams office — the exam officer role, the planner, exam requests decided by the office, and the resit archive.
export default async function ({ db, q, expectRows, expectError, expectOk, check, U, T }) {
  const KID = "a8000000-0000-0000-0000-000000000001", OTHER = "a8000000-0000-0000-0000-000000000002";
  const ID = n => `eb000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
  const EO = ID(1), EXAM = ID(2), R1 = ID(3), R2 = ID(4), R3 = ID(5);
  await db.exec(`insert into auth.users (id) values ('${EO}');
    insert into users (id, tenant_id, email, full_name, role) values ('${EO}', '${T.A}', 'eo@a', 'Exam Officer', 'exam_officer');
    insert into exams (id, tenant_id, created_by, title, status) values ('${EXAM}', '${T.A}', '${U.teacherA}', 'JSS2 Maths', 'published');`);

  console.log("\nExams office: the role");
  await expectRows("an exam officer is staff and runs the exams office", EO, `select count(*) n from (select public.is_staff() a, public.is_exam_office() b) x where a and b`, 1);
  await expectRows("a teacher is not the exams office", U.teacherA, `select count(*) n from (select public.is_exam_office() b) x where b`, 0);
  await expectOk("the exam officer adds an exam hall", EO, `insert into exam_halls (tenant_id, name, capacity) values ('${T.A}', 'Hall 14j', 60)`);
  await expectError("a teacher cannot", U.teacherA, `insert into exam_halls (tenant_id, name, capacity) values ('${T.A}', 'Hall 14j-t', 60)`, /row-level security/);
  await expectRows("the exam officer sees every exam", EO, `select count(*) n from exams where id = '${EXAM}'`, 1);

  console.log("\nExams office: requests");
  await expectOk("a teacher asks for 15 minutes' extra time", U.teacherA, `insert into exam_requests (id, tenant_id, exam_id, student_id, kind, minutes, reason, requested_by, requested_as) values ('${R1}', '${T.A}', '${EXAM}', '${KID}', 'extra_time', 15, 'Broken wrist', '${U.teacherA}', 'staff')`);
  await expectOk("a parent asks for a late sitting for their child", U.parentA, `insert into exam_requests (id, tenant_id, exam_id, student_id, kind, opens_at, closes_at, reason, requested_by, requested_as) values ('${R2}', '${T.A}', '${EXAM}', '${KID}', 'late_sitting', '2026-11-10 09:00+01', '2026-11-10 12:00+01', 'In hospital on the day', '${U.parentA}', 'parent')`);
  await expectError("…but not for someone else's child", U.parentA, `insert into exam_requests (tenant_id, exam_id, student_id, kind, minutes, reason, requested_by, requested_as) values ('${T.A}', '${EXAM}', '${OTHER}', 'extra_time', 10, 'x x x', '${U.parentA}', 'parent')`, /row-level security/);
  await expectOk("a student asks for a reader for themself", U.studentA, `insert into exam_requests (id, tenant_id, exam_id, student_id, kind, arrangement, reason, requested_by, requested_as) values ('${R3}', '${T.A}', '${EXAM}', '${KID}', 'special_arrangement', 'A reader', 'I read slowly', '${U.studentA}', 'student')`);
  await expectError("…and cannot pretend to be staff", U.studentA, `insert into exam_requests (tenant_id, exam_id, student_id, kind, minutes, reason, requested_by, requested_as) values ('${T.A}', '${EXAM}', '${KID}', 'extra_time', 60, 'Please', '${U.studentA}', 'staff')`, /row-level security/);
  await expectError("extra time needs the minutes", U.teacherA, `insert into exam_requests (tenant_id, exam_id, student_id, kind, reason, requested_by) values ('${T.A}', '${EXAM}', '${KID}', 'extra_time', 'Why not', '${U.teacherA}')`, /check/);
  await expectError("a teacher cannot approve", U.teacherA, `update exam_requests set status = 'approved' where id = '${R1}'`, /exams office/);
  await expectError("…nor change the minutes", U.teacherA, `update exam_requests set minutes = 90 where id = '${R1}'`, /exams office/);
  await expectOk("the exam officer approves", EO, `update exam_requests set status = 'approved', decision_note = 'Approved' where id = '${R1}'`);
  const d = await q(`select decided_by, decided_at is not null decided from exam_requests where id = '${R1}'`);
  check("who decided and when is kept", d[0]?.decided_by === EO && d[0]?.decided, d);
  await expectError("a decision is final", EO, `update exam_requests set status = 'declined' where id = '${R1}'`, /already been decided/);
  await expectRows("the parent cancels their own request", U.parentA, `with u as (update exam_requests set status = 'cancelled' where id = '${R2}' returning 1) select count(*) n from u`, 1);
  await expectRows("…but cannot touch the student's", U.parentA, `with u as (update exam_requests set status = 'cancelled' where id = '${R3}' returning 1) select count(*) n from u`, 0);
  await expectRows("the parent sees their child's requests", U.parentA, `select count(*) n from exam_requests`, 3);
  await expectRows("the student sees their own", U.studentA, `select count(*) n from exam_requests`, 3);
  await expectRows("another school sees none", U.adminB, `select count(*) n from exam_requests`, 0);

  console.log("\nExams office: resits keep the first attempt");
  await q(`insert into exam_attempt_archive (tenant_id, exam_id, student_user_id, request_id, attempt) values ('${T.A}', '${EXAM}', '${U.studentA}', '${R1}', '{"total_score": 12}')`);
  await expectRows("staff can see the archived attempt", U.teacherA2, `select count(*) n from exam_attempt_archive`, 1);
  await expectRows("the student cannot", U.studentA, `select count(*) n from exam_attempt_archive`, 0);
  await expectError("nobody writes the archive directly", EO, `insert into exam_attempt_archive (tenant_id, exam_id, attempt) values ('${T.A}', '${EXAM}', '{}')`, /row-level security/);

  await db.exec(`delete from exams where id = '${EXAM}'; delete from exam_halls where name like 'Hall 14j%'; delete from users where id = '${EO}'; delete from auth.users where id = '${EO}';`);
}
