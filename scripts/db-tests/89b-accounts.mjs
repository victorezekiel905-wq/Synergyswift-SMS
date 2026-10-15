// Accounts: budgets with a second approver, petty cash floats, the chart of accounts, balanced journals and closed periods.
export default async function ({ db, q, expectRows, expectError, expectOk, check, U, T }) {
  const CASHIER = "a0000000-0000-0000-0000-000000000007";   // created in 40-v47
  const ID = n => `e7000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
  const BUDGET = ID(1), BUDGET2 = ID(2), FLOAT = ID(3), BANK = ID(4), OPENING = ID(5), OTHER_ACC = ID(6), JNL = ID(7), JNL2 = ID(8), MINE = ID(9);

  console.log("\nBudgets");
  await expectOk("a bursar drafts a budget", U.bursarA, `insert into budgets (id, tenant_id, name, starts_on, ends_on, status, created_by) values ('${BUDGET}', '${T.A}', '2026/2027', '2026-09-01', '2027-08-31', 'approved', '${U.adminA}')`);
  const b0 = await q(`select status, created_by from budgets where id = '${BUDGET}'`);
  check("it starts as a draft by its author, whatever was sent", b0[0].status === "draft" && b0[0].created_by === U.bursarA, b0[0]);
  await expectOk("…with lines", U.bursarA, `insert into budget_lines (tenant_id, budget_id, kind, category, amount) values ('${T.A}', '${BUDGET}', 'income', 'Tuition', 5000000), ('${T.A}', '${BUDGET}', 'expense', 'Utilities', 400000)`);
  await expectError("a category appears once per kind", U.bursarA, `insert into budget_lines (tenant_id, budget_id, kind, category, amount) values ('${T.A}', '${BUDGET}', 'income', 'Tuition', 1)`, /duplicate|unique/);
  await expectError("the bursar cannot approve it", U.bursarA, `update budgets set status = 'approved' where id = '${BUDGET}'`, /only the principal or a school admin/);
  await expectOk("an admin approves it", U.adminA, `update budgets set status = 'approved' where id = '${BUDGET}'`);
  const b1 = await q(`select approved_by from budgets where id = '${BUDGET}'`);
  check("…and is recorded as the approver", b1[0].approved_by === U.adminA, b1[0]);
  await expectError("an approved budget's lines are fixed", U.bursarA, `update budget_lines set amount = 1 where budget_id = '${BUDGET}'`, /reopen the budget/);
  await expectError("…and so is the budget", U.bursarA, `update budgets set name = 'Changed' where id = '${BUDGET}'`, /reopen the budget/);
  await expectError("…which cannot be deleted either", U.adminA, `delete from budgets where id = '${BUDGET}'`, /reopen the budget/);
  await expectError("the bursar cannot reopen it", U.bursarA, `update budgets set status = 'draft' where id = '${BUDGET}'`, /only the principal or a school admin can reopen/);
  await expectOk("an admin can", U.adminA, `update budgets set status = 'draft' where id = '${BUDGET}'`);
  await expectOk("an admin drafts one too", U.adminA, `insert into budgets (id, tenant_id, name, starts_on, ends_on) values ('${BUDGET2}', '${T.A}', 'Admin plan', '2026-01-01', '2026-12-31')`);
  await expectError("…but cannot approve their own", U.adminA, `update budgets set status = 'approved' where id = '${BUDGET2}'`, /someone other than/);
  await expectError("a budget cannot end before it starts", U.bursarA, `insert into budgets (tenant_id, name, starts_on, ends_on) values ('${T.A}', 'Back', '2026-02-01', '2026-01-01')`, /check/);
  await expectRows("teachers do not see budgets", U.teacherA, "select count(*) n from budgets", 0);
  await expectRows("the other school does not either", U.adminB, "select count(*) n from budgets", 0);

  console.log("\nPetty cash");
  await expectOk("a bursar opens a float with a custodian", U.bursarA, `insert into petty_cash_floats (id, tenant_id, name, custodian_id, imprest, balance) values ('${FLOAT}', '${T.A}', 'Front office', '${U.teacherA}', 5000, 999999)`);
  const f0 = await q(`select balance from petty_cash_floats where id = '${FLOAT}'`);
  check("its balance comes from its records, not what was sent", Number(f0[0].balance) === 0, f0[0]);
  await expectOk("nor can it be typed in later", U.bursarA, `update petty_cash_floats set balance = 999999 where id = '${FLOAT}'`);
  const fx = await q(`select balance from petty_cash_floats where id = '${FLOAT}'`);
  check("…the balance stays put", Number(fx[0].balance) === 0, fx[0]);
  await expectOk("the bursar tops it up", U.bursarA, `insert into petty_cash_moves (tenant_id, float_id, kind, amount, on_date) values ('${T.A}', '${FLOAT}', 'topup', 5000, '2026-03-01')`);
  const f1 = await q(`select balance from petty_cash_floats where id = '${FLOAT}'`);
  check("…and the balance follows the records", Number(f1[0].balance) === 5000, f1[0]);
  await expectRows("the custodian sees their float", U.teacherA, "select count(*) n from petty_cash_floats", 1);
  await expectRows("another teacher does not", U.teacherA2, "select count(*) n from petty_cash_floats", 0);
  await expectRows("nor does a parent", U.parentA, "select count(*) n from petty_cash_floats", 0);
  await expectOk("the custodian records a spend", U.teacherA, `select public.petty_cash_spend('${FLOAT}', 1500, 'Supplies', 'Chalk and markers', 'Stationers', '2026-03-02', null)`);
  const e = await q(`select e.method, e.amount, e.recorded_by, f.balance from expenses e, petty_cash_floats f where e.description = 'Chalk and markers' and f.id = '${FLOAT}'`);
  check("…which is an expense paid from the float", e[0]?.method === "petty_cash" && Number(e[0].amount) === 1500 && e[0].recorded_by === U.teacherA && Number(e[0].balance) === 3500, e[0]);
  await expectError("nobody spends more than the float holds", U.teacherA, `select public.petty_cash_spend('${FLOAT}', 10000, 'Supplies', 'Projector', null, '2026-03-02', null)`, /not enough in the petty cash float/);
  await expectError("another teacher cannot spend from it", U.teacherA2, `select public.petty_cash_spend('${FLOAT}', 10, 'Supplies', 'Pens', null, null, null)`, /not found|only the custodian/);
  await expectError("receipts must be this school's files", U.teacherA, `select public.petty_cash_spend('${FLOAT}', 10, 'Supplies', 'Pens', null, null, '${T.B}/x.jpg')`, /receipt not found/);
  await expectError("the custodian cannot top up their own float", U.teacherA, `insert into petty_cash_moves (tenant_id, float_id, kind, amount) values ('${T.A}', '${FLOAT}', 'topup', 100000)`, /row-level security/);
  await expectError("spends only come through the spend function", U.bursarA, `insert into petty_cash_moves (tenant_id, float_id, kind, amount) values ('${T.A}', '${FLOAT}', 'spend', 1)`, /row-level security|check/);
  await expectRows("records are never edited", U.bursarA, `with u as (update petty_cash_moves set amount = 1 returning 1) select count(*) n from u`, 0);
  await expectRows("…or deleted", U.bursarA, `with u as (delete from petty_cash_moves returning 1) select count(*) n from u`, 0);
  await expectRows("the custodian still cannot see other expenses", U.teacherA, "select count(*) n from expenses", 0);
  await expectOk("the custodian counts the cash", U.teacherA, `insert into petty_cash_counts (tenant_id, float_id, counted, expected) values ('${T.A}', '${FLOAT}', 3400, 3400)`);
  const c = await q(`select expected, counted_by from petty_cash_counts where float_id = '${FLOAT}'`);
  check("…against the balance the records give", Number(c[0].expected) === 3500 && c[0].counted_by === U.teacherA, c[0]);
  await expectError("another teacher cannot count it", U.teacherA2, `insert into petty_cash_counts (tenant_id, float_id, counted) values ('${T.A}', '${FLOAT}', 1)`, /row-level security/);
  await expectOk("the bursar books the shortage", U.bursarA, `insert into petty_cash_moves (tenant_id, float_id, kind, amount, note) values ('${T.A}', '${FLOAT}', 'adjust', -100, 'count')`);
  await expectOk("deleting the spend's expense puts the money back", U.bursarA, `delete from expenses where description = 'Chalk and markers'`);
  const f2 = await q(`select balance from petty_cash_floats where id = '${FLOAT}'`);
  check("…in the float", Number(f2[0].balance) === 4900, f2[0]);
  await expectOk("a closed float…", U.bursarA, `update petty_cash_floats set active = false where id = '${FLOAT}'`);
  await expectError("…takes no more spends", U.teacherA, `select public.petty_cash_spend('${FLOAT}', 10, 'Supplies', 'Pens', null, null, null)`, /closed/);

  console.log("\nChart of accounts and journals");
  await db.exec(`insert into ledger_accounts (id, tenant_id, code, name, type, system_key) values ('${BANK}', '${T.A}', '1010', 'Bank', 'asset', 'bank'), ('${OPENING}', '${T.A}', '3000', 'Opening balance equity', 'equity', 'opening'),
    ('${OTHER_ACC}', '${T.B}', '1010', 'Bank', 'asset', 'bank')`);
  await expectError("built-in accounts are added by the system only", U.bursarA, `insert into ledger_accounts (tenant_id, code, name, type, system_key) values ('${T.A}', '1999', 'Fake', 'asset', 'receivables')`, /added by the system/);
  await expectOk("a bursar adds an account", U.bursarA, `insert into ledger_accounts (id, tenant_id, code, name, type) values ('${MINE}', '${T.A}', '1500', 'Furniture and equipment', 'asset')`);
  await expectError("codes are unique", U.bursarA, `insert into ledger_accounts (tenant_id, code, name, type) values ('${T.A}', '1500', 'Again', 'asset')`, /duplicate|unique/);
  await expectOk("built-in accounts can be renamed", U.bursarA, `update ledger_accounts set name = 'Main bank account' where id = '${BANK}'`);
  await expectError("…but keep their type", U.bursarA, `update ledger_accounts set type = 'expense' where id = '${BANK}'`, /cannot change/);
  await expectError("…and are never deleted", U.bursarA, `delete from ledger_accounts where id = '${BANK}'`, /not deleted/);
  await expectRows("teachers do not see the chart", U.teacherA, "select count(*) n from ledger_accounts", 0);
  await expectError("the cashier cannot add accounts", CASHIER, `insert into ledger_accounts (tenant_id, code, name, type) values ('${T.A}', '9', 'x', 'asset')`, /row-level security/);

  await expectOk("a bursar drafts a journal", U.bursarA, `insert into journal_entries (id, tenant_id, entry_date, memo, status, entry_no) values ('${JNL}', '${T.A}', '2026-01-01', 'Opening balances', 'posted', 'FAKE-1')`);
  const j0 = await q(`select status, entry_no from journal_entries where id = '${JNL}'`);
  check("it starts as an unnumbered draft", j0[0].status === "draft" && j0[0].entry_no === null, j0[0]);
  await expectOk("…with lines", U.bursarA, `insert into journal_lines (tenant_id, entry_id, account_id, debit, credit) values ('${T.A}', '${JNL}', '${BANK}', 100000, 0), ('${T.A}', '${JNL}', '${OPENING}', 0, 90000)`);
  await expectError("a line is a debit or a credit", U.bursarA, `insert into journal_lines (tenant_id, entry_id, account_id, debit, credit) values ('${T.A}', '${JNL}', '${BANK}', 5, 5)`, /check/);
  await expectError("lines use this school's accounts", U.bursarA, `insert into journal_lines (tenant_id, entry_id, account_id, debit) values ('${T.A}', '${JNL}', '${OTHER_ACC}', 5)`, /account not found/);
  await expectError("an unbalanced journal cannot be posted", U.bursarA, `update journal_entries set status = 'posted' where id = '${JNL}'`, /must be equal/);
  await expectOk("once it balances…", U.bursarA, `update journal_lines set credit = 100000 where entry_id = '${JNL}' and account_id = '${OPENING}'`);
  await expectOk("…it is posted", U.bursarA, `update journal_entries set status = 'posted' where id = '${JNL}'`);
  const j1 = await q(`select entry_no, posted_by from journal_entries where id = '${JNL}'`);
  check("…with a number and who posted it", /^JNL-\d{4}-\d{6}$/.test(j1[0].entry_no) && j1[0].posted_by === U.bursarA, j1[0]);
  await expectError("posted journals never change", U.bursarA, `update journal_entries set memo = 'Edited' where id = '${JNL}'`, /reversing journal/);
  await expectError("…or lose lines", U.bursarA, `delete from journal_lines where entry_id = '${JNL}'`, /reversing journal/);
  await expectError("…or gain them", U.bursarA, `insert into journal_lines (tenant_id, entry_id, account_id, debit) values ('${T.A}', '${JNL}', '${BANK}', 1)`, /reversing journal/);
  await expectError("…or get deleted", U.adminA, `delete from journal_entries where id = '${JNL}'`, /reversing journal/);
  await expectOk("a second draft…", U.bursarA, `insert into journal_entries (id, tenant_id, entry_date, memo) values ('${JNL2}', '${T.A}', '2026-02-01', 'One line')`);
  await expectOk("…with one line", U.bursarA, `insert into journal_lines (tenant_id, entry_id, account_id, debit) values ('${T.A}', '${JNL2}', '${MINE}', 1)`);
  await expectError("…cannot be posted", U.bursarA, `update journal_entries set status = 'posted' where id = '${JNL2}'`, /two lines/);
  await expectError("an account with journal lines is not deleted", U.bursarA, `delete from ledger_accounts where id = '${MINE}'`, /journal lines/);
  await expectOk("a draft can be deleted", U.bursarA, `delete from journal_entries where id = '${JNL2}'`);
  await expectOk("…and then the unused account too", U.bursarA, `delete from ledger_accounts where id = '${MINE}'`);
  await expectRows("teachers do not see journals", U.teacherA, "select count(*) n from journal_entries", 0);
  await expectRows("the other school does not either", U.adminB, "select count(*) n from journal_entries", 0);

  console.log("\nClosing the books");
  await expectRows("the bursar cannot close the books", U.bursarA, `with u as (update tenant_settings set books_closed_until = '2026-01-31' where tenant_id = '${T.A}' returning 1) select count(*) n from u`, 0);
  await expectOk("an admin closes January", U.adminA, `update tenant_settings set books_closed_until = '2026-01-31' where tenant_id = '${T.A}'`);
  await expectError("no expenses dated in a closed period", U.bursarA, `insert into expenses (tenant_id, category, description, amount, spent_on) values ('${T.A}', 'Utilities', 'Late bill', 100, '2026-01-15')`, /books are closed/);
  await expectOk("…but later ones are fine", U.bursarA, `insert into expenses (tenant_id, category, description, amount, spent_on) values ('${T.A}', 'Utilities', 'February bill', 100, '2026-02-01')`);
  await expectError("an expense cannot be moved back into it", U.bursarA, `update expenses set spent_on = '2026-01-20' where description = 'February bill'`, /books are closed/);
  await expectError("no journals dated in it", U.bursarA, `insert into journal_entries (tenant_id, entry_date, memo) values ('${T.A}', '2026-01-10', 'Backdated')`, /books are closed/);
  await db.exec(`update petty_cash_floats set active = true where id = '${FLOAT}'`);
  await expectError("petty cash dated in it is refused", U.bursarA, `insert into petty_cash_moves (tenant_id, float_id, kind, amount, on_date) values ('${T.A}', '${FLOAT}', 'topup', 1, '2026-01-05')`, /books are closed/);

  await db.exec(`update tenant_settings set books_closed_until = null where tenant_id = '${T.A}';
    delete from expenses where description in ('February bill');
    delete from journal_lines where tenant_id in ('${T.A}', '${T.B}'); delete from journal_entries where tenant_id in ('${T.A}', '${T.B}');
    delete from ledger_mappings; delete from ledger_accounts where tenant_id in ('${T.A}', '${T.B}');
    delete from petty_cash_floats where id = '${FLOAT}'; delete from budgets where tenant_id = '${T.A}';`);
}
