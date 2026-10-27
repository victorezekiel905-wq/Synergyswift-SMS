// Phase 14f: elections — secret ballot, one vote, kiosk, turnout, results, receipts, one vote per family.
export default async function ({ db, as, q, expectRows, expectError, expectOk, check, U, T }) {
  const E = "fa000000-0000-0000-0000-000000000001", PTA = "fa000000-0000-0000-0000-000000000002";
  const HEAD = "fa000000-0000-0000-0000-0000000000a1", GAMES = "fa000000-0000-0000-0000-0000000000a2", CHAIR = "fa000000-0000-0000-0000-0000000000a3";
  const ADA = "a8000000-0000-0000-0000-000000000001", BOLA = "a8000000-0000-0000-0000-000000000002";
  const C = (n) => `fa000000-0000-0000-0000-0000000000c${n}`;
  const P2 = "a0000000-0000-0000-0000-00000000e0b1";
  const one = async (uid, sql) => (await as(uid, () => q(sql)))[0];
  const ballot = (o) => `'${JSON.stringify(o)}'::jsonb`;

  console.log("\nElections: setting up");
  await expectOk("the school sets up a prefect election", U.adminA,
    `insert into elections (id, tenant_id, title, kind, audience) values ('${E}', '${T.A}', 'Prefects 2027', 'prefects', 'students')`);
  await expectOk("…with posts", U.adminA, `insert into election_posts (id, tenant_id, election_id, title, seats, position) values
    ('${HEAD}', '${T.A}', '${E}', 'Head prefect', 1, 1), ('${GAMES}', '${T.A}', '${E}', 'Games captain', 2, 2)`);
  await expectOk("…and candidates", U.adminA, `insert into election_candidates (id, tenant_id, election_id, post_id, name) values
    ('${C(1)}', '${T.A}', '${E}', '${HEAD}', 'Ada Obi'), ('${C(2)}', '${T.A}', '${E}', '${HEAD}', 'Bola Ade'),
    ('${C(3)}', '${T.A}', '${E}', '${GAMES}', 'Chidi'), ('${C(4)}', '${T.A}', '${E}', '${GAMES}', 'Dayo'), ('${C(5)}', '${T.A}', '${E}', '${GAMES}', 'Efe')`);
  await expectError("teachers can't create elections", U.teacherA, `insert into elections (tenant_id, title) values ('${T.A}', 'Mine')`, /row-level security/);
  await expectRows("another school sees nothing", U.adminB, `select count(*) n from elections`, 0);
  await expectRows("a draft is hidden from students", U.studentA, `select count(*) n from elections where id = '${E}'`, 0);
  await expectError("…and can't be voted in", U.studentA, `select public.cast_ballot('${E}', ${ballot({ [HEAD]: [C(1)] })})`, /not open|not found/);

  console.log("\nElections: voting");
  await q(`update elections set status = 'open' where id = '${E}'`);
  const mine = await one(U.studentA, `select public.my_elections() r`);
  check("the student sees the open election, not yet voted", mine.r.some(e => e.id === E && e.phase === "voting" && !e.voted), mine.r);
  const cast = await one(U.studentA, `select public.cast_ballot('${E}', ${ballot({ [HEAD]: [C(1)], [GAMES]: [C(3), C(4)] })}) receipt`);
  check("the student votes online and gets a receipt code", /^[0-9A-F]{12}$/.test(cast.receipt), cast);
  await expectError("one vote only", U.studentA, `select public.cast_ballot('${E}', ${ballot({ [HEAD]: [C(2)] })})`, /already been cast/);
  await expectError("no more choices than seats", U.teacherA, `select public.cast_ballot_kiosk('${E}', '${BOLA}', ${ballot({ [HEAD]: [C(1), C(2)] })})`, /Too many choices/);
  await expectError("a candidate must stand for that post", U.teacherA, `select public.cast_ballot_kiosk('${E}', '${BOLA}', ${ballot({ [HEAD]: [C(3)] })})`, /not a candidate for that post/);
  const kiosk = await one(U.teacherA, `select public.cast_ballot_kiosk('${E}', '${BOLA}', ${ballot({ [HEAD]: [C(2)], [GAMES]: [C(3)] })}) receipt`);
  check("the class teacher's voting tablet takes Bola's vote", /^[0-9A-F]{12}$/.test(kiosk.receipt), kiosk);
  await expectError("a student can't vote twice through the tablet", U.teacherA, `select public.cast_ballot_kiosk('${E}', '${ADA}', ${ballot({ [HEAD]: [C(2)] })})`, /already been cast/);
  await expectError("a parent can't run a voting tablet", U.parentA, `select public.cast_ballot_kiosk('${E}', '${BOLA}', ${ballot({})})`, /teachers|not found/);
  await expectError("staff are not voters in a students' election", U.teacherA, `select public.cast_ballot('${E}', ${ballot({ [HEAD]: [C(1)] })})`, /voters' list/);

  console.log("\nElections: the ballot is secret");
  await expectError("not even the head can read ballots", U.adminA, `select * from election_ballots`, /permission denied/);
  await expectError("…or votes", U.adminA, `select * from election_votes`, /permission denied/);
  await expectRows("officers see who voted (for turnout)", U.adminA, `select count(*) n from election_voters where election_id = '${E}'`, 2);
  const cols = await q(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'election_voters'`);
  check("the voters list holds no choices", !cols.some(c => /candidate|post|ballot/.test(c.column_name)), cols);
  const ballotCols = await q(`select column_name from information_schema.columns where table_schema = 'public' and table_name in ('election_ballots','election_votes')`);
  check("ballots hold no voter and no time", !ballotCols.some(c => /user|voter|student|_at$/.test(c.column_name)), ballotCols);
  await expectRows("a student sees only their own vote record", U.studentA, `select count(*) n from election_voters`, 1);
  await expectError("nobody writes vote records directly", U.adminA,
    `insert into election_voters (election_id, voter_key, tenant_id, channel) values ('${E}', 'user:x', '${T.A}', 'online')`, /permission denied/);
  await expectError("the ballot paper is fixed once votes are in", U.adminA,
    `insert into election_candidates (tenant_id, election_id, post_id, name) values ('${T.A}', '${E}', '${HEAD}', 'Late entry')`, /can no longer change/);
  const turnout = await one(U.adminA, `select public.election_turnout('${E}') t`);
  check("turnout: two voted, one online and one on a tablet", turnout.t.voted === 2 && turnout.t.online === 1 && turnout.t.kiosk === 1 && turnout.t.eligible >= 2, turnout.t);
  await expectError("students can't see turnout", U.studentA, `select public.election_turnout('${E}')`, /not allowed/);

  console.log("\nElections: results");
  await expectError("no counts while voting is open (unless the school allows it)", U.adminA, `select public.election_results('${E}')`, /not available/);
  await q(`update elections set status = 'closed' where id = '${E}'`);
  const res = (await one(U.adminA, `select public.election_results('${E}') r`)).r;
  const head = res.posts.find(p => p.id === HEAD), games = res.posts.find(p => p.id === GAMES);
  check("two ballots counted", res.ballots === 2, res);
  check("a tie for the one seat is flagged, nobody elected", head.candidates.every(c => c.votes === 1 && c.tie && !c.elected), head);
  check("two seats: the top two are elected", games.candidates.filter(c => c.elected).map(c => c.name).sort().join() === "Chidi,Dayo", games);
  check("abstentions are counted per post", head.abstained === 0 && games.abstained === 0, { head: head.abstained, games: games.abstained });
  await expectError("voters wait for publication", U.studentA, `select public.election_results('${E}')`, /not available/);
  await q(`update elections set status = 'published' where id = '${E}'`);
  await expectOk("…then see the results", U.studentA, `select public.election_results('${E}')`);
  const ok = await one(U.studentA, `select public.election_check_receipt('${E}', '${cast.receipt.toLowerCase()}') ok`);
  check("a voter's receipt shows their ballot was counted", ok.ok === true, ok);
  const bad = await one(U.studentA, `select public.election_check_receipt('${E}', 'FFFFFFFFFFFF') ok`);
  check("…a made-up receipt doesn't", bad.ok === false, bad);

  console.log("\nElections: PTA, one vote per family");
  await db.exec(`
    insert into auth.users (id) values ('${P2}');
    insert into users (id, tenant_id, email, full_name, role) values ('${P2}', '${T.A}', 'p2@a', 'Second Parent', 'parent');
    insert into guardians (id, tenant_id, user_id, full_name) values ('a9000000-0000-0000-0000-0000000000e2', '${T.A}', '${P2}', 'Second Parent');
    insert into student_guardians (tenant_id, student_id, guardian_id) values ('${T.A}', '${ADA}', 'a9000000-0000-0000-0000-0000000000e2');
    insert into elections (id, tenant_id, title, kind, audience, one_per_family, status) values ('${PTA}', '${T.A}', 'PTA chair', 'pta', 'parents', true, 'open');
    insert into election_posts (id, tenant_id, election_id, title) values ('${CHAIR}', '${T.A}', '${PTA}', 'Chair');
    insert into election_candidates (id, tenant_id, election_id, post_id, name) values ('${C(6)}', '${T.A}', '${PTA}', '${CHAIR}', 'Mrs Okafor');
  `);
  await expectOk("a parent votes", U.parentA, `select public.cast_ballot('${PTA}', ${ballot({ [CHAIR]: [C(6)] })})`);
  await expectError("the other parent of the same family can't vote again", P2, `select public.cast_ballot('${PTA}', ${ballot({ [CHAIR]: [C(6)] })})`, /already been cast/);
  await expectError("students are not voters in a PTA election", U.studentA, `select public.cast_ballot('${PTA}', ${ballot({ [CHAIR]: [C(6)] })})`, /voters' list/);
  await expectRows("closing time stops votes", U.adminA, `update elections set closes_at = now() - interval '1 minute', opens_at = now() - interval '1 hour' where id = '${PTA}' returning id`, 1);
  await expectError("…after it", U.adminA, `select public.cast_ballot('${PTA}', ${ballot({})})`, /not open|voters' list/);

  // Leave the shared fixture as it was.
  await db.exec(`delete from elections where tenant_id = '${T.A}'; delete from student_guardians where guardian_id = 'a9000000-0000-0000-0000-0000000000e2';
    delete from guardians where id = 'a9000000-0000-0000-0000-0000000000e2'; delete from users where id = '${P2}';`);
}
