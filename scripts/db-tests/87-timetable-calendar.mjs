// Timetabling and calendar: rooms, teacher availability, room bookings, calendar links.
export default async function ({ db, q, expectRows, expectError, expectOk, check, U, T }) {
  const JSS1 = "a2000000-0000-0000-0000-000000000000", MATHS = "a3000000-0000-0000-0000-000000000000";
  const ID = n => `e4000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
  const LAB = ID(1), HALL = ID(2), CLOSED = ID(3), P1 = ID(4), E1 = ID(5), B1 = ID(6), B2 = ID(7), B3 = ID(8);

  console.log("\nRooms and timetable rules");
  await expectOk("an admin adds rooms", U.adminA, `insert into rooms (id, tenant_id, name, kind, capacity, needs_approval, bookable) values ('${LAB}', '${T.A}', 'Chemistry lab', 'lab', 30, false, true),
    ('${HALL}', '${T.A}', 'Main hall', 'hall', 400, true, true), ('${CLOSED}', '${T.A}', 'Store', 'other', null, false, false)`);
  await expectError("room names are unique in a school", U.adminA, `insert into rooms (tenant_id, name) values ('${T.A}', 'Main hall')`, /duplicate|unique/);
  await expectError("teachers cannot add rooms", U.teacherA, `insert into rooms (tenant_id, name) values ('${T.A}', 'My room')`, /row-level security/);
  await expectRows("staff see the rooms", U.teacherA, "select count(*) n from rooms", 3);
  await expectRows("students do not", U.studentA, "select count(*) n from rooms", 0);
  await expectError("a subject cannot have more doubles than its periods allow", U.adminA, `update subject_offerings set periods_per_week = 2, doubles = 3 where class_group_id = '${JSS1}'`, /room_rules_check/);
  await expectOk("…but two doubles in four periods, in a lab, is fine", U.adminA, `update subject_offerings set periods_per_week = 4, doubles = 2, room_kind = 'lab' where class_group_id = '${JSS1}'`);
  await db.exec(`update subject_offerings set periods_per_week = 0, doubles = 0, room_kind = null where class_group_id = '${JSS1}';
    insert into timetable_periods (id, tenant_id, name, starts_at, ends_at, position) values ('${P1}', '${T.A}', 'P1', '08:00', '08:40', 1);
    insert into class_groups (id, tenant_id, name) values ('${E1}', '${T.A}', 'Room test class');
    insert into timetable_entries (tenant_id, class_group_id, day, period_id, subject_id, teacher_id, room_id) values ('${T.A}', '${JSS1}', 2, '${P1}', '${MATHS}', '${U.teacherA}', '${LAB}');`);
  await expectError("a room holds one lesson at a time", U.adminA, `insert into timetable_entries (tenant_id, class_group_id, day, period_id, subject_id, room_id) values ('${T.A}', '${E1}', 2, '${P1}', '${MATHS}', '${LAB}')`, /timetable_room_id_clash/);
  await expectOk("a teacher marks a period they cannot teach", U.teacherA, `insert into teacher_unavailability (tenant_id, user_id, day, period_id) values ('${T.A}', '${U.teacherA}', 1, '${P1}')`);
  await expectError("…but not for someone else", U.teacherA, `insert into teacher_unavailability (tenant_id, user_id, day, period_id) values ('${T.A}', '${U.teacherA2}', 1, '${P1}')`, /row-level security/);
  await expectOk("an admin can", U.adminA, `insert into teacher_unavailability (tenant_id, user_id, day, period_id) values ('${T.A}', '${U.teacherA2}', 1, '${P1}')`);

  console.log("\nRoom bookings");
  const book = (id, room, from, to, by = U.teacherA, status = null) => `insert into room_bookings (id, tenant_id, room_id, title, starts_at, ends_at, booked_by${status ? ", status" : ""})
    values ('${id}', '${T.A}', '${room}', 'Practical', '${from}', '${to}', '${by}'${status ? `, '${status}'` : ""})`;
  await expectOk("a teacher books the lab", U.teacherA, book(B1, LAB, "2026-05-04T09:00:00Z", "2026-05-04T10:00:00Z"));
  const b1 = await q(`select status from room_bookings where id = '${B1}'`);
  check("it is confirmed straight away", b1[0].status === "confirmed", b1[0]);
  await expectError("nobody can book over it", U.teacherA2, book(B2, LAB, "2026-05-04T09:30:00Z", "2026-05-04T10:30:00Z", U.teacherA2), /already booked/);
  await expectOk("back-to-back is fine", U.teacherA2, book(B2, LAB, "2026-05-04T10:00:00Z", "2026-05-04T11:00:00Z", U.teacherA2));
  await expectError("…not in someone else's name", U.teacherA, book(ID(20), LAB, "2026-05-05T09:00:00Z", "2026-05-05T10:00:00Z", U.teacherA2), /row-level security/);
  await expectError("rooms that are not bookable cannot be booked", U.teacherA, book(ID(21), CLOSED, "2026-05-05T09:00:00Z", "2026-05-05T10:00:00Z"), /cannot be booked/);
  await expectOk("the hall needs approval, so a teacher's booking waits", U.teacherA, book(B3, HALL, "2026-05-06T13:00:00Z", "2026-05-06T15:00:00Z", U.teacherA, "confirmed"));
  const b3 = await q(`select status from room_bookings where id = '${B3}'`);
  check("…even if they ask for it to be confirmed", b3[0].status === "pending", b3[0]);
  await expectError("the teacher cannot approve it", U.teacherA, `update room_bookings set status = 'confirmed' where id = '${B3}'`, /only admins/);
  await expectError("a waiting booking still holds the slot", U.teacherA2, book(ID(22), HALL, "2026-05-06T14:00:00Z", "2026-05-06T16:00:00Z", U.teacherA2), /already booked/);
  await expectOk("an admin approves it", U.adminA, `update room_bookings set status = 'confirmed' where id = '${B3}'`);
  const b3b = await q(`select decided_by from room_bookings where id = '${B3}'`);
  check("…and is recorded as the approver", b3b[0].decided_by === U.adminA, b3b[0]);
  await expectOk("a teacher cancels their own booking", U.teacherA, `update room_bookings set status = 'cancelled' where id = '${B1}'`);
  await expectRows("…but not someone else's", U.teacherA, `with u as (update room_bookings set status = 'cancelled' where id = '${B2}' returning 1) select count(*) n from u`, 0);
  await expectOk("a cancelled booking frees the slot", U.teacherA2, book(ID(23), LAB, "2026-05-04T09:00:00Z", "2026-05-04T09:45:00Z", U.teacherA2));
  await expectError("bookings cannot run for weeks", U.adminA, book(ID(24), LAB, "2026-06-01T09:00:00Z", "2026-07-01T09:00:00Z", U.adminA), /check/);
  await expectRows("students cannot see bookings", U.studentA, "select count(*) n from room_bookings", 0);
  await expectRows("another school sees none", U.adminB, "select (select count(*) from room_bookings) + (select count(*) from rooms) n", 0);

  console.log("\nCalendar");
  await expectOk("PTA meetings are an event kind", U.adminA, `insert into school_events (tenant_id, title, kind, starts_at) values ('${T.A}', 'PTA meeting', 'pta', '2026-05-10T15:00:00Z')`);
  await db.exec(`insert into calendar_feeds (user_id, tenant_id, token_hash) values ('${U.teacherA}', '${T.A}', 'hash-for-test')`);
  await expectError("calendar links are server-only", U.teacherA, "select * from calendar_feeds", /permission denied/);
  const dc = await q(`select count(*)::int n from data_changes where table_name = 'calendar_feeds'`);
  check("…and stay out of the change history", dc[0].n === 0, dc[0]);

  // Later tests count classes and timetable rows.
  await db.exec(`delete from calendar_feeds; delete from room_bookings; delete from timetable_entries where period_id = '${P1}'; delete from teacher_unavailability;
    delete from timetable_periods where id = '${P1}'; delete from class_groups where id = '${E1}'; delete from school_events where kind = 'pta';`);
}
