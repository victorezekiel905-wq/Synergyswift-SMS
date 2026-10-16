// LTI 1.3: admins register tools, teachers add them to classes, students see only their own class's tools, and keys and launches stay on the server.
export default async function ({ db, q, expectRows, expectError, expectOk, check, U, T }) {
  const CLASS = "a2000000-0000-0000-0000-000000000000";
  const TOOL = "f3000000-0000-0000-0000-000000000001", L1 = "f3000000-0000-0000-0000-000000000002", L2 = "f3000000-0000-0000-0000-000000000003";
  const OTHER_CLASS = "f3000000-0000-0000-0000-000000000009";
  console.log("\nLTI 1.3 tools");
  await expectOk("an admin registers a tool", U.adminA,
    `insert into lti_tools (id, tenant_id, name, oidc_login_url, target_link_uri, jwks_url) values ('${TOOL}', '${T.A}', 'Science sims', 'https://tool.example/login', 'https://tool.example/launch', 'https://tool.example/jwks')`);
  const t = await q(`select length(client_id) c, length(deployment_id) d from lti_tools where id = '${TOOL}'`);
  check("…and gets its own client and deployment ids", Number(t[0].c) === 32 && Number(t[0].d) === 32, t[0]);
  await expectError("tools must use https", U.adminA, `insert into lti_tools (tenant_id, name, oidc_login_url, target_link_uri, grades) values ('${T.A}', 'X', 'http://x/login', 'https://x/launch', false)`, /check constraint/);
  await expectError("grades need the tool's keys", U.adminA, `insert into lti_tools (tenant_id, name, oidc_login_url, target_link_uri) values ('${T.A}', 'Y', 'https://y/login', 'https://y/launch')`, /check constraint/);
  await expectError("teachers cannot register tools", U.teacherA, `insert into lti_tools (tenant_id, name, oidc_login_url, target_link_uri, grades) values ('${T.A}', 'Z', 'https://z/l', 'https://z/t', false)`, /row-level security/);
  await expectRows("teachers can see the tools", U.teacherA, `select count(*) n from lti_tools where id = '${TOOL}'`, 1);
  await expectRows("students cannot", U.studentA, "select count(*) n from lti_tools", 0);
  await db.exec(`insert into class_groups (id, tenant_id, name) values ('${OTHER_CLASS}', '${T.A}', 'LTI other class') on conflict do nothing`);
  await expectOk("a teacher adds the tool to their class", U.teacherA, `insert into lti_links (id, tenant_id, tool_id, title, class_group_id) values ('${L1}', '${T.A}', '${TOOL}', 'Circuits lab', '${CLASS}')`);
  await expectOk("…and another class", U.teacherA, `insert into lti_links (id, tenant_id, tool_id, title, class_group_id) values ('${L2}', '${T.A}', '${TOOL}', 'Optics lab', '${OTHER_CLASS}')`);
  await expectRows("a student sees only their own class's tool", U.studentA, "select count(*) n from lti_links", 1);
  await expectError("students cannot add tools", U.studentA, `insert into lti_links (tenant_id, tool_id, title) values ('${T.A}', '${TOOL}', 'Mine')`, /row-level security/);
  await db.exec(`update lti_tools set active = false where id = '${TOOL}'`);
  await expectError("a switched-off tool cannot be added", U.teacherA, `insert into lti_links (tenant_id, tool_id, title) values ('${T.A}', '${TOOL}', 'New')`, /row-level security/);
  await expectRows("another school sees nothing", U.adminB, "select count(*) n from lti_links", 0);

  console.log("\nKeys, launches and scores");
  await db.exec(`insert into lti_platform_keys (kid, public_jwk, private_pem) values ('k1', '{}', 'secret')`);
  await expectRows("nobody signed in can read the platform keys", U.adminA, "select count(*) n from lti_platform_keys", 0);
  await db.exec(`insert into lti_launches (tenant_id, link_id, user_id) values ('${T.A}', '${L1}', '${U.studentA}')`);
  await expectRows("…or launches", U.adminA, "select count(*) n from lti_launches", 0);
  await db.exec(`insert into lti_scores (tenant_id, link_id, user_id, score_given, score_maximum) values ('${T.A}', '${L1}', '${U.studentA}', 8, 10), ('${T.A}', '${L2}', '${U.teacherA2}', 5, 10)`);
  await expectRows("a student sees their own score", U.studentA, "select count(*) n from lti_scores", 1);
  await expectRows("teachers see every score", U.teacherA, "select count(*) n from lti_scores", 2);
  await expectError("nobody writes scores by hand", U.teacherA, `insert into lti_scores (tenant_id, link_id, user_id, score_given) values ('${T.A}', '${L1}', '${U.studentA}', 10)`, /row-level security/);
  const h = await q(`select count(*) n from data_changes where table_name in ('lti_launches', 'lti_platform_keys')`);
  check("launches and keys stay out of the change history", Number(h[0].n) === 0, h[0]);

  await db.exec(`delete from lti_platform_keys; delete from lti_tools where id = '${TOOL}'; delete from class_groups where id = '${OTHER_CLASS}';`);
}
