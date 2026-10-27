// Phase 14o: student-added achievements, staff portfolios, share links, transcript release and targets — who sees what.
export default async function ({ db, q, expectRows, expectError, check, U, T }) {
  const KID = "a8000000-0000-0000-0000-000000000001", OTHER = "a8000000-0000-0000-0000-000000000002", CG = "a2000000-0000-0000-0000-000000000000";
  const T1 = "ad000000-0000-0000-0000-000000000001";   // Teacher A's staff record
  const ID = n => `ee000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
  const server = async (name, sql, re) => {
    try { await q(sql); check(name, !re, re ? "expected an error" : null); }
    catch (e) { check(name, Boolean(re && re.test(e.message)), e.message); }
  };

  console.log("\nPortfolios: achievements students add");
  await server("a student's own achievement waits for a teacher", `insert into student_achievements (id, tenant_id, student_id, title, source, status, recorded_by, photo_path) values ('${ID(1)}', '${T.A}', '${KID}', 'Maths Olympiad', 'student', 'pending', '${U.studentA}', 'x/a.jpg')`);
  await server("…with a known status", `insert into student_achievements (tenant_id, student_id, title, source, status) values ('${T.A}', '${KID}', 'Chess', 'student', 'maybe')`, /check/);
  const old = await q(`select status, source from student_achievements where id <> '${ID(1)}' limit 1`);
  check("achievements staff recorded before count as verified", !old.length || (old[0].status === "verified" && old[0].source === "staff"), old);
  await expectRows("the student sees it", U.studentA, `select count(*) n from student_achievements where id = '${ID(1)}'`, 1);
  await expectError("students still cannot write achievements directly", U.studentA, `insert into student_achievements (tenant_id, student_id, title, recorded_by) values ('${T.A}', '${KID}', 'Mine', '${U.studentA}')`, /row-level security/);

  console.log("\nPortfolios: staff achievements");
  await server("a teacher's achievement is saved", `insert into staff_achievements (id, tenant_id, staff_id, title, kind, link_url) values ('${ID(2)}', '${T.A}', '${T1}', 'Best Teacher Award', 'award', 'https://example.org/award')`);
  await server("links must be https", `insert into staff_achievements (tenant_id, staff_id, title, link_url) values ('${T.A}', '${T1}', 'Bad link', 'http://x.org')`, /check/);
  await expectRows("colleagues can see it", U.teacherA2, `select count(*) n from staff_achievements`, 1);
  await expectRows("parents and students cannot", U.parentA, `select count(*) n from staff_achievements`, 0);
  await expectRows("another school cannot", U.adminB, `select count(*) n from staff_achievements`, 0);
  await expectError("staff write through the server only", U.teacherA, `insert into staff_achievements (tenant_id, staff_id, title) values ('${T.A}', '${T1}', 'Mine')`, /row-level security/);

  console.log("\nPortfolios: share links");
  await server("a share link belongs to one student or one teacher", `insert into portfolio_shares (tenant_id, student_id, staff_id) values ('${T.A}', '${KID}', '${T1}')`, /check/);
  await server("a link is long and random, and expires", `insert into portfolio_shares (id, tenant_id, student_id) values ('${ID(3)}', '${T.A}', '${KID}')`);
  const sh = await q(`select length(token) l, expires_at > now() + interval '80 days' later from portfolio_shares where id = '${ID(3)}'`);
  check("…40 characters, 90 days by default", sh[0]?.l === 40 && sh[0]?.later, sh);
  await expectError("nobody in a school reads share links directly", U.adminA, `select count(*) from portfolio_shares`, /permission denied/);

  console.log("\nPortfolios: transcript release");
  const tr = await q(`select transcript_allowed from students where id = '${KID}'`);
  check("a transcript is held back until the school releases it", tr[0]?.transcript_allowed === false, tr);
  await expectRows("a parent cannot release it", U.parentA, `with u as (update students set transcript_allowed = true where id = '${KID}' returning 1) select count(*) n from u`, 0);
  await expectRows("…nor the student", U.studentA, `with u as (update students set transcript_allowed = true where id = '${KID}' returning 1) select count(*) n from u`, 0);

  console.log("\nPortfolios: targets");
  await server("a teacher's target for Ada", `insert into student_targets (id, tenant_id, student_id, kind, target) values ('${ID(4)}', '${T.A}', '${KID}', 'average', 70)`);
  await server("a number target needs its number", `insert into student_targets (tenant_id, student_id, kind) values ('${T.A}', '${KID}', 'attendance')`, /check/);
  await server("a subject target needs its subject", `insert into student_targets (tenant_id, student_id, kind, target) values ('${T.A}', '${KID}', 'subject_score', 60)`, /check/);
  await server("a class target", `insert into class_targets (tenant_id, class_group_id, kind, target) values ('${T.A}', '${CG}', 'average', 65)`);
  await expectRows("Ada sees her target", U.studentA, `select count(*) n from student_targets`, 1);
  await expectRows("her parent sees it", U.parentA, `select count(*) n from student_targets`, 1);
  await expectRows("staff see it", U.teacherA, `select count(*) n from student_targets where student_id = '${KID}'`, 1);
  await expectRows("the class and its families see the class target", U.parentA, `select count(*) n from class_targets`, 1);
  await expectRows("another school sees no targets", U.adminB, `select (select count(*) from student_targets) + (select count(*) from class_targets) n`, 0);
  await expectError("targets are set through the server", U.teacherA, `insert into student_targets (tenant_id, student_id, kind, target) values ('${T.A}', '${OTHER}', 'average', 50)`, /row-level security|permission denied/);

  await db.exec(`delete from student_achievements where id = '${ID(1)}'; delete from staff_achievements where tenant_id = '${T.A}'; delete from portfolio_shares where tenant_id = '${T.A}';
    delete from student_targets where tenant_id = '${T.A}'; delete from class_targets where tenant_id = '${T.A}';`);
}
