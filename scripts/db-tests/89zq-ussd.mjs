// USSD for parents (migration 8200): a phone number reaches only its own children, schools can switch it off, server only.
export default async function ({ db, q, expectError, check, U, T }) {
  console.log("\nUSSD for parents");
  const gB = "b9000000-0000-0000-0000-000000000001";
  await db.exec(`update guardians set phone = '0803 123 4567' where id = 'a9000000-0000-0000-0000-000000000001';
    insert into guardians (id, tenant_id, full_name, phone) values ('${gB}', '${T.B}', 'Same parent at B', '+234-803-123-4567') on conflict (id) do update set phone = excluded.phone;
    insert into student_guardians (tenant_id, student_id, guardian_id) values ('${T.B}', 'b8000000-0000-0000-0000-000000000001', '${gB}') on conflict do nothing;
    update students set status = 'active' where id in ('a8000000-0000-0000-0000-000000000001', 'b8000000-0000-0000-0000-000000000001');
    insert into tenant_settings (tenant_id) values ('${T.A}'), ('${T.B}') on conflict (tenant_id) do nothing;`);
  const both = await q(`select tenant_id, first_name from public.ussd_children('+2348031234567') order by first_name`);
  check("the parent's own children at each school, whatever way the number was written", both.length === 2 && both.some(r => r.first_name === "Ada") && both.some(r => r.first_name === "Beta"), both);
  const none = await q(`select count(*)::int n from public.ussd_children('+2348099999999')`);
  check("a number on no record gets nobody", none[0].n === 0, none);
  const short = await q(`select count(*)::int n from public.ussd_children('12345')`);
  check("a short or made-up number never matches", short[0].n === 0, short);
  await db.exec(`update tenant_settings set ussd_enabled = false where tenant_id = '${T.B}'`);
  const onlyA = await q(`select first_name from public.ussd_children('08031234567')`);
  check("a school that switched USSD off is left out", onlyA.length === 1 && onlyA[0].first_name === "Ada", onlyA);
  await expectError("signed-in people can't look up who owns a phone number", U.parentA, `select * from public.ussd_children('08031234567')`, /permission denied/);
  await db.exec(`update tenant_settings set ussd_enabled = true where tenant_id = '${T.B}';
    delete from student_guardians where guardian_id = '${gB}'; delete from guardians where id = '${gB}';
    update guardians set phone = null where id = 'a9000000-0000-0000-0000-000000000001';`);
}
