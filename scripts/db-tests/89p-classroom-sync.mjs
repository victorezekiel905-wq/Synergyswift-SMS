// Google Classroom / Teams: tokens stay on the server, links and pushed homework are visible to staff only, and written by the server.
export default async function ({ db, q, expectRows, expectError, check, U, T }) {
  const CLASS = "a2000000-0000-0000-0000-000000000000";
  console.log("\nClassroom and Teams links");
  await db.exec(`insert into oauth_connections (tenant_id, user_id, provider, account_email, access_token, refresh_token) values ('${T.A}', '${U.teacherA}', 'google', 't@school.edu', 'tok', 'ref')`);
  await expectRows("not even the teacher can read their tokens from the browser", U.teacherA, "select count(*) n from oauth_connections", 0);
  await expectRows("…nor the head", U.adminA, "select count(*) n from oauth_connections", 0);
  await db.exec(`insert into class_links (tenant_id, class_group_id, provider, external_id, external_name) values ('${T.A}', '${CLASS}', 'google', 'course-1', 'JSS1 Maths')`);
  await expectRows("staff see which classes are linked", U.teacherA2, "select count(*) n from class_links", 1);
  await expectRows("students do not", U.studentA, "select count(*) n from class_links", 0);
  await expectError("staff cannot link classes directly (the server checks the teacher first)", U.teacherA,
    `insert into class_links (tenant_id, class_group_id, provider, external_id) values ('${T.A}', '${CLASS}', 'microsoft', 'team-1')`, /row-level security/);
  let dup = null;
  try { await q(`insert into class_links (tenant_id, class_group_id, provider, external_id) values ('${T.A}', '${CLASS}', 'google', 'course-2')`); } catch (e) { dup = e.message; }
  check("a class links to one course per provider (and subject)", /duplicate|unique/.test(dup ?? ""), dup);
  const h = await q(`select count(*) n from data_changes where table_name = 'oauth_connections'`);
  check("tokens stay out of the change history", Number(h[0].n) === 0, h[0]);
  await expectRows("another school sees nothing", U.adminB, "select count(*) n from class_links", 0);
  await db.exec(`delete from class_links; delete from oauth_connections;`);
}
