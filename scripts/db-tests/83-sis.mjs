// Student information system: history, documents, SEN and IEPs, achievements, portfolio, certificates.
export default async function ({ db, q, expectRows, expectError, expectOk, check, U, T }) {
  const COUNS = "a0000000-0000-0000-0000-0000000000c1";   // counsellor, created in 82-core-security
  const KID = "a8000000-0000-0000-0000-000000000001", OTHER = "a8000000-0000-0000-0000-000000000002";
  const NEW = "d1000000-0000-0000-0000-000000000001", IEP = "d1000000-0000-0000-0000-000000000002", TG1 = "d1000000-0000-0000-0000-000000000003", TG2 = "d1000000-0000-0000-0000-000000000004";
  console.log("\nStudent information system");

  await expectOk("an admin admits a student", U.adminA, `insert into students (id, tenant_id, admission_no, first_name, last_name, class_group_id, previous_school)
    values ('${NEW}', '${T.A}', 'SIS-1', 'Kemi', 'Lawal', 'a2000000-0000-0000-0000-000000000000', 'Bright Stars Academy')`);
  const adm = await q(`select kind, to_class, school, effective_on = current_date today from student_movements where student_id = '${NEW}'`);
  check("their history starts with 'admitted', the class and the previous school", adm.length === 1 && adm[0].kind === "admitted" && adm[0].to_class === "JSS1" && adm[0].school === "Bright Stars Academy" && adm[0].today, adm);
  const old = await q(`select count(*)::int n from student_movements where student_id = '${KID}' and kind = 'admitted'`);
  check("students admitted before the history began get an entry too", old[0].n === 1, old[0]);
  await expectRows("staff read the history", U.teacherA, `select count(*) n from student_movements where student_id = '${NEW}'`, 1);
  await expectError("teachers cannot write it", U.teacherA, `insert into student_movements (tenant_id, student_id, kind) values ('${T.A}', '${NEW}', 'promoted')`, /row-level security/);
  await expectRows("parents do not read it directly", U.parentA, "select count(*) n from student_movements", 0);

  console.log("\nStudent documents");
  await expectOk("an admin files a birth certificate", U.adminA, `insert into student_documents (tenant_id, student_id, kind, name, path) values ('${T.A}', '${KID}', 'birth_certificate', 'bc.pdf', 'x/bc.pdf')`);
  await expectOk("and a confidential court order", U.adminA, `insert into student_documents (tenant_id, student_id, kind, name, path, confidential) values ('${T.A}', '${KID}', 'court_order', 'order.pdf', 'x/o.pdf', true)`);
  await expectRows("teachers see ordinary documents only", U.teacherA, `select count(*) n from student_documents where student_id = '${KID}'`, 1);
  await expectRows("the counsellor sees confidential ones", COUNS, `select count(*) n from student_documents where student_id = '${KID}'`, 2);
  await expectError("teachers cannot add documents", U.teacherA, `insert into student_documents (tenant_id, student_id, name, path) values ('${T.A}', '${KID}', 'x', 'y')`, /row-level security/);
  await expectRows("parents do not read the table directly", U.parentA, "select count(*) n from student_documents", 0);

  console.log("\nSEN and support plans");
  await expectError("a teacher cannot put a child on the SEN register", U.teacherA, `insert into sen_profiles (student_id, tenant_id, status) values ('${KID}', '${T.A}', 'sen_support')`, /row-level security/);
  await expectOk("the counsellor does, with 25% extra exam time", COUNS, `insert into sen_profiles (student_id, tenant_id, status, needs, strategies, extra_time_pct, coordinator_id)
    values ('${KID}', '${T.A}', 'sen_support', '{dyslexia}', 'Give written instructions', 25, '${U.teacherA2}')`);
  await expectRows("the child's teacher reads the shared profile", U.teacherA, `select count(*) n from sen_profiles where student_id = '${KID}'`, 1);
  await expectRows("a teacher who does not teach the child does not", U.bursarA, "select count(*) n from sen_profiles", 0);
  await expectRows("the named coordinator can update it", U.teacherA2, `with u as (update sen_profiles set summary = 'Reading age 9' where student_id = '${KID}' returning 1) select count(*) n from u`, 1);
  await expectRows("the class teacher cannot", U.teacherA, `with u as (update sen_profiles set summary = 'x' where student_id = '${KID}' returning 1) select count(*) n from u`, 0);
  await expectOk("the coordinator drafts a plan", U.teacherA2, `insert into ieps (id, tenant_id, student_id, title, status, created_by) values ('${IEP}', '${T.A}', '${KID}', 'Reading plan', 'draft', '${U.teacherA2}')`);
  await expectOk("with targets", U.teacherA2, `insert into iep_targets (id, tenant_id, iep_id, target, owner_id) values ('${TG1}', '${T.A}', '${IEP}', 'Read 60 words a minute', '${U.teacherA}'), ('${TG2}', '${T.A}', '${IEP}', 'Spell 20 key words', null)`);
  await expectRows("teachers do not see draft plans", U.teacherA, `select count(*) n from ieps where id = '${IEP}'`, 0);
  await db.exec(`update ieps set status = 'active' where id = '${IEP}'`);
  await expectRows("…but see live ones and their targets", U.teacherA, `select count(*) n from iep_targets t join ieps i on i.id = t.iep_id where i.id = '${IEP}'`, 2);
  await expectRows("a teacher records progress on a target they own", U.teacherA, `with u as (update iep_targets set progress = 'developing' where id = '${TG1}' returning 1) select count(*) n from u`, 1);
  await expectRows("…but not on someone else's", U.teacherA, `with u as (update iep_targets set progress = 'achieved' where id = '${TG2}' returning 1) select count(*) n from u`, 0);
  await db.exec(`update sen_profiles set share_with_teachers = false where student_id = '${KID}'`);
  await expectRows("when the profile is not shared, teachers see nothing", U.teacherA, `select (select count(*) from sen_profiles) + (select count(*) from ieps) n`, 0);
  await expectRows("parents never read SEN records directly", U.parentA, `select (select count(*) from sen_profiles) + (select count(*) from ieps) n`, 0);
  await expectRows("another school sees nothing", U.adminB, `select (select count(*) from sen_profiles) + (select count(*) from ieps) + (select count(*) from iep_targets) n`, 0);

  console.log("\nAchievements, portfolio, certificates");
  await expectOk("a teacher records an achievement", U.teacherA, `insert into student_achievements (tenant_id, student_id, kind, title, recorded_by) values ('${T.A}', '${KID}', 'sports', '100 m, 1st place', '${U.teacherA}')`);
  await expectOk("and a private one", U.teacherA, `insert into student_achievements (tenant_id, student_id, kind, title, shared_with_family, recorded_by) values ('${T.A}', '${KID}', 'character', 'Kindness award shortlist', false, '${U.teacherA}')`);
  await expectError("…but not in someone else's name", U.teacherA, `insert into student_achievements (tenant_id, student_id, title, recorded_by) values ('${T.A}', '${KID}', 'X', '${U.teacherA2}')`, /row-level security/);
  await expectRows("the parent sees shared achievements only", U.parentA, `select count(*) n from student_achievements`, 1);
  await expectRows("the student sees their own", U.studentA, `select count(*) n from student_achievements`, 1);
  await expectRows("another teacher cannot delete it", U.teacherA2, `with d as (delete from student_achievements returning 1) select count(*) n from d`, 0);

  await db.exec(`insert into portfolio_items (tenant_id, student_id, title, status) values ('${T.A}', '${KID}', 'Essay draft', 'submitted'), ('${T.A}', '${KID}', 'Science project', 'approved')`);
  await expectRows("the student sees all their work", U.studentA, "select count(*) n from portfolio_items", 2);
  await expectRows("the parent sees approved work only", U.parentA, "select count(*) n from portfolio_items", 1);
  await expectError("students add work through the server only", U.studentA, `insert into portfolio_items (tenant_id, student_id, title) values ('${T.A}', '${KID}', 'Mine')`, /row-level security/);
  await expectRows("another family's child's work is hidden", U.parentA, `select count(*) n from portfolio_items where student_id = '${OTHER}'`, 0);

  await db.exec(`insert into certificates (tenant_id, student_id, kind, serial_no, title) values ('${T.A}', '${KID}', 'award', 'CERT-T-1', 'Sports award'), ('${T.A}', '${KID}', 'award', 'CERT-T-2', 'Old award');
    update certificates set status = 'revoked' where serial_no = 'CERT-T-2';`);
  await expectRows("families see issued certificates, not revoked ones", U.parentA, "select count(*) n from certificates", 1);
  await expectRows("staff see all of them", U.teacherA, "select count(*) n from certificates", 2);
  await expectError("certificates are numbered and signed by the server only", U.adminA, `insert into certificates (tenant_id, student_id, kind, serial_no, title) values ('${T.A}', '${KID}', 'award', 'FAKE-1', 'Fake')`, /row-level security/);
  await expectRows("nobody edits them directly", U.adminA, `with u as (update certificates set title = 'Changed' where serial_no = 'CERT-T-1' returning 1) select count(*) n from u`, 0);
  const still = await q(`select title from certificates where serial_no = 'CERT-T-1'`);
  check("an issued certificate's wording cannot be changed from the app", still[0].title === "Sports award", still[0]);
  await db.exec(`delete from students where id = '${NEW}'`);   // later tests count the seed students
}
