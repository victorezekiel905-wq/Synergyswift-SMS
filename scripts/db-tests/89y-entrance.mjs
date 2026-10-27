// Phase 14e: entrance exam automation — intakes, sittings with seats, automatic assignment, the staff checks, privacy.
export default async function ({ db, q, expectRows, expectError, expectOk, check, U, T }) {
  const EXAM = "f9000000-0000-0000-0000-000000000001";
  const P1 = "f9000000-0000-0000-0000-0000000000a1", P2 = "f9000000-0000-0000-0000-0000000000a2", P3 = "f9000000-0000-0000-0000-0000000000a3";
  const S1 = "f9000000-0000-0000-0000-0000000000b1", S2 = "f9000000-0000-0000-0000-0000000000b2", S3 = "f9000000-0000-0000-0000-0000000000b3", S4 = "f9000000-0000-0000-0000-0000000000b4";
  const soon = "now() + interval '2 days'", later = "now() + interval '2 days 2 hours'";
  let n = 0;
  const apply = async (level, extra = "") => {
    const no = `ENT-${++n}`;
    const [r] = await q(`insert into applications (tenant_id, application_no, first_name, last_name, applying_for, guardian_name, guardian_phone${extra ? ", " + extra.split("=")[0] : ""})
      values ('${T.A}', '${no}', 'Kid${n}', 'Test', '${level}', 'Parent ${n}', '0800000${String(n).padStart(4, "0")}'${extra ? ", " + extra.split("=")[1] : ""}) returning id`);
    return r.id;
  };
  const attempt = async (app) => (await q(`select id, sitting_id, opens_at, closes_at, status from entrance_attempts where application_id = '${app}'`))[0];

  await q(`insert into exams (id, tenant_id, created_by, title, duration_minutes) values ('${EXAM}', '${T.A}', '${U.adminA}', 'JSS1 entrance', 45)`);

  console.log("\nEntrance automation: intakes and sittings");
  await expectOk("the admissions team sets up an intake", U.adminA,
    `insert into entrance_plans (id, tenant_id, name, level, exam_id, assign_on, where_mode) values ('${P1}', '${T.A}', 'JSS1 2027', 'JSS9', '${EXAM}', 'fee_paid', 'centre')`);
  await expectError("weights must add up to 100", U.adminA,
    `insert into entrance_plans (tenant_id, name, level, test_weight, interview_weight, report_weight) values ('${T.A}', 'Bad', 'JSS8', 50, 30, 30)`, /entrance_plans_weights/);
  await expectError("one plan per class and intake", U.adminA,
    `insert into entrance_plans (tenant_id, name, level) values ('${T.A}', 'Again', 'jss9')`, /entrance_plans_intake|duplicate/);
  await expectOk("…and a centre sitting with one seat", U.adminA,
    `insert into entrance_sittings (id, tenant_id, plan_id, kind, centre, starts_at, ends_at, seats) values ('${S1}', '${T.A}', '${P1}', 'centre', 'Main hall', ${soon}, ${later}, 1)`);
  await expectError("a centre sitting needs a centre name", U.adminA,
    `insert into entrance_sittings (tenant_id, plan_id, kind, starts_at, ends_at) values ('${T.A}', '${P1}', 'centre', ${soon}, ${later})`, /entrance_sittings_centre/);
  await expectRows("teachers can't see entrance plans", U.teacherA, `select count(*) n from entrance_plans`, 0);
  await expectRows("another school can't see them", U.adminB, `select count(*) n from entrance_plans`, 0);
  await expectError("another school can't add a sitting to them", U.adminB,
    `insert into entrance_sittings (tenant_id, plan_id, kind, centre, starts_at, ends_at) values ('${T.B}', '${P1}', 'centre', 'X', ${soon}, ${later})`, /row-level security/);

  console.log("\nEntrance automation: the test is assigned and seated automatically");
  const a1 = await apply("JSS9");
  check("no test before the form fee is paid", !(await attempt(a1)), null);
  await q(`update applications set fee_paid = true where id = '${a1}'`);
  const t1 = await attempt(a1);
  check("paying the fee assigns the test", Boolean(t1), t1);
  check("…in the centre sitting", t1?.sitting_id === S1, t1);
  const app1 = (await q(`select status, entrance_plan_id from applications where id = '${a1}'`))[0];
  check("…and the application moves to the test stage in its intake", app1.status === "assessment" && app1.entrance_plan_id === P1, app1);
  const a2 = await apply("JSS9", "fee_paid=true");
  const t2 = await attempt(a2);
  check("a full sitting is never overbooked: the next candidate waits for a seat", t2 && t2.sitting_id === null, t2);
  const full = await q(`select public.entrance_book_sitting('${t2.id}', '${S1}') ok`);
  check("booking a full sitting is refused", full[0].ok === false, full);
  await q(`insert into entrance_sittings (id, tenant_id, plan_id, kind, centre, starts_at, ends_at, seats) values ('${S2}', '${T.A}', '${P1}', 'centre', 'Annex', ${soon}, ${later}, 10)`);
  await expectRows("adding a sitting seats the waiting candidate", U.adminA, `select public.entrance_staff_seat_waiting('${P1}') as n`, 1);
  check("…in the new sitting", (await attempt(a2))?.sitting_id === S2, await attempt(a2));
  await expectError("another school's staff can't seat tests here", U.adminB, `select public.entrance_staff_seat_waiting('${P1}')`, /not allowed/);
  await expectError("nor assign them", U.adminB, `select public.entrance_staff_assign('${a1}')`, /not allowed/);
  await expectError("teachers can't assign tests", U.teacherA, `select public.entrance_staff_assign('${a1}')`, /not allowed/);
  await expectError("the raw functions are not open to signed-in users", U.adminA, `select public.entrance_assign('${a1}')`, /permission denied/);

  console.log("\nEntrance automation: online windows, assigning on arrival, families choosing");
  await q(`insert into entrance_plans (id, tenant_id, name, level, exam_id, assign_on, where_mode) values ('${P2}', '${T.A}', 'JSS8 online', 'JSS8', '${EXAM}', 'submitted', 'online')`);
  await q(`insert into entrance_sittings (id, tenant_id, plan_id, kind, starts_at, ends_at) values ('${S3}', '${T.A}', '${P2}', 'online', ${soon}, ${later})`);
  const a3 = await apply("JSS8");
  const t3 = await attempt(a3);
  check("an application that arrives gets its online test at once", t3?.sitting_id === S3, t3);
  check("…open only in the window", t3?.opens_at && t3?.closes_at, t3);
  await q(`insert into entrance_plans (id, tenant_id, name, level, exam_id, assign_on, where_mode) values ('${P3}', '${T.A}', 'SS9 choice', 'SS9', '${EXAM}', 'submitted', 'choice')`);
  await q(`insert into entrance_sittings (id, tenant_id, plan_id, kind, centre, starts_at, ends_at, seats) values ('${S4}', '${T.A}', '${P3}', 'centre', 'Lekki campus', ${soon}, ${later}, 5)`);
  const a4 = await apply("SS9");
  const t4 = await attempt(a4);
  check("when families choose, the test waits for their choice", t4 && t4.sitting_id === null, t4);
  await q(`update entrance_attempts set notified_at = now() where id = '${t4.id}'`);
  const booked = await q(`select public.entrance_book_sitting('${t4.id}', '${S4}') ok`);
  const t4b = (await q(`select sitting_id, notified_at from entrance_attempts where id = '${t4.id}'`))[0];
  check("the family books a sitting and is told the details again", booked[0].ok === true && t4b.sitting_id === S4 && t4b.notified_at === null, t4b);
  const a5 = await apply("JSS7", "fee_paid=true");
  check("classes without an entrance plan are left alone", !(await attempt(a5)), null);
  await q(`update applications set status = 'offered' where id = '${a3}'`);
  const again = await q(`select public.entrance_assign('${a3}') id`);
  check("an application past the test stage is not given another", again[0].id === null, again);

  console.log("\nEntrance automation: privacy");
  await expectError("nobody reads the PIN and results-checker log", U.adminA, `select * from entrance_lookups`, /permission denied/);
  await expectError("camera flags are written only by the server", U.adminA,
    `insert into entrance_events (tenant_id, attempt_id, kind) values ('${T.A}', '${t1.id}', 'no_face')`, /permission denied/);
  await q(`insert into entrance_events (tenant_id, attempt_id, kind) values ('${T.A}', '${t1.id}', 'no_face')`);
  await expectRows("the admissions team sees them", U.adminA, `select count(*) n from entrance_events where attempt_id = '${t1.id}'`, 1);
  await expectRows("teachers don't", U.teacherA, `select count(*) n from entrance_events`, 0);
  await q(`update entrance_attempts set pin_hash = 'abc' where id = '${t1.id}'`);
  let dup = null;
  try { await q(`update entrance_attempts set pin_hash = 'abc' where id = '${t2.id}'`); } catch (e) { dup = e.message; }
  check("two tests can never share a PIN", /entrance_attempts_pin|duplicate/.test(dup ?? ""), dup);

  // Leave the shared fixture as it was.
  await db.exec(`delete from entrance_attempts where tenant_id = '${T.A}'; delete from applications where application_no like 'ENT-%';
    delete from entrance_plans where tenant_id = '${T.A}'; delete from exams where id = '${EXAM}';`);
}
