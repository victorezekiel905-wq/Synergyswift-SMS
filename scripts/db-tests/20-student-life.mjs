// Attendance, behaviour, homework, health, lesson notes, timetable, admissions, groups.
export default async function ({ db, expectRows, expectError, expectOk, U, T }) {
  const S1 = "a8000000-0000-0000-0000-000000000001";
  const CG = "a2000000-0000-0000-0000-000000000000";
  console.log("\nStudent life");
  await expectOk("subject teacher marks the class register", U.teacherA,
    `insert into class_attendance (tenant_id, student_id, class_group_id, date, status, marked_by) values ('${T.A}', '${S1}', '${CG}', '2026-09-21', 'absent', '${U.teacherA}')`);
  await expectError("a teacher who does not teach the class cannot mark it", U.teacherA2,
    `insert into class_attendance (tenant_id, student_id, class_group_id, date, status) values ('${T.A}', 'a8000000-0000-0000-0000-000000000002', '${CG}', '2026-09-21', 'present')`, /row-level security/);
  await expectRows("parent sees only their child's attendance", U.parentA, "select count(*) n from class_attendance", 1);

  await expectOk("teacher records behaviour", U.teacherA,
    `insert into behaviour_records (tenant_id, student_id, kind, points, recorded_by) values ('${T.A}', '${S1}', 'positive', 2, '${U.teacherA}')`);
  await expectError("teacher cannot record behaviour in another teacher's name", U.teacherA,
    `insert into behaviour_records (tenant_id, student_id, kind, points, recorded_by) values ('${T.A}', '${S1}', 'negative', -1, '${U.teacherA2}')`, /row-level security/);
  await expectRows("student sees their own behaviour", U.studentA, "select count(*) n from behaviour_records", 1);

  await db.exec(`insert into medical_profiles (student_id, tenant_id, allergies) values ('${S1}', '${T.A}', 'Peanuts')`);
  await expectRows("the child's teacher can see allergies", U.teacherA, "select count(*) n from medical_profiles", 1);
  await expectRows("other teachers cannot see medical records", U.teacherA2, "select count(*) n from medical_profiles", 0);
  await expectOk("parent can update their child's medical info", U.parentA, `update medical_profiles set allergies = 'Peanuts, penicillin' where student_id = '${S1}'`);

  await expectOk("teacher writes a lesson note", U.teacherA,
    `insert into lesson_notes (id, tenant_id, author_id, topic, status) values ('b0000000-0000-0000-0000-00000000000a', '${T.A}', '${U.teacherA}', 'Fractions', 'submitted')`);
  await expectRows("other teachers cannot read it", U.teacherA2, "select count(*) n from lesson_notes", 0);
  await expectError("teacher cannot approve their own note", U.teacherA, "update lesson_notes set status = 'approved'", /only the principal|cannot approve your own/);
  await expectOk("admin approves the note", U.adminA, "update lesson_notes set status = 'approved'");
  await expectError("approved notes are locked", U.teacherA, "update lesson_notes set content = 'changed'", /locked/);

  console.log("\nTimetable and logistics");
  await db.exec(`insert into timetable_periods (id, tenant_id, name, starts_at, ends_at, position) values ('b1000000-0000-0000-0000-000000000001', '${T.A}', 'P1', '08:00', '08:40', 1);
    insert into class_groups (id, tenant_id, name) values ('a2000000-0000-0000-0000-000000000009', '${T.A}', 'JSS2')`);
  await expectOk("admin schedules a lesson", U.adminA,
    `insert into timetable_entries (tenant_id, class_group_id, day, period_id, teacher_id) values ('${T.A}', '${CG}', 1, 'b1000000-0000-0000-0000-000000000001', '${U.teacherA}')`);
  await expectError("a teacher cannot be double-booked", U.adminA,
    `insert into timetable_entries (tenant_id, class_group_id, day, period_id, teacher_id) values ('${T.A}', 'a2000000-0000-0000-0000-000000000009', 1, 'b1000000-0000-0000-0000-000000000001', '${U.teacherA}')`, /duplicate key|timetable_teacher_clash/);
  await expectRows("students can read the timetable", U.studentA, "select count(*) n from timetable_entries", 1);

  await db.exec(`insert into applications (tenant_id, application_no, first_name, last_name, applying_for, guardian_name, guardian_phone) values ('${T.A}', 'APP-1', 'New', 'Kid', 'JSS1', 'Mum', '080')`);
  await expectRows("admins see applications", U.adminA, "select count(*) n from applications", 1);
  await expectRows("teachers do not see applications", U.teacherA, "select count(*) n from applications", 0);
  await expectRows("other schools do not see applications", U.adminB, "select count(*) n from applications", 0);
  await expectError("school users cannot read school groups", U.adminA, "select * from tenant_groups", /permission denied/);
  await expectError("parents cannot write exeat requests directly", U.parentA,
    `insert into exeat_requests (tenant_id, student_id, reason, leave_at, return_by) values ('${T.A}', '${S1}', 'x', now(), now() + interval '1 day')`, /row-level security/);
}
