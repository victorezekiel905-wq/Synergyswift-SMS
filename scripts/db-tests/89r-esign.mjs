// E-signatures: who can see requests, signatures that cannot be changed, matching fingerprints, any-parent-per-child forms and contracts accepted on signing.
export default async function ({ db, q, expectRows, expectError, expectOk, check, U, T }) {
  const KID = "a8000000-0000-0000-0000-000000000001", T1 = "ad000000-0000-0000-0000-000000000001";
  const H = "a".repeat(64), H2 = "b".repeat(64);
  const RQ = "f5000000-0000-0000-0000-000000000001", RC = "f5000000-0000-0000-0000-000000000002";
  const S1 = "f5000000-0000-0000-0000-000000000011", S2 = "f5000000-0000-0000-0000-000000000012", SC = "f5000000-0000-0000-0000-000000000013";
  const CON = "f5000000-0000-0000-0000-000000000021", G2 = "f5000000-0000-0000-0000-000000000031";
  const server = async (name, sql, re) => {
    try { await q(sql); check(name, !re, re ? "expected an error" : null); }
    catch (e) { check(name, Boolean(re && re.test(e.message)), e.message); }
  };
  const [{ id: G1 }] = await q(`select g.id from guardians g join users u on u.id = g.user_id where u.id = '${U.parentA}' limit 1`);
  await db.exec(`insert into guardians (id, tenant_id, full_name) values ('${G2}', '${T.A}', 'Second parent') on conflict do nothing;
    insert into student_guardians (tenant_id, student_id, guardian_id, relation) values ('${T.A}', '${KID}', '${G2}', 'father') on conflict do nothing;`);

  console.log("\nE-signatures: a parents' form");
  await db.exec(`insert into signature_requests (id, tenant_id, title, body, rule, content_hash, created_by) values ('${RQ}', '${T.A}', 'Medical consent', 'I consent to first aid.', 'any_per_child', '${H}', '${U.teacherA}');
    insert into signature_signers (id, tenant_id, request_id, signer_type, guardian_id, student_id, name) values
      ('${S1}', '${T.A}', '${RQ}', 'guardian', '${G1}', '${KID}', 'Parent A'), ('${S2}', '${T.A}', '${RQ}', 'guardian', '${G2}', '${KID}', 'Second parent');`);
  await expectRows("the sender sees their request", U.teacherA, "select count(*) n from signature_requests", 1);
  await expectRows("another teacher does not", U.teacherA2, "select count(*) n from signature_requests", 0);
  await expectRows("the head does", U.adminA, "select count(*) n from signature_requests", 1);
  await expectRows("the parent sees the request they must sign", U.parentA, "select count(*) n from signature_requests", 1);
  await expectRows("…and only their own signer line", U.parentA, "select count(*) n from signature_signers", 1);
  await expectRows("students see nothing", U.studentA, "select count(*) n from signature_requests", 0);
  await expectError("nobody signs through the database directly", U.parentA, `insert into signature_signers (tenant_id, request_id, signer_type, name) values ('${T.A}', '${RQ}', 'external', 'Me')`, /row-level security/);
  await expectOk("…and a parent's update does nothing", U.parentA, `update signature_signers set status = 'signed' where id = '${S1}'`);
  const s0 = await q(`select status from signature_signers where id = '${S1}'`);
  check("…so it is still unsigned", s0[0].status === "pending", s0[0]);
  await server("a signature must match what was sent", `update signature_signers set status = 'signed', signed_at = now(), typed_name = 'Parent A', signed_hash = '${H2}' where id = '${S1}'`, /changed since it was sent/);
  await server("one parent signs (on the server)", `update signature_signers set status = 'signed', signed_at = now(), typed_name = 'Parent A', signed_hash = '${H}', ip = '1.2.3.4' where id = '${S1}'`);
  const st = await q(`select (select status from signature_signers where id = '${S2}') other, (select status from signature_requests where id = '${RQ}') req, (select completed_at is not null from signature_requests where id = '${RQ}') done`);
  check("the other parent is no longer needed", st[0].other === "not_needed", st[0]);
  check("…and the form is complete", st[0].req === "completed" && st[0].done, st[0]);
  await server("a signature cannot be changed", `update signature_signers set typed_name = 'Someone else' where id = '${S1}'`, /cannot be changed/);
  await expectOk("…and staff deleting it does nothing", U.adminA, `delete from signature_requests where id = '${RQ}'`);
  const kept = await q(`select count(*) n from signature_requests where id = '${RQ}'`);
  check("…so the signed form is kept", Number(kept[0].n) === 1, kept[0]);
  await expectError("a sent request cannot be edited", U.teacherA, `update signature_requests set body = 'Different text' where id = '${RQ}'`, /cannot be edited|closed/);

  console.log("\nE-signatures: a contract");
  await db.exec(`insert into staff_contracts (id, tenant_id, staff_id, kind, starts_on, status) values ('${CON}', '${T.A}', '${T1}', 'permanent', '2026-09-01', 'active');
    insert into signature_requests (id, tenant_id, title, body, kind, staff_contract_id, content_hash, created_by) values ('${RC}', '${T.A}', 'Employment contract', 'Terms…', 'contract', '${CON}', '${H}', '${U.adminA}');
    insert into signature_signers (id, tenant_id, request_id, signer_type, user_id, name) values ('${SC}', '${T.A}', '${RC}', 'staff', '${U.teacherA}', 'Teacher A');`);
  await expectRows("the teacher sees the contract to sign", U.teacherA, `select count(*) n from signature_requests where id = '${RC}'`, 1);
  await server("a staff signer needs their account", `insert into signature_signers (tenant_id, request_id, signer_type, name) values ('${T.A}', '${RC}', 'staff', 'Nobody')`, /check constraint/);
  await server("the teacher signs", `update signature_signers set status = 'signed', signed_at = now(), typed_name = 'Teacher A', signed_hash = '${H}' where id = '${SC}'`);
  const c = await q(`select accepted_at is not null a from staff_contracts where id = '${CON}'`);
  check("…and the contract is accepted in HR", c[0].a, c[0]);
  await expectError("a finished request cannot be reopened", U.adminA, `update signature_requests set status = 'open' where id = '${RC}'`, /closed/);
  const r = await q(`select status from signature_requests where id = '${RC}'`);
  check("a completed request stays completed", r[0].status === "completed", r[0]);
  await expectRows("another school sees nothing", U.adminB, "select count(*) n from signature_requests", 0);

  await db.exec(`delete from signature_requests; delete from staff_contracts where id = '${CON}'; delete from student_guardians where guardian_id = '${G2}'; delete from guardians where id = '${G2}';`);
}
