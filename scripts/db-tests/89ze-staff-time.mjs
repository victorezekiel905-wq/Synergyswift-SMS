// Phase 14i-1: staff time — shifts with clash checks, late / early / missed-clock requests decided by the line manager or HR, and settings.
export default async function ({ db, q, expectRows, expectError, expectOk, check, U, T }) {
  const T1 = "ad000000-0000-0000-0000-000000000001";          // Teacher A's staff record (10-finance), Teacher A2's line manager here
  const ID = n => `e9000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
  const T2 = ID(1), DAY = ID(2), NIGHT = ID(3), AFT = ID(4), WKND = ID(5), R1 = ID(6), R2 = ID(7), R3 = ID(8), A1 = ID(9);
  const server = async (name, sql, re) => {
    try { await q(sql); check(name, !re, re ? "expected an error" : null); }
    catch (e) { check(name, Boolean(re && re.test(e.message)), e.message); }
  };
  await db.exec(`insert into staff (id, tenant_id, user_id, staff_no, full_name, line_manager_id) values ('${T2}', '${T.A}', '${U.teacherA2}', 'T-2c', 'Teacher A2', '${T1}')`);

  console.log("\nStaff time: shifts");
  await expectOk("HR sets up the school day", U.adminA, `insert into staff_shifts (id, tenant_id, name, starts_at, ends_at, days) values ('${DAY}', '${T.A}', 'School day', '07:30', '16:00', '{1,2,3,4,5}')`);
  await expectOk("…and a night security shift that runs past midnight", U.adminA, `insert into staff_shifts (id, tenant_id, name, starts_at, ends_at, days, works_holidays) values ('${NIGHT}', '${T.A}', 'Night security', '19:00', '07:00', '{1,2,3,4,5,6,7}', true)`);
  await expectOk("…an afternoon shift and a weekend shift", U.adminA, `insert into staff_shifts (id, tenant_id, name, starts_at, ends_at, days) values ('${AFT}', '${T.A}', 'Afternoon', '12:00', '18:00', '{1,2,3,4,5}'), ('${WKND}', '${T.A}', 'Weekend', '08:00', '14:00', '{6,7}')`);
  await expectError("a teacher cannot make shifts", U.teacherA, `insert into staff_shifts (tenant_id, name, starts_at, ends_at) values ('${T.A}', 'Mine', '09:00', '10:00')`, /row-level security/);
  await expectError("a shift cannot start and end at the same time", U.adminA, `insert into staff_shifts (tenant_id, name, starts_at, ends_at) values ('${T.A}', 'Zero', '09:00', '09:00')`, /check/);
  await expectError("days are weekdays 1 to 7", U.adminA, `insert into staff_shifts (tenant_id, name, starts_at, ends_at, days) values ('${T.A}', 'Odd', '09:00', '10:00', '{0,8}')`, /check/);
  await expectOk("HR gives Teacher A2 the school day", U.adminA, `insert into staff_shift_assignments (id, tenant_id, staff_id, shift_id, starts_on) values ('${A1}', '${T.A}', '${T2}', '${DAY}', '2026-11-02')`);
  await expectOk("…and night security (no overlap)", U.adminA, `insert into staff_shift_assignments (tenant_id, staff_id, shift_id, starts_on) values ('${T.A}', '${T2}', '${NIGHT}', '2026-11-02')`);
  await expectError("an afternoon shift overlapping the school day is refused", U.adminA, `insert into staff_shift_assignments (tenant_id, staff_id, shift_id, starts_on) values ('${T.A}', '${T2}', '${AFT}', '2026-11-10')`, /clashes with the School day shift/);
  await expectOk("weekend shifts on other days are fine", U.adminA, `insert into staff_shift_assignments (tenant_id, staff_id, shift_id, starts_on) values ('${T.A}', '${T2}', '${WKND}', '2026-11-02')`);
  await expectOk("the school day ends, then the afternoon shift can start", U.adminA, `update staff_shift_assignments set ends_on = '2026-11-30' where id = '${A1}'`);
  await expectOk("…from December", U.adminA, `insert into staff_shift_assignments (tenant_id, staff_id, shift_id, starts_on) values ('${T.A}', '${T2}', '${AFT}', '2026-12-01')`);
  await expectError("a teacher cannot assign shifts", U.teacherA, `insert into staff_shift_assignments (tenant_id, staff_id, shift_id) values ('${T.A}', '${T2}', '${DAY}')`, /row-level security/);
  await expectRows("staff see the rota", U.teacherA2, `select count(*) n from staff_shift_assignments where staff_id = '${T2}'`, 4);
  await expectRows("parents do not", U.parentA, `select (select count(*) from staff_shifts) + (select count(*) from staff_shift_assignments) n`, 0);
  await expectRows("another school sees none", U.adminB, `select (select count(*) from staff_shifts) + (select count(*) from staff_shift_assignments) n`, 0);
  const ov = await q(`select public.time_ranges_overlap('07:30','16:00','12:00','18:00') a, public.time_ranges_overlap('07:30','16:00','19:00','07:00') b, public.time_ranges_overlap('19:00','07:00','06:00','08:00') c`);
  check("overlap rules: day vs afternoon yes, day vs night no, night vs early morning yes", ov[0].a === true && ov[0].b === false && ov[0].c === true, ov);

  console.log("\nStaff time: requests");
  await expectOk("Teacher A2 says they will be late", U.teacherA2, `insert into staff_time_requests (id, tenant_id, staff_id, kind, on_date, at_time, reason, created_by) values ('${R1}', '${T.A}', '${T2}', 'late_arrival', '2026-11-04', '09:00', 'Hospital appointment', '${U.teacherA2}')`);
  await expectError("…but not for someone else", U.teacherA2, `insert into staff_time_requests (tenant_id, staff_id, kind, on_date, reason, created_by) values ('${T.A}', '${T1}', 'late_arrival', '2026-11-04', 'Traffic', '${U.teacherA2}')`, /row-level security/);
  await expectError("…and a request starts as pending", U.teacherA2, `insert into staff_time_requests (tenant_id, staff_id, kind, on_date, reason, status, created_by) values ('${T.A}', '${T2}', 'late_arrival', '2026-11-05', 'Traffic', 'approved', '${U.teacherA2}')`, /row-level security|pending/);
  await expectError("a missed clock needs the time and whether it was in or out", U.teacherA2, `insert into staff_time_requests (tenant_id, staff_id, kind, on_date, reason, created_by) values ('${T.A}', '${T2}', 'missed_clock', '2026-11-03', 'Forgot', '${U.teacherA2}')`, /check/);
  await expectError("nobody approves their own request", U.teacherA2, `update staff_time_requests set status = 'approved' where id = '${R1}'`, /line manager or HR/);
  await expectRows("the line manager sees it", U.teacherA, `select count(*) n from staff_time_requests where id = '${R1}'`, 1);
  await expectRows("a colleague who is not the manager does not", U.bursarA, `select count(*) n from staff_time_requests`, 0);
  await expectRows("nor do parents or another school", U.parentA, `select count(*) n from staff_time_requests`, 0);
  await expectRows("…(another school)", U.adminB, `select count(*) n from staff_time_requests`, 0);
  await expectError("the request cannot be rewritten", U.teacherA2, `update staff_time_requests set reason = 'Something else' where id = '${R1}'`, /cannot be changed/);
  await expectOk("the line manager approves it", U.teacherA, `update staff_time_requests set status = 'approved', decision_note = 'Fine' where id = '${R1}'`);
  const d = await q(`select decided_by, decided_at is not null decided from staff_time_requests where id = '${R1}'`);
  check("who decided and when is recorded", d[0]?.decided_by === U.teacherA && d[0]?.decided, d);
  await expectError("a decision is final", U.adminA, `update staff_time_requests set status = 'declined' where id = '${R1}'`, /already been decided/);
  await expectOk("Teacher A2 forgot to sign in on Tuesday at 07:25", U.teacherA2, `insert into staff_time_requests (id, tenant_id, staff_id, kind, on_date, at_time, direction, reason, created_by) values ('${R2}', '${T.A}', '${T2}', 'missed_clock', '2026-11-03', '07:25', 'in', 'Phone was flat', '${U.teacherA2}')`);
  await expectOk("HR approves the missed clock", U.adminA, `update staff_time_requests set status = 'approved' where id = '${R2}'`);
  const ev = await q(`select g.direction, g.method, g.at = timestamptz '2026-11-03 06:25:00+00' at_utc, r.gate_event_id = g.id linked from staff_time_requests r join gate_events g on g.id = r.gate_event_id where r.id = '${R2}'`);
  check("…which adds the sign-in at 07:25 school time, linked to the request", ev.length === 1 && ev[0].direction === "in" && ev[0].method === "manual" && ev[0].at_utc && ev[0].linked, ev);
  await expectOk("a pending request can be cancelled by the person", U.teacherA2, `insert into staff_time_requests (id, tenant_id, staff_id, kind, on_date, at_time, reason, created_by) values ('${R3}', '${T.A}', '${T2}', 'early_departure', '2026-11-06', '14:00', 'Family event', '${U.teacherA2}')`);
  await expectRows("…and is", U.teacherA2, `with u as (update staff_time_requests set status = 'cancelled' where id = '${R3}' returning 1) select count(*) n from u`, 1);

  console.log("\nStaff time: settings");
  await server("lateness rules are checked", `insert into hr_settings (tenant_id, late_deduction_mode) values ('${T.B}', 'sometimes')`, /check/);
  await server("…and clock-in modes", `update tenant_settings set staff_self_clock = 'anywhere' where tenant_id = '${T.A}'`, /check/);
  await server("a school can name its campuses and require the entrance code", `update tenant_settings set campuses = '{Main,Annex}', staff_self_clock = 'qr' where tenant_id = '${T.A}'`);
  await server("sign-ins record the campus and early departures", `insert into gate_events (tenant_id, person_type, staff_id, direction, method, early, campus) values ('${T.A}', 'staff', '${T2}', 'out', 'self', true, 'Annex')`);

  await db.exec(`update tenant_settings set campuses = '{}', staff_self_clock = 'auto' where tenant_id = '${T.A}';
    delete from staff_time_requests where staff_id = '${T2}'; delete from gate_events where staff_id = '${T2}';
    delete from staff_shift_assignments where staff_id = '${T2}'; delete from staff_shifts where tenant_id = '${T.A}'; delete from staff where id = '${T2}';`);
}
