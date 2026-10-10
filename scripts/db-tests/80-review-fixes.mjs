// Full-spec review fixes: the lead webhook key is server-only, and bookings check seats under a lock.
export default async function ({ db, q, expectRows, expectError, check, U, T }) {
  const EV = "b3000000-0000-0000-0000-000000000001", HIDDEN = "b3000000-0000-0000-0000-000000000002";
  console.log("\nReview fixes");
  await db.exec(`insert into admission_secrets (tenant_id, lead_webhook_key) values ('${T.A}', 'abcdef0123456789abcdef01')
    on conflict (tenant_id) do update set lead_webhook_key = excluded.lead_webhook_key`);
  const cols = await q(`select 1 from information_schema.columns where table_name = 'tenant_settings' and column_name = 'lead_webhook_key'`);
  check("the webhook key is no longer in tenant_settings", cols.length === 0, cols);
  await expectError("admins cannot read the webhook key", U.adminA, "select * from admission_secrets", /permission denied/);
  await expectError("students cannot read the webhook key", U.studentA, "select * from admission_secrets", /permission denied/);

  await db.exec(`insert into admission_events (id, tenant_id, kind, title, starts_at, capacity) values ('${EV}', '${T.A}', 'tour', 'Small tour', now() + interval '2 days', 3);
    insert into admission_events (id, tenant_id, kind, title, starts_at, capacity, published) values ('${HIDDEN}', '${T.A}', 'interview', 'Interview', now() + interval '2 days', 1, false);`);
  const book = (phone, party, staff = false) => q(`select public.book_admission_event('${EV}', null, 'Parent', '${phone}', null, ${party}, ${staff}) t`);
  const tok = await book("+2348000000001", 2);
  check("a family books two seats", typeof tok[0]?.t === "string" && tok[0].t.length > 0, tok);
  let err = "";
  try { await book("+2348000000001", 1); } catch (e) { err = e.message; }
  check("the same phone cannot book twice", /already booked/.test(err), err);
  err = "";
  try { await book("+2348000000002", 2); } catch (e) { err = e.message; }
  check("a booking past capacity is refused", /full/.test(err), err);
  await book("+2348000000003", 1);
  await expectRows("the last seat can still be taken", U.adminA, `select coalesce(sum(party_size), 0) n from admission_bookings where event_id = '${EV}'`, 3);

  err = "";
  try { await q(`select public.book_admission_event('${HIDDEN}', null, 'Parent', '+2348000000004', null, 1)`); } catch (e) { err = e.message; }
  check("the public cannot book an unpublished session", /not available/.test(err), err);
  const staff = await q(`select public.book_admission_event('${HIDDEN}', null, 'Parent', '+2348000000004', null, 1, true) t`);
  check("staff can book an unpublished session", !!staff[0]?.t, staff);
  await expectError("signed-in users cannot call the booking function", U.adminA,
    `select public.book_admission_event('${EV}', null, 'X', '+2348000000009', null, 1)`, /permission denied/);
}
