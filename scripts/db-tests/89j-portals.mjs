// Portals: students see their own fees when the school allows it, and the head's dashboard trend snapshots stay with leaders.
export default async function ({ db, q, expectRows, expectError, expectOk, check, U, T }) {
  const KID = "a8000000-0000-0000-0000-000000000001", OTHER = "a8000000-0000-0000-0000-000000000002";
  const INV = "ef000000-0000-0000-0000-000000000001", INV2 = "ef000000-0000-0000-0000-000000000002";

  console.log("\nStudent fees view");
  await db.exec(`insert into tenant_settings (tenant_id, school_name) values ('${T.A}', 'Alpha') on conflict (tenant_id) do nothing;
    insert into fee_invoices (id, tenant_id, student_id, invoice_no) values ('${INV}', '${T.A}', '${KID}', 'P12-1'), ('${INV2}', '${T.A}', '${OTHER}', 'P12-2');
    insert into fee_invoice_lines (invoice_id, tenant_id, description, amount) values ('${INV}', '${T.A}', 'Tuition', 50000), ('${INV2}', '${T.A}', 'Tuition', 60000);`);
  const d = await q(`select student_sees_fees s, kpi_targets t from tenant_settings where tenant_id = '${T.A}'`);
  check("students see fees by default", d[0].s === true && JSON.stringify(d[0].t) === "{}", d[0]);
  await expectRows("a student sees their own invoice", U.studentA, `select count(*) n from fee_invoices where id in ('${INV}', '${INV2}')`, 1);
  await expectRows("…and its lines", U.studentA, `select count(*) n from fee_invoice_lines where invoice_id in ('${INV}', '${INV2}')`, 1);
  await expectOk("a student's change to it does nothing", U.studentA, `update fee_invoices set amount_paid = 50000 where id = '${INV}'`);
  const paid = await q(`select amount_paid from fee_invoices where id = '${INV}'`);
  check("…so nothing is marked paid", Number(paid[0].amount_paid) === 0, paid[0]);
  await expectRows("another school's student sees nothing", U.adminB, `select count(*) n from fee_invoices where id in ('${INV}', '${INV2}')`, 0);
  await db.exec(`update tenant_settings set student_sees_fees = false where tenant_id = '${T.A}'`);
  await expectRows("when the school turns it off, the student sees no invoices", U.studentA, `select count(*) n from fee_invoices where id in ('${INV}', '${INV2}')`, 0);
  await expectRows("…or lines", U.studentA, `select count(*) n from fee_invoice_lines where invoice_id in ('${INV}', '${INV2}')`, 0);
  await expectRows("parents still see their child's", U.parentA, `select count(*) n from fee_invoices where id in ('${INV}', '${INV2}')`, 1);
  await db.exec(`update tenant_settings set student_sees_fees = true where tenant_id = '${T.A}'`);

  console.log("\nDashboard trends");
  await db.exec(`insert into kpi_snapshots (tenant_id, day, metrics) values ('${T.A}', '2026-10-14', '{"attendance_rate": 93.5}'), ('${T.A}', '2026-10-15', '{"attendance_rate": 95}'), ('${T.B}', '2026-10-15', '{"attendance_rate": 80}')`);
  await expectRows("the head sees their school's trend", U.adminA, "select count(*) n from kpi_snapshots", 2);
  await expectRows("the bursar does too", U.bursarA, "select count(*) n from kpi_snapshots", 2);
  await expectRows("teachers do not", U.teacherA, "select count(*) n from kpi_snapshots", 0);
  await expectRows("parents do not", U.parentA, "select count(*) n from kpi_snapshots", 0);
  await expectRows("another school sees only its own", U.adminB, "select count(*) n from kpi_snapshots", 1);
  await expectError("nobody writes snapshots by hand", U.adminA, `insert into kpi_snapshots (tenant_id, day) values ('${T.A}', '2026-10-16')`, /row-level security/);
  await expectOk("…and changes do nothing", U.adminA, `update kpi_snapshots set metrics = '{}' where tenant_id = '${T.A}'`);
  const k = await q(`select metrics->>'attendance_rate' r from kpi_snapshots where tenant_id = '${T.A}' and day = '2026-10-15'`);
  check("…so the figure stands", k[0].r === "95", k[0]);
  const logged = await q(`select count(*) n from data_changes where table_name = 'kpi_snapshots'`);
  check("snapshots are left out of the change history", Number(logged[0].n) === 0, logged[0]);

  await db.exec(`delete from kpi_snapshots; delete from fee_invoices where id in ('${INV}', '${INV2}');`);
}
