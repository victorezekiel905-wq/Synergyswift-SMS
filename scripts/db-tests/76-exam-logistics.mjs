// Exam planner: admins plan, staff read, students see only their own published papers and seats.
export default async function ({ db, expectRows, expectError, expectOk, U, T }) {
  const CG = "a2000000-0000-0000-0000-000000000000", S1 = "a8000000-0000-0000-0000-000000000001", S2 = "a8000000-0000-0000-0000-000000000002";
  const HALL = "ae000000-0000-0000-0000-000000000001", SER = "ae000000-0000-0000-0000-000000000002", PAP = "ae000000-0000-0000-0000-000000000003";
  console.log("\nExam planner");
  await expectOk("admin adds a hall", U.adminA, `insert into exam_halls (id, tenant_id, name, capacity, rows, cols) values ('${HALL}', '${T.A}', 'Main hall', 40, 5, 8)`);
  await expectError("teachers cannot add halls", U.teacherA, `insert into exam_halls (tenant_id, name, capacity) values ('${T.A}', 'Lab', 20)`, /row-level security/);
  await expectOk("admin creates an exam period", U.adminA, `insert into exam_series (id, tenant_id, name, starts_on, ends_on) values ('${SER}', '${T.A}', 'First term exams', '2026-12-01', '2026-12-12')`);
  await expectOk("admin adds a paper", U.adminA, `insert into exam_papers (id, tenant_id, series_id, title, class_group_ids, slot_date, slot_session) values ('${PAP}', '${T.A}', '${SER}', 'JSS1 Maths', '{${CG}}', '2026-12-01', 0)`);
  await expectOk("admin seats students", U.adminA, `insert into exam_seats (tenant_id, series_id, paper_id, hall_id, student_id, row, col, label) values
    ('${T.A}', '${SER}', '${PAP}', '${HALL}', '${S1}', 0, 0, 'A1'), ('${T.A}', '${SER}', '${PAP}', '${HALL}', '${S2}', 0, 1, 'A2')`);
  await expectOk("admin assigns an invigilator", U.adminA, `insert into exam_invigilations (tenant_id, series_id, slot_date, slot_session, hall_id, staff_user_id, chief) values ('${T.A}', '${SER}', '2026-12-01', 0, '${HALL}', '${U.teacherA}', true)`);
  await expectError("the same person cannot invigilate twice in one session", U.adminA, `insert into exam_invigilations (tenant_id, series_id, slot_date, slot_session, hall_id, staff_user_id) values ('${T.A}', '${SER}', '2026-12-01', 0, '${HALL}', '${U.teacherA}')`, /duplicate key/);
  await expectError("a student cannot have two seats for one paper", U.adminA, `insert into exam_seats (tenant_id, series_id, paper_id, hall_id, student_id, row, col, label) values ('${T.A}', '${SER}', '${PAP}', '${HALL}', '${S1}', 1, 1, 'B2')`, /duplicate key/);

  await expectRows("teachers read the whole plan", U.teacherA, "select count(*) n from exam_seats", 2);
  await expectRows("students see nothing while the plan is a draft", U.studentA, "select count(*) n from exam_papers", 0);
  await db.exec(`update exam_series set status = 'published' where id = '${SER}'`);
  await expectRows("after publishing, a student sees their class's paper", U.studentA, "select count(*) n from exam_papers", 1);
  await expectRows("a student sees only their own seat", U.studentA, "select count(*) n from exam_seats", 1);
  await expectRows("a student sees the hall they sit in", U.studentA, "select count(*) n from exam_halls", 1);
  await expectRows("a parent sees their child's seat", U.parentA, "select count(*) n from exam_seats", 1);
  await expectRows("students do not see the invigilation roster", U.studentA, "select count(*) n from exam_invigilations", 0);
  await expectRows("another school sees nothing", U.adminB, "select count(*) n from exam_papers", 0);
  await expectError("students cannot move seats", U.studentA, `insert into exam_seats (tenant_id, series_id, paper_id, hall_id, student_id, row, col, label) values ('${T.A}', '${SER}', '${PAP}', '${HALL}', '${S2}', 4, 4, 'E5')`, /row-level security/);
}
