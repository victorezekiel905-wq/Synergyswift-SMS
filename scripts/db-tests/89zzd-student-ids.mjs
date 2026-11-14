// Student IDs (migration 10600): the school's initials and a running number (GC-0001), given when
// a student is added without one; a typed ID is kept; an admin can renumber everyone.
export default async function ({ q, expectError, check, U, T }) {
  console.log("\nStudent IDs: the school's initials and a running number");
  const one = async sql => (await q(sql))[0];
  const acr = async n => (await one(`select public.school_acronym('${n.replace(/'/g, "''")}') a`)).a;
  check("initials of the school's name", await acr("Greenfield College") === "GC" && await acr("Royal International School") === "RIS", [await acr("Greenfield College"), await acr("Royal International School")]);
  check("small words are left out", await acr("The School of St. Mary and St. John") === "SSMSJ", await acr("The School of St. Mary and St. John"));
  check("a one-word name gives its first three letters", await acr("Kingsway") === "KIN");

  // Its own letters, so the test does not depend on the test school's name.
  await q(`insert into tenant_settings (tenant_id) values ('${T.A}') on conflict (tenant_id) do nothing`);
  await q(`update tenant_settings set student_id_prefix = 'TQX' where tenant_id = '${T.A}'`);
  const add = async (id, adm) => q(`insert into students (id, tenant_id, admission_no, first_name, last_name) values ('${id}', '${T.A}', ${adm === null ? "''" : `'${adm}'`}, 'Test', 'Student')`);
  const S1 = "a8d00000-0000-0000-0000-000000000001", S2 = "a8d00000-0000-0000-0000-000000000002", S3 = "a8d00000-0000-0000-0000-000000000003";
  await add(S1, null); await add(S2, "OLD/77"); await add(S3, null);
  const adm = async id => (await one(`select admission_no from students where id = '${id}'`)).admission_no;
  check("a student added with no ID gets the next one", await adm(S1) === "TQX-0001", await adm(S1));
  check("a typed ID is kept", await adm(S2) === "OLD/77");
  check("…and the next student continues the series", await adm(S3) === "TQX-0002", await adm(S3));

  await expectError("nobody signed in can renumber students", U.adminA, `select renumber_students('${T.A}')`, /permission denied/);
  await expectError("…or take numbers directly", U.adminA, `select next_admission_no('${T.A}')`, /permission denied/);

  const before = Number((await one(`select count(*)::int n from students where tenant_id = '${T.A}'`)).n);
  const n = (await one(`select renumber_students('${T.A}') n`)).n;
  const after = await q(`select admission_no, previous_admission_no from students where tenant_id = '${T.A}' order by created_at, id`);
  check("renumbering gives everyone an ID in the school's format", n === before && after.every((r, i) => r.admission_no === `TQX-${String(i + 1).padStart(4, "0")}`), after.slice(0, 4));
  check("…and keeps each old ID", (await one(`select previous_admission_no p from students where id = '${S2}'`)).p === "OLD/77");

  // Put the shared test school back as it was for the tests that follow.
  await q(`delete from students where id in ('${S1}', '${S2}', '${S3}')`);
  await q(`update students set admission_no = 'TMP-' || replace(id::text, '-', '') where tenant_id = '${T.A}' and previous_admission_no is not null`);
  await q(`update students set admission_no = previous_admission_no, previous_admission_no = null where tenant_id = '${T.A}' and previous_admission_no is not null`);
  await q(`update tenant_settings set student_id_prefix = null where tenant_id = '${T.A}'`);
}
