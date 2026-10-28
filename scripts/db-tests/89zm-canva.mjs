// "Open in Canva": a teacher's Canva tokens are readable and writable by the server only.
export default async function ({ db, q, expectError, check, U, T }) {
  console.log("\nCanva: connections stay on the server");
  await q(`insert into canva_connections (user_id, tenant_id, access_token, refresh_token, expires_at) values ('${U.teacherA}', '${T.A}', 'v1.enc', 'v1.enc', now() + interval '1 hour')`);
  const n = await q(`select count(*)::int n from canva_connections`);
  check("the server keeps one connection per teacher", n[0]?.n === 1, n);
  await expectError("the teacher can't read the tokens", U.teacherA, `select access_token from canva_connections`, /permission denied/);
  await expectError("…nor can the school admin", U.adminA, `select count(*) from canva_connections`, /permission denied/);
  await expectError("…or anyone write one", U.teacherA, `insert into canva_connections (user_id, access_token, refresh_token, expires_at) values ('${U.teacherA}', 'x', 'y', now())`, /permission denied/);
  await db.exec(`delete from canva_connections`);
}
