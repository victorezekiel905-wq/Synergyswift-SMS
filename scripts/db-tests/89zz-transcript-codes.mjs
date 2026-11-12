// Transcript codes (migration 10100): a parent opens a child's transcript only with a code the
// school's admins made for that child; the code works only for a parent linked to that child.
export default async function ({ q, as, expectError, check, U, T }) {
  const ctxAs = { as };
  console.log("\nTranscript codes: made by admins, used by the child's own parents");
  const ADA = "a8000000-0000-0000-0000-000000000001", BOLA = "a8000000-0000-0000-0000-000000000002";   // Parent A is linked to Ada only
  const issue = async (sid, days = null) => (await q(`select issue_transcript_code('${sid}', '${U.adminA}', ${days === null ? "null" : days}) c`))[0].c;
  const unlock = async (code, user = U.parentA) => (await q(`select unlock_transcript('${code}', '${user}') r`))[0].r;
  const fails = async (code, user, re) => { try { await unlock(code, user); return false; } catch (e) { return re.test(e.message); } };

  const c1 = await issue(ADA, 30);
  check("a code is 8 characters with no look-alikes", /^[A-HJ-NP-Z2-9]{8}$/.test(c1), c1);
  const r1 = await unlock(`${c1.slice(0, 4)}-${c1.slice(4).toLowerCase()}`);
  check("the child's parent unlocks the transcript (dash and small letters are fine)", r1.student_id === ADA && r1.already === false, r1);
  check("…and it is recorded", Boolean((await q(`select 1 x from transcript_access where student_id = '${ADA}' and user_id = '${U.parentA}' and revoked_at is null`))[0]));
  const again = await unlock(c1);
  check("entering it again does not use it up", again.already === true && Number((await q(`select uses from transcript_codes where code = '${c1}'`))[0].uses) === 1);

  const cBola = await issue(BOLA);
  check("another child's code does nothing for this parent", await fails(cBola, U.parentA, /not right for any of your children/));
  check("staff can't use a transcript code", await fails(c1, U.teacherA, /Only parents/));

  const c2 = await issue(ADA);
  check("a new code replaces the old one", await fails(c1, U.parentA, /not right/) || (await unlock(c1).catch(() => null)) === null);
  await q(`update transcript_access set revoked_at = now() where student_id = '${ADA}'`);
  await q(`update transcript_codes set expires_at = now() - interval '1 minute' where code = '${c2}'`);
  check("an expired code is refused", await fails(c2, U.parentA, /expired/));
  await q(`update transcript_codes set expires_at = null, uses = max_uses where code = '${c2}'`);
  check("a code used up is refused for a new unlock", await fails(c2, U.parentA, /used as many times/));
  await q(`update transcript_codes set uses = 0 where code = '${c2}'`);
  check("after the school took access back, a live code opens it again", (await unlock(c2)).already === false);

  await expectError("parents can't read the codes", U.parentA, "select * from transcript_codes", /permission denied/);
  await expectError("staff can't read who unlocked", U.adminA, "select * from transcript_access", /permission denied/);
  await expectError("nobody signed in can make codes", U.adminA, `select issue_transcript_code('${ADA}', '${U.adminA}', null)`, /permission denied/);
  await expectError("…or call the unlock directly", U.parentA, `select unlock_transcript('${c2}', '${U.parentA}')`, /permission denied/);

  // A parent's own children only: the database itself hides everyone else's child and results.
  const asParent = async sql => { const { as } = ctxAs; return await as(U.parentA, () => q(sql)); };
  check("a parent reads their own child's record", (await asParent(`select id from students where id = '${ADA}'`)).length === 1);
  check("…but not another child's, even in the same class", (await asParent(`select id from students where id = '${BOLA}'`)).length === 0);
  check("…nor a child in another school", (await asParent(`select id from students where id = 'b8000000-0000-0000-0000-000000000001'`)).length === 0);
  check("a parent sees report cards for their own child only", (await asParent(`select distinct student_id from report_cards`)).every(r => r.student_id === ADA));
  check("holding a code for another child unlocks nothing", await fails(cBola, U.parentA, /not right for any of your children/)
    && !(await q(`select 1 x from transcript_access where student_id = '${BOLA}'`))[0]);

  // Unlinked from the child: the transcript goes at once, and linking again needs the code again.
  check("the parent has the transcript open", Boolean((await q(`select 1 x from transcript_access where student_id = '${ADA}' and user_id = '${U.parentA}' and revoked_at is null`))[0]));
  await q(`delete from student_guardians where student_id = '${ADA}' and guardian_id = 'a9000000-0000-0000-0000-000000000001'`);
  check("unlinking the parent removes their transcript access", !(await q(`select 1 x from transcript_access where student_id = '${ADA}' and user_id = '${U.parentA}'`))[0]);
  check("…and the code no longer works for them", await fails(c2, U.parentA, /not right for any of your children/));
  check("…and they can no longer read the child", (await asParent(`select id from students where id = '${ADA}'`)).length === 0);
  await q(`insert into student_guardians (tenant_id, student_id, guardian_id) values ('${T.A}', '${ADA}', 'a9000000-0000-0000-0000-000000000001')`);
  check("linked again, the transcript stays shut until the code is entered", !(await q(`select 1 x from transcript_access where student_id = '${ADA}' and user_id = '${U.parentA}'`))[0]);

  await q(`delete from transcript_access where tenant_id = '${T.A}'`);
  await q(`delete from transcript_codes where tenant_id = '${T.A}'`);
}
