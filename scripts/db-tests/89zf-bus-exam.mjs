// Phase 14i-2: bus exceptions and exam-hall check-in — who can see them, and that only the server writes them.
export default async function ({ db, q, expectRows, expectError, check, U, T }) {
  const KID = "a8000000-0000-0000-0000-000000000001", OTHER = "a8000000-0000-0000-0000-000000000002";
  const ID = n => `ea000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
  const ROUTE = ID(1), SERIES = ID(2), PAPER = ID(3), HALL = ID(4), DUTY = ID(5);
  const server = async (name, sql, re) => {
    try { await q(sql); check(name, !re, re ? "expected an error" : null); }
    catch (e) { check(name, Boolean(re && re.test(e.message)), e.message); }
  };

  console.log("\nBus checks");
  await q(`insert into transport_routes (id, tenant_id, name) values ('${ROUTE}', '${T.A}', 'Route 9')`);
  await server("the scheduler raises a check", `insert into bus_exceptions (tenant_id, date, student_id, route_id, kind, boarded_at) values ('${T.A}', '2026-11-02', '${KID}', '${ROUTE}', 'not_dropped_off', '2026-11-02 14:05+00')`);
  await server("…once per child, day and kind", `insert into bus_exceptions (tenant_id, date, student_id, route_id, kind) values ('${T.A}', '2026-11-02', '${KID}', '${ROUTE}', 'not_dropped_off')`, /duplicate|unique/);
  await server("only the two kinds exist", `insert into bus_exceptions (tenant_id, date, student_id, kind) values ('${T.A}', '2026-11-02', '${OTHER}', 'late_bus')`, /check/);
  await expectRows("staff see it", U.teacherA, `select count(*) n from bus_exceptions`, 1);
  await expectRows("parents and children do not (staff call the family)", U.parentA, `select count(*) n from bus_exceptions`, 0);
  await expectRows("…(the child)", U.studentA, `select count(*) n from bus_exceptions`, 0);
  await expectRows("another school sees nothing", U.adminB, `select count(*) n from bus_exceptions`, 0);
  await expectError("nobody raises or edits checks directly", U.adminA, `insert into bus_exceptions (tenant_id, date, student_id, kind) values ('${T.A}', '2026-11-03', '${KID}', 'boarded_not_in_school')`, /row-level security/);
  await expectRows("…or closes them without the server", U.adminA, `with u as (update bus_exceptions set resolved_at = now() returning 1) select count(*) n from u`, 0);

  console.log("\nExam-hall check-in");
  await db.exec(`insert into exam_halls (id, tenant_id, name, capacity) values ('${HALL}', '${T.A}', 'Hall 14i', 100);
    insert into exam_series (id, tenant_id, name, starts_on, ends_on, status) values ('${SERIES}', '${T.A}', 'First term', '2026-11-02', '2026-11-06', 'published');
    insert into exam_papers (id, tenant_id, series_id, title, class_group_ids, slot_date, slot_session) values ('${PAPER}', '${T.A}', '${SERIES}', 'Maths', '{a2000000-0000-0000-0000-000000000000}', '2026-11-02', 0);
    insert into exam_seats (tenant_id, series_id, paper_id, hall_id, student_id, row, col, label) values ('${T.A}', '${SERIES}', '${PAPER}', '${HALL}', '${KID}', 1, 1, 'A1');
    insert into exam_invigilations (id, tenant_id, series_id, slot_date, slot_session, hall_id, staff_user_id) values ('${DUTY}', '${T.A}', '${SERIES}', '2026-11-02', 0, '${HALL}', '${U.teacherA}')`);
  const s = await q(`select require_checkin from exam_series where id = '${SERIES}'`);
  check("check-in before online papers is off unless the school turns it on", s[0]?.require_checkin === false, s);
  await server("the invigilator checks Ada in", `insert into exam_checkins (tenant_id, series_id, paper_id, student_id, hall_id, method, checked_in_by) values ('${T.A}', '${SERIES}', '${PAPER}', '${KID}', '${HALL}', 'card', '${U.teacherA}')`);
  await server("…once per paper", `insert into exam_checkins (tenant_id, series_id, paper_id, student_id) values ('${T.A}', '${SERIES}', '${PAPER}', '${KID}')`, /duplicate|unique/);
  await expectRows("staff see check-ins", U.teacherA2, `select count(*) n from exam_checkins`, 1);
  await expectRows("Ada sees her own", U.studentA, `select count(*) n from exam_checkins`, 1);
  await expectRows("her parent sees it", U.parentA, `select count(*) n from exam_checkins`, 1);
  await expectRows("another school sees nothing", U.adminB, `select count(*) n from exam_checkins`, 0);
  await expectError("a student cannot check themself in", U.studentA, `insert into exam_checkins (tenant_id, series_id, paper_id, student_id) values ('${T.A}', '${SERIES}', '${PAPER}', '${OTHER}')`, /row-level security/);
  await server("invigilators record that they are in the hall, and cover", `update exam_invigilations set checked_in_at = now(), cover_for = '${U.teacherA2}' where id = '${DUTY}'`);

  await db.exec(`delete from exam_series where id = '${SERIES}'; delete from exam_halls where id = '${HALL}'; delete from bus_exceptions where tenant_id = '${T.A}'; delete from transport_routes where id = '${ROUTE}'`);
}
