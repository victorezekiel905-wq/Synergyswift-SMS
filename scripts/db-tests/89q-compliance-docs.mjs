// Compliance: documents seen by the right people, versions retiring each other, policy read-receipts, the single central record and inspection progress.
export default async function ({ db, q, expectRows, expectError, expectOk, check, U, T }) {
  const FAM = "f4000000-0000-0000-0000-0000000000f1";
  const D1 = "f4000000-0000-0000-0000-000000000001", D2 = "f4000000-0000-0000-0000-000000000002", LEAD = "f4000000-0000-0000-0000-000000000003", PAR = "f4000000-0000-0000-0000-000000000004";
  const T1 = "ad000000-0000-0000-0000-000000000001";
  console.log("\nSchool documents");
  await expectOk("an admin uploads the safeguarding policy as a draft", U.adminA,
    `insert into school_documents (id, tenant_id, family_id, title, category, requires_ack) values ('${D1}', '${T.A}', '${FAM}', 'Safeguarding policy', 'policy', true)`);
  await expectRows("staff do not see drafts", U.teacherA, `select count(*) n from school_documents where id = '${D1}'`, 0);
  await expectOk("…approves it", U.adminA, `update school_documents set status = 'approved' where id = '${D1}'`);
  const a = await q(`select approved_at is not null a, approved_by = '${U.adminA}' b from school_documents where id = '${D1}'`);
  check("…stamped with who and when", a[0].a && a[0].b, a[0]);
  await expectRows("now staff see it", U.teacherA, `select count(*) n from school_documents where id = '${D1}'`, 1);
  await expectRows("parents do not see staff documents", U.parentA, `select count(*) n from school_documents where id = '${D1}'`, 0);
  await expectError("teachers cannot add documents", U.teacherA, `insert into school_documents (tenant_id, title, category) values ('${T.A}', 'My doc', 'other')`, /row-level security/);
  await expectOk("a leaders-only document", U.adminA, `insert into school_documents (id, tenant_id, title, category, visibility, status) values ('${LEAD}', '${T.A}', 'Fire certificate', 'certificate', 'leaders', 'approved')`);
  await expectRows("…is hidden from teachers", U.teacherA, `select count(*) n from school_documents where id = '${LEAD}'`, 0);
  await expectOk("a parents' document", U.adminA, `insert into school_documents (id, tenant_id, title, category, visibility, status) values ('${PAR}', '${T.A}', 'Complaints procedure', 'policy', 'parents', 'approved')`);
  await expectRows("…is seen by parents", U.parentA, `select count(*) n from school_documents where id = '${PAR}'`, 1);

  console.log("\nVersions and read-receipts");
  await expectOk("a teacher confirms reading the policy", U.teacherA, `insert into document_acknowledgements (document_id, user_id, tenant_id) values ('${D1}', '${U.teacherA}', '${T.A}')`);
  await expectError("…but not for someone else", U.teacherA, `insert into document_acknowledgements (document_id, user_id, tenant_id) values ('${D1}', '${U.teacherA2}', '${T.A}')`, /row-level security/);
  await expectError("…nor for a document that needs no confirming", U.teacherA2, `insert into document_acknowledgements (document_id, user_id, tenant_id) values ('${PAR}', '${U.teacherA2}', '${T.A}')`, /row-level security/);
  await expectRows("teachers see only their own confirmations", U.teacherA2, "select count(*) n from document_acknowledgements", 0);
  await expectRows("the head sees who has read it", U.adminA, "select count(*) n from document_acknowledgements", 1);
  await expectOk("version 2 is uploaded and approved", U.adminA,
    `insert into school_documents (id, tenant_id, family_id, version, title, category, status, requires_ack) values ('${D2}', '${T.A}', '${FAM}', 2, 'Safeguarding policy', 'policy', 'approved', true)`);
  const v = await q(`select status from school_documents where id = '${D1}'`);
  check("…and version 1 is superseded", v[0].status === "superseded", v[0]);
  await expectRows("staff now see only the current version", U.teacherA, `select count(*) n from school_documents where family_id = '${FAM}'`, 1);
  await expectError("one version number per document", U.adminA, `insert into school_documents (tenant_id, family_id, version, title, category) values ('${T.A}', '${FAM}', 2, 'Dup', 'policy')`, /duplicate|unique/);
  await expectRows("another school sees nothing", U.adminB, "select count(*) n from school_documents", 0);

  console.log("\nSingle central record");
  await expectError("teachers cannot record checks", U.teacherA, `insert into staff_checks (tenant_id, staff_id, kind, checked_on) values ('${T.A}', '${T1}', 'police_check', '2026-01-10')`, /row-level security/);
  await expectOk("the head records a police check", U.adminA, `insert into staff_checks (tenant_id, staff_id, kind, checked_on, reference_no) values ('${T.A}', '${T1}', 'police_check', '2026-01-10', 'NPF/123')`);
  await expectError("a cleared check needs its date", U.adminA, `insert into staff_checks (tenant_id, staff_id, kind) values ('${T.A}', '${T1}', 'identity')`, /check constraint/);
  await expectOk("…a pending one does not", U.adminA, `insert into staff_checks (tenant_id, staff_id, kind, outcome) values ('${T.A}', '${T1}', 'references', 'pending')`);
  await expectRows("the teacher sees their own checks", U.teacherA, "select count(*) n from staff_checks", 2);
  await expectRows("other teachers do not", U.teacherA2, "select count(*) n from staff_checks", 0);

  console.log("\nInspection readiness");
  await expectOk("the head marks a requirement met", U.adminA, `insert into inspection_progress (tenant_id, framework, requirement_key, status, owner_id) values ('${T.A}', 'bso', 'welfare.safeguarding_policy', 'met', '${U.teacherA}')`);
  await expectRows("staff can see progress", U.teacherA2, "select count(*) n from inspection_progress", 1);
  await expectOk("the owner updates their item", U.teacherA, `update inspection_progress set notes = 'Reviewed with governors' where requirement_key = 'welfare.safeguarding_policy'`);
  await expectOk("others' changes do nothing", U.teacherA2, `update inspection_progress set status = 'not_started' where requirement_key = 'welfare.safeguarding_policy'`);
  const p = await q(`select status, notes from inspection_progress where requirement_key = 'welfare.safeguarding_policy'`);
  check("…so it stays met, with the owner's note", p[0].status === "met" && p[0].notes === "Reviewed with governors", p[0]);
  await expectError("teachers cannot add items for themselves", U.teacherA2, `insert into inspection_progress (tenant_id, framework, requirement_key, status) values ('${T.A}', 'bso', 'x.y', 'met')`, /row-level security/);

  await db.exec(`delete from inspection_progress; delete from staff_checks; delete from school_documents;`);
}
