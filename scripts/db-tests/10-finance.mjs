// Fees, payments, payroll and inventory permission checks.
export default async function ({ db, q, expectRows, expectError, expectOk, check, U, T }) {
  const S1 = "a8000000-0000-0000-0000-000000000001";
  console.log("\nFinance");
  await expectOk("bursar creates a fee item", U.bursarA, `insert into fee_items (tenant_id, name) values ('${T.A}', 'Tuition')`);
  await expectError("teacher cannot create fee items", U.teacherA, `insert into fee_items (tenant_id, name) values ('${T.A}', 'Bus')`, /row-level security/);
  await expectRows("teacher cannot see fee items", U.teacherA, "select count(*) n from fee_items", 0);
  await expectError("authenticated users cannot mint document numbers", U.bursarA, `select next_doc_no('${T.A}', 'inv')`, /permission denied/);

  const [{ no }] = await q(`select next_doc_no('${T.A}', 'inv') as no`);
  await db.exec(`insert into fee_invoices (id, tenant_id, student_id, term_id, invoice_no) values
    ('ac000000-0000-0000-0000-000000000001', '${T.A}', '${S1}', 'a5000000-0000-0000-0000-000000000000', '${no}');
    insert into fee_invoice_lines (invoice_id, tenant_id, description, amount) values
    ('ac000000-0000-0000-0000-000000000001', '${T.A}', 'Tuition', 100000),
    ('ac000000-0000-0000-0000-000000000001', '${T.A}', 'Sibling discount', -10000);`);
  const inv = (await q("select total, status from fee_invoices where id = 'ac000000-0000-0000-0000-000000000001'"))[0];
  check("invoice total is derived from its lines (discount applied)", Number(inv.total) === 90000 && inv.status === "issued", inv);

  await db.exec(`insert into fee_payments (tenant_id, invoice_id, student_id, amount, method, reference) values
    ('${T.A}', 'ac000000-0000-0000-0000-000000000001', '${S1}', 40000, 'cash', 'cash-1')`);
  const part = (await q("select amount_paid, status from fee_invoices where id = 'ac000000-0000-0000-0000-000000000001'"))[0];
  const rct = (await q("select receipt_no from fee_payments where reference = 'cash-1'"))[0];
  check("part payment updates status and balance", part.status === "part_paid" && Number(part.amount_paid) === 40000, part);
  check("successful payments get a receipt number", /^RCT-\d{4}-\d{6}$/.test(rct.receipt_no ?? ""), rct);
  await db.exec(`insert into fee_payments (tenant_id, invoice_id, student_id, amount, method, reference, status) values
    ('${T.A}', 'ac000000-0000-0000-0000-000000000001', '${S1}', 50000, 'online', 'psk-1', 'pending')`);
  const pend = (await q("select status from fee_invoices where id = 'ac000000-0000-0000-0000-000000000001'"))[0];
  check("pending online payments do not count until verified", pend.status === "part_paid", pend);
  await db.exec(`update fee_payments set status = 'success' where reference = 'psk-1'`);
  const paid = (await q("select status from fee_invoices where id = 'ac000000-0000-0000-0000-000000000001'"))[0];
  check("verified payment settles the invoice", paid.status === "paid", paid);

  await expectRows("parent sees their child's invoice", U.parentA, "select count(*) n from fee_invoices", 1);
  await expectRows("parent sees their child's payments", U.parentA, "select count(*) n from fee_payments", 2);
  await expectRows("teacher cannot see invoices", U.teacherA, "select count(*) n from fee_invoices", 0);
  await expectRows("other school cannot see invoices", U.adminB, "select count(*) n from fee_invoices", 0);
  await expectError("parents cannot record payments themselves", U.parentA,
    `insert into fee_payments (tenant_id, invoice_id, student_id, amount, method, reference) values ('${T.A}', 'ac000000-0000-0000-0000-000000000001', '${S1}', 1, 'cash', 'fake')`, /row-level security/);

  console.log("\nPayroll");
  await db.exec(`insert into staff (id, tenant_id, user_id, staff_no, full_name) values ('ad000000-0000-0000-0000-000000000001', '${T.A}', '${U.teacherA}', 'T-1', 'Teacher A')`);
  await expectOk("bursar prepares a payroll run", U.bursarA, `insert into payroll_runs (id, tenant_id, period, created_by) values ('ae000000-0000-0000-0000-000000000001', '${T.A}', '2026-09', '${U.bursarA}')`);
  await expectOk("bursar adds a payslip to the draft", U.bursarA, `insert into payslips (run_id, tenant_id, staff_id, basic, gross, total_deductions, net) values ('ae000000-0000-0000-0000-000000000001', '${T.A}', 'ad000000-0000-0000-0000-000000000001', 100000, 120000, 20000, 100000)`);
  await expectRows("staff cannot see a draft payslip", U.teacherA, "select count(*) n from payslips", 0);
  await expectError("bursar cannot approve payroll", U.bursarA, "update payroll_runs set status = 'approved' where period = '2026-09'", /only the principal/);
  await expectOk("admin approves payroll prepared by someone else", U.adminA, "update payroll_runs set status = 'approved' where period = '2026-09'");
  await expectRows("staff sees own payslip once approved", U.teacherA, "select count(*) n from payslips", 1);
  await expectError("approved payslips cannot be edited", U.bursarA, "update payslips set net = 1", /row-level security/);

  console.log("\nInventory");
  await db.exec(`insert into inventory_items (id, tenant_id, name) values ('af000000-0000-0000-0000-000000000001', '${T.A}', 'Chalk')`);
  await expectError("teacher cannot move stock", U.teacherA, "select inventory_move('af000000-0000-0000-0000-000000000001', 'in', 10, 'x', null)", /forbidden/);
  await expectOk("bursar receives stock", U.bursarA, "select inventory_move('af000000-0000-0000-0000-000000000001', 'in', 10, 'delivery', 'PO-1')");
  await expectError("stock cannot go negative", U.bursarA, "select inventory_move('af000000-0000-0000-0000-000000000001', 'out', 11, 'issue', null)", /not enough stock/);
  await expectRows("staff can look up stock", U.teacherA, "select count(*) n from inventory_items", 1);

}
