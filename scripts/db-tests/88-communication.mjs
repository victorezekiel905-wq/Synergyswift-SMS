// Communication: notices and read receipts, templates, teacher-student messaging, parent-teacher evenings.
export default async function ({ db, q, expectRows, expectError, expectOk, check, U, T }) {
  const COUNS = "a0000000-0000-0000-0000-0000000000c1";
  const JSS1 = "a2000000-0000-0000-0000-000000000000";
  const KID = "a8000000-0000-0000-0000-000000000001", GUARD = "a9000000-0000-0000-0000-000000000001";
  const ID = n => `e5000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
  const N1 = ID(1), N2 = ID(2), R1 = ID(3), R2 = ID(4), R3 = ID(5), TH = ID(6), M1 = ID(7), CONF = ID(8);

  console.log("\nAnnouncements and read receipts");
  await expectOk("an admin drafts a circular", U.adminA, `insert into notices (id, tenant_id, kind, title, body, requires_ack, created_by) values ('${N1}', '${T.A}', 'circular', 'Trip consent', 'Please read and confirm', true, '${U.adminA}')`);
  await expectError("teachers cannot send notices", U.teacherA, `insert into notices (tenant_id, title, body) values ('${T.A}', 'Mine', 'Hello')`, /row-level security/);
  await expectError("a scheduled notice needs a time", U.adminA, `insert into notices (tenant_id, title, body, status) values ('${T.A}', 'Later', 'Hello', 'scheduled')`, /check/);
  await db.exec(`update notices set status = 'sent', sent_at = now() where id = '${N1}';
    insert into notices (id, tenant_id, title, body, status) values ('${N2}', '${T.A}', 'Draft only', 'Not yet', 'draft');
    insert into notice_recipients (id, tenant_id, notice_id, recipient_kind, guardian_id, student_ids) values ('${R1}', '${T.A}', '${N1}', 'guardian', '${GUARD}', '{${KID}}');
    insert into notice_recipients (id, tenant_id, notice_id, recipient_kind, user_id) values ('${R2}', '${T.A}', '${N1}', 'staff', '${U.teacherA}'), ('${R3}', '${T.A}', '${N1}', 'student', '${U.studentA}');`);
  await expectRows("the parent sees the notice sent to them", U.parentA, "select count(*) n from notices", 1);
  await expectRows("…and their own receipt only", U.parentA, "select count(*) n from notice_recipients", 1);
  await expectRows("a teacher sees theirs", U.teacherA, "select count(*) n from notices", 1);
  await expectRows("people who were not sent it see nothing", U.teacherA2, "select (select count(*) from notices) + (select count(*) from notice_recipients) n", 0);
  await expectRows("drafts are for senders only", U.studentA, `select count(*) n from notices where id = '${N2}'`, 0);
  await expectOk("the parent confirms they have read it", U.parentA, `update notice_recipients set read_at = now(), acknowledged_at = now() where id = '${R1}'`);
  await expectError("…but cannot change anything else", U.parentA, `update notice_recipients set read_token = 'x' where id = '${R1}'`, /only the read and acknowledged times/);
  const t1 = await q(`select acknowledged_at from notice_recipients where id = '${R1}'`);
  await expectOk("a later update cannot wipe the confirmation", U.parentA, `update notice_recipients set acknowledged_at = null, read_at = null where id = '${R1}'`);
  const t2 = await q(`select acknowledged_at, read_at from notice_recipients where id = '${R1}'`);
  check("…it is kept", t2[0].acknowledged_at && String(t2[0].acknowledged_at) === String(t1[0].acknowledged_at) && t2[0].read_at, t2[0]);
  await expectRows("the parent cannot mark someone else's copy", U.parentA, `with u as (update notice_recipients set read_at = now() where id = '${R2}' returning 1) select count(*) n from u`, 0);
  await expectOk("an admin saves a template", U.adminA, `insert into message_templates (tenant_id, name, body) values ('${T.A}', 'Fees reminder', 'Dear {parent_name}, ...')`);
  await expectRows("staff can read templates", U.teacherA, "select count(*) n from message_templates", 1);
  await expectRows("families cannot", U.parentA, "select count(*) n from message_templates", 0);
  const dc = await q(`select count(*)::int n from data_changes where table_name = 'notice_recipients'`);
  check("receipts (and their links) stay out of the change history", dc[0].n === 0, dc[0]);

  console.log("\nTeacher-student messaging");
  await db.exec(`insert into student_threads (id, tenant_id, student_id, staff_user_id, subject) values ('${TH}', '${T.A}', '${KID}', '${U.teacherA}', 'Your essay');
    insert into student_thread_messages (id, tenant_id, thread_id, sender_kind, sender_user_id, body, flagged, flag_reason) values ('${M1}', '${T.A}', '${TH}', 'staff', '${U.teacherA}', 'Text me on 08031234567', true, 'a phone number');`);
  await expectRows("the student reads it", U.studentA, "select count(*) n from student_thread_messages", 1);
  await expectRows("the teacher in it reads it", U.teacherA, "select count(*) n from student_thread_messages", 1);
  await expectRows("the counsellor (a safeguarding lead) reads it", COUNS, "select count(*) n from student_thread_messages", 1);
  await expectRows("the parent reads it (the school allows this by default)", U.parentA, "select count(*) n from student_thread_messages", 1);
  await expectRows("other teachers do not", U.teacherA2, "select (select count(*) from student_threads) + (select count(*) from student_thread_messages) n", 0);
  await db.exec(`update tenant_settings set student_messaging_parents_see = false where tenant_id = '${T.A}'`);
  await expectRows("…and parents stop seeing it when the school says so", U.parentA, "select count(*) n from student_thread_messages", 0);
  await db.exec(`update tenant_settings set student_messaging_parents_see = true where tenant_id = '${T.A}'`);
  await expectError("nobody writes messages directly; the server applies the rules", U.teacherA, `insert into student_thread_messages (tenant_id, thread_id, sender_kind, sender_user_id, body) values ('${T.A}', '${TH}', 'staff', '${U.teacherA}', 'hi')`, /row-level security/);
  await expectRows("the teacher cannot edit their message", U.teacherA, `with u as (update student_thread_messages set body = 'harmless' where id = '${M1}' returning 1) select count(*) n from u`, 0);
  await expectOk("the counsellor marks the flag as reviewed", COUNS, `update student_thread_messages set reviewed_at = now() where id = '${M1}'`);
  const rv = await q(`select reviewed_by, body from student_thread_messages where id = '${M1}'`);
  check("…recorded as the reviewer, wording untouched", rv[0].reviewed_by === COUNS && rv[0].body.includes("0803"), rv[0]);
  await expectError("…but cannot change the wording", COUNS, `update student_thread_messages set body = 'changed' where id = '${M1}'`, /cannot be changed/);
  await expectRows("…or delete it", U.adminA, `with d as (delete from student_thread_messages where id = '${M1}' returning 1) select count(*) n from d`, 0);
  await expectRows("another school sees none of it", U.adminB, "select (select count(*) from student_threads) + (select count(*) from notices) n", 0);

  console.log("\nParent-teacher evenings");
  await expectOk("an admin creates an evening", U.adminA, `insert into pt_conferences (id, tenant_id, title, date, starts_at, ends_at, class_group_ids, staff_user_ids) values ('${CONF}', '${T.A}', 'PT evening', '2026-05-07', '16:00', '19:00', '{${JSS1}}', '{${U.teacherA}}')`);
  await expectError("teachers cannot", U.teacherA, `insert into pt_conferences (tenant_id, title, date, starts_at, ends_at) values ('${T.A}', 'Mine', '2026-05-07', '16:00', '17:00')`, /row-level security/);
  await expectError("it must end after it starts", U.adminA, `insert into pt_conferences (tenant_id, title, date, starts_at, ends_at) values ('${T.A}', 'Backwards', '2026-05-07', '17:00', '16:00')`, /check/);
  await expectRows("parents of the class see it", U.parentA, "select count(*) n from pt_conferences", 1);
  await db.exec(`update pt_conferences set status = 'cancelled' where id = '${CONF}'`);
  await expectRows("…not once it is cancelled", U.parentA, "select count(*) n from pt_conferences", 0);

  await db.exec(`delete from pt_conferences; delete from student_threads; delete from notices; delete from message_templates;`);
}
