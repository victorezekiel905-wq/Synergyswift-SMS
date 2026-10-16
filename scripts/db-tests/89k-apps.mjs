// Apps: each person's notification choices are their own, safety alerts cannot be turned off, and native app devices register for push.
export default async function ({ db, q, expectRows, expectError, expectOk, check, U, T }) {
  console.log("\nNotification choices");
  await expectOk("a teacher turns off fee and activity messages and sets quiet hours", U.teacherA,
    `insert into notification_prefs (tenant_id, user_id, muted, quiet_from, quiet_to) values ('${T.A}', '${U.teacherA}', array['fees','activities'], '21:00', '06:30')`);
  await expectRows("they see their own choices", U.teacherA, "select count(*) n from notification_prefs", 1);
  await expectRows("another teacher does not", U.teacherA2, "select count(*) n from notification_prefs", 0);
  await expectRows("nor does the head", U.adminA, "select count(*) n from notification_prefs", 0);
  await expectError("nobody saves choices for someone else", U.teacherA2,
    `insert into notification_prefs (tenant_id, user_id) values ('${T.A}', '${U.teacherA}')`, /row-level security/);
  await expectOk("…and changing someone else's does nothing", U.teacherA2, `update notification_prefs set muted = '{}'`);
  const p = await q(`select muted from notification_prefs where user_id = '${U.teacherA}'`);
  check("…so the teacher's choices stand", p[0].muted.length === 2, p[0]);
  await expectError("safety alerts cannot be turned off", U.teacherA, `update notification_prefs set muted = array['safety'] where user_id = '${U.teacherA}'`, /check constraint/);
  await expectError("quiet hours need a start and an end", U.teacherA, `update notification_prefs set quiet_to = null where user_id = '${U.teacherA}'`, /check constraint/);
  await expectError("one set of choices per person", U.teacherA, `insert into notification_prefs (tenant_id, user_id) values ('${T.A}', '${U.teacherA}')`, /duplicate|unique/);
  await expectError("signed-in users cannot write a parent's choices", U.parentA,
    `insert into notification_prefs (tenant_id, user_id, guardian_id) values ('${T.A}', '${U.parentA}', (select id from guardians limit 1))`, /row-level security|check constraint/);
  await expectRows("another school sees nothing", U.adminB, "select count(*) n from notification_prefs", 0);

  console.log("\nApp devices (written by the server)");
  const server = async (name, sql, re) => {
    try { await q(sql); check(name, !re, re ? "expected an error" : null); }
    catch (e) { check(name, Boolean(re && re.test(e.message)), e.message); }
  };
  await server("an Android phone registers with its Firebase token",
    `insert into push_subscriptions (tenant_id, user_id, endpoint, kind, platform) values ('${T.A}', '${U.teacherA}', 'fcm-token-abc', 'fcm', 'android')`);
  await server("a web device still needs its keys",
    `insert into push_subscriptions (tenant_id, user_id, endpoint) values ('${T.A}', '${U.teacherA}', 'https://push.example/x')`, /check constraint/);
  await server("…and a known platform",
    `insert into push_subscriptions (tenant_id, user_id, endpoint, kind, platform) values ('${T.A}', '${U.teacherA}', 'fcm-2', 'fcm', 'windows')`, /check constraint/);
  await expectRows("signed-in users never read device tokens", U.teacherA, "select count(*) n from push_subscriptions", 0);
  await server("outbox messages remember who they are for",
    `insert into message_outbox (tenant_id, channel, to_address, kind, body_text, recipient_user_id) values ('${T.A}', 'push', 'x', 'leave_decided', 'hi', '${U.teacherA}')`);

  await db.exec(`delete from message_outbox where to_address = 'x' and kind = 'leave_decided'; delete from push_subscriptions where endpoint like 'fcm-%'; delete from notification_prefs;`);
}
