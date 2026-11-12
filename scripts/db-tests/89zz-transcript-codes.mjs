// Transcript codes (migration 10100): a parent opens a child's transcript only with a code the
// school's admins made for that child; the code works only for a parent linked to that child.
export default async function ({ q, expectError, check, U, T }) {
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

  await q(`delete from transcript_access where tenant_id = '${T.A}'`);
  await q(`delete from transcript_codes where tenant_id = '${T.A}'`);
}
