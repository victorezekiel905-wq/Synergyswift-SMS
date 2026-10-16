// Pastoral care: counselling kept to counsellors, safeguarding with a fixed chronology, incidents and detentions, medication log, wellbeing check-ins.
export default async function ({ db, q, expectRows, expectError, expectOk, check, U, T }) {
  const COUNS = "a0000000-0000-0000-0000-0000000000c1";   // counsellor, created in 82-core-security
  const KID = "a8000000-0000-0000-0000-000000000001", CG = "a2000000-0000-0000-0000-000000000000";
  const ID = n => `ea000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
  const CASE = ID(1), SES = ID(2), CON = ID(3), INC = ID(4), DET = ID(5), SESS = ID(6), PLAN = ID(7), DOSE = ID(8), CHK = ID(9), ANON = ID(10);
  const ft = await q(`select form_teacher_id from class_groups where id = '${CG}'`);
  await db.exec(`update class_groups set form_teacher_id = '${U.teacherA}' where id = '${CG}'`);

  console.log("\nCounselling");
  await expectOk("a teacher refers a student", U.teacherA, `insert into pastoral_referrals (tenant_id, student_id, reason, referred_by) values ('${T.A}', '${KID}', 'Withdrawn in class for two weeks', '${U.teacherA}')`);
  await expectRows("…sees their own referral", U.teacherA, "select count(*) n from pastoral_referrals", 1);
  await expectRows("…which other teachers do not", U.teacherA2, "select count(*) n from pastoral_referrals", 0);
  await expectRows("counsellors see referrals", COUNS, "select count(*) n from pastoral_referrals", 1);
  await expectError("teachers cannot open counselling cases", U.teacherA, `insert into counselling_cases (tenant_id, student_id) values ('${T.A}', '${KID}')`, /row-level security/);
  await expectOk("a counsellor opens a case", COUNS, `insert into counselling_cases (id, tenant_id, student_id, counsellor_id) values ('${CASE}', '${T.A}', '${KID}', '${COUNS}')`);
  await expectOk("…and records a session", COUNS, `insert into counselling_sessions (id, tenant_id, case_id, notes) values ('${SES}', '${T.A}', '${CASE}', 'Talked about home')`);
  await expectRows("the head does not see an unshared case", U.adminA, "select count(*) n from counselling_cases", 0);
  await expectRows("…or its notes", U.adminA, "select count(*) n from counselling_sessions", 0);
  await expectRows("nor do teachers or parents", U.parentA, "select count(*) n from counselling_cases", 0);
  await expectOk("the counsellor shares it with the safeguarding team", COUNS, `update counselling_cases set shared_with_dsl = true where id = '${CASE}'`);
  await expectRows("now the head can read it", U.adminA, "select count(*) n from counselling_sessions", 1);
  await expectRows("teachers still cannot", U.teacherA, "select count(*) n from counselling_sessions", 0);
  await expectOk("notes can be corrected on the day", COUNS, `update counselling_sessions set notes = 'Talked about home and friends' where id = '${SES}'`);
  await db.exec(`update counselling_sessions set created_at = now() - interval '2 days' where id = '${SES}'`);
  await expectError("…but not later", COUNS, `update counselling_sessions set notes = 'Rewritten' where id = '${SES}'`, /on the day/);
  await expectError("nobody writes the access log directly", U.adminA, `insert into sensitive_access_log (tenant_id, record_kind, record_id) values ('${T.A}', 'x', '${CASE}')`, /row-level security/);
  const ch = await q(`select count(*) n from data_changes where table_name in ('counselling_cases','counselling_sessions','pastoral_referrals')`);
  check("counselling records stay out of the change history", Number(ch[0].n) === 0, ch[0]);

  console.log("\nSafeguarding");
  await expectOk("a teacher reports a concern", U.teacherA, `insert into safeguarding_concerns (id, tenant_id, student_id, category, severity, description, status, assigned_to) values ('${CON}', '${T.A}', '${KID}', 'neglect', 'high', 'Arrives hungry most days and wore the same clothes all week', 'closed', '${U.teacherA}')`);
  const c0 = await q(`select status, reported_by, assigned_to from safeguarding_concerns where id = '${CON}'`);
  check("it arrives as new, from the reporter, unassigned", c0[0].status === "new" && c0[0].reported_by === U.teacherA && c0[0].assigned_to === null, c0[0]);
  await expectRows("the reporter can see what they reported", U.teacherA, "select count(*) n from safeguarding_concerns", 1);
  await expectRows("other teachers cannot", U.teacherA2, "select count(*) n from safeguarding_concerns", 0);
  await expectRows("parents cannot", U.parentA, "select count(*) n from safeguarding_concerns", 0);
  await expectRows("the safeguarding team can", COUNS, "select count(*) n from safeguarding_concerns", 1);
  await expectRows("the reporter cannot manage it", U.teacherA, `with u as (update safeguarding_concerns set status = 'closed' returning 1) select count(*) n from u`, 0);
  await expectError("the original report is never rewritten", COUNS, `update safeguarding_concerns set description = 'Nothing to see here really' where id = '${CON}'`, /kept as written/);
  await expectOk("the team acknowledges it", COUNS, `update safeguarding_concerns set status = 'acknowledged' where id = '${CON}'`);
  await expectOk("…assigns it", COUNS, `update safeguarding_concerns set assigned_to = '${COUNS}' where id = '${CON}'`);
  await expectOk("…and adds a note", COUNS, `insert into safeguarding_actions (tenant_id, concern_id, kind, detail, by_user) values ('${T.A}', '${CON}', 'contacted_parent', 'Spoke to mother', '${U.adminA}')`);
  const a0 = await q(`select kind, by_user from safeguarding_actions where concern_id = '${CON}' order by at`);
  check("each step is in the chronology, in the right name", a0.length === 3 && a0.some(x => x.kind === "status") && a0.some(x => x.kind === "assigned") && a0.find(x => x.kind === "contacted_parent")?.by_user === COUNS, a0);
  await expectRows("the reporter does not see the chronology", U.teacherA, "select count(*) n from safeguarding_actions", 0);
  await expectRows("the chronology cannot be edited", COUNS, `with u as (update safeguarding_actions set detail = 'x' where concern_id = '${CON}' returning 1) select count(*) n from u`, 0);
  await expectRows("…or deleted", U.adminA, `with u as (delete from safeguarding_actions where concern_id = '${CON}' returning 1) select count(*) n from u`, 0);
  await expectError("a concern is closed with an outcome", COUNS, `update safeguarding_concerns set status = 'closed' where id = '${CON}'`, /outcome/);
  await expectOk("…like this", COUNS, `update safeguarding_concerns set status = 'closed', outcome = 'Family supported with breakfast club' where id = '${CON}'`);
  const c1 = await q(`select closed_at, acknowledged_at from safeguarding_concerns where id = '${CON}'`);
  check("…time-stamped", c1[0].closed_at !== null && c1[0].acknowledged_at !== null, c1[0]);

  console.log("\nIncidents and detentions");
  await expectOk("a teacher logs an incident", U.teacherA, `insert into behaviour_incidents (id, tenant_id, description, reported_by) values ('${INC}', '${T.A}', 'Fight at break', '${U.teacherA}')`);
  await expectOk("…with the students involved", U.teacherA, `insert into behaviour_incident_students (incident_id, tenant_id, student_id, role) values ('${INC}', '${T.A}', '${KID}', 'responsible')`);
  await expectRows("another teacher cannot change it", U.teacherA2, `with u as (update behaviour_incidents set status = 'resolved' returning 1) select count(*) n from u`, 0);
  await expectOk("an admin can", U.adminA, `update behaviour_incidents set status = 'resolved', outcome = 'Restorative meeting' where id = '${INC}'`);
  await expectError("incidents are logged in your own name", U.teacherA, `insert into behaviour_incidents (tenant_id, description, reported_by) values ('${T.A}', 'Spoof', '${U.teacherA2}')`, /row-level security/);
  await expectOk("a detention session", U.teacherA, `insert into detention_sessions (id, tenant_id, starts_at) values ('${SESS}', '${T.A}', now() + interval '1 day')`);
  await expectOk("…and a detention in it", U.teacherA, `insert into detentions (id, tenant_id, student_id, session_id, reason) values ('${DET}', '${T.A}', '${KID}', '${SESS}', 'Fight at break')`);
  await expectRows("the parent sees the detention", U.parentA, "select count(*) n from detentions", 1);
  await expectRows("…and its session", U.parentA, "select count(*) n from detention_sessions", 1);
  await expectRows("the student sees it too", U.studentA, "select count(*) n from detentions", 1);
  await expectRows("…not a row", U.parentA, `with u as (update detentions set status = 'served' returning 1) select count(*) n from u`, 0);

  console.log("\nMedication and immunisations");
  await expectOk("the nurse adds a medication plan", U.adminA, `insert into medication_plans (id, tenant_id, student_id, medicine, dose, times, parent_consent) values ('${PLAN}', '${T.A}', '${KID}', 'Inhaler', '2 puffs', '{08:00}', true)`);
  await expectOk("…and logs a dose", U.adminA, `insert into medication_doses (id, tenant_id, student_id, plan_id, medicine, dose, given_by) values ('${DOSE}', '${T.A}', '${KID}', '${PLAN}', 'Inhaler', '2 puffs', '${U.teacherA}')`);
  const d0 = await q(`select given_by from medication_doses where id = '${DOSE}'`);
  check("…in their own name", d0[0].given_by === U.adminA, d0[0]);
  await expectError("the log is never changed", U.adminA, `update medication_doses set dose = '10 puffs' where id = '${DOSE}'`, /cannot be changed/);
  await expectRows("parents see their child's doses", U.parentA, "select count(*) n from medication_doses", 1);
  await expectRows("teachers do not", U.teacherA, "select count(*) n from medication_doses", 0);
  await expectError("teachers cannot add plans", U.teacherA, `insert into medication_plans (tenant_id, student_id, medicine, dose) values ('${T.A}', '${KID}', 'x', 'y')`, /row-level security/);
  await expectOk("immunisations are recorded", U.adminA, `insert into immunisations (tenant_id, student_id, vaccine, next_due_on) values ('${T.A}', '${KID}', 'HPV', current_date + 30)`);
  await expectRows("…and parents see them", U.parentA, "select count(*) n from immunisations", 1);

  console.log("\nWellbeing check-ins");
  await db.exec(`insert into wellbeing_checkins (id, tenant_id, student_id, class_group_id, mood, wants_to_talk) values ('${CHK}', '${T.A}', '${KID}', '${CG}', 1, true), ('${ANON}', '${T.A}', null, '${CG}', 4, false)`);
  let refused = false;
  try { await q(`insert into wellbeing_checkins (tenant_id, student_id, class_group_id, mood, wants_to_talk) values ('${T.A}', null, '${CG}', 2, true)`); } catch { refused = true; }
  check("an anonymous check-in cannot ask to talk (nobody could find them)", refused, null);
  await expectRows("the student sees their own", U.studentA, "select count(*) n from wellbeing_checkins", 1);
  await expectRows("the form teacher sees named ones in their class", U.teacherA, "select count(*) n from wellbeing_checkins", 1);
  await expectRows("other teachers do not", U.teacherA2, "select count(*) n from wellbeing_checkins", 0);
  await expectRows("counsellors see all, anonymous included", COUNS, "select count(*) n from wellbeing_checkins", 2);
  await expectRows("parents do not", U.parentA, "select count(*) n from wellbeing_checkins", 0);
  await expectError("students check in through the app only", U.studentA, `insert into wellbeing_checkins (tenant_id, student_id, mood) values ('${T.A}', '${KID}', 5)`, /row-level security/);
  await expectOk("the form teacher follows up", U.teacherA, `update wellbeing_checkins set followed_up_at = now(), follow_up_note = 'Talked at break' where id = '${CHK}'`);
  const w0 = await q(`select followed_up_by from wellbeing_checkins where id = '${CHK}'`);
  check("…recorded as them", w0[0].followed_up_by === U.teacherA, w0[0]);
  await expectError("the check-in itself is never changed", U.teacherA, `update wellbeing_checkins set mood = 5 where id = '${CHK}'`, /as the student wrote/);

  await db.exec(`delete from wellbeing_checkins where tenant_id = '${T.A}'; delete from immunisations where tenant_id = '${T.A}'; delete from medication_plans where id = '${PLAN}';
    delete from medication_doses where id = '${DOSE}'; delete from detentions where id = '${DET}'; delete from detention_sessions where id = '${SESS}'; delete from behaviour_incidents where id = '${INC}';
    delete from safeguarding_concerns where id = '${CON}'; delete from counselling_cases where id = '${CASE}'; delete from pastoral_referrals where tenant_id = '${T.A}'; delete from sensitive_access_log;
    update class_groups set form_teacher_id = ${ft[0]?.form_teacher_id ? `'${ft[0].form_teacher_id}'` : "null"} where id = '${CG}';`);
}
