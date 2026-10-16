// Boarding: exeats agreed by a parent, roll calls, house notes, menus and dining. Transport: buses and drivers.
export default async function ({ db, q, expectRows, expectError, expectOk, check, U, T }) {
  const KID = "a8000000-0000-0000-0000-000000000001";
  const ID = n => `eb000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
  const HOSTEL = ID(1), ROOM = ID(2), EX = ID(3), CALL = ID(4), BUS = ID(5), ROUTE = ID(6);
  await db.exec(`insert into hostels (id, tenant_id, name) values ('${HOSTEL}', '${T.A}', 'Test House');
    insert into hostel_rooms (id, tenant_id, hostel_id, name, capacity) values ('${ROOM}', '${T.A}', '${HOSTEL}', 'R1', 4);
    insert into hostel_allocations (tenant_id, room_id, student_id) values ('${T.A}', '${ROOM}', '${KID}');`);

  console.log("\nExeats agreed by a parent");
  await db.exec(`insert into exeat_requests (id, tenant_id, student_id, requested_by, kind, reason, leave_at, return_by, status) values ('${EX}', '${T.A}', '${KID}', 'student', 'weekend', 'Cousin''s wedding', now() + interval '1 day', now() + interval '3 days', 'awaiting_parent')`);
  await expectRows("the parent sees the request waiting for them", U.parentA, `select count(*) n from exeat_requests where status = 'awaiting_parent'`, 1);
  let bad = false;
  try { await q(`update exeat_requests set status = 'teleported' where id = '${EX}'`); } catch { bad = true; }
  check("only the known exeat states are allowed", bad, null);
  await expectRows("families still cannot change exeats directly", U.parentA, `with u as (update exeat_requests set status = 'approved' returning 1) select count(*) n from u`, 0);

  console.log("\nRoll calls, notes and dining");
  await expectError("teachers do not take boarding roll calls", U.teacherA, `insert into boarding_roll_calls (tenant_id, hostel_id) values ('${T.A}', '${HOSTEL}')`, /row-level security/);
  await expectOk("house staff take the roll", U.adminA, `insert into boarding_roll_calls (id, tenant_id, hostel_id, kind) values ('${CALL}', '${T.A}', '${HOSTEL}', 'evening')`);
  await expectOk("…marking each boarder", U.adminA, `insert into boarding_roll_marks (roll_call_id, tenant_id, student_id, status) values ('${CALL}', '${T.A}', '${KID}', 'present')`);
  await expectError("…with a known status", U.adminA, `update boarding_roll_marks set status = 'asleep' where roll_call_id = '${CALL}'`, /check/);
  await expectRows("staff can see roll calls", U.teacherA, "select count(*) n from boarding_roll_calls", 1);
  await expectRows("parents see their child's mark", U.parentA, "select count(*) n from boarding_roll_marks", 1);
  await expectOk("house staff write notes", U.adminA, `insert into boarding_notes (tenant_id, student_id, kind, note, visible_to_parent, author_id) values ('${T.A}', '${KID}', 'achievement', 'Led evening prep well', true, '${U.adminA}'), ('${T.A}', '${KID}', 'welfare', 'Seemed homesick', false, '${U.adminA}')`);
  await expectRows("parents see only the shared note", U.parentA, "select count(*) n from boarding_notes", 1);
  await expectRows("teachers see none", U.teacherA, "select count(*) n from boarding_notes", 0);
  await expectError("notes are written in your own name", U.adminA, `insert into boarding_notes (tenant_id, student_id, note, author_id) values ('${T.A}', '${KID}', 'Forged', '${U.teacherA}')`, /row-level security/);
  await expectOk("house staff set the menu", U.adminA, `insert into meal_menus (tenant_id, on_date, meal, items) values ('${T.A}', current_date, 'lunch', 'Jollof rice and chicken')`);
  await expectError("…once per meal", U.adminA, `insert into meal_menus (tenant_id, on_date, meal, items) values ('${T.A}', current_date, 'lunch', 'Again')`, /duplicate|unique/);
  await expectRows("families can read the menu", U.parentA, "select count(*) n from meal_menus", 1);
  await expectError("teachers cannot change it", U.teacherA, `insert into meal_menus (tenant_id, on_date, meal, items) values ('${T.A}', current_date, 'supper', 'x')`, /row-level security/);
  await expectOk("the dining register", U.adminA, `insert into dining_marks (tenant_id, on_date, meal, student_id, status) values ('${T.A}', current_date, 'lunch', '${KID}', 'ate')`);
  await expectRows("…which the parent can see", U.parentA, "select count(*) n from dining_marks", 1);

  console.log("\nBuses and drivers");
  await expectOk("transport staff add a bus", U.adminA, `insert into vehicles (id, tenant_id, reg_no, seats, insurance_expires) values ('${BUS}', '${T.A}', 'LAG-123-AB', 32, current_date + 200)`);
  await expectError("…once per registration", U.adminA, `insert into vehicles (tenant_id, reg_no) values ('${T.A}', 'LAG-123-AB')`, /duplicate|unique/);
  await expectOk("…and a driver", U.adminA, `insert into drivers (tenant_id, full_name, licence_expires) values ('${T.A}', 'Musa Bello', current_date + 30)`);
  await expectRows("staff can look them up", U.teacherA, "select count(*) n from vehicles", 1);
  await expectRows("families cannot", U.parentA, "select count(*) n from drivers", 0);
  await expectError("teachers cannot add buses", U.teacherA, `insert into vehicles (tenant_id, reg_no) values ('${T.A}', 'X-1')`, /row-level security/);
  await db.exec(`insert into transport_routes (id, tenant_id, name) values ('${ROUTE}', '${T.A}', 'Test route')`);
  await expectOk("a route runs on a bus", U.adminA, `update transport_routes set vehicle_id = '${BUS}' where id = '${ROUTE}'`);
  await expectRows("other schools see none of it", U.adminB, "select count(*) n from vehicles", 0);

  await db.exec(`delete from transport_routes where id = '${ROUTE}'; delete from vehicles where tenant_id = '${T.A}'; delete from drivers where tenant_id = '${T.A}';
    delete from dining_marks where tenant_id = '${T.A}'; delete from meal_menus where tenant_id = '${T.A}'; delete from boarding_notes where tenant_id = '${T.A}';
    delete from exeat_requests where id = '${EX}'; delete from hostels where id = '${HOSTEL}';`);
}
