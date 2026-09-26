// v47: two-factor enforcement, messaging, push, wallet, cover, live bus.
export default async function ({ db, as, q, expectRows, expectError, expectOk, check, setAal, U, T }) {
  const S1 = "a8000000-0000-0000-0000-000000000001";
  const G1 = "a9000000-0000-0000-0000-000000000001";
  const cashier = "a0000000-0000-0000-0000-000000000007";
  await db.exec(`insert into auth.users (id) values ('${cashier}');
    insert into users (id, tenant_id, email, full_name, role) values ('${cashier}', '${T.A}', 'c@a', 'Cashier A', 'cashier');
    insert into tenant_settings (tenant_id, school_name) values ('${T.A}', 'Alpha') on conflict (tenant_id) do nothing;`);

  console.log("\nTwo-factor sign-in");
  const st = await as(U.platform, () => q("select platform_admin_state() s"));
  check("platform admin without a second factor is told to verify", st[0].s === "mfa_required", st[0]);
  setAal("aal2");
  const st2 = await as(U.platform, () => q("select platform_admin_state() s"));
  check("platform admin with a second factor is let in", st2[0].s === "ok", st2[0]);
  setAal("aal1");
  const none = await as(U.adminA, () => q("select platform_admin_state() s"));
  check("a school admin is not a platform admin", none[0].s === "none", none[0]);

  await db.exec(`update tenant_settings set require_mfa = 'admins' where tenant_id = '${T.A}'`);
  await expectRows("school requires MFA for admins: admin without it is locked out", U.adminA, "select count(*) n from students", 0);
  const ms = await as(U.adminA, () => q("select my_account_state() s"));
  check("the app is told a second factor is needed", ms[0].s.state === "mfa_required", ms[0].s);
  await expectRows("bursar counts as an admin for MFA", U.bursarA, "select count(*) n from fee_invoices", 0);
  await expectRows("teachers are not affected by the admins-only setting", U.teacherA, "select count(*) n from students", 2);
  setAal("aal2");
  await expectRows("admin with a second factor gets access", U.adminA, "select count(*) n from students", 2);
  setAal("aal1");
  await db.exec(`update tenant_settings set require_mfa = 'staff' where tenant_id = '${T.A}'`);
  await expectRows("school requires MFA for all staff: teacher is locked out", U.teacherA, "select count(*) n from students", 0);
  await expectRows("parents never need a second factor", U.parentA, "select count(*) n from students", 1);
  await expectRows("other schools are unaffected", U.adminB, "select count(*) n from students", 1);
  await db.exec(`update tenant_settings set require_mfa = 'off' where tenant_id = '${T.A}'`);

  console.log("\nTwo-way messaging");
  await db.exec(`insert into conversations (id, tenant_id, guardian_id, student_id, staff_user_id, subject, started_by)
      values ('c1000000-0000-0000-0000-000000000001', '${T.A}', '${G1}', '${S1}', '${U.teacherA}', 'Homework', 'guardian');
    insert into conversation_messages (tenant_id, conversation_id, sender_kind, sender_name, body)
      values ('${T.A}', 'c1000000-0000-0000-0000-000000000001', 'guardian', 'Parent A', 'Hello');`);
  await expectRows("the teacher in the thread sees it", U.teacherA, "select count(*) n from conversation_messages", 1);
  await expectRows("other teachers cannot read it", U.teacherA2, "select count(*) n from conversations", 0);
  await expectRows("school admin can review it for safeguarding", U.adminA, "select count(*) n from conversations", 1);
  await expectRows("the parent sees their own thread", U.parentA, "select count(*) n from conversation_messages", 1);
  await expectRows("another school sees nothing", U.adminB, "select count(*) n from conversations", 0);
  await expectError("messages cannot be written directly from the browser", U.teacherA,
    `insert into conversation_messages (tenant_id, conversation_id, sender_kind, sender_name, body) values ('${T.A}', 'c1000000-0000-0000-0000-000000000001', 'staff', 'T', 'x')`, /row-level security/);
  await expectRows("nobody can delete a message", U.adminA, "with d as (delete from conversation_messages returning 1) select count(*) n from d", 0);
  await expectRows("nobody can edit a message", U.teacherA, "with d as (update conversation_messages set body = 'changed' returning 1) select count(*) n from d", 0);

  console.log("\nPush subscriptions");
  await db.exec(`insert into push_subscriptions (tenant_id, guardian_id, endpoint, p256dh, auth) values ('${T.A}', '${G1}', 'https://push.example/1', 'k', 'a')`);
  await expectRows("push subscriptions are server-only", U.adminA, "select count(*) n from push_subscriptions", 0);

  console.log("\nCashless wallet");
  await expectError("teachers cannot top up wallets", U.teacherA, `select wallet_credit('${S1}', 1000, 'topup', 'cash', 'CASH-1', 'Pocket money')`, /forbidden/);
  await expectOk("bursar records a cash top-up", U.bursarA, `select wallet_credit('${S1}', 1000, 'topup', 'cash', 'CASH-1', 'Pocket money')`);
  await expectError("a reference cannot be used twice", U.bursarA, `select wallet_credit('${S1}', 1000, 'topup', 'cash', 'CASH-1', 'Again')`, /duplicate key/);
  await expectError("the cashier cannot top up", cashier, `select wallet_credit('${S1}', 500, 'topup', 'cash', 'CASH-2', 'x')`, /forbidden/);
  await expectOk("cashier charges a purchase", cashier, `select wallet_charge('${S1}', 300, '[{"name":"Juice","qty":1,"price":300}]', 'Tuck shop', 'POS-1')`);
  await expectError("cannot spend more than the balance", cashier, `select wallet_charge('${S1}', 800, '[]', 'Tuck shop', 'POS-2')`, /insufficient balance/);
  await db.exec(`update wallets set daily_limit = 500 where student_id = '${S1}'`);
  await expectError("the parent's daily limit is enforced", cashier, `select wallet_charge('${S1}', 300, '[]', 'Tuck shop', 'POS-3')`, /daily spending limit/);
  await db.exec(`update wallets set daily_limit = null, frozen = true where student_id = '${S1}'`);
  await expectError("a frozen wallet cannot be charged", cashier, `select wallet_charge('${S1}', 100, '[]', 'Tuck shop', 'POS-4')`, /frozen/);
  await db.exec(`update wallets set frozen = false where student_id = '${S1}'`);
  await expectError("teachers cannot charge wallets", U.teacherA, `select wallet_charge('${S1}', 100, '[]', 'x', 'POS-5')`, /forbidden/);
  await expectRows("parent sees the balance and every transaction", U.parentA, "select count(*) n from wallet_transactions", 2);
  await expectRows("student sees their own wallet", U.studentA, "select count(*) n from wallets", 1);
  await expectRows("other teachers cannot see wallets", U.teacherA, "select count(*) n from wallets", 0);
  await expectRows("parents cannot change a balance", U.parentA, "with d as (update wallets set balance = 99999 returning 1) select count(*) n from d", 0);
  const bal = await q(`select balance from wallets where student_id = '${S1}'`);
  check("balance is exactly 1000 - 300", Number(bal[0].balance) === 700, bal[0]);
  await expectError("online top-ups can only be settled by the server", U.parentA, "select wallet_settle(gen_random_uuid())", /permission denied/);
  await expectRows("another school sees no wallets", U.adminB, "select count(*) n from wallet_transactions", 0);

  console.log("\nStaff cover");
  const [entry] = await q(`select id from timetable_entries where teacher_id = '${U.teacherA}' limit 1`);
  await db.exec(`insert into timetable_entries (id, tenant_id, class_group_id, day, period_id, teacher_id)
    values ('c2000000-0000-0000-0000-000000000001', '${T.A}', 'a2000000-0000-0000-0000-000000000009', 1, 'b1000000-0000-0000-0000-000000000001', '${U.teacherA2}')`);
  const coverSql = (entryId, who, date = "2026-09-21") =>
    `insert into cover_assignments (tenant_id, date, timetable_entry_id, period_id, absent_user_id, cover_user_id) values ('${T.A}', '${date}', '${entryId}', 'b1000000-0000-0000-0000-000000000001', null, '${who}')`;
  await expectError("a teacher teaching then cannot cover", U.adminA, coverSql(entry.id, U.teacherA2), /teaching their own lesson/);
  await expectOk("admin assigns a free member of staff", U.adminA, coverSql(entry.id, U.adminA));
  await expectError("nobody covers two lessons at once", U.adminA, coverSql("c2000000-0000-0000-0000-000000000001", U.adminA), /duplicate key/);
  await expectError("teachers cannot assign cover", U.teacherA, coverSql(entry.id, U.bursarA, "2026-10-05"), /row-level security/);
  await db.exec(`insert into staff_absences (tenant_id, user_id, starts_on, ends_on) values ('${T.A}', '${U.bursarA}', '2026-09-28', '2026-09-28')`);
  await expectError("an absent member of staff cannot cover", U.adminA, coverSql(entry.id, U.bursarA, "2026-09-28"), /absent on this day/);
  await expectRows("staff can see the cover list", U.teacherA2, "select count(*) n from cover_assignments", 1);
  await expectRows("parents cannot see cover", U.parentA, "select count(*) n from cover_assignments", 0);

  console.log("\nLive bus");
  await db.exec(`insert into transport_routes (id, tenant_id, name) values ('c3000000-0000-0000-0000-000000000001', '${T.A}', 'Route 1'), ('c3000000-0000-0000-0000-000000000002', '${T.A}', 'Route 2');
    insert into transport_assignments (student_id, tenant_id, route_id) values ('${S1}', '${T.A}', 'c3000000-0000-0000-0000-000000000001');
    insert into transport_live (route_id, tenant_id, trip, lat, lng) values ('c3000000-0000-0000-0000-000000000001', '${T.A}', 'morning', 6.5, 3.3),
      ('c3000000-0000-0000-0000-000000000002', '${T.A}', 'morning', 6.6, 3.4);`);
  await expectRows("parent sees only their child's bus", U.parentA, "select count(*) n from transport_live", 1);
  await expectRows("student sees their own bus", U.studentA, "select count(*) n from transport_live", 1);
  await expectRows("staff see every bus", U.teacherA, "select count(*) n from transport_live", 2);
  await expectRows("another school sees no buses", U.adminB, "select count(*) n from transport_live", 0);
}
