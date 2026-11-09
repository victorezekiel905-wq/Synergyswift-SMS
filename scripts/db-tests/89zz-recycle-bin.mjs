// Recycle bin (migration 9400): what a school deletes is kept with everything that went with it,
// comes back whole (links included), stays inside the school, and is only reachable by the server.
export default async function ({ q, as, expectError, check, U, T }) {
  const CG = "a2000000-0000-0000-0000-0000000000e1", ST = "a8000000-0000-0000-0000-0000000000e1", HW = "a2000000-0000-0000-0000-0000000000e2";
  const SUBJ = "a3000000-0000-0000-0000-000000000000";
  const bin = async (where) => (await q(`select * from recycle_bin where ${where} order by id`));
  console.log("\nRecycle bin");

  await q(`insert into class_groups (id, tenant_id, name) values ('${CG}', '${T.A}', 'Bin class')`);
  await q(`insert into students (id, tenant_id, admission_no, first_name, last_name, class_group_id) values ('${ST}', '${T.A}', 'BIN-1', 'Chidi', 'Okafor', '${CG}')`);
  await q(`insert into subject_offerings (tenant_id, class_group_id, subject_id, teacher_id) values ('${T.A}', '${CG}', '${SUBJ}', '${U.teacherA}')`);
  await q(`insert into homework (id, tenant_id, class_group_id, subject_id, set_by, title, due_at) values ('${HW}', '${T.A}', '${CG}', '${SUBJ}', '${U.teacherA}', 'Fractions worksheet', now() + interval '3 days')`)
    .catch(e => console.log("    (homework insert skipped:", e.message.slice(0, 80), ")"));
  const hwMade = (await q(`select count(*)::int n from homework where id = '${HW}'`))[0].n === 1;

  // Deleting a class keeps the class, what was removed with it, and the students it was cleared from.
  await q(`delete from class_groups where id = '${CG}'`);
  const rows = await bin(`tenant_id = '${T.A}' and batch = (select batch from recycle_bin where row_id = '${CG}' and top)`);
  check("deleting a class puts it in the bin", rows.some(r => r.top && r.table_name === "class_groups"), rows.map(r => r.table_name));
  check("…with its class subjects", rows.some(r => !r.top && r.table_name === "subject_offerings"), rows.map(r => r.table_name));
  if (hwMade) check("…and its homework", rows.some(r => !r.top && r.table_name === "homework"), rows.map(r => r.table_name));
  check("…and remembers the student it was taken from", rows.some(r => r.op === "unlink" && r.table_name === "students" && r.row_id === ST && r.data.class_group_id === CG), rows.filter(r => r.op === "unlink"));
  check("only the class shows as the thing deleted", rows.filter(r => r.top).length === 1, rows.filter(r => r.top).length);

  const list = await q(`select * from recycle_bin_list('${T.A}')`);
  const entry = list.find(l => l.items.some(i => i.id === CG));
  check("the bin lists it by name, with what went with it", entry?.items[0]?.label === "Bin class" && entry.linked >= 1 && entry.unlinked >= 1, entry);
  check("another school's bin does not show it", !(await q(`select * from recycle_bin_list('${T.B}')`)).some(l => l.batch === entry?.batch));

  let other = null;
  try { await q(`select recycle_bin_restore('${T.B}', '${entry.batch}')`); } catch (e) { other = e.message; }
  check("restoring with another school's id is refused", /no longer in the recycle bin/.test(other ?? ""), other);

  // Restore: the class, its subjects and homework come back, and the student is back in it.
  const res = (await q(`select recycle_bin_restore('${T.A}', '${entry.batch}') r`))[0].r;
  check("restore puts the class back", (await q(`select count(*)::int n from class_groups where id = '${CG}'`))[0].n === 1, res);
  check("…its class subjects", (await q(`select count(*)::int n from subject_offerings where class_group_id = '${CG}'`))[0].n === 1, res);
  if (hwMade) check("…its homework", (await q(`select count(*)::int n from homework where id = '${HW}'`))[0].n === 1, res);
  check("…and the student is back in the class", (await q(`select class_group_id from students where id = '${ST}'`))[0].class_group_id === CG, res);
  check("…the live-lesson copy of the class is back too", (await q(`select count(*)::int n from live.classes where id = '${CG}'`))[0].n === 1);
  check("restored deletions leave the bin", (await bin(`batch = '${entry.batch}'`)).length === 0);
  check("restoring is recorded as relinking the student", res.relinked >= 1, res);

  // A deleted student comes back without a second "admitted" entry in their history.
  const moves = async () => (await q(`select count(*)::int n from student_movements where student_id = '${ST}' and kind = 'admitted'`))[0].n;
  const before = await moves();
  await q(`delete from students where id = '${ST}'`);
  const sb = (await q(`select batch from recycle_bin where row_id = '${ST}' and top`))[0]?.batch;
  check("deleting a student puts them in the bin", Boolean(sb));
  await q(`select recycle_bin_restore('${T.A}', '${sb}')`);
  check("a restored student is not admitted a second time", (await moves()) === before, { before, after: await moves() });

  // Something with the same details added since: refused with a clear reason, nothing changed.
  await q(`delete from students where id = '${ST}'`);
  const sb2 = (await q(`select batch from recycle_bin where row_id = '${ST}' and top`))[0]?.batch;
  await q(`insert into students (tenant_id, admission_no, first_name, last_name) values ('${T.A}', 'BIN-1', 'New', 'Pupil')`);
  let clash = null;
  try { await q(`select recycle_bin_restore('${T.A}', '${sb2}')`); } catch (e) { clash = e.message; }
  check("restoring over a reused admission number is refused, saying why", /Chidi Okafor.*same details/.test(clash ?? ""), clash);
  check("…and it stays in the bin", (await bin(`batch = '${sb2}' and top`)).length === 1);
  await q(`delete from students where admission_no = 'BIN-1' and first_name = 'New'`);
  await q(`delete from recycle_bin where top and data ->> 'first_name' = 'New'`);

  // Not everything is a deletion to keep.
  const offeringBatches = async () => (await q(`select count(*)::int n from recycle_bin where table_name = 'subject_offerings' and top`))[0].n;
  await q(`delete from subject_offerings where class_group_id = '${CG}'`);
  check("removing a class subject on its own is not a bin entry", (await offeringBatches()) === 0);
  await q(`delete from phone_login_codes`).catch(() => 0);
  check("sign-in codes and logs are never kept", (await q(`select count(*)::int n from recycle_bin where table_name in ('phone_login_codes','data_changes','audit_logs')`))[0].n === 0);

  // A whole school deleted by the platform does not fill a bin.
  const TC = "c1000000-0000-0000-0000-0000000000e1";
  await q(`insert into tenants (id, name, slug) values ('${TC}', 'Closing School', 'closing-bin')`);
  await q(`insert into class_groups (tenant_id, name) values ('${TC}', 'Gone class')`);
  await q(`insert into students (tenant_id, admission_no, first_name, last_name) values ('${TC}', 'G1', 'Gone', 'Kid')`);
  await q(`select platform_delete_tenant('${TC}')`);
  check("deleting a school keeps nothing in a bin", (await q(`select count(*)::int n from recycle_bin where tenant_id = '${TC}'`))[0].n === 0);

  // Only the server reaches the bin.
  await expectError("staff cannot read the bin directly", U.adminA, `select * from recycle_bin`, /permission denied/);
  await expectError("staff cannot restore from the bin directly", U.adminA, `select recycle_bin_restore('${T.A}', '${sb2}')`, /permission denied/);
  await expectError("staff cannot list the bin directly", U.adminA, `select * from recycle_bin_list('${T.A}')`, /permission denied/);

  // Deleting through the app as a signed-in admin records who did it.
  const SUB2 = "a3000000-0000-0000-0000-0000000000e3";
  await q(`insert into subjects (id, tenant_id, name) values ('${SUB2}', '${T.A}', 'Bin subject')`);
  const gone = await as(U.adminA, async () => (await q(`delete from subjects where id = '${SUB2}' returning id`)).length);
  const f = (await bin(`row_id = '${SUB2}' and top`))[0];
  check("an admin's delete through the app reaches the bin, with who did it", gone === 1 && f?.actor_id === U.adminA && f?.actor === "user", { gone, f });
  // The server deleting for a person: the person comes from the x-actor header.
  const SUB3 = "a3000000-0000-0000-0000-0000000000e4";
  await q(`insert into subjects (id, tenant_id, name) values ('${SUB3}', '${T.A}', 'Bin subject 2')`);
  await q(`select set_config('request.jwt.claims', '{"role":"service_role"}', false), set_config('request.headers', '{"x-actor":"user:${U.bursarA}"}', false)`);
  await q(`delete from subjects where id = '${SUB3}'`);
  await q(`select set_config('request.jwt.claims', '', false), set_config('request.headers', '', false)`);
  const f3 = (await bin(`row_id = '${SUB3}' and top`))[0];
  check("…and when the server deletes for someone, it is them", f3?.actor_id === U.bursarA, f3);
  await q(`delete from recycle_bin where batch in ('${sb2}', '${f?.batch}', '${f3?.batch}')`);
}
