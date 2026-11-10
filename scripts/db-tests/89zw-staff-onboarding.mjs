// Staff onboarding (migration 9800): the subjects each member of staff teaches, kept to the
// school's own staff and subjects, written only by admins and HR, and staff numbers made
// when the school leaves the ID number blank.
export default async function ({ q, as, expectRows, expectError, expectOk, check, U, T }) {
  console.log("\nStaff onboarding: subjects they teach and staff numbers");
  const S1 = "a8500000-0000-0000-0000-000000000001", S2 = "a8500000-0000-0000-0000-000000000002";
  const MATHS = "a8600000-0000-0000-0000-000000000001", ENG = "a8600000-0000-0000-0000-000000000002", B_SUBJ = "a8600000-0000-0000-0000-000000000003";
  await q(`insert into subjects (id, tenant_id, name) values ('${MATHS}', '${T.A}', 'Onboard Maths'), ('${ENG}', '${T.A}', 'Onboard English'), ('${B_SUBJ}', '${T.B}', 'Other school subject')`);

  const before = (await q(`select next_staff_no('${T.A}') n`))[0].n;
  check("a staff number is made when the ID is left blank", /^STF-\d{4,}$/.test(before), before);
  await q(`insert into staff (id, tenant_id, staff_no, full_name, email) values ('${S1}', '${T.A}', '${before}', 'Ada Obi', 'ada.onboard@example.com')`);
  const next = (await q(`select next_staff_no('${T.A}') n`))[0].n;
  check("…and the next one follows on", Number(next.slice(4)) === Number(before.slice(4)) + 1, { before, next });
  check("a new member of staff gets a sign-up code at once", Boolean((await q(`select 1 x from account_codes where kind = 'staff' and staff_id = '${S1}' and revoked_at is null`))[0]));

  await expectOk("an admin records the subjects they teach", U.adminA,
    `insert into staff_subjects (tenant_id, staff_id, subject_id) values ('${T.A}', '${S1}', '${MATHS}'), ('${T.A}', '${S1}', '${ENG}')`);
  await expectRows("staff see them", U.teacherA, `select * from staff_subjects where staff_id = '${S1}'`, 2);
  await expectOk("an admin takes a subject off", U.adminA, `delete from staff_subjects where staff_id = '${S1}' and subject_id = '${MATHS}'`);
  await expectError("a teacher can't add them", U.teacherA, `insert into staff_subjects (tenant_id, staff_id, subject_id) values ('${T.A}', '${S1}', '${MATHS}')`, /row-level security/);
  await expectRows("…or take them off", U.teacherA, `delete from staff_subjects where staff_id = '${S1}' returning 1`, 0);
  await expectOk("an admin puts it back", U.adminA, `insert into staff_subjects (tenant_id, staff_id, subject_id) values ('${T.A}', '${S1}', '${MATHS}')`);
  await expectError("another school's subject can't be given", U.adminA, `insert into staff_subjects (tenant_id, staff_id, subject_id) values ('${T.A}', '${S1}', '${B_SUBJ}')`, /not found in this school/);
  await expectRows("parents and students see none", U.parentA, `select * from staff_subjects`, 0);
  await expectError("nobody signed in can make staff numbers", U.adminA, `select next_staff_no('${T.A}')`, /permission denied/);

  // Classes chosen before they sign up are put in place the moment they do.
  const CLS = "a8700000-0000-0000-0000-000000000001", CLS2 = "a8700000-0000-0000-0000-000000000002", B_CLS = "a8700000-0000-0000-0000-000000000003";
  const NEWU = "a8800000-0000-0000-0000-000000000001";
  await q(`insert into class_groups (id, tenant_id, name) values ('${CLS}', '${T.A}', 'Onboard 1A'), ('${CLS2}', '${T.A}', 'Onboard 1B'), ('${B_CLS}', '${T.B}', 'Other school class')`);
  await expectOk("an admin chooses classes for someone not yet signed up", U.adminA,
    `insert into staff_class_plans (tenant_id, staff_id, class_group_id, subject_id) values ('${T.A}', '${S1}', '${CLS}', '${MATHS}'), ('${T.A}', '${S1}', '${CLS2}', null)`);
  await expectError("a teacher can't", U.teacherA, `insert into staff_class_plans (tenant_id, staff_id, class_group_id, subject_id) values ('${T.A}', '${S1}', '${CLS2}', '${MATHS}')`, /row-level security/);
  await expectError("another school's class can't be chosen", U.adminA, `insert into staff_class_plans (tenant_id, staff_id, class_group_id) values ('${T.A}', '${S1}', '${B_CLS}')`, /not found in this school/);
  await expectError("…nor the same class twice", U.adminA, `insert into staff_class_plans (tenant_id, staff_id, class_group_id, subject_id) values ('${T.A}', '${S1}', '${CLS2}', null)`, /duplicate/);
  await q(`insert into auth.users (id) values ('${NEWU}')`);
  await q(`insert into users (id, tenant_id, email, full_name, role) values ('${NEWU}', '${T.A}', 'ada.onboard@example.com', 'Ada Obi', 'teacher')`);
  await q(`update staff set user_id = '${NEWU}' where id = '${S1}'`);
  check("when they sign up, they teach the subject in the class chosen", Boolean((await q(`select 1 x from subject_offerings where class_group_id = '${CLS}' and subject_id = '${MATHS}' and teacher_id = '${NEWU}'`))[0]));
  check("…and are form teacher of the class chosen", (await q(`select form_teacher_id f from class_groups where id = '${CLS2}'`))[0].f === NEWU);
  check("…and the plan is used up", Number((await q(`select count(*) n from staff_class_plans where staff_id = '${S1}'`))[0].n) === 0);

  // Removing a subject from the school takes it off the staff member; removing the staff member takes all.
  await q(`insert into staff (id, tenant_id, staff_no, full_name) values ('${S2}', '${T.A}', 'ONB-2', 'Bayo Ade')`);
  await q(`insert into staff_subjects (tenant_id, staff_id, subject_id) values ('${T.A}', '${S2}', '${ENG}')`);
  await q(`delete from subjects where id = '${ENG}'`);
  check("a deleted subject comes off their list", Number((await q(`select count(*) n from staff_subjects where staff_id in ('${S1}', '${S2}')`))[0].n) === 1);
  await q(`delete from staff where id in ('${S1}', '${S2}')`);
  check("a deleted staff member's subjects go with them", Number((await q(`select count(*) n from staff_subjects where staff_id in ('${S1}', '${S2}')`))[0].n) === 0);

  // Leave the school as later tests expect it.
  await q(`delete from subjects where id in ('${MATHS}', '${B_SUBJ}')`);
  await q(`delete from class_groups where id in ('${CLS}', '${CLS2}', '${B_CLS}')`);
  await q(`delete from users where id = '${NEWU}'`);
  await q(`delete from auth.users where id = '${NEWU}'`).catch(() => {});
  await q(`delete from recycle_bin where row_id in ('${S1}', '${S2}', '${MATHS}', '${ENG}', '${B_SUBJ}', '${CLS}', '${CLS2}', '${B_CLS}', '${NEWU}')`).catch(() => {});
  void as;
}
