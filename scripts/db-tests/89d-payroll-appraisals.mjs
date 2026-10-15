// Payroll settings, grades and loans; appraisals (self-review, review shown only at discussion, acknowledgement); observation replies; CPD verified by HR.
export default async function ({ db, q, expectRows, expectError, expectOk, check, U, T }) {
  const T1 = "ad000000-0000-0000-0000-000000000001";          // Teacher A's staff record (10-finance)
  const ID = n => `e9000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
  const T2 = ID(1), LOAN = ID(2), RUN = ID(3), CYCLE = ID(4), APR = ID(5), CL = ID(6), OBS = ID(7), CPD = ID(8);
  await db.exec(`insert into staff (id, tenant_id, user_id, staff_no, full_name, line_manager_id) values ('${T2}', '${T.A}', '${U.teacherA2}', 'T-2b', 'Teacher A2', '${T1}')`);

  console.log("\nPayroll settings, grades and loans");
  await expectOk("the bursar sets the statutory rates", U.bursarA, `insert into hr_settings (tenant_id, pension_employee_pct, pension_employer_pct) values ('${T.A}', 8, 10)`);
  await expectRows("staff can read them", U.teacherA, "select count(*) n from hr_settings", 1);
  await expectRows("…but not change them", U.teacherA, `with u as (update hr_settings set nhf_pct = 0 returning 1) select count(*) n from u`, 0);
  await expectError("rates stay within 0–100%", U.bursarA, `update hr_settings set pension_employee_pct = 150 where tenant_id = '${T.A}'`, /check/);
  await expectOk("the bursar adds a pay grade", U.bursarA, `insert into pay_grades (tenant_id, name, basic, allowances) values ('${T.A}', 'Grade 7', 200000, '[{"name":"Housing","amount":100000}]')`);
  await expectRows("teachers do not see pay grades", U.teacherA, "select count(*) n from pay_grades", 0);
  await expectOk("the bursar enters a loan", U.bursarA, `insert into staff_loans (id, tenant_id, staff_id, principal, monthly_deduction, balance, start_period, approved_by) values ('${LOAN}', '${T.A}', '${T1}', 60000, 30000, 1, '2026-10', '${U.adminA}')`);
  const l0 = await q(`select balance, approved_by, created_by from staff_loans where id = '${LOAN}'`);
  check("it starts unapproved at its full amount", Number(l0[0].balance) === 60000 && l0[0].approved_by === null && l0[0].created_by === U.bursarA, l0[0]);
  await expectError("the bursar cannot approve it", U.bursarA, `update staff_loans set approved_by = '${U.bursarA}' where id = '${LOAN}'`, /only the principal/);
  await expectRows("the borrower sees their loan", U.teacherA, "select count(*) n from staff_loans", 1);
  await expectRows("colleagues do not", U.teacherA2, "select count(*) n from staff_loans", 0);
  await expectOk("an admin approves it", U.adminA, `update staff_loans set approved_by = '${U.adminA}' where id = '${LOAN}'`);
  await expectError("an approved loan's balance only moves through payroll", U.bursarA, `update staff_loans set balance = 0 where id = '${LOAN}'`, /through payroll/);
  await expectOk("a payroll run…", U.bursarA, `insert into payroll_runs (id, tenant_id, period, created_by) values ('${RUN}', '${T.A}', '2026-10', '${U.bursarA}')`);
  await expectOk("…with a payslip that repays the loan", U.bursarA, `insert into payslips (run_id, tenant_id, staff_id, basic, gross, total_deductions, net, paye, pension_employee, pension_employer, employer_total, loan_repayments)
    values ('${RUN}', '${T.A}', '${T1}', 200000, 300000, 80000, 220000, 20000, 24000, 30000, 33000, '[{"loan_id":"${LOAN}","amount":30000}]')`);
  await expectOk("is approved by an admin", U.adminA, `update payroll_runs set status = 'approved' where id = '${RUN}'`);
  const l1 = await q(`select balance from staff_loans where id = '${LOAN}'`);
  check("approval alone does not touch the loan", Number(l1[0].balance) === 60000, l1[0]);
  await expectOk("…then marked paid", U.bursarA, `update payroll_runs set status = 'paid' where id = '${RUN}'`);
  const l2 = await q(`select balance, status from staff_loans where id = '${LOAN}'`);
  check("…and the repayment comes off the balance", Number(l2[0].balance) === 30000 && l2[0].status === "active", l2[0]);
  await db.exec(`update payroll_runs set status = 'paid' where id = '${RUN}'`);
  const l3 = await q(`select balance from staff_loans where id = '${LOAN}'`);
  check("…once only", Number(l3[0].balance) === 30000, l3[0]);
  await expectRows("staff see their own payslip with PAYE and pension", U.teacherA, `select count(*) n from payslips where run_id = '${RUN}' and paye = 20000 and pension_employer = 30000`, 1);

  console.log("\nAppraisals");
  await expectOk("HR drafts a cycle", U.adminA, `insert into appraisal_cycles (id, tenant_id, name, starts_on, ends_on, criteria) values ('${CYCLE}', '${T.A}', 'Annual 2026', '2026-01-01', '2026-12-31', '[{"id":"planning","label":"Planning","weight":50},{"id":"teaching","label":"Teaching","weight":50}]')`);
  await expectRows("staff do not see draft cycles", U.teacherA2, "select count(*) n from appraisal_cycles", 0);
  await expectOk("HR opens it", U.adminA, `update appraisal_cycles set status = 'open' where id = '${CYCLE}'`);
  await expectRows("staff see open cycles", U.teacherA2, "select count(*) n from appraisal_cycles", 1);
  await expectError("only HR starts appraisals", U.teacherA, `insert into appraisals (tenant_id, cycle_id, staff_id, reviewer_id) values ('${T.A}', '${CYCLE}', '${T2}', '${U.teacherA}')`, /row-level security/);
  await expectOk("HR adds Teacher A2, reviewed by their manager", U.adminA, `insert into appraisals (id, tenant_id, cycle_id, staff_id, reviewer_id) values ('${APR}', '${T.A}', '${CYCLE}', '${T2}', '${U.teacherA}')`);
  await expectRows("the person sees their appraisal", U.teacherA2, "select count(*) n from appraisals", 1);
  await expectRows("the reviewer does too", U.teacherA, "select count(*) n from appraisals", 1);
  await expectRows("others do not", U.bursarA, "select count(*) n from appraisals", 0);
  await expectOk("the person scores themselves", U.teacherA2, `update appraisals set self_scores = '{"planning":4,"teaching":3}', self_comments = 'Good year' where id = '${APR}'`);
  await expectError("…but cannot set their own goals", U.teacherA2, `update appraisals set goals = '[{"text":"Rest"}]' where id = '${APR}'`, /agreed with your reviewer/);
  await expectOk("…and sends the self-review", U.teacherA2, `update appraisals set status = 'review' where id = '${APR}'`);
  const a0 = await q(`select self_submitted_at from appraisals where id = '${APR}'`);
  check("…which is time-stamped", a0[0].self_submitted_at !== null, a0[0]);
  await expectError("it cannot be changed once sent", U.teacherA2, `update appraisals set self_scores = '{"planning":5}' where id = '${APR}'`, /has been sent/);
  await expectError("the person cannot skip to completed", U.teacherA2, `update appraisals set status = 'completed' where id = '${APR}'`, /cannot move/);
  await expectOk("the reviewer drafts a review", U.teacherA, `insert into appraisal_reviews (appraisal_id, tenant_id, scores, strengths) values ('${APR}', '${T.A}', '{"planning":4,"teaching":4}', 'Well planned lessons')`);
  await expectRows("the person cannot read it yet", U.teacherA2, "select count(*) n from appraisal_reviews", 0);
  await expectRows("other staff cannot either", U.bursarA, "select count(*) n from appraisal_reviews", 0);
  await expectError("the reviewer cannot write the person's part", U.teacherA, `update appraisals set self_comments = 'Edited' where id = '${APR}'`, /belongs to the person/);
  await expectError("a review is finished before it is shared", U.teacherA, `update appraisals set status = 'discussion' where id = '${APR}'`, /finish your review/);
  await expectOk("the reviewer finishes it", U.teacherA, `update appraisal_reviews set submitted_at = now(), overall = 4 where appraisal_id = '${APR}'`);
  await expectOk("…sets goals", U.teacherA, `update appraisals set goals = '[{"text":"Lead a department project","status":"open"}]' where id = '${APR}'`);
  await expectOk("…and shares it", U.teacherA, `update appraisals set status = 'discussion' where id = '${APR}'`);
  await expectRows("now the person reads the review", U.teacherA2, "select count(*) n from appraisal_reviews", 1);
  await expectOk("the person comments and acknowledges", U.teacherA2, `update appraisals set staff_comment = 'Agreed', status = 'completed' where id = '${APR}'`);
  const a1 = await q(`select acknowledged_at, completed_at from appraisals where id = '${APR}'`);
  check("…which completes it", a1[0].acknowledged_at !== null && a1[0].completed_at !== null, a1[0]);
  await expectError("a completed review is final for the reviewer", U.teacherA, `update appraisal_reviews set overall = 1 where appraisal_id = '${APR}'`, /complete/);

  console.log("\nLesson observations and CPD");
  await db.exec(`insert into qa_checklists (id, tenant_id, name) values ('${CL}', '${T.A}', 'Lesson obs');
    insert into qa_observations (id, tenant_id, checklist_id, observer_id, staff_id, total, max_total) values ('${OBS}', '${T.A}', '${CL}', '${U.adminA}', '${T1}', 18, 25);`);
  await expectOk("the teacher acknowledges their observation with a reply", U.teacherA, `select public.acknowledge_observation('${OBS}', 'Thanks, will work on questioning')`);
  const o0 = await q(`select acknowledged_at, teacher_response from qa_observations where id = '${OBS}'`);
  check("…which is recorded", o0[0].acknowledged_at !== null && o0[0].teacher_response === "Thanks, will work on questioning", o0[0]);
  await expectError("nobody answers someone else's observation", U.teacherA2, `select public.acknowledge_observation('${OBS}', 'Mine now')`, /not found/);
  await expectOk("staff log CPD", U.teacherA2, `insert into cpd_activities (id, tenant_id, staff_id, title, starts_on, hours, verified_at, verified_by) values ('${CPD}', '${T.A}', '${T2}', 'Assessment for learning', '2026-03-01', 6, now(), '${U.teacherA2}')`);
  const c0 = await q(`select verified_at, created_by from cpd_activities where id = '${CPD}'`);
  check("…unverified, whatever was sent", c0[0].verified_at === null && c0[0].created_by === U.teacherA2, c0[0]);
  await expectRows("the line manager sees their team's CPD", U.teacherA, `select count(*) n from cpd_activities where staff_id = '${T2}'`, 1);
  await expectRows("other staff do not", U.bursarA, "select count(*) n from cpd_activities", 0);
  await expectError("nobody logs CPD for a colleague", U.teacherA, `insert into cpd_activities (tenant_id, staff_id, title, starts_on, hours) values ('${T.A}', '${T2}', 'Fake', '2026-03-01', 100)`, /row-level security/);
  await expectOk("HR verifies it", U.adminA, `update cpd_activities set verified_at = now() where id = '${CPD}'`);
  await expectError("…and then it is HR's to change", U.teacherA2, `update cpd_activities set hours = 60 where id = '${CPD}'`, /HR has verified/);

  await db.exec(`delete from qa_observations where id = '${OBS}'; delete from qa_checklists where id = '${CL}'; delete from appraisal_cycles where id = '${CYCLE}';
    delete from payroll_runs where id = '${RUN}'; delete from staff_loans where id = '${LOAN}'; delete from pay_grades where tenant_id = '${T.A}'; delete from hr_settings where tenant_id = '${T.A}';
    delete from staff where id = '${T2}';`);
}
