// Account confirmation in the app (migration 8000): only the server reads or writes sign-ups and the sign-in email log.
export default async function ({ db, q, expectError, check, U, T }) {
  console.log("\nSign-ups waiting to be confirmed");
  const nu = "d0000000-0000-0000-0000-000000000001";
  await db.exec(`insert into auth.users (id) values ('${nu}');
    insert into signup_requests (user_id, tenant_id, email, full_name, kind) values ('${nu}', '${T.A}', 'new@a.co', 'New Student', 'student');
    insert into auth_mail_log (email, ip, kind) values ('new@a.co', '1.2.3.4', 'confirm'), ('x@a.co', '1.2.3.4', 'code_miss');`);
  const waiting = await q(`select count(*)::int n from signup_requests where tenant_id = '${T.A}' and confirmed_at is null`);
  check("a new account waits to be confirmed", waiting[0].n === 1, waiting);
  await expectError("a school admin can't read the sign-ups table directly (only through the app)", U.adminA, `select count(*) from signup_requests`, /permission denied/);
  await expectError("…nor can anyone else signed in", U.studentA, `select count(*) from signup_requests`, /permission denied/);
  await expectError("nobody can confirm themselves by writing to it", U.studentA, `update signup_requests set confirmed_at = now() where user_id = '${nu}'`, /permission denied/);
  await expectError("…or read the sign-in email log", U.adminA, `select count(*) from auth_mail_log`, /permission denied/);
  let bad = false;
  try { await q(`insert into signup_requests (user_id, email, kind) values ('${U.teacherA}', 'x@a.co', 'wizard')`); } catch { bad = true; }
  check("only known kinds of sign-up", bad);
  bad = false;
  try { await q(`update signup_requests set confirmed_how = 'myself' where user_id = '${nu}'`); } catch { bad = true; }
  check("only known ways of confirming", bad);
  await q(`delete from auth.users where id = '${nu}'`);
  const gone = await q(`select count(*)::int n from signup_requests where user_id = '${nu}'`);
  check("removing the account removes its sign-up", gone[0].n === 0, gone);
  await db.exec(`delete from auth_mail_log`);
}
