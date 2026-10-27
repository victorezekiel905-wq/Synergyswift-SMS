// Phase 14h: SEN engagement — the family and the child see the plan, the home–school book, target feedback, and the handshake into live lessons.
export default async function ({ db, q, expectRows, expectError, expectOk, check, U, T }) {
  const COUNS = "a0000000-0000-0000-0000-0000000000c1";   // counsellor, created in 82-core-security
  const KID = "a8000000-0000-0000-0000-000000000001", OTHER = "a8000000-0000-0000-0000-000000000002";
  const TG1 = "d1000000-0000-0000-0000-000000000003";     // a target on Ada's live plan, from 83-sis
  const note = (who, uid, kind = "note", extra = "") =>
    `insert into sen_home_notes (tenant_id, student_id, author_kind, author_user_id, author_name, kind, body${extra ? ", mood" : ""}) values ('${T.A}', '${KID}', '${who}', '${uid}', 'X', '${kind}', 'Hello'${extra ? ", " + extra : ""})`;

  console.log("\nSEN engagement: who may see the plan");
  const prof = await q(`select share_with_parents from sen_profiles where student_id = '${KID}'`);
  check("Ada is on the register and her profile is shared with the family by default", prof.length === 1 && prof[0].share_with_parents === true, prof);
  await expectRows("her parent may see it", U.parentA, `select count(*) n from (select public.sen_family_can('${KID}') ok) x where ok`, 1);
  await expectRows("Ada herself may see it", U.studentA, `select count(*) n from (select public.sen_is_me('${KID}') ok) x where ok`, 1);
  await expectRows("another child's parent may not", U.parentA, `select count(*) n from (select public.sen_family_can('${OTHER}') ok) x where ok`, 0);
  await expectRows("another school cannot resolve the plan's targets", U.adminB, `select count(*) n from (select public.iep_target_student('${TG1}') s) x where s is not null`, 0);

  console.log("\nSEN engagement: the home–school book");
  await expectOk("the parent writes how the day went", U.parentA, note("parent", U.parentA, "note", "4"));
  await expectOk("and asks for a review meeting", U.parentA, note("parent", U.parentA, "meeting_request"));
  await expectError("a parent cannot write as staff", U.parentA, note("staff", U.parentA), /row-level security/);
  await expectError("…or in someone else's name", U.parentA, note("parent", U.adminA), /row-level security/);
  await expectError("…or about a child who is not theirs", U.parentA, `insert into sen_home_notes (tenant_id, student_id, author_kind, author_user_id, author_name, body) values ('${T.A}', '${OTHER}', 'parent', '${U.parentA}', 'X', 'Hi')`, /row-level security/);
  await expectOk("Ada tells her teachers something", U.studentA, note("student", U.studentA));
  await expectError("a child cannot post 'good news' about themself", U.studentA, note("student", U.studentA, "praise"), /row-level security/);
  await expectOk("the counsellor sends good news", COUNS, note("staff", COUNS, "praise"));
  await expectError("a teacher the profile is not shared with cannot write", U.teacherA, note("staff", U.teacherA), /row-level security/);
  await expectRows("the SEN team reads the whole book", COUNS, `select count(*) n from sen_home_notes where student_id = '${KID}'`, 4);
  await expectRows("the family reads its own notes and the school's, not what the child wrote", U.parentA, `select count(*) n from sen_home_notes`, 3);
  await expectRows("Ada reads what she wrote and the good news", U.studentA, `select count(*) n from sen_home_notes`, 2);
  await expectRows("the teacher the profile is not shared with reads nothing", U.teacherA, `select count(*) n from sen_home_notes`, 0);
  await expectRows("another school reads nothing", U.adminB, `select count(*) n from sen_home_notes`, 0);
  await expectRows("nobody edits the book directly", U.parentA, `with u as (update sen_home_notes set body = 'changed' returning 1) select count(*) n from u`, 0);

  console.log("\nSEN engagement: how each target is going");
  const fb = (who, uid, extra = "") => `insert into iep_target_feedback (tenant_id, target_id, author_kind, author_user_id, author_name, rating${extra ? ", comment" : ""}) values ('${T.A}', '${TG1}', '${who}', '${uid}', 'X', 4${extra ? ", " + extra : ""})`;
  await expectOk("the parent says how it is going at home", U.parentA, fb("parent", U.parentA));
  await expectOk("Ada says how it is going for her", U.studentA, fb("student", U.studentA, "'I like the reading ruler'"));
  await expectError("a child cannot rate as a parent", U.studentA, fb("parent", U.studentA), /row-level security/);
  await expectError("a parent cannot rate as staff", U.parentA, fb("staff", U.parentA), /row-level security/);
  await expectRows("the SEN team sees both", COUNS, `select count(*) n from iep_target_feedback where target_id = '${TG1}'`, 2);
  await expectRows("the family sees its own, not the child's", U.parentA, `select count(*) n from iep_target_feedback`, 1);
  await expectRows("Ada sees her own", U.studentA, `select count(*) n from iep_target_feedback`, 1);
  await expectRows("another school sees none", U.adminB, `select count(*) n from iep_target_feedback`, 0);

  console.log("\nSEN engagement: sharing switched off, and a closed profile");
  await db.exec(`update sen_profiles set share_with_parents = false where student_id = '${KID}'`);
  await expectRows("when the school does not share the profile, the family sees nothing", U.parentA, `select (select count(*) from sen_home_notes) + (select count(*) from iep_target_feedback where author_user_id <> '${U.parentA}') n`, 0);
  await expectError("…and cannot write", U.parentA, note("parent", U.parentA), /row-level security/);
  await expectRows("Ada still sees her own", U.studentA, `select count(*) n from sen_home_notes`, 2);
  await db.exec(`update sen_profiles set share_with_parents = true where student_id = '${KID}'`);

  console.log("\nSEN engagement: the handshake into live lessons");
  const live = async () => (await q(`select read_aloud, readable_font, extra_time_pct, calm_mode, note from live.student_supports where student_id = '${U.studentA}'`))[0];
  await db.exec(`update sen_profiles set extra_time_pct = 30, arrangements = '{reader}', live_calm_mode = true, status = 'sen_support' where student_id = '${KID}'`);
  let s = await live();
  check("the SENCO's supports reach the live engine (30% rounds up to 50%, a reader means read aloud, calm mode)",
    s && s.extra_time_pct === 50 && s.read_aloud === true && s.readable_font === false && s.calm_mode === true && s.note === "From the SEN register", s);
  await db.exec(`update sen_profiles set extra_time_pct = 75, arrangements = '{}', live_readable_font = true, live_calm_mode = false where student_id = '${KID}'`);
  s = await live();
  check("changes follow (over 50% becomes 100%, the easy-to-read font)", s && s.extra_time_pct === 100 && s.read_aloud === false && s.readable_font === true && s.calm_mode === false, s);
  await db.exec(`update sen_profiles set status = 'closed' where student_id = '${KID}'`);
  check("closing the profile removes the supports it set", !(await live()), await live());
  await expectRows("a closed profile is no longer shared with the family", U.parentA, `select count(*) n from (select public.sen_family_can('${KID}') ok) x where ok`, 0);
  await db.exec(`update sen_profiles set status = 'sen_support', extra_time_pct = 25, live_readable_font = false where student_id = '${KID}'`);
  s = await live();
  check("reopening it brings them back", s && s.extra_time_pct === 25, s);
  // A child with no live account (no login) never blocks the register.
  await expectOk("a profile for a child with no login still saves", COUNS, `insert into sen_profiles (student_id, tenant_id, status, extra_time_pct) values ('${OTHER}', '${T.A}', 'monitoring', 25)`);
  await db.exec(`delete from sen_profiles where student_id = '${OTHER}'; delete from sen_home_notes where student_id = '${KID}'; delete from iep_target_feedback where target_id = '${TG1}'`);
}
