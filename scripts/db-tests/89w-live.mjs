// Phase 14d-2: the live-lesson engine (schema live) kept in step with the school, module switch, and the Safe Exam Browser lock.
export default async function ({ db, q, expectRows, expectError, expectOk, check, U, T }) {
  const CG = "a2000000-0000-0000-0000-000000000000", SESSION = "f7000000-0000-0000-0000-000000000001";
  const server = async (name, sql, re) => {
    try { await q(sql); check(name, !re, re ? "expected an error" : null); }
    catch (e) { check(name, Boolean(re && re.test(e.message)), e.message); }
  };

  console.log("\nLive lessons: people and classes come from the school");
  const tenants = await q(`select id, status from live.tenants where id in ('${T.A}', '${T.B}') order by id`);
  check("both schools exist in the live engine", tenants.length === 2, tenants);
  const roles = Object.fromEntries((await q(`select id, role from live.users where id in ('${U.teacherA}', '${U.studentA}', '${U.adminA}', '${U.parentA}')`)).map(r => [r.id, r.role]));
  check("the teacher is a live teacher", roles[U.teacherA] === "teacher", roles);
  check("the student is a live student", roles[U.studentA] === "student", roles);
  check("the head is a live school admin", roles[U.adminA] === "school_admin", roles);
  check("parents get no live account", !roles[U.parentA], roles);
  const cls = await q(`select id, teacher_id from live.classes where id = '${CG}'`);
  check("the school's class is a live class", cls.length === 1, cls);
  const members = await q(`select user_id, role from live.class_members where class_id = '${CG}'`);
  check("its student is a member", members.some(m => m.user_id === U.studentA && m.role === "student"), members);
  const subj = await q(`select teacher_id, subject from live.class_subjects where class_id = '${CG}'`);
  check("its subject teacher teaches the subject", subj.some(s => s.teacher_id === U.teacherA && s.subject === "Maths"), subj);

  console.log("\nLive lessons: the Live module switch");
  await db.exec(`update tenants set modules = modules || '{"live": false}'::jsonb where id = '${T.A}'`);
  const off = await q(`select status from live.tenants where id = '${T.A}'`);
  check("switching the module off blocks the school in the engine", off[0]?.status === "suspended", off);
  await db.exec(`update tenants set modules = modules - 'live' where id = '${T.A}'`);
  const on = await q(`select status from live.tenants where id = '${T.A}'`);
  check("…and switching it back on opens it again", on[0]?.status === "active", on);

  console.log("\nLive lessons: who may do what");
  await expectOk("a teacher makes a lesson", U.teacherA, `insert into live.lessons (tenant_id, owner_id, title) values ('${T.A}', '${U.teacherA}', 'Fractions')`);
  await expectError("a student cannot", U.studentA, `insert into live.lessons (tenant_id, owner_id, title) values ('${T.A}', '${U.studentA}', 'Mine')`, /row-level security|permission denied/);
  await expectRows("another school sees none of this school's classes", U.adminB, `select count(*) n from live.classes where tenant_id = '${T.A}'`, 0);

  console.log("\nLive lessons: Safe Exam Browser lock");
  const teacher = cls[0]?.teacher_id;
  await q(`insert into live.class_sessions (id, tenant_id, class_id, teacher_id, title, join_code) values ('${SESSION}', '${T.A}', '${CG}', '${teacher}', 'Fractions', 'QZ7K2M')`);
  await expectOk("the subject teacher locks the lesson", U.teacherA, `select live.set_session_seb('${SESSION}', true)`);
  await expectError("a head from another school cannot", U.adminB, `select live.set_session_seb('${SESSION}', false)`, /not allowed/);
  await expectError("a student cannot join a locked lesson in a normal browser", U.studentA, `select live.join_session('QZ7K2M')`, /safe_exam_browser_required/);
  await expectError("a student cannot give themselves a pass", U.studentA,
    `insert into live.seb_passes (session_id, user_id, expires_at) values ('${SESSION}', '${U.studentA}', now() + interval '1 hour')`, /permission denied|row-level security/);
  await q(`insert into live.seb_passes (session_id, user_id, expires_at) values ('${SESSION}', '${U.studentA}', now() + interval '1 hour')`);
  await expectOk("with the server's pass the student joins", U.studentA, `select live.join_session('QZ7K2M')`);
  const joined = await q(`select count(*) n from live.session_participants where session_id = '${SESSION}' and user_id = '${U.studentA}'`);
  check("…and is in the lesson", Number(joined[0].n) === 1, joined[0]);
  await expectOk("unlocking works", U.teacherA, `select live.set_session_seb('${SESSION}', false)`);
  await expectOk("the class can be locked for every new lesson", U.teacherA, `select live.set_class_seb('${CG}', true)`);
  await q(`update live.class_sessions set status = 'ended', ended_at = now() where id = '${SESSION}'`);
  await q(`insert into live.class_sessions (tenant_id, class_id, teacher_id, title, join_code) values ('${T.A}', '${CG}', '${teacher}', 'Decimals', 'QZ7K2N')`);
  const locked = await q(`select require_seb from live.class_sessions where join_code = 'QZ7K2N'`);
  check("…so the next lesson starts locked", locked[0]?.require_seb === true, locked);
  await db.exec(`update live.classes set require_seb = false where id = '${CG}'; delete from live.class_sessions where tenant_id = '${T.A}'; delete from live.lessons where tenant_id = '${T.A}';`);
}
