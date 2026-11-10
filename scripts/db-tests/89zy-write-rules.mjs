// Write rules (migration 9900): adding a record needs the same role as changing one. Before,
// several tables checked only the school when a row was added, so anyone signed in to the
// school (a student, a parent) could add students, staff or parents, or link a parent to a child.
export default async function ({ q, expectError, expectOk, check, U, T }) {
  console.log("\nWrite rules: adding records needs the right role");
  const ST = "a8900000-0000-0000-0000-000000000001", G = "a8900000-0000-0000-0000-000000000002";
  await q(`insert into students (id, tenant_id, admission_no, first_name, last_name) values ('${ST}', '${T.A}', 'WR-1', 'Not', 'Yours')`);
  const rls = /row-level security/;

  await expectError("a parent can't add a parent record", U.parentA, `insert into guardians (id, tenant_id, full_name) values ('${G}', '${T.A}', 'Fake parent')`, rls);
  await q(`insert into guardians (id, tenant_id, full_name) values ('${G}', '${T.A}', 'A parent')`);
  await expectError("a parent can't link a parent to someone else's child", U.parentA,
    `insert into student_guardians (tenant_id, student_id, guardian_id) values ('${T.A}', '${ST}', '${G}')`, rls);
  await expectError("a student can't add themselves to the staff list", U.studentA,
    `insert into staff (tenant_id, staff_no, full_name) values ('${T.A}', 'WR-STAFF', 'Sneaky')`, rls);
  await expectError("a teacher can't add students", U.teacherA,
    `insert into students (tenant_id, admission_no, first_name, last_name) values ('${T.A}', 'WR-2', 'Made', 'Up')`, rls);
  await expectError("a teacher can't add library books", U.teacherA, `insert into library_books (tenant_id, title) values ('${T.A}', 'Not a librarian')`, rls);
  await expectError("a teacher can't add quality checklists", U.teacherA, `insert into qa_checklists (tenant_id, name) values ('${T.A}', 'Not QA')`, /row-level security|null value|violates/);
  await expectError("a student can't file a report as resolved staff business", U.studentA,
    `insert into forum_reports (tenant_id, reporter_id, reason) values ('${T.A}', '${U.teacherA}', 'not me')`, rls);

  // The right people still can.
  await expectOk("an admin adds a parent and links them", U.adminA,
    `insert into student_guardians (tenant_id, student_id, guardian_id) values ('${T.A}', '${ST}', '${G}')`);
  await expectOk("an admin adds staff", U.adminA, `insert into staff (tenant_id, staff_no, full_name) values ('${T.A}', 'WR-STAFF-OK', 'Real Staff')`);

  // Every "all"-type rule that checks a role for reading or changing checks one when adding too.
  const weak = await q(`select schemaname || '.' || tablename || ' ' || policyname p from pg_policies
    where cmd = 'ALL' and with_check is not null and qual ~ '(has_role|is_staff|auth\\.uid|is_school_admin|is_hr|is_election_officer|is_admissions)'
      and with_check !~ '(has_role|is_staff|auth\\.uid|is_school_admin|is_hr|is_election_officer|is_admissions|can_|is_teacher|is_admin|is_it)'`);
  check("no rule lets a row be added on the school check alone", weak.length === 0, weak.map(r => r.p));

  await q(`delete from staff where tenant_id = '${T.A}' and staff_no in ('WR-STAFF', 'WR-STAFF-OK')`);
  await q(`delete from student_guardians where student_id = '${ST}'`);
  await q(`delete from guardians where id = '${G}'`);
  await q(`delete from students where id = '${ST}'`);
  await q(`delete from recycle_bin where row_id in ('${ST}', '${G}')`).catch(() => {});
}
