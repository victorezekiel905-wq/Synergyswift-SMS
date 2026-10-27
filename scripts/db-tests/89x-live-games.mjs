// Phase 14d-3: the games rework — modes, power-ups, comebacks, survival, self-paced, guests, board keys, characters.
export default async function ({ db, as, q, expectError, expectOk, check, U, T }) {
  const CG = "a2000000-0000-0000-0000-000000000000", ACT = "f8000000-0000-0000-0000-000000000001";
  const S = ["a0000000-0000-0000-0000-00000000e0a1", "a0000000-0000-0000-0000-00000000e0a2", "a0000000-0000-0000-0000-00000000e0a3"];
  const GUEST = "a0000000-0000-0000-0000-00000000e0a9", LESSON = "f8000000-0000-0000-0000-0000000000c1";
  const one = async (uid, sql) => (await as(uid, () => q(sql)))[0];
  const rpc = async (uid, sql) => Object.values(await one(uid, `select ${sql} as r`))[0];

  // Three more students in the class (the sync copies them into the live engine), a quiz of six questions.
  await db.exec(`
    insert into auth.users (id) values ('${S[0]}'), ('${S[1]}'), ('${S[2]}');
    insert into users (id, tenant_id, email, full_name, role) values
      ('${S[0]}', '${T.A}', 's1@a', 'Chidi Eze', 'student'), ('${S[1]}', '${T.A}', 's2@a', 'Dayo Bello', 'student'), ('${S[2]}', '${T.A}', 's3@a', 'Efe Okoro', 'student');
    insert into students (id, tenant_id, user_id, admission_no, first_name, last_name, class_group_id) values
      ('a8000000-0000-0000-0000-0000000000a1', '${T.A}', '${S[0]}', '0a1', 'Chidi', 'Eze', '${CG}'),
      ('a8000000-0000-0000-0000-0000000000a2', '${T.A}', '${S[1]}', '0a2', 'Dayo', 'Bello', '${CG}'),
      ('a8000000-0000-0000-0000-0000000000a3', '${T.A}', '${S[2]}', '0a3', 'Efe', 'Okoro', '${CG}');
    insert into live.activities (id, tenant_id, owner_id, kind, title) values ('${ACT}', '${T.A}', '${U.teacherA}', 'quiz', 'Fractions quiz');
  `);
  const Q = (i) => `f8000000-0000-0000-0000-00000000010${i}`;
  for (const i of [1, 2, 4, 5, 6]) {
    const tf = i === 2;
    await db.exec(`insert into live.questions (id, tenant_id, activity_id, owner_id, kind, prompt, position) values
      ('${Q(i)}', '${T.A}', '${ACT}', '${U.teacherA}', '${tf ? "true_false" : "mcq"}', 'Question ${i}', ${i});
      insert into live.question_options (id, tenant_id, question_id, label, is_correct, position) values
      ('f8000000-0000-0000-0000-0000000${i}0001', '${T.A}', '${Q(i)}', 'Right', true, 1),
      ('f8000000-0000-0000-0000-0000000${i}0002', '${T.A}', '${Q(i)}', 'Wrong 1', false, 2)
      ${tf ? "" : `, ('f8000000-0000-0000-0000-0000000${i}0003', '${T.A}', '${Q(i)}', 'Wrong 2', false, 3), ('f8000000-0000-0000-0000-0000000${i}0004', '${T.A}', '${Q(i)}', 'Wrong 3', false, 4)`};`);
  }
  await db.exec(`insert into live.questions (id, tenant_id, activity_id, owner_id, kind, prompt, position, config, answer_key) values
    ('${Q(3)}', '${T.A}', '${ACT}', '${U.teacherA}', 'fill_blank', 'Half of 10 is ___', 3, '{"blanks":1}', '{"blanks":[["5","five"]]}');`);
  const RIGHT = (i) => `{"option_id": "f8000000-0000-0000-0000-0000000${i}0001"}`;
  const WRONG = (i) => `{"option_id": "f8000000-0000-0000-0000-0000000${i}0002"}`;
  const ANSWER = (i, right) => i === 3 ? (right ? `{"blanks": ["Five"]}` : `{"blanks": ["6"]}`) : right ? RIGHT(i) : WRONG(i);
  const answer = (uid, game, idx, right) => rpc(uid, `live.game_answer('${game}', ${idx}, '${ANSWER(idx + 1, right)}'::jsonb, 3000)`);
  const control = (game, action) => rpc(U.teacherA, `live.game_control('${game}', '${action}')`);
  const players = [U.studentA, ...S];

  console.log("\nLive games: classic game with power-ups, comebacks and board keys");
  const g1 = await rpc(U.teacherA, `live.create_game('${CG}', '${ACT}', '{"mode":"classic","question_seconds":0,"powerups":true,"comeback":true}'::jsonb)`);
  check("every auto-marked question type is played (gap fill too)", g1.question_order.length === 6, g1.question_order);
  for (const p of players) await rpc(p, `live.join_game('${g1.join_code}')`);
  await control(g1.id, "start");
  // Question 1: Ada and Chidi right, Dayo and Efe do not answer.
  await answer(U.studentA, g1.id, 0, true); await answer(S[0], g1.id, 0, true);
  await control(g1.id, "next");
  const afterQ1 = await q(`select user_id, score, streak from live.game_players where game_id = '${g1.id}'`);
  check("a missed answer scores nothing", afterQ1.find(r => r.user_id === S[1]).score === 0, afterQ1);
  // Questions 2 and 3: Ada right again (three in a row earns a power-up); Dayo (bottom half) right on q2 = comeback bonus.
  await answer(U.studentA, g1.id, 1, true); await answer(S[1], g1.id, 1, true);
  const dayoQ2 = await q(`select a.comeback_bonus from live.game_answers a join live.game_players p on p.id = a.player_id where p.game_id = '${g1.id}' and p.user_id = '${S[1]}' and a.question_index = 1`);
  check("a right answer from the bottom half gets a comeback bonus", dayoQ2[0]?.comeback_bonus > 0, dayoQ2);
  await control(g1.id, "next");
  await answer(U.studentA, g1.id, 2, true);
  const midQ3 = await rpc(U.studentA, `live.game_state('${g1.id}')`);
  check("correctness stays hidden until the question closes", midQ3.me.last == null && !midQ3.me.earned, midQ3.me);
  await control(g1.id, "close");
  const review = await rpc(U.studentA, `live.game_state('${g1.id}')`);
  check("a typed gap-fill answer is marked right ('Five' for 5)", review.me.last?.is_correct === true, review.me.last);
  check("three right in a row earns a power-up, shown at the reveal", review.me.powerups.length === 1 && review.me.earned === review.me.powerups[0], review.me);
  const kind = review.me.powerups[0];
  await control(g1.id, "next");
  await expectError("a power-up you don't hold cannot be used", U.studentA, `select live.game_use_powerup('${g1.id}', '${kind === "double" ? "shield" : "double"}')`, /do not have/);
  const used = await rpc(U.studentA, `live.game_use_powerup('${g1.id}', '${kind}')`);
  check(`using it (${kind}) makes it active`, used.active === kind, used);
  if (kind === "fifty") {
    const s = await rpc(U.studentA, `live.game_state('${g1.id}')`);
    check("50:50 removes half of the wrong options from your screen only", s.question.options.length === 3, s.question.options);
    const other = await rpc(S[0], `live.game_state('${g1.id}')`);
    check("…and nobody else's", other.question.options.length === 4, other.question.options.length);
  }
  await answer(U.studentA, g1.id, 3, kind !== "shield");
  const ada = await one(U.studentA, `select live.game_state('${g1.id}') s`);
  check("the power-up is spent", ada.s.me.powerups.length === 0 && ada.s.me.active_powerup == null, ada.s.me);
  if (kind === "double") {
    const d = await q(`select a.powerup_bonus from live.game_answers a join live.game_players p on p.id = a.player_id where p.game_id = '${g1.id}' and p.user_id = '${U.studentA}' and a.question_index = 3`);
    check("double doubles a right answer", d[0]?.powerup_bonus > 0, d);
  }
  if (kind === "shield") check("a shield keeps the streak through a wrong answer", ada.s.me.streak === 3, ada.s.me);
  // Mid-question the class board is hidden; the teacher sees every row, the student their own.
  const board = await rpc(U.teacherA, `live.game_leaderboard('${g1.id}', 50)`);
  const mineB = await rpc(U.studentA, `live.game_leaderboard('${g1.id}', 50)`);
  const keys = board.top.map(e => e.key);
  check("every player has a different board key", new Set(keys).size === keys.length && keys.length === 4, keys);
  check("…and you are found by your key, not your name", board.top.find(e => e.key === mineB.me.key)?.player_id === mineB.me.player_id && mineB.top.length === 0, mineB);
  check("keys never expose user ids", !keys.some(k => players.some(p => p.replace(/-/g, "").startsWith(k))), keys);
  await control(g1.id, "end");
  const ended = await q(`select p.user_id, p.badges from live.game_players p where p.game_id = '${g1.id}'`);
  check("the winner gets gold", ended.find(r => r.user_id === U.studentA).badges.includes("gold"), ended);
  const xp = await q(`select points from live.xp_events where student_id = '${U.studentA}' and source = 'game_result' and source_id = '${g1.id}'`);
  check("right answers turn into XP (5 each + podium bonus)", xp[0]?.points >= 25, xp);
  const note = await q(`select link from live.notifications where user_id = '${S[0]}' and kind = 'game_created' order by created_at desc limit 1`);
  check("the game notification links to the Synergy Swift player screen", note[0]?.link === `/live/student/game/${g1.id}`, note);

  console.log("\nLive games: team battle is scored by average, not team size");
  const g2 = await rpc(U.teacherA, `live.create_game('${CG}', '${ACT}', '{"mode":"team_battle","team_count":2,"question_seconds":0}'::jsonb)`);
  for (const p of players) await rpc(p, `live.join_game('${g2.join_code}')`);
  const teams = await q(`select team_id, count(*) n from live.game_players where game_id = '${g2.id}' group by 1`);
  check("players are split evenly across the teams", teams.length === 2 && teams.every(t => Number(t.n) === 2), teams);
  await control(g2.id, "start");
  await answer(U.studentA, g2.id, 0, true);
  const tb = await rpc(U.teacherA, `live.game_leaderboard('${g2.id}', 50)`);
  const top = tb.teams[0];
  check("a team's score is its players' average", top.score === Math.round(top.total / top.members), tb.teams);
  await control(g2.id, "end");

  console.log("\nLive games: survival");
  const g3 = await rpc(U.teacherA, `live.create_game('${CG}', '${ACT}', '{"mode":"survival","lives":2,"question_seconds":0,"powerups":false}'::jsonb)`);
  for (const p of players) await rpc(p, `live.join_game('${g3.join_code}')`);
  await control(g3.id, "start");
  await answer(S[0], g3.id, 0, false);
  for (const p of [U.studentA, S[1]]) await answer(p, g3.id, 0, true);
  await control(g3.id, "next");
  const lives = Object.fromEntries((await q(`select user_id, lives, out_at from live.game_players where game_id = '${g3.id}'`)).map(r => [r.user_id, r]));
  check("a wrong answer costs a life", lives[S[0]].lives === 1, lives[S[0]]);
  check("so does not answering", lives[S[2]].lives === 1, lives[S[2]]);
  check("a right answer keeps both", lives[U.studentA].lives === 2, lives[U.studentA]);
  await answer(S[0], g3.id, 1, false);
  await expectError("a player out of lives can't answer any more", S[0], `select live.game_answer('${g3.id}', 1, '${RIGHT(2)}'::jsonb)`, /already answered|out of lives/);
  await control(g3.id, "next");
  const s3 = await rpc(U.teacherA, `live.game_state('${g3.id}')`);
  check("the host sees who is still in", s3.alive === 2, s3.alive);
  await expectError("out is out", S[0], `select live.game_answer('${g3.id}', 2, '${ANSWER(3, true)}'::jsonb)`, /out of lives/);
  const sb = await rpc(U.teacherA, `live.game_leaderboard('${g3.id}', 50)`);
  check("survivors rank above anyone who is out", sb.top.slice(0, 2).every(e => !e.out) && sb.top.slice(2).every(e => e.out), sb.top);
  await control(g3.id, "end");
  const surv = await q(`select user_id, badges from live.game_players where game_id = '${g3.id}' and 'survivor' = any(badges)`);
  check("survivors get the survivor badge", surv.length === 2, surv);

  console.log("\nLive games: self-paced (homework) game");
  const g4 = await rpc(U.teacherA, `live.create_game('${CG}', '${ACT}', '{"mode":"self_paced","question_seconds":30,"closes_at":"${new Date(Date.now() + 86400000).toISOString()}"}'::jsonb)`);
  check("it opens straight away with a closing time", g4.status === "open" && !!g4.closes_at, g4);
  await expectError("the teacher does not move it on", U.teacherA, `select live.game_control('${g4.id}', 'next')`, /own pace/);
  await rpc(S[1], `live.join_game('${g4.join_code}')`);
  const first = await rpc(S[1], `live.game_state('${g4.id}')`);
  check("each player gets their own question and clock", first.question_index === 0 && !!first.question_ends_at, first);
  const res = await answer(S[1], g4.id, 0, true);
  check("at your own pace you see the result at once", res.is_correct === true && res.points > 0 && !!res.review, res);
  await expectError("you can't answer the same question twice", S[1], `select live.game_answer('${g4.id}', 0, '${RIGHT(1)}'::jsonb)`, /window is closed|already answered/);
  for (let i = 1; i < 6; i++) await answer(S[1], g4.id, i, true);
  const done = await rpc(S[1], `live.game_state('${g4.id}')`);
  check("after the last question you've finished", done.me.finished === true && !done.question, done.me);
  const xp4 = await q(`select points from live.xp_events where student_id = '${S[1]}' and source = 'game_result' and source_id = '${g4.id}'`);
  check("finishing gives XP", xp4[0]?.points === 30, xp4);
  await expectOk("the teacher can give a day more", U.teacherA, `select live.game_control('${g4.id}', 'extend')`);
  await q(`update live.game_sessions set closes_at = now() - interval '1 minute' where id = '${g4.id}'`);
  const closed = await rpc(S[1], `live.game_state('${g4.id}')`);
  check("past its closing time the game ends by itself", closed.status === "ended", closed.status);

  console.log("\nLive games: guests of a live lesson can play its game");
  await db.exec(`
    insert into auth.users (id, is_anonymous) values ('${GUEST}', true);
    insert into live.users (id, tenant_id, email, full_name, role) values ('${GUEST}', '${T.A}', '', 'Sam Guest', 'guest');
  `);
  const teacher = (await q(`select teacher_id from live.classes where id = '${CG}'`))[0].teacher_id;
  await db.exec(`
    insert into live.class_sessions (id, tenant_id, class_id, teacher_id, title, join_code) values ('${LESSON}', '${T.A}', '${CG}', '${teacher}', 'Fractions live', 'QZ8K2M');
    insert into live.session_guests (session_id, user_id, tenant_id, display_name) values ('${LESSON}', '${GUEST}', '${T.A}', 'Sam Guest');
  `);
  await expectError("a guest can't join a class's game that isn't from their lesson", GUEST, `select live.join_game('${g2.join_code}')`, /another class|No open game/);
  const g5 = await rpc(U.teacherA, `live.create_game('${CG}', '${ACT}', '{"question_seconds":0}'::jsonb, '${LESSON}')`);
  await expectOk("a guest of the lesson joins the game launched from it", GUEST, `select live.join_game('${g5.join_code}')`);
  await expectOk("…and a student joins from the game link", U.studentA, `select live.join_game_by_id('${g5.id}')`);
  const gb = await rpc(GUEST, `live.game_leaderboard('${g5.id}', 50)`);
  check("the guest is on the board, found by key", gb.me?.name === "Sam G." && gb.players === 2, gb.me);
  const listen = await one(GUEST, `select live_app.can_listen('game:${g5.id}') ok`);
  check("…and hears the game's live updates", listen.ok === true, listen);
  await control(g5.id, "end");

  console.log("\nLive lessons: leaderboard keys for guests");
  await db.exec(`insert into live.session_participants (session_id, user_id, tenant_id, status) values ('${LESSON}', '${GUEST}', '${T.A}', 'online'), ('${LESSON}', '${U.studentA}', '${T.A}', 'online')`);
  await q(`select live_app.snapshot_leaderboard('${LESSON}'::uuid)`);
  const lb = (await q(`select leaderboard from live.class_sessions where id = '${LESSON}'`))[0].leaderboard.top;
  const mine = await one(GUEST, `select live.my_board_key('${LESSON}') k`);
  check("the lesson board has a key per row and the guest can find theirs", lb.length === 2 && lb.some(e => e.key === mine.k), { lb, mine });
  await expectRows0("someone outside the lesson gets no key", U.adminB, `select live.my_board_key('${LESSON}') k`);

  console.log("\nCharacters: collected with XP");
  const mc = await rpc(S[2], `live.my_characters()`);
  check("there are sixteen characters, four to start with", mc.characters.length === 16 && mc.characters.filter(c => c.unlocked).length >= 4, mc.characters.filter(c => c.unlocked));
  await expectError("a locked character can't be chosen", S[2], `select live.choose_character('phoenix')`, /Earn 7500 XP/);
  await q(`select live_app.give_xp('${T.A}', '${S[2]}', '${CG}', 'teacher', gen_random_uuid(), 100, 'Great work')`);
  const got = await q(`select critter from live.student_characters where student_id = '${S[2]}'`);
  check("reaching 100 XP unlocks the tiger", got.some(r => r.critter === "tiger"), got);
  const told = await q(`select title from live.notifications where user_id = '${S[2]}' and kind = 'character'`);
  check("…and the student is told", told.some(r => /Tiger/.test(r.title)), told);
  await expectOk("an unlocked character can be chosen", S[2], `select live.choose_character('tiger')`);
  const g6 = await rpc(U.teacherA, `live.create_game('${CG}', '${ACT}', '{"question_seconds":0}'::jsonb)`);
  await rpc(S[2], `live.join_game('${g6.join_code}')`);
  const av = await q(`select avatar from live.game_players where game_id = '${g6.id}' and user_id = '${S[2]}'`);
  check("they play as their chosen character", av[0]?.avatar === "tiger", av);
  await expectError("a guest can't wear a character they haven't earned", GUEST, `select live.set_avatar('${LESSON}', 'dragon')`, /Earn/);
  await expectOk("…but can pick a starter", GUEST, `select live.set_avatar('${LESSON}', 'fox')`);
  await expectError("nobody can hand themselves characters", S[2], `insert into live.student_characters (student_id, tenant_id, critter) values ('${S[2]}', '${T.A}', 'phoenix')`, /permission denied|row-level security/);

  // Leave the shared fixture as it was.
  await db.exec(`delete from live.game_sessions where tenant_id = '${T.A}'; delete from live.class_sessions where id = '${LESSON}'; delete from live.activities where id = '${ACT}';`);
  await db.exec(`delete from students where user_id in (${S.map(x => `'${x}'`).join(",")}); delete from users where id in (${S.map(x => `'${x}'`).join(",")});`);

  async function expectRows0(name, uid, sql) {
    try { const r = await one(uid, sql); check(name, r.k == null, r); } catch (e) { check(name, true, e.message); }
  }
}
