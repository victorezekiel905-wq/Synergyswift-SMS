// Sign-in state (migration 10200): the server can tell an account that was only made (invited)
// from one whose owner has signed in; nobody signed in can read it.
export default async function ({ q, expectError, check, U, T }) {
  console.log("\nSign-in state: invited is not joined");
  const rows = async () => await q(`select * from tenant_sign_ins('${T.A}')`);
  const before = (await rows()).find(r => r.user_id === U.teacherA);
  check("an account nobody has signed in to shows no sign-in", Boolean(before) && before.last_sign_in_at === null, before);
  await q(`update auth.users set last_sign_in_at = now() where id = '${U.teacherA}'`);
  check("after they sign in, it shows", Boolean((await rows()).find(r => r.user_id === U.teacherA)?.last_sign_in_at));
  check("only this school's accounts are listed", !(await rows()).some(r => r.user_id === U.adminB));
  await expectError("signed-in users can't read sign-in records", U.adminA, `select * from tenant_sign_ins('${T.A}')`, /permission denied/);
  await q(`update auth.users set last_sign_in_at = null where id = '${U.teacherA}'`);
}
