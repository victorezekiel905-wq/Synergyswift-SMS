// Clubs and teams run by their leads, competitions with results families can see, and trip rosters kept by the trip staff.
export default async function ({ db, q, expectRows, expectError, expectOk, check, U, T }) {
  const KID = "a8000000-0000-0000-0000-000000000001", KID2 = "a8000000-0000-0000-0000-000000000002";
  const ID = n => `ee000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
  const CHESS = ID(1), SES = ID(2), COMP = ID(3), TRIP = ID(4);

  console.log("\nClubs and teams");
  await expectOk("an admin starts a chess club led by a teacher", U.adminA, `insert into cc_groups (id, tenant_id, name, kind, lead_id, joining) values ('${CHESS}', '${T.A}', 'Chess club', 'club', '${U.teacherA}', 'approval')`);
  await expectError("other teachers cannot start groups", U.teacherA2, `insert into cc_groups (tenant_id, name) values ('${T.A}', 'Drama')`, /row-level security/);
  await expectOk("the lead changes when it meets", U.teacherA, `update cc_groups set meets = 'Wednesdays 3-4pm' where id = '${CHESS}'`);
  await expectError("…but not who leads it", U.teacherA, `update cc_groups set assistant_ids = array['${U.teacherA2}']::uuid[] where id = '${CHESS}'`, /only admins/);
  await expectOk("another teacher's change does nothing", U.teacherA2, `update cc_groups set meets = 'Never' where id = '${CHESS}'`);
  const g0 = await q(`select meets from cc_groups where id = '${CHESS}'`);
  check("…so the lead's time stands", g0[0].meets === "Wednesdays 3-4pm", g0[0]);
  await expectOk("the lead adds two members", U.teacherA, `insert into cc_members (group_id, tenant_id, student_id, status) values ('${CHESS}', '${T.A}', '${KID}', 'active'), ('${CHESS}', '${T.A}', '${KID2}', 'active')`);
  await expectError("other teachers cannot add members", U.teacherA2, `insert into cc_members (group_id, tenant_id, student_id) values ('${CHESS}', '${T.A}', '${KID}') on conflict (group_id, student_id) do nothing`, /row-level security/);
  await expectOk("…and their role changes do nothing", U.teacherA2, `update cc_members set role = 'captain' where group_id = '${CHESS}'`);
  const r0 = await q(`select count(*) n from cc_members where role = 'captain'`);
  check("…so nobody is made captain", Number(r0[0].n) === 0, r0[0]);
  await expectError("students cannot add themselves", U.studentA, `insert into cc_members (group_id, tenant_id, student_id, status) values ('${CHESS}', '${T.A}', '${KID}', 'active') on conflict (group_id, student_id) do update set role = 'captain'`, /row-level security/);
  await expectRows("a parent sees only their own child's membership", U.parentA, "select count(*) n from cc_members", 1);
  await expectRows("a student sees only their own", U.studentA, "select count(*) n from cc_members", 1);
  await expectRows("another school sees no groups", U.adminB, "select count(*) n from cc_groups", 0);
  await expectOk("the lead records a session", U.teacherA, `insert into cc_sessions (id, tenant_id, group_id, held_on) values ('${SES}', '${T.A}', '${CHESS}', '2026-10-14')`);
  await expectOk("…and takes attendance", U.teacherA, `insert into cc_attendance (session_id, tenant_id, student_id, status) values ('${SES}', '${T.A}', '${KID}', 'present'), ('${SES}', '${T.A}', '${KID2}', 'absent')`);
  await expectError("other teachers cannot mark it", U.teacherA2, `insert into cc_attendance (session_id, tenant_id, student_id, status) values ('${SES}', '${T.A}', '${KID}', 'late') on conflict (session_id, student_id) do update set status = 'late'`, /row-level security/);
  await expectRows("a parent sees their child's attendance only", U.parentA, "select count(*) n from cc_attendance", 1);

  console.log("\nCompetitions");
  await expectOk("a teacher records an inter-school quiz", U.teacherA2, `insert into competitions (id, tenant_id, title, kind, level, held_on) values ('${COMP}', '${T.A}', 'State quiz', 'quiz', 'state', '2026-10-10')`);
  await expectError("students cannot", U.studentA, `insert into competitions (tenant_id, title, held_on) values ('${T.A}', 'My quiz', '2026-10-10')`, /row-level security/);
  await expectOk("…and both entries", U.teacherA2, `insert into competition_entries (tenant_id, competition_id, student_id, position) values ('${T.A}', '${COMP}', '${KID}', 2), ('${T.A}', '${COMP}', '${KID2}', 5)`);
  await expectError("a student is entered once per event", U.teacherA2, `insert into competition_entries (tenant_id, competition_id, student_id) values ('${T.A}', '${COMP}', '${KID}')`, /duplicate|unique/);
  await expectRows("a parent sees their own child's result only", U.parentA, "select count(*) n from competition_entries", 1);

  console.log("\nTrips");
  await expectOk("an admin sets up a trip with a teacher going", U.adminA, `insert into school_events (id, tenant_id, title, kind, starts_at, staff_ids) values ('${TRIP}', '${T.A}', 'Museum trip', 'trip', '2026-10-20 08:00+01', array['${U.teacherA}']::uuid[])`);
  await expectOk("the trip teacher puts a child on the roster", U.teacherA, `insert into trip_roster (event_id, tenant_id, student_id) values ('${TRIP}', '${T.A}', '${KID}')`);
  await expectError("staff not on the trip cannot", U.teacherA2, `insert into trip_roster (event_id, tenant_id, student_id) values ('${TRIP}', '${T.A}', '${KID2}')`, /row-level security/);
  await expectOk("the coach leaves", U.teacherA, `update trip_roster set status = 'departed' where event_id = '${TRIP}'`);
  const t0 = await q(`select departed_at is not null d, returned_at is null r from trip_roster where event_id = '${TRIP}'`);
  check("…and the time is stamped", t0[0].d && t0[0].r, t0[0]);
  await expectRows("the parent can see where their child is", U.parentA, `select count(*) n from trip_roster where status = 'departed'`, 1);
  await expectError("parents cannot tick their child back", U.parentA, `insert into trip_roster (event_id, tenant_id, student_id, status) values ('${TRIP}', '${T.A}', '${KID}', 'returned') on conflict (event_id, student_id) do update set status = 'returned'`, /row-level security/);

  await db.exec(`delete from school_events where id = '${TRIP}'; delete from competitions where id = '${COMP}'; delete from cc_groups where id = '${CHESS}';`);
}
