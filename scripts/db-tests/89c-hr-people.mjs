// People: private personal details, documents, contracts, qualifications HR verifies, recruitment with a panel, checklists ticked by their owners, leave via the line manager.
export default async function ({ db, q, expectRows, expectError, expectOk, check, U, T }) {
  const T1 = "ad000000-0000-0000-0000-000000000001";          // Teacher A's staff record (10-finance)
  const ID = n => `e8000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
  const T2 = ID(1), JOB = ID(2), APP = ID(3), IV = ID(4), LIST = ID(5), LEAVE = ID(6), DOC = ID(7);
  await db.exec(`insert into staff (id, tenant_id, user_id, staff_no, full_name, line_manager_id) values ('${T2}', '${T.A}', '${U.teacherA2}', 'T-2', 'Teacher A2', '${T1}')`);

  console.log("\nStaff records");
  await expectOk("staff fill in their own details", U.teacherA2, `insert into staff_personal (staff_id, tenant_id, nin, rsa_pin, next_of_kin_name) values ('${T2}', '${T.A}', '12345678901', 'PEN100012345678', 'Ada')`);
  await expectError("a NIN is 11 digits", U.teacherA2, `update staff_personal set nin = '123' where staff_id = '${T2}'`, /check/);
  await expectError("an RSA PIN looks like PEN and 12 digits", U.teacherA2, `update staff_personal set rsa_pin = 'X1' where staff_id = '${T2}'`, /check/);
  await db.exec(`insert into staff_personal (staff_id, tenant_id, nin) values ('${T1}', '${T.A}', '10987654321')`);
  await expectRows("…and see only their own", U.teacherA2, "select count(*) n from staff_personal", 1);
  await expectRows("a line manager does not see their team's private details", U.teacherA, `select count(*) n from staff_personal where staff_id = '${T2}'`, 0);
  await expectRows("HR sees everyone's", U.adminA, "select count(*) n from staff_personal", 2);
  await expectError("nobody writes someone else's", U.teacherA2, `insert into staff_personal (staff_id, tenant_id) values ('${T1}', '${T.A}') on conflict (staff_id) do update set nin = '11111111111'`, /row-level security/);
  await expectRows("parents see none", U.parentA, "select count(*) n from staff_personal", 0);
  await expectOk("HR files a reference kept from the person", U.adminA, `insert into staff_documents (id, tenant_id, staff_id, kind, title, path, visible_to_staff) values ('${DOC}', '${T.A}', '${T2}', 'reference', 'Reference', '${T.A}/${T2}/r.pdf', false), (default, '${T.A}', '${T2}', 'cv', 'CV', '${T.A}/${T2}/cv.pdf', true)`);
  await expectRows("the person sees only what is shared with them", U.teacherA2, "select count(*) n from staff_documents", 1);
  await expectRows("colleagues see none", U.teacherA, "select count(*) n from staff_documents", 0);
  await expectError("staff add files through the server only", U.teacherA2, `insert into staff_documents (tenant_id, staff_id, kind, title, path) values ('${T.A}', '${T2}', 'cv', 'x', 'x')`, /row-level security/);
  await expectOk("HR adds contracts", U.adminA, `insert into staff_contracts (tenant_id, staff_id, kind, starts_on, status) values ('${T.A}', '${T2}', 'probation', '2026-01-05', 'active'), ('${T.A}', '${T2}', 'permanent', '2026-07-05', 'draft')`);
  await expectRows("the person sees active contracts, not drafts", U.teacherA2, "select count(*) n from staff_contracts", 1);
  await expectRows("…and cannot change them", U.teacherA2, `with u as (update staff_contracts set ends_on = '2030-01-01' returning 1) select count(*) n from u`, 0);
  await expectOk("staff add their qualifications", U.teacherA2, `insert into staff_qualifications (id, tenant_id, staff_id, kind, title, verified_at, verified_by) values ('${ID(8)}', '${T.A}', '${T2}', 'licence', 'TRCN', now(), '${U.teacherA2}')`);
  const q0 = await q(`select verified_at, verified_by from staff_qualifications where id = '${ID(8)}'`);
  check("…which start unverified, whatever was sent", q0[0].verified_at === null && q0[0].verified_by === null, q0[0]);
  await expectOk("HR verifies it", U.adminA, `update staff_qualifications set verified_at = now() where id = '${ID(8)}'`);
  const q1 = await q(`select verified_by from staff_qualifications where id = '${ID(8)}'`);
  check("…as themselves", q1[0].verified_by === U.adminA, q1[0]);
  await expectError("a verified qualification is HR's to change", U.teacherA2, `update staff_qualifications set title = 'PhD' where id = '${ID(8)}'`, /HR has verified/);
  await expectError("…or remove", U.teacherA2, `delete from staff_qualifications where id = '${ID(8)}'`, /HR has verified/);
  await expectError("nobody adds qualifications for a colleague", U.teacherA2, `insert into staff_qualifications (tenant_id, staff_id, kind, title) values ('${T.A}', '${T1}', 'degree', 'Fake')`, /row-level security/);

  console.log("\nRecruitment");
  await expectOk("HR drafts a job", U.adminA, `insert into job_postings (id, tenant_id, title, description) values ('${JOB}', '${T.A}', 'Physics teacher', 'Teach physics')`);
  await expectRows("staff do not see drafts", U.teacherA, "select count(*) n from job_postings", 0);
  await expectOk("…until it is published", U.adminA, `update job_postings set status = 'open' where id = '${JOB}'`);
  await expectRows("then staff can see it", U.teacherA, "select count(*) n from job_postings", 1);
  await expectRows("parents cannot", U.parentA, "select count(*) n from job_postings", 0);
  await expectError("only HR posts jobs", U.teacherA, `insert into job_postings (tenant_id, title) values ('${T.A}', 'My job')`, /row-level security/);
  await db.exec(`insert into job_applications (id, tenant_id, posting_id, full_name, email, cv_path) values ('${APP}', '${T.A}', '${JOB}', 'Chidi Okeke', 'Chidi@example.com', '${T.A}/${JOB}/cv.pdf')`);
  await expectError("one application per email per job", U.adminA, `insert into job_applications (tenant_id, posting_id, full_name, email) values ('${T.A}', '${JOB}', 'Chidi again', 'chidi@EXAMPLE.com')`, /duplicate|unique|row-level/);
  await expectRows("applications are HR's", U.adminA, "select count(*) n from job_applications", 1);
  await expectRows("staff do not see them", U.teacherA, "select count(*) n from job_applications", 0);
  await expectOk("HR books an interview with Teacher A on the panel", U.adminA, `insert into job_interviews (id, tenant_id, application_id, scheduled_at, panel) values ('${IV}', '${T.A}', '${APP}', now() + interval '2 days', array['${U.teacherA}']::uuid[])`);
  await expectRows("the panellist now sees the candidate", U.teacherA, "select count(*) n from job_applications", 1);
  await expectRows("…and the interview", U.teacherA, "select count(*) n from job_interviews", 1);
  await expectRows("other staff do not", U.teacherA2, "select count(*) n from job_interviews", 0);
  await expectOk("the panellist scores", U.teacherA, `insert into interview_scores (interview_id, tenant_id, panelist_id, score, recommendation) values ('${IV}', '${T.A}', '${U.adminA}', 4, 'hire')`);
  const s0 = await q(`select panelist_id from interview_scores where interview_id = '${IV}'`);
  check("…in their own name", s0.length === 1 && s0[0].panelist_id === U.teacherA, s0);
  await expectError("someone off the panel cannot", U.teacherA2, `insert into interview_scores (interview_id, tenant_id, panelist_id, score, recommendation) values ('${IV}', '${T.A}', '${U.teacherA2}', 1, 'no')`, /panel/);
  await db.exec(`insert into interview_scores (interview_id, tenant_id, panelist_id, score, recommendation) values ('${IV}', '${T.A}', '${U.adminA}', 3, 'maybe')`);
  await expectRows("panellists see only their own score", U.teacherA, "select count(*) n from interview_scores", 1);
  await expectRows("HR sees every score", U.adminA, "select count(*) n from interview_scores", 2);
  await expectRows("panellists cannot move the candidate on", U.teacherA, `with u as (update job_applications set stage = 'offer' returning 1) select count(*) n from u`, 0);
  await expectOk("HR can", U.adminA, `update job_applications set stage = 'offer' where id = '${APP}'`);

  console.log("\nOnboarding checklists");
  await db.exec(`insert into staff_checklists (id, tenant_id, staff_id, kind, name) values ('${LIST}', '${T.A}', '${T2}', 'onboarding', 'New staff');
    insert into staff_checklist_items (id, tenant_id, checklist_id, position, label, owner) values
      ('${ID(11)}', '${T.A}', '${LIST}', 0, 'Contract on file', 'hr_manager'), ('${ID(12)}', '${T.A}', '${LIST}', 1, 'Details completed', 'staff'),
      ('${ID(13)}', '${T.A}', '${LIST}', 2, 'Meet the team', 'line_manager'), ('${ID(14)}', '${T.A}', '${LIST}', 3, 'Salary set up', 'bursar');`);
  await expectRows("the new starter sees their checklist", U.teacherA2, "select count(*) n from staff_checklist_items", 4);
  await expectOk("…and ticks their own item", U.teacherA2, `update staff_checklist_items set done_at = now(), done_by = '${U.adminA}' where id = '${ID(12)}'`);
  const i0 = await q(`select done_by from staff_checklist_items where id = '${ID(12)}'`);
  check("…in their own name", i0[0].done_by === U.teacherA2, i0[0]);
  await expectRows("…but not the bursary's", U.teacherA2, `with u as (update staff_checklist_items set done_at = now() where id = '${ID(14)}' returning 1) select count(*) n from u`, 0);
  await expectError("…nor rename anything", U.teacherA2, `update staff_checklist_items set label = 'Done!' where id = '${ID(12)}'`, /tick items/);
  await expectOk("the line manager ticks theirs", U.teacherA, `update staff_checklist_items set done_at = now() where id = '${ID(13)}'`);
  await expectRows("the bursar sees the checklist with a task for them", U.bursarA, "select count(*) n from staff_checklists", 1);
  await expectOk("…and ticks it", U.bursarA, `update staff_checklist_items set done_at = now() where id = '${ID(14)}'`);
  await expectRows("unrelated staff see nothing", U.studentA, "select count(*) n from staff_checklists", 0);
  await expectError("only HR adds items", U.teacherA, `insert into staff_checklist_items (tenant_id, checklist_id, label) values ('${T.A}', '${LIST}', 'Extra')`, /row-level security|only HR/);
  await expectOk("HR ticks the last item", U.adminA, `update staff_checklist_items set done_at = now() where id = '${ID(11)}'`);
  const c0 = await q(`select completed_at from staff_checklists where id = '${LIST}'`);
  check("…and the checklist is complete", c0[0].completed_at !== null, c0[0]);
  await expectOk("unticking reopens it", U.adminA, `update staff_checklist_items set done_at = null where id = '${ID(11)}'`);
  const c1 = await q(`select completed_at from staff_checklists where id = '${LIST}'`);
  check("…as open", c1[0].completed_at === null, c1[0]);

  console.log("\nLeave through the line manager");
  await expectOk("staff ask for leave", U.teacherA2, `insert into leave_requests (id, tenant_id, staff_id, leave_type, starts_on, ends_on, days, status, manager_status) values ('${LEAVE}', '${T.A}', '${T2}', 'annual', '2026-11-02', '2026-11-03', 1.5, 'pending', 'pending')`);
  await expectError("days come in halves", U.teacherA2, `insert into leave_requests (tenant_id, staff_id, leave_type, starts_on, ends_on, days) values ('${T.A}', '${T2}', 'annual', '2026-12-01', '2026-12-01', 0.3)`, /check/);
  await expectRows("the line manager sees the request", U.teacherA, `select count(*) n from leave_requests where id = '${LEAVE}'`, 1);
  await expectRows("other colleagues do not", U.bursarA, `select count(*) n from leave_requests where id = '${LEAVE}'`, 0);
  await expectError("nobody recommends their own leave", U.teacherA2, `update leave_requests set manager_status = 'recommended' where id = '${LEAVE}'`, /your own/);
  await expectOk("the line manager recommends it", U.teacherA, `update leave_requests set manager_status = 'recommended', manager_note = 'Cover sorted' where id = '${LEAVE}'`);
  const l0 = await q(`select manager_id from leave_requests where id = '${LEAVE}'`);
  check("…and is recorded", l0[0].manager_id === U.teacherA, l0[0]);
  await expectError("…but cannot approve it", U.teacherA, `update leave_requests set status = 'approved' where id = '${LEAVE}'`, /only HR/);
  await expectError("staff cannot change the dates of a request", U.teacherA2, `update leave_requests set ends_on = '2026-11-20' where id = '${LEAVE}'`, /cannot be changed/);
  await expectOk("HR approves", U.adminA, `update leave_requests set status = 'approved' where id = '${LEAVE}'`);
  const l1 = await q(`select decided_by from leave_requests where id = '${LEAVE}'`);
  check("…as themselves", l1[0].decided_by === U.adminA, l1[0]);
  await expectError("approved leave is not recommended again", U.teacherA, `update leave_requests set manager_status = 'not_recommended' where id = '${LEAVE}'`, /already decided/);
  await expectError("nor sent back to pending", U.adminA, `update leave_requests set status = 'pending' where id = '${LEAVE}'`, /back to pending/);
  await expectOk("the person can still cancel", U.teacherA2, `update leave_requests set status = 'cancelled' where id = '${LEAVE}'`);
  await expectRows("everyone reads leave policies", U.teacherA, "select count(*) n from leave_policies", 0);
  await expectError("only HR sets them", U.teacherA, `insert into leave_policies (tenant_id, leave_type, days_per_year) values ('${T.A}', 'sick', 99)`, /row-level security/);
  await expectOk("HR does", U.adminA, `insert into leave_policies (tenant_id, leave_type, days_per_year) values ('${T.A}', 'sick', 10)`);

  await db.exec(`delete from leave_policies where tenant_id = '${T.A}'; delete from leave_requests where staff_id = '${T2}';
    delete from job_postings where id = '${JOB}'; delete from staff_personal where staff_id in ('${T1}', '${T2}'); delete from staff where id = '${T2}';`);
}
