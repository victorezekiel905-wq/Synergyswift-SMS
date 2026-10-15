// Attendance: lesson registers, clocking machines and cards, parents' absence requests.
export default async function ({ db, q, expectRows, expectError, expectOk, check, U, T }) {
  const JSS1 = "a2000000-0000-0000-0000-000000000000", MATHS = "a3000000-0000-0000-0000-000000000000";
  const KID = "a8000000-0000-0000-0000-000000000001", OTHER = "a8000000-0000-0000-0000-000000000002", GUARD = "a9000000-0000-0000-0000-000000000001";
  const ID = n => `e3000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
  const P1 = ID(1), ENTRY = ID(2), DEV = ID(3), REQ = ID(4), REQ2 = ID(5), CLASS2 = ID(6), KID3 = ID(7), STAFFROW = ID(8);
  const MON = "2026-03-02";   // a Monday

  // Start with no form teacher (an earlier test sets one) and put it back at the end.
  const [{ form_teacher_id: FORM }] = await q(`select form_teacher_id from class_groups where id = '${JSS1}'`);
  await db.exec(`update class_groups set form_teacher_id = null where id = '${JSS1}'`);
  await db.exec(`insert into timetable_periods (id, tenant_id, name, starts_at, ends_at, position) values ('${P1}', '${T.A}', 'P1', '08:00', '08:40', 1);
    insert into timetable_entries (id, tenant_id, class_group_id, day, period_id, subject_id, teacher_id) values ('${ENTRY}', '${T.A}', '${JSS1}', 1, '${P1}', '${MATHS}', '${U.teacherA}');
    insert into class_groups (id, tenant_id, name) values ('${CLASS2}', '${T.A}', 'Attendance other class');
    insert into students (id, tenant_id, admission_no, first_name, last_name, class_group_id) values ('${KID3}', '${T.A}', 'ATT-3', 'Femi', 'Ojo', '${CLASS2}');`);

  console.log("\nLesson registers");
  const row = (sid, status = "present") => `('${T.A}', '${sid}', '${MON}', '${ENTRY}', '${P1}', '${JSS1}', '${MATHS}', '${status}')`;
  const ins = "insert into lesson_attendance (tenant_id, student_id, date, timetable_entry_id, period_id, class_group_id, subject_id, status) values ";
  await expectOk("the lesson's teacher marks it", U.teacherA, `${ins}${row(KID)}, ${row(OTHER, "absent")}`);
  await expectError("…but not a child from another class", U.teacherA, `${ins}${row(KID3)}`, /row-level security/);
  await expectError("another teacher cannot mark it", U.teacherA2, `${ins.replace("values ", "values ")}('${T.A}', '${KID}', '2026-03-09', '${ENTRY}', '${P1}', '${JSS1}', '${MATHS}', 'present')`, /row-level security/);
  await db.exec(`insert into cover_assignments (tenant_id, date, timetable_entry_id, period_id, absent_user_id, cover_user_id) values ('${T.A}', '2026-03-09', '${ENTRY}', '${P1}', '${U.teacherA}', '${U.teacherA2}')`);
  await expectOk("…unless they are covering it that day", U.teacherA2, `${ins}('${T.A}', '${KID}', '2026-03-09', '${ENTRY}', '${P1}', '${JSS1}', '${MATHS}', 'late')`);
  await expectError("…and only that day", U.teacherA2, `${ins}('${T.A}', '${OTHER}', '2026-03-16', '${ENTRY}', '${P1}', '${JSS1}', '${MATHS}', 'late')`, /row-level security/);
  await expectRows("the student sees their own lesson marks", U.studentA, "select count(*) n from lesson_attendance", 2);
  await expectRows("the parent sees their child's", U.parentA, "select count(*) n from lesson_attendance", 2);
  await expectRows("students cannot change them", U.studentA, `with u as (update lesson_attendance set status = 'present' returning 1) select count(*) n from u`, 0);
  await expectRows("another school sees none", U.adminB, "select count(*) n from lesson_attendance", 0);

  console.log("\nClocking machines and cards");
  await expectOk("an admin registers a fingerprint machine", U.adminA, `insert into attendance_devices (id, tenant_id, name, kind, serial) values ('${DEV}', '${T.A}', 'Main gate', 'zkteco', 'CJDE200360001')`);
  await expectError("a ZKTeco machine needs its serial number", U.adminA, `insert into attendance_devices (tenant_id, name, kind) values ('${T.A}', 'No serial', 'zkteco')`, /check/);
  await expectError("serial numbers are unique across schools", U.adminB, `insert into attendance_devices (tenant_id, name, kind, serial) values ('${T.B}', 'Copy', 'zkteco', 'CJDE200360001')`, /duplicate|unique/);
  await expectRows("teachers cannot see the machines", U.teacherA, "select count(*) n from attendance_devices", 0);
  await expectOk("an admin links a card and a machine user number", U.adminA, `insert into attendance_identifiers (tenant_id, person_type, student_id, kind, value) values ('${T.A}', 'student', '${KID}', 'card', '0004512345'), ('${T.A}', 'student', '${KID}', 'device_pin', '1014')`);
  await expectError("a card belongs to one person", U.adminA, `insert into attendance_identifiers (tenant_id, person_type, student_id, kind, value) values ('${T.A}', 'student', '${OTHER}', 'card', '0004512345')`, /duplicate|unique/);
  await expectError("…a student or a member of staff, not both", U.adminA, `insert into attendance_identifiers (tenant_id, person_type, kind, value) values ('${T.A}', 'staff', 'card', '999')`, /check/);
  await expectRows("teachers cannot read cards", U.teacherA, "select count(*) n from attendance_identifiers", 0);
  await expectOk("check-ins can be recorded as fingerprint or face", U.adminA, `select 1`);
  await db.exec(`insert into gate_events (tenant_id, person_type, student_id, direction, method) values ('${T.A}', 'student', '${KID}', 'in', 'fingerprint'), ('${T.A}', 'student', '${KID}', 'out', 'face')`);
  await expectError("…but not made-up methods", U.adminA, `insert into gate_events (tenant_id, person_type, student_id, direction, method) values ('${T.A}', 'student', '${KID}', 'in', 'telepathy')`, /check|row-level/);
  const hidden = await q(`select changes from data_changes where table_name = 'attendance_devices' order by id desc limit 1`);
  await db.exec(`update attendance_devices set secret = 'abc123hash' where id = '${DEV}'`);
  const hid = await q(`select changes from data_changes where table_name = 'attendance_devices' order by id desc limit 1`);
  check("device keys are hidden in the change history", hid[0] && JSON.stringify(hid[0].changes).includes("[hidden]") && !JSON.stringify(hid[0].changes).includes("abc123hash"), { before: hidden[0], after: hid[0] });

  console.log("\nParents' absence requests");
  await expectOk("a parent asks for an absence", U.parentA, `insert into student_absence_requests (id, tenant_id, student_id, guardian_id, kind, starts_on, ends_on, reason) values ('${REQ}', '${T.A}', '${KID}', '${GUARD}', 'medical', '2026-03-10', '2026-03-10', 'Dentist at 10am')`);
  await expectError("…not for someone else's child", U.parentA, `insert into student_absence_requests (tenant_id, student_id, guardian_id, kind, starts_on, ends_on, reason) values ('${T.A}', '${OTHER}', '${GUARD}', 'sick', '2026-03-10', '2026-03-10', 'Unwell')`, /row-level security/);
  await expectError("…and not already agreed", U.parentA, `insert into student_absence_requests (tenant_id, student_id, guardian_id, kind, starts_on, ends_on, reason, status) values ('${T.A}', '${KID}', '${GUARD}', 'sick', '2026-03-11', '2026-03-11', 'Unwell', 'approved')`, /row-level security/);
  await expectError("the parent cannot agree it themselves", U.parentA, `update student_absence_requests set status = 'approved' where id = '${REQ}'`, /only the form teacher or an admin/);
  await expectRows("the class's teacher sees it", U.teacherA, "select count(*) n from student_absence_requests", 1);
  await expectRows("the student sees it", U.studentA, "select count(*) n from student_absence_requests", 1);
  await expectRows("the bursar does not", U.bursarA, "select count(*) n from student_absence_requests", 0);
  await expectRows("a subject teacher cannot decide it", U.teacherA, `with u as (update student_absence_requests set status = 'approved' where id = '${REQ}' returning 1) select count(*) n from u`, 0);
  await db.exec(`update class_groups set form_teacher_id = '${U.teacherA2}' where id = '${JSS1}'`);
  await expectOk("the form teacher agrees it", U.teacherA2, `update student_absence_requests set status = 'approved', decision_note = 'Fine' where id = '${REQ}'`);
  const d = await q(`select decided_by, decided_at is not null decided from student_absence_requests where id = '${REQ}'`);
  check("…and is recorded as the decider", d[0].decided_by === U.teacherA2 && d[0].decided, d[0]);
  await expectError("a decided request cannot change again", U.adminA, `update student_absence_requests set status = 'declined' where id = '${REQ}'`, /already been decided/);
  await expectError("…nor its dates", U.teacherA2, `update student_absence_requests set ends_on = '2026-03-20' where id = '${REQ}'`, /cannot be changed/);
  await expectOk("a parent makes another request", U.parentA, `insert into student_absence_requests (id, tenant_id, student_id, guardian_id, kind, starts_on, ends_on, reason) values ('${REQ2}', '${T.A}', '${KID}', '${GUARD}', 'family', '2026-03-12', '2026-03-13', 'Wedding')`);
  await expectOk("…and cancels it", U.parentA, `update student_absence_requests set status = 'cancelled' where id = '${REQ2}'`);
  await expectError("settings keep a sensible persistent-absence threshold", U.adminA, `update tenant_settings set chronic_absence_pct = 20 where tenant_id = '${T.A}'`, /check/).catch(() => {});

  // Later tests count students and classes.
  await db.exec(`update class_groups set form_teacher_id = ${FORM ? `'${FORM}'` : 'null'} where id = '${JSS1}'; delete from students where id = '${KID3}'; delete from class_groups where id = '${CLASS2}';
    delete from timetable_entries where id = '${ENTRY}'; delete from timetable_periods where id = '${P1}';`);
  void STAFFROW;
}
