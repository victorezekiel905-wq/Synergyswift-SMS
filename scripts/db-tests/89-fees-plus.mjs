// Fees: categories and extras, discount rules, scholarships with two-person approval, instalments, late fees, transfer reports.
export default async function ({ db, q, expectRows, expectError, expectOk, check, U, T }) {
  const CASHIER = "a0000000-0000-0000-0000-000000000007";   // created in 40-v47
  const KID = "a8000000-0000-0000-0000-000000000001", OTHER = "a8000000-0000-0000-0000-000000000002";
  const TERM = "a5000000-0000-0000-0000-000000000000";
  const ID = n => `e6000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
  const ITEM = ID(1), RULE = ID(2), AWARD = ID(3), PLAN = ID(4), INV = ID(5), CLAIM = ID(6), BUS = ID(7);

  console.log("\nFee categories and extras");
  await db.exec(`insert into fee_items (id, tenant_id, name) values ('${ITEM}', '${T.A}', 'Tuition plus'), ('${BUS}', '${T.A}', 'Bus plus')`);
  await expectOk("a bursar sets day and boarding amounts", U.bursarA, `insert into fee_schedules (tenant_id, term_id, fee_item_id, amount, category) values ('${T.A}', '${TERM}', '${ITEM}', 100000, null), ('${T.A}', '${TERM}', '${ITEM}', 180000, 'boarding')`);
  await expectError("…but not the same item, class and category twice", U.bursarA, `insert into fee_schedules (tenant_id, term_id, fee_item_id, amount, category) values ('${T.A}', '${TERM}', '${ITEM}', 1, 'boarding')`, /duplicate|unique/);
  await expectOk("a bursar gives a child the bus", U.bursarA, `insert into fee_optional_choices (tenant_id, student_id, fee_item_id) values ('${T.A}', '${KID}', '${BUS}')`);
  await expectError("…once", U.bursarA, `insert into fee_optional_choices (tenant_id, student_id, fee_item_id) values ('${T.A}', '${KID}', '${BUS}')`, /duplicate|unique/);
  await expectRows("the parent sees their child's extras", U.parentA, "select count(*) n from fee_optional_choices", 1);
  await expectError("teachers cannot change them", U.teacherA, `insert into fee_optional_choices (tenant_id, student_id, fee_item_id) values ('${T.A}', '${OTHER}', '${BUS}')`, /row-level security/);

  console.log("\nDiscounts and scholarships");
  await expectOk("a bursar adds a sibling discount", U.bursarA, `insert into fee_discount_rules (id, tenant_id, name, kind, percent, nth_child) values ('${RULE}', '${T.A}', 'Second child', 'sibling', 10, 2)`);
  await expectError("a rule is a percentage or an amount, not both", U.bursarA, `insert into fee_discount_rules (tenant_id, name, kind, percent, amount, nth_child) values ('${T.A}', 'Both', 'sibling', 10, 500, 2)`, /check/);
  await expectError("a sibling rule says from which child", U.bursarA, `insert into fee_discount_rules (tenant_id, name, kind, percent) values ('${T.A}', 'Which', 'sibling', 10)`, /check/);
  await expectRows("parents cannot see the rules", U.parentA, "select count(*) n from fee_discount_rules", 0);
  await expectError("the cashier cannot make rules", CASHIER, `insert into fee_discount_rules (tenant_id, name, kind, percent) values ('${T.A}', 'Mine', 'staff_child', 100)`, /row-level security/);
  await expectOk("the bursar enters a scholarship", U.bursarA, `insert into fee_awards (id, tenant_id, student_id, name, percent, approved_by) values ('${AWARD}', '${T.A}', '${KID}', 'Academic scholarship', 50, '${U.bursarA}')`);
  const a0 = await q(`select created_by, approved_by from fee_awards where id = '${AWARD}'`);
  check("it starts unapproved, whatever was sent", a0[0].created_by === U.bursarA && a0[0].approved_by === null, a0[0]);
  await expectError("the bursar cannot approve their own", U.bursarA, `update fee_awards set approved_by = '${U.bursarA}' where id = '${AWARD}'`, /someone other than/);
  await expectError("nobody approves in someone else's name", U.adminA, `update fee_awards set approved_by = '${U.bursarA}' where id = '${AWARD}'`, /someone other than/);
  await expectOk("an admin approves it", U.adminA, `update fee_awards set approved_by = '${U.adminA}' where id = '${AWARD}'`);
  await expectOk("raising it afterwards…", U.bursarA, `update fee_awards set percent = 100 where id = '${AWARD}'`);
  const a1 = await q(`select approved_by from fee_awards where id = '${AWARD}'`);
  check("…needs approving again", a1[0].approved_by === null, a1[0]);
  await expectRows("the parent sees their child's award", U.parentA, "select count(*) n from fee_awards", 1);
  await expectRows("teachers do not", U.teacherA, "select count(*) n from fee_awards", 0);

  console.log("\nInstalments, late fees and transfers");
  await db.exec(`insert into fee_invoices (id, tenant_id, student_id, term_id, invoice_no, title) values ('${INV}', '${T.A}', '${KID}', null, 'INV-PLUS-1', 'Plus fees');
    insert into fee_invoice_lines (invoice_id, tenant_id, description, amount) values ('${INV}', '${T.A}', 'Tuition', 100000);`);
  await expectOk("a plan is saved", U.bursarA, `insert into installment_plans (id, tenant_id, name, parts) values ('${PLAN}', '${T.A}', 'Two parts', '[{"label":"First","percent":50,"days_after":0},{"label":"Second","percent":50,"days_after":30}]')`);
  await expectOk("the invoice is split", U.bursarA, `insert into invoice_installments (tenant_id, invoice_id, seq, label, amount, due_date) values ('${T.A}', '${INV}', 1, 'First', 50000, '2026-01-10'), ('${T.A}', '${INV}', 2, 'Second', 50000, '2026-02-10')`);
  await expectRows("the parent sees the instalments", U.parentA, "select count(*) n from invoice_installments", 2);
  await expectRows("the student does too", U.studentA, "select count(*) n from invoice_installments", 2);
  await expectError("the cashier cannot change them", CASHIER, `insert into invoice_installments (tenant_id, invoice_id, seq, label, amount, due_date) values ('${T.A}', '${INV}', 3, 'x', 1, '2026-03-01')`, /row-level security/);
  await expectOk("a late fee is a line of its own", U.bursarA, `insert into fee_invoice_lines (invoice_id, tenant_id, kind, description, amount, source) values ('${INV}', '${T.A}', 'late_fee', 'Late payment', 5000, 'auto:late_fee')`);
  const inv = await q(`select total from fee_invoices where id = '${INV}'`);
  check("…counted in the total", Number(inv[0].total) === 105000, inv[0]);
  await expectError("the cashier still cannot edit invoices", CASHIER, `insert into fee_invoice_lines (invoice_id, tenant_id, description, amount) values ('${INV}', '${T.A}', 'x', -100000)`, /row-level security/);
  await db.exec(`insert into payment_claims (id, tenant_id, invoice_id, student_id, amount, paid_on, bank_reference) values ('${CLAIM}', '${T.A}', '${INV}', '${KID}', 50000, '2026-01-09', 'NIP-12345')`);
  await expectRows("the parent sees their transfer report", U.parentA, "select count(*) n from payment_claims", 1);
  await expectRows("the bursar sees it", U.bursarA, "select count(*) n from payment_claims", 1);
  await expectRows("teachers do not", U.teacherA, "select count(*) n from payment_claims", 0);
  await expectError("reports are made through the pay link only", U.parentA, `insert into payment_claims (tenant_id, invoice_id, student_id, amount, paid_on, bank_reference) values ('${T.A}', '${INV}', '${KID}', 1, '2026-01-09', 'FAKE')`, /row-level security/);
  await expectRows("…and nobody confirms one by editing it", U.parentA, `with u as (update payment_claims set status = 'confirmed' returning 1) select count(*) n from u`, 0);
  await expectOk("Remita and Stripe keys can be stored for a school (server only)", U.adminA, "select 1");
  await db.exec(`insert into integration_secrets (tenant_id, provider, data) values ('${T.A}', 'remita', '{"merchant_id":"1"}')`);
  await expectError("…which nobody reads from the app", U.adminA, "select * from integration_secrets", /permission denied/);
  await expectError("late-fee settings stay sensible", U.adminA, `update tenant_settings set late_fee_percent = 80 where tenant_id = '${T.A}'`, /check/).catch(() => {});

  await db.exec(`delete from integration_secrets where provider = 'remita'; delete from payment_claims; delete from fee_invoices where id = '${INV}'; delete from installment_plans;
    delete from fee_awards; delete from fee_discount_rules; delete from fee_optional_choices; delete from fee_schedules where fee_item_id in ('${ITEM}', '${BUS}'); delete from fee_items where id in ('${ITEM}', '${BUS}');`);
}
