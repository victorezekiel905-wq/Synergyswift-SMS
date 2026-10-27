// Phase 14g-3: two-way WhatsApp — finding the family by phone, WhatsApp threads, each message kept once.
export default async function ({ db, q, expectError, check, U, T }) {
  const G = "a9000000-0000-0000-0000-000000000001";
  console.log("\nWhatsApp inbox: finding the family");
  await db.exec(`update guardians set phone = '0803 123 4567' where id = '${G}'`);
  const m1 = await q(`select * from public.guardians_by_phone('2348031234567')`);
  check("a number typed as 0803 123 4567 matches WhatsApp's 2348031234567", m1.length === 1 && m1[0].guardian_id === G && m1[0].tenant_id === T.A, m1);
  const m2 = await q(`select * from public.guardians_by_phone('+234 803 123 4567')`);
  check("…and +234 803 123 4567", m2.length === 1, m2);
  const none = await q(`select * from public.guardians_by_phone('12345')`);
  check("a short number matches nobody", none.length === 0, none);
  await db.exec(`insert into tenant_settings (tenant_id, whatsapp_inbox) values ('${T.A}', false) on conflict (tenant_id) do update set whatsapp_inbox = false`);
  const off = await q(`select * from public.guardians_by_phone('2348031234567')`);
  check("a school that turned the WhatsApp inbox off is left out", off.length === 0, off);
  await db.exec(`update tenant_settings set whatsapp_inbox = true where tenant_id = '${T.A}'`);
  await expectError("signed-in users can't look families up by phone", U.adminA, `select * from public.guardians_by_phone('2348031234567')`, /permission denied/);
  await expectError("nor read unmatched WhatsApp messages", U.adminA, `select * from whatsapp_unmatched`, /permission denied/);

  console.log("\nWhatsApp inbox: threads and messages");
  const [c] = await q(`insert into conversations (tenant_id, guardian_id, subject, started_by, channel) values ('${T.A}', '${G}', 'WhatsApp', 'guardian', 'whatsapp') returning id`);
  await q(`insert into conversation_messages (tenant_id, conversation_id, sender_kind, sender_name, body, channel, provider_id) values ('${T.A}', '${c.id}', 'guardian', 'Parent A', 'Hello', 'whatsapp', 'wamid.TEST1')`);
  let dup = null;
  try { await q(`insert into conversation_messages (tenant_id, conversation_id, sender_kind, sender_name, body, channel, provider_id) values ('${T.A}', '${c.id}', 'guardian', 'Parent A', 'Hello', 'whatsapp', 'wamid.TEST1')`); }
  catch (e) { dup = e.message; }
  check("a retried webhook can't file the same WhatsApp message twice", /conversation_messages_provider|duplicate/.test(dup ?? ""), dup);
  let bad = null;
  try { await q(`update conversations set channel = 'sms' where id = '${c.id}'`); } catch (e) { bad = e.message; }
  check("channels are app or WhatsApp", /conversations_channel_check/.test(bad ?? ""), bad);
  await db.exec(`delete from conversations where id = '${c.id}'; update guardians set phone = null where id = '${G}';`);
}
