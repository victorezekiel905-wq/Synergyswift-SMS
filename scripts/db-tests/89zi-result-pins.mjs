// Phase 14l: result-checker PINs (hashed, one per serial, staff who run results and fees see use) and performance samples (platform only).
export default async function ({ db, q, expectRows, expectError, check, U, T }) {
  const ID = n => `ed000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
  const BATCH = ID(1);
  const server = async (name, sql, re) => {
    try { await q(sql); check(name, !re, re ? "expected an error" : null); }
    catch (e) { check(name, Boolean(re && re.test(e.message)), e.message); }
  };
  console.log("\nResult PINs");
  await db.exec(`insert into result_pin_batches (id, tenant_id, name, max_uses, pins) values ('${BATCH}', '${T.A}', 'First term', 5, 2);
    insert into result_pins (tenant_id, batch_id, serial, pin_hash) values ('${T.A}', '${BATCH}', 'AS-000001', 'hash-one'), ('${T.A}', '${BATCH}', 'AS-000002', 'hash-two');`);
  await server("serial numbers are unique in a school", `insert into result_pins (tenant_id, batch_id, serial, pin_hash) values ('${T.A}', '${BATCH}', 'AS-000001', 'hash-three')`, /duplicate|unique/);
  await server("…and so are PINs", `insert into result_pins (tenant_id, batch_id, serial, pin_hash) values ('${T.A}', '${BATCH}', 'AS-000009', 'hash-one')`, /duplicate|unique/);
  await server("a batch holds at most 5,000 PINs", `insert into result_pin_batches (tenant_id, name, pins) values ('${T.A}', 'Too many', 6000)`, /check/);
  await expectRows("the admin sees the batch and its PINs", U.adminA, `select count(*) n from result_pins`, 2);
  await expectRows("the bursar (who sells the cards) does too", U.bursarA, `select count(*) n from result_pin_batches`, 1);
  await expectRows("a teacher does not", U.teacherA, `select count(*) n from result_pins`, 0);
  await expectRows("parents and students do not", U.parentA, `select (select count(*) from result_pins) + (select count(*) from result_pin_batches) n`, 0);
  await expectRows("another school sees none", U.adminB, `select count(*) n from result_pins`, 0);
  await expectError("nobody makes PINs directly (the server does, and keeps only the hash)", U.adminA, `insert into result_pins (tenant_id, batch_id, serial, pin_hash) values ('${T.A}', '${BATCH}', 'AS-000003', 'x')`, /row-level security/);
  await expectError("the guessing log is not readable", U.adminA, `select count(*) from result_pin_tries`, /permission denied/);

  console.log("\nPerformance samples");
  await server("the server records page speed and slow calls", `insert into perf_samples (kind, name, path, value, rating) values ('vital', 'LCP', '/school/results', 2100, 'good'), ('slow_call', 'report_cards', null, 1300, null)`);
  await server("only known kinds", `insert into perf_samples (kind, name, value) values ('guess', 'x', 1)`, /check/);
  await expectError("schools cannot read them", U.adminA, `select count(*) from perf_samples`, /permission denied/);

  await db.exec(`delete from result_pin_batches where id = '${BATCH}'; delete from perf_samples;`);
}
