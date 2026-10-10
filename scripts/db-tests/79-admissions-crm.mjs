// Admissions CRM: admissions staff and admins only; payments and entrance results are server-written.
export default async function ({ db, q, expectRows, expectError, expectOk, check, U, T }) {
  const OFFICER = "a0000000-0000-0000-0000-0000000000a1";
  const LEAD = "b2000000-0000-0000-0000-000000000001", APP = "b2000000-0000-0000-0000-000000000002", EV = "b2000000-0000-0000-0000-000000000003";
  console.log("\nAdmissions CRM");
  await db.exec(`insert into auth.users (id) values ('${OFFICER}');
    insert into users (id, tenant_id, email, full_name, role) values ('${OFFICER}', '${T.A}', 'adm@a', 'Admissions A', 'admissions_officer');`);

  await expectOk("an admissions officer adds a lead", OFFICER,
    `insert into admission_leads (id, tenant_id, parent_name, phone, source, owner_id) values ('${LEAD}', '${T.A}', 'Mrs Obi', '+2348031234567', 'facebook', '${OFFICER}')`);
  await expectOk("and logs a call", OFFICER, `insert into lead_activities (tenant_id, lead_id, kind, body, actor_id) values ('${T.A}', '${LEAD}', 'call', 'Asked about fees', '${OFFICER}')`);
  await expectRows("admins see leads", U.adminA, "select count(*) n from admission_leads", 1);
  await expectRows("teachers do not see leads", U.teacherA, "select count(*) n from admission_leads", 0);
  await expectRows("the bursar does not see leads", U.bursarA, "select count(*) n from admission_leads", 0);
  await expectRows("parents do not see leads", U.parentA, "select count(*) n from admission_leads", 0);
  await expectRows("another school does not see leads", U.adminB, "select count(*) n from admission_leads", 0);
  await expectError("teachers cannot add leads", U.teacherA, `insert into admission_leads (tenant_id, parent_name, source) values ('${T.A}', 'X Y', 'website')`, /row-level security/);
  await expectError("unknown sources are rejected", OFFICER, `insert into admission_leads (tenant_id, parent_name, source) values ('${T.A}', 'X Y', 'tiktok')`, /check constraint/);

  await expectOk("an application can carry campaign and referral details", OFFICER,
    `insert into applications (id, tenant_id, application_no, first_name, last_name, applying_for, guardian_name, guardian_phone, source, utm, referral_code, lead_id)
     values ('${APP}', '${T.A}', 'APP-T1', 'Ada', 'Obi', 'JSS1', 'Mrs Obi', '+2348031234567', 'facebook', '{"utm_campaign":"sept"}', 'ABCD1234', '${LEAD}')`);
  await expectOk("applications accept waitlisted, declined and expired", OFFICER, `update applications set status = 'waitlisted', waitlist_position = 1 where id = '${APP}'`);
  await expectError("payments are recorded only by the server", OFFICER,
    `insert into admission_payments (tenant_id, application_id, kind, amount, reference, status) values ('${T.A}', '${APP}', 'application_fee', 5000, 'ADM-FAKE', 'success')`, /row-level security/);
  await expectError("entrance results are recorded only by the server", OFFICER,
    `insert into entrance_attempts (tenant_id, application_id, exam_id, total_score) values ('${T.A}', '${APP}', 'ab000000-0000-0000-0000-000000000000', 100)`, /row-level security/);

  await expectOk("an officer creates a tour", OFFICER, `insert into admission_events (id, tenant_id, kind, title, starts_at, capacity) values ('${EV}', '${T.A}', 'tour', 'School tour', now() + interval '3 days', 8)`);
  await expectOk("and books a family", OFFICER, `insert into admission_bookings (tenant_id, event_id, lead_id, name, phone) values ('${T.A}', '${EV}', '${LEAD}', 'Mrs Obi', '+2348031234567')`);
  const SEQ = "b2000000-0000-0000-0000-000000000004";
  await expectOk("an officer creates a follow-up sequence", OFFICER, `insert into admission_sequences (id, tenant_id, name, stage) values ('${SEQ}', '${T.A}', 'Welcome', 'enquiry')`);
  await expectOk("with steps", OFFICER, `insert into admission_sequence_steps (sequence_id, position, delay_hours, channel, body) values ('${SEQ}', 1, 0, 'email', 'Hello {parent}')`);
  await expectRows("teachers cannot read sequence steps", U.teacherA, "select count(*) n from admission_sequence_steps", 0);
  await expectOk("letters", OFFICER, `insert into admission_templates (tenant_id, kind, subject, body) values ('${T.A}', 'offer', 'Offer', 'Dear {parent}')`);
  await expectOk("places per level", OFFICER, `insert into admission_capacity (tenant_id, level, seats) values ('${T.A}', 'JSS1', 60)`);
  await expectOk("marketing spend", OFFICER, `insert into admission_costs (tenant_id, month, source, amount) values ('${T.A}', '2026-09-01', 'facebook', 50000)`);
  await expectRows("another school sees none of it", U.adminB, "select (select count(*) from admission_events) + (select count(*) from admission_costs) + (select count(*) from admission_templates) n", 0);

  const codes = await q(`select referral_code from guardians where tenant_id = '${T.A}'`);
  check("every guardian gets a referral code", codes.length > 0 && codes.every(c => /^[0-9A-F]{8}$/.test(c.referral_code)), codes);
  await expectRows("deleting a lead removes its timeline", U.adminA, `with d as (delete from admission_leads where id = '${LEAD}' returning 1) select count(*) n from d`, 1);
  await expectRows("…and keeps the application", U.adminA, `select count(*) n from applications where id = '${APP}' and lead_id is null`, 1);
}
