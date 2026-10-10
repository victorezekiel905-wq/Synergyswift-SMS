// Parent and community CRM: admins manage it; staff work their own tickets; families act only through the server.
export default async function ({ db, q, expectRows, expectError, expectOk, check, U, T }) {
  const G = "a9000000-0000-0000-0000-000000000001", KID = "a8000000-0000-0000-0000-000000000001";
  const TK = "b4000000-0000-0000-0000-000000000001", AL = "b4000000-0000-0000-0000-000000000002", PA = "b4000000-0000-0000-0000-000000000003";
  const SV = "b4000000-0000-0000-0000-000000000004", LEAD = "b4000000-0000-0000-0000-000000000005", RD = "b4000000-0000-0000-0000-000000000006";
  console.log("\nCommunity CRM");

  await expectOk("an admin saves a family segment", U.adminA, `insert into family_segments (tenant_id, name, rules) values ('${T.A}', 'Owing', '{"min_balance": 1000}')`);
  await expectOk("an admin drafts a survey", U.adminA, `insert into surveys (id, tenant_id, title, questions) values ('${SV}', '${T.A}', 'How are we doing?', '[{"id":"nps","type":"nps","label":"Recommend?"}]')`);
  await expectOk("an admin drafts a campaign", U.adminA, `insert into crm_campaigns (tenant_id, name, subject) values ('${T.A}', 'Open day', 'Come and see us')`);
  await expectOk("an admin adds an alumnus", U.adminA, `insert into alumni (id, tenant_id, full_name, graduation_year) values ('${AL}', '${T.A}', 'Old Student', 2015)`);
  await expectOk("an admin opens a re-enrolment round", U.adminA, `insert into reenrolment_rounds (id, tenant_id, title) values ('${RD}', '${T.A}', '2027/2028')`);
  await expectOk("the bursar adds a vendor", U.bursarA, `insert into crm_partners (id, tenant_id, name, kind) values ('${PA}', '${T.A}', 'Uniform Co', 'supplier')`);
  await expectRows("the bursar does not see surveys", U.bursarA, "select count(*) n from surveys", 0);
  await expectRows("teachers do not see segments, surveys, campaigns, alumni or partners", U.teacherA,
    "select (select count(*) from family_segments) + (select count(*) from surveys) + (select count(*) from crm_campaigns) + (select count(*) from alumni) + (select count(*) from crm_partners) n", 0);
  await expectRows("parents see none of it", U.parentA,
    "select (select count(*) from surveys) + (select count(*) from alumni) + (select count(*) from crm_partners) + (select count(*) from tickets) + (select count(*) from reenrolment_responses) n", 0);
  await expectRows("another school sees none of it", U.adminB,
    "select (select count(*) from family_segments) + (select count(*) from surveys) + (select count(*) from crm_campaigns) + (select count(*) from alumni) + (select count(*) from crm_partners) n", 0);
  await expectError("survey answers are recorded only by the server", U.adminA,
    `insert into survey_responses (tenant_id, survey_id, nps) values ('${T.A}', '${SV}', 10)`, /row-level security/);
  await expectError("parents cannot answer re-enrolment directly", U.parentA,
    `insert into reenrolment_responses (round_id, student_id, tenant_id, intent) values ('${RD}', '${KID}', '${T.A}', 'returning')`, /row-level security/);
  await expectError("an interaction must point at exactly one family, alumnus or partner", U.adminA,
    `insert into crm_interactions (tenant_id, guardian_id, alumni_id, body) values ('${T.A}', '${G}', '${AL}', 'x')`, /check constraint/);

  // Tickets are numbered by the server; staff then work the ones they raised or are assigned.
  await expectError("staff cannot file tickets directly", U.teacherA,
    `insert into tickets (tenant_id, ticket_no, subject, body) values ('${T.A}', 'X-1', 'Hi', 'x')`, /row-level security/);
  await db.exec(`insert into tickets (id, tenant_id, ticket_no, guardian_id, subject, body, assigned_to) values ('${TK}', '${T.A}', 'TKT-T-1', '${G}', 'Bus late', 'Every day', '${U.teacherA}')`);
  await expectRows("the assignee sees the ticket", U.teacherA, "select count(*) n from tickets", 1);
  await expectRows("other teachers do not", U.teacherA2, "select count(*) n from tickets", 0);
  await expectRows("admins see every ticket", U.adminA, "select count(*) n from tickets", 1);
  await expectOk("the assignee updates the status", U.teacherA, `update tickets set status = 'in_progress' where id = '${TK}'`);
  await expectError("…but cannot hand it to someone else", U.teacherA, `update tickets set assigned_to = '${U.teacherA2}' where id = '${TK}'`, /only a school admin/);
  await expectRows("other teachers cannot change it", U.teacherA2, `with u as (update tickets set status = 'closed' where id = '${TK}' returning 1) select count(*) n from u`, 0);
  await expectOk("an admin reassigns it", U.adminA, `update tickets set assigned_to = '${U.teacherA2}' where id = '${TK}'`);
  await expectOk("the new assignee replies", U.teacherA2, `insert into ticket_messages (tenant_id, ticket_id, author, author_id, body) values ('${T.A}', '${TK}', 'staff', '${U.teacherA2}', 'On it')`);
  await expectError("staff cannot write as the family", U.teacherA2, `insert into ticket_messages (tenant_id, ticket_id, author, author_id, body) values ('${T.A}', '${TK}', 'family', '${U.teacherA2}', 'Fake')`, /row-level security/);
  await expectError("the old assignee can no longer reply", U.teacherA, `insert into ticket_messages (tenant_id, ticket_id, author, author_id, body) values ('${T.A}', '${TK}', 'staff', '${U.teacherA}', 'Hi')`, /row-level security/);
  await expectRows("the bursar sees no tickets", U.bursarA, "select count(*) n from tickets", 0);

  await expectOk("a teacher logs a call with a family", U.teacherA, `insert into crm_interactions (tenant_id, guardian_id, kind, body, actor_id) values ('${T.A}', '${G}', 'call', 'Discussed homework', '${U.teacherA}')`);
  await expectRows("…and sees only their own log", U.teacherA2, "select count(*) n from crm_interactions", 0);
  await expectError("teachers cannot log alumni contacts", U.teacherA, `insert into crm_interactions (tenant_id, alumni_id, kind, body, actor_id) values ('${T.A}', '${AL}', 'call', 'x', '${U.teacherA}')`, /row-level security/);

  // Referral rewards: earned once when a referred family enrols.
  await db.exec(`insert into tenant_settings (tenant_id, referral_reward_amount, referral_reward_kind) values ('${T.A}', 5000, 'fee_discount')
    on conflict (tenant_id) do update set referral_reward_amount = 5000, referral_reward_kind = 'fee_discount';
    insert into admission_leads (id, tenant_id, parent_name, referred_by, source) values ('${LEAD}', '${T.A}', 'New Family', '${G}', 'referral');
    update admission_leads set stage = 'offered' where id = '${LEAD}';`);
  let n = await q(`select count(*)::int n from referral_rewards where lead_id = '${LEAD}'`);
  check("no reward before the referred family enrols", n[0].n === 0, n);
  await db.exec(`update admission_leads set stage = 'enrolled' where id = '${LEAD}'; update admission_leads set stage = 'enrolled', notes = 'again' where id = '${LEAD}';`);
  n = await q(`select count(*)::int n, max(amount)::int amount, max(kind) kind from referral_rewards where lead_id = '${LEAD}'`);
  check("enrolment earns the referrer one reward at the school's rate", n[0].n === 1 && n[0].amount === 5000 && n[0].kind === "fee_discount", n);
  await expectRows("the bursar sees referral rewards", U.bursarA, "select count(*) n from referral_rewards", 1);
  await expectRows("parents do not", U.parentA, "select count(*) n from referral_rewards", 0);

  await expectError("signed-in users cannot read attendance across the school", U.adminA, `select * from attendance_rates('${T.A}', current_date - 30)`, /permission denied/);
  const tok = await q(`select unsubscribe_token from guardians where id = '${G}'`);
  check("every family has an unsubscribe token", /^[0-9a-f]{32}$/.test(tok[0]?.unsubscribe_token ?? ""), tok);
  await expectRows("deleting a family's ticket removes its messages", U.adminA, `with d as (delete from tickets where id = '${TK}' returning 1) select count(*) n from d`, 1);
  const left = await q(`select count(*)::int n from ticket_messages where ticket_id = '${TK}'`);
  check("…none left behind", left[0].n === 0, left);
}
