// Only the platform owner creates schools; a prospect's one-time school code works exactly once.
export default async function ({ db, q, expectError, check, U }) {
  console.log("\nSchool codes: one use only");
  const hash = "a".repeat(64), old = "b".repeat(64), cancelled = "c".repeat(64);
  await db.exec(`insert into school_signup_codes (code_hash, hint, label, expires_at) values
    ('${hash}', 'JKMN', 'Greenfield College', now() + interval '7 days'),
    ('${old}', 'OLD1', 'Old code', now() + interval '1 second'),
    ('${cancelled}', 'CAN1', 'Cancelled code', now() + interval '7 days');
    update school_signup_codes set created_at = now() - interval '2 days', expires_at = now() - interval '1 day' where code_hash = '${old}';
    update school_signup_codes set revoked_at = now() where code_hash = '${cancelled}';`);
  const first = await q(`select public.claim_school_code('${hash}', '${U.teacherA}') id`);
  check("the code works the first time", Boolean(first[0]?.id), first);
  const second = await q(`select public.claim_school_code('${hash}', '${U.adminB}') id`);
  check("…and never again, even for someone else", second[0]?.id === null, second);
  check("an expired code doesn't work", (await q(`select public.claim_school_code('${old}', '${U.teacherA}') id`))[0]?.id === null);
  check("a cancelled code doesn't work", (await q(`select public.claim_school_code('${cancelled}', '${U.teacherA}') id`))[0]?.id === null);
  check("a made-up code doesn't work", (await q(`select public.claim_school_code('${"d".repeat(64)}', '${U.teacherA}') id`))[0]?.id === null);
  await q(`select public.release_school_code('${first[0].id}')`);
  check("if setting up the school fails, the code is given back", Boolean((await q(`select public.claim_school_code('${hash}', '${U.teacherA}') id`))[0]?.id));
  await expectError("nobody signed in can use the code function directly", U.teacherA, `select public.claim_school_code('${hash}', '${U.teacherA}')`, /permission denied/);
  await expectError("…or read the codes", U.adminA, `select count(*) from school_signup_codes`, /permission denied/);
  const live = await q(`select to_regprocedure('live.bootstrap_school(text,text,text)') is not null as here`);
  if (live[0]?.here) await expectError("signed-in accounts can't create a live-lessons school any more", U.teacherA, `select live.bootstrap_school('Shadow School', 'Me')`, /permission denied/);
  await db.exec(`delete from school_signup_codes`);
}
