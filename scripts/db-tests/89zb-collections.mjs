// Phase 14g-2: fee collections (promises, cases) and fundraising (appeals, gifts) — finance staff only; online gifts only via the server.
export default async function ({ db, q, expectRows, expectError, expectOk, check, U, T }) {
  const G = "a9000000-0000-0000-0000-000000000001", ADA = "a8000000-0000-0000-0000-000000000001";
  const CAMP = "fb000000-0000-0000-0000-000000000001";

  console.log("\nCollections: promises to pay and escalation");
  await expectOk("the bursar records a promise to pay", U.bursarA,
    `insert into fee_promises (tenant_id, guardian_id, student_ids, amount, promised_by, created_by) values ('${T.A}', '${G}', array['${ADA}']::uuid[], 50000, current_date + 7, '${U.bursarA}')`);
  await expectError("a promise must be for more than nothing", U.bursarA,
    `insert into fee_promises (tenant_id, guardian_id, amount, promised_by) values ('${T.A}', '${G}', 0, current_date)`, /check constraint/);
  await expectOk("…and raises the family's case", U.bursarA,
    `insert into fee_collection_cases (tenant_id, guardian_id, level) values ('${T.A}', '${G}', 2) on conflict (tenant_id, guardian_id) do update set level = 2`);
  await expectError("levels stop at a final notice", U.bursarA, `update fee_collection_cases set level = 5 where guardian_id = '${G}'`, /check constraint/);
  await expectRows("teachers can't see promises", U.teacherA, `select count(*) n from fee_promises`, 0);
  await expectRows("…or cases", U.teacherA, `select count(*) n from fee_collection_cases`, 0);
  await expectRows("parents can't see the school's collection notes", U.parentA, `select count(*) n from fee_promises`, 0);
  await expectRows("another school sees none", U.adminB, `select count(*) n from fee_promises`, 0);

  console.log("\nFundraising: appeals and gifts");
  await expectOk("the bursar opens an appeal", U.bursarA,
    `insert into fundraising_campaigns (id, tenant_id, title, slug, goal, status) values ('${CAMP}', '${T.A}', 'New lab', 'new-lab', 1000000, 'open')`);
  await expectError("slugs are web-safe", U.bursarA,
    `insert into fundraising_campaigns (tenant_id, title, slug) values ('${T.A}', 'Bad', 'Bad Slug!')`, /check constraint/);
  await expectOk("…and records a cash gift", U.bursarA,
    `insert into donations (tenant_id, campaign_id, donor_name, amount, status, method, paid_at) values ('${T.A}', '${CAMP}', 'Mr Bello', 200000, 'paid', 'cash', now())`);
  await expectOk("…and a pledge", U.bursarA,
    `insert into donations (tenant_id, campaign_id, donor_name, amount, kind, status, method) values ('${T.A}', '${CAMP}', 'Old Students Association', 300000, 'pledge', 'pledged', 'transfer')`);
  await expectError("staff can't record an online gift as paid (only the payment provider can)", U.bursarA,
    `insert into donations (tenant_id, campaign_id, donor_name, amount, status, method) values ('${T.A}', '${CAMP}', 'Fake', 999999, 'paid', 'online')`, /row-level security/);
  await q(`insert into donations (tenant_id, campaign_id, donor_name, amount, status, method, reference) values ('${T.A}', '${CAMP}', 'Online donor', 50000, 'pending', 'online', 'DON-TEST-1')`);
  await expectRows("…nor mark an online gift as paid", U.bursarA, `update donations set status = 'paid' where reference = 'DON-TEST-1' returning id`, 0);
  const [t] = await q(`select * from public.campaign_totals('${CAMP}')`);
  check("the appeal counts paid gifts as raised and pledges apart", Number(t.raised) === 200000 && Number(t.pledged) === 300000 && Number(t.donors) === 2, t);
  await expectRows("teachers can't see donors", U.teacherA, `select count(*) n from donations`, 0);
  await expectError("totals are for the server only", U.bursarA, `select * from public.campaign_totals('${CAMP}')`, /permission denied/);

  await db.exec(`delete from fee_promises where tenant_id = '${T.A}'; delete from fee_collection_cases where tenant_id = '${T.A}'; delete from fundraising_campaigns where tenant_id = '${T.A}'; delete from donations where tenant_id = '${T.A}';`);
}
