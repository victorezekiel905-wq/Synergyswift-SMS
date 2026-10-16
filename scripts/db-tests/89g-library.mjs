// Library: lending rules, the loan limit, reservations held for the next reader, renewals, fines and lost books.
export default async function ({ db, q, expectRows, expectError, expectOk, check, U, T }) {
  const KID = "a8000000-0000-0000-0000-000000000001", OTHER = "a8000000-0000-0000-0000-000000000002";
  const T1 = "ad000000-0000-0000-0000-000000000001";          // Teacher A's staff record
  const ID = n => `ec000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
  const B1 = ID(1), B2 = ID(2), E1 = ID(3);
  const old = await q(`select library_max_loans, library_fine_per_day from tenant_settings where tenant_id = '${T.A}'`);
  // Room for exactly one more loan for this student (other tests may have lent them books already).
  const open = await q(`select count(*) n from library_loans where student_id = '${KID}' and returned_at is null`);
  await db.exec(`update tenant_settings set library_max_loans = ${Number(open[0].n) + 1} where tenant_id = '${T.A}'`);

  console.log("\nLending");
  await expectOk("the librarian adds books and an e-book", U.adminA, `insert into library_books (id, tenant_id, title, total_copies, available_copies, price) values ('${B1}', '${T.A}', 'Things Fall Apart', 2, 2, 2000), ('${B2}', '${T.A}', 'Arrow of God', 1, 1, 1500)`);
  await expectOk("…and an e-book", U.adminA, `insert into library_books (id, tenant_id, title, format, access, total_copies, available_copies) values ('${E1}', '${T.A}', 'Teaching guide', 'ebook', 'staff', 0, 0)`);
  await expectRows("families can browse the catalogue", U.parentA, `select count(*) n from library_books where id in ('${B1}', '${B2}', '${E1}')`, 3);
  await expectError("teachers cannot lend books", U.teacherA, `select public.library_issue('${B1}', '${KID}', null, 14)`, /forbidden/);
  await expectOk("the librarian lends one to a student", U.adminA, `select public.library_issue('${B1}', '${KID}', null, 14)`);
  await expectError("…who may not go over the loan limit", U.adminA, `select public.library_issue('${B2}', '${KID}', null, 14)`, /books out/);
  await expectError("e-books are read, not lent", U.adminA, `select public.library_issue('${E1}', '${OTHER}', null, 14)`, /digital/);

  console.log("\nReservations");
  await expectOk("a teacher reserves the last copy, which is held for them", U.teacherA, `select public.library_reserve('${B1}', null, '${T1}')`);
  const r0 = await q(`select status from library_reservations where book_id = '${B1}' and staff_id = '${T1}'`);
  check("…ready at once", r0[0]?.status === "ready", r0[0]);
  await expectError("nobody else can borrow the held copy", U.adminA, `select public.library_issue('${B1}', '${OTHER}', null, 14)`, /held for readers/);
  await expectOk("the teacher collects it", U.adminA, `select public.library_issue('${B1}', null, '${T1}', 14)`);
  const r1 = await q(`select status from library_reservations where book_id = '${B1}' and staff_id = '${T1}'`);
  check("…and the hold is marked collected", r1[0]?.status === "collected", r1[0]);
  await expectError("students reserve only for themselves", U.studentA, `select public.library_reserve('${B1}', '${OTHER}', null)`, /forbidden/);
  await expectError("…and not a book they already have", U.studentA, `select public.library_reserve('${B1}', '${KID}', null)`, /already have/);
  await expectOk("the librarian queues another reader", U.adminA, `select public.library_reserve('${B1}', '${OTHER}', null)`);
  await expectError("…once", U.adminA, `select public.library_reserve('${B1}', '${OTHER}', null)`, /already reserved/);
  await expectRows("readers' parents see their reservations, not others'", U.parentA, "select count(*) n from library_reservations where status = 'waiting'", 0);
  await expectError("a book someone is waiting for cannot be renewed", U.studentA, `select public.library_renew((select id from library_loans where student_id = '${KID}' and book_id = '${B1}' and returned_at is null))`, /waiting/);

  console.log("\nReturns, fines and lost books");
  await db.exec(`update library_loans set due_at = now() - interval '3 days' + interval '1 hour' where student_id = '${KID}' and book_id = '${B1}' and returned_at is null`);
  await expectOk("the late book comes back", U.adminA, `select public.library_return((select id from library_loans where student_id = '${KID}' and book_id = '${B1}' and returned_at is null), 100)`);
  const l0 = await q(`select fine_amount, fine_status from library_loans where student_id = '${KID}' and book_id = '${B1}'`);
  check("…with a fine for three late days", Number(l0[0].fine_amount) === 300 && l0[0].fine_status === "owed", l0[0]);
  const r2 = await q(`select status, expires_at from library_reservations where book_id = '${B1}' and student_id = '${OTHER}'`);
  check("…and the copy goes to the next reader in the queue", r2[0]?.status === "ready" && r2[0].expires_at !== null, r2[0]);
  await expectError("nobody edits a fine by hand", U.adminA, `update library_loans set fine_amount = 0 where student_id = '${KID}' and book_id = '${B1}'`, /only by issuing/);
  await expectError("…or a due date", U.adminA, `update library_loans set due_at = now() + interval '1 year' where staff_id = '${T1}'`, /only by issuing/);
  await expectOk("the fine is paid", U.adminA, `update library_loans set fine_status = 'paid' where student_id = '${KID}' and book_id = '${B1}'`);
  await expectError("…once", U.adminA, `update library_loans set fine_status = 'waived' where student_id = '${KID}' and book_id = '${B1}'`, /paid or waived/);
  await expectRows("readers cannot settle their own fines", U.studentA, `with u as (update library_loans set fine_status = 'waived' returning 1) select count(*) n from u`, 0);
  await expectOk("the teacher's copy is lost", U.adminA, `select public.library_lost((select id from library_loans where staff_id = '${T1}' and returned_at is null))`);
  const l1 = await q(`select fine_amount, fine_status from library_loans where staff_id = '${T1}' and book_id = '${B1}'`);
  const b0 = await q(`select total_copies from library_books where id = '${B1}'`);
  check("…they owe its price and the library has one copy fewer", Number(l1[0].fine_amount) === 2000 && l1[0].fine_status === "owed" && Number(b0[0].total_copies) === 1, { l1: l1[0], b0: b0[0] });
  await db.exec(`update library_reservations set expires_at = now() - interval '1 hour' where book_id = '${B1}' and status = 'ready'`);
  const ex = await q(`select public.library_expire_holds() n`);
  check("holds not collected in time lapse", Number(ex[0].n) === 1, ex[0]);

  await db.exec(`delete from library_books where id in ('${B1}', '${B2}', '${E1}');
    update tenant_settings set library_max_loans = ${Number(old[0].library_max_loans)}, library_fine_per_day = ${Number(old[0].library_fine_per_day)} where tenant_id = '${T.A}';`);
}
