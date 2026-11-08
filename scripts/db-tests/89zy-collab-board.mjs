// Collaborative boards are ready for students straight away (migration 9310): no waiting for
// the teacher's Responses tab, one board per activity per lesson, and only for people in it.
export default async function ({ q, as, expectError, check, U, T }) {
  const CG = "a2000000-0000-0000-0000-000000000000";
  const SESSION = "f7000000-0000-0000-0000-0000000000b1", ACT = "f7000000-0000-0000-0000-0000000000b2", QUIZ = "f7000000-0000-0000-0000-0000000000b3";
  console.log("\nCollaborative board opens for students in a live lesson");
  const teacher = (await q(`select teacher_id from live.classes where id = '${CG}'`))[0]?.teacher_id;
  await q(`insert into live.class_sessions (id, tenant_id, class_id, teacher_id, title, join_code) values ('${SESSION}', '${T.A}', '${CG}', '${teacher}', 'Ideas', 'QZ7B0D')`);
  await q(`insert into live.activities (id, tenant_id, owner_id, kind, title) values ('${ACT}', '${T.A}', '${teacher}', 'collab_board', 'Our ideas'),
                                                                                  ('${QUIZ}', '${T.A}', '${teacher}', 'quiz', 'A quiz')`);

  const call = (uid) => as(uid, async () => (await q(`select live.ensure_collab_board('${ACT}', '${SESSION}') b`))[0].b);
  const first = await call(U.studentA);
  check("a student in the lesson opens the board before the teacher has", Boolean(first?.id), first);
  check("…it belongs to the lesson's teacher", first?.owner_id === teacher, first);
  check("…and is open for posting", first?.locked === false, first);
  const again = await call(teacher);
  check("the lesson's teacher gets the same board, not a second one", again?.id === first?.id, again);
  const boards = await q(`select count(*)::int n from live.collab_boards where activity_id = '${ACT}' and session_id = '${SESSION}'`);
  check("one board per activity per lesson", boards[0].n === 1, boards[0]);

  const posted = await as(U.studentA, async () => {
    try { await q(`insert into live.collab_posts (tenant_id, board_id, author_id, body) values ('${T.A}', '${first.id}', '${U.studentA}', 'Fractions are parts of a whole')`); return true; }
    catch (e) { return e.message; }
  });
  check("the student can post on it", posted === true, posted);

  // Guests (joined with the code and a name, an anonymous sign-in) use the board like students.
  const GUEST = "f7000000-0000-0000-0000-0000000000b4", STRANGER = "f7000000-0000-0000-0000-0000000000b5";
  await q(`insert into auth.users (id, is_anonymous) values ('${GUEST}', true), ('${STRANGER}', true)`);
  await q(`insert into live.users (id, tenant_id, email, full_name, role) values ('${GUEST}', '${T.A}', '', 'Sam Guest', 'guest'), ('${STRANGER}', '${T.A}', '', 'Not Here', 'guest')`);
  await q(`insert into live.session_guests (session_id, user_id, tenant_id, display_name) values ('${SESSION}', '${GUEST}', '${T.A}', 'Sam Guest')`);
  const guestBoard = await call(GUEST);
  check("a guest in the lesson opens the same board", guestBoard?.id === first.id, guestBoard);
  const guestPosted = await as(GUEST, async () => {
    try { await q(`insert into live.collab_posts (tenant_id, board_id, author_id, body) values ('${T.A}', '${first.id}', '${GUEST}', 'A guest idea')`); return true; }
    catch (e) { return e.message; }
  });
  check("…and can post on it", guestPosted === true, guestPosted);
  const guestSees = await as(GUEST, async () => (await q(`select count(*)::int n from live.collab_posts where board_id = '${first.id}'`))[0].n);
  check("…and sees everyone's posts", guestSees === 2, guestSees);
  await expectError("a guest from another lesson cannot open it", STRANGER, `select live.ensure_collab_board('${ACT}', '${SESSION}')`, /not found/i);

  await expectError("someone from another school cannot open it", U.adminB, `select live.ensure_collab_board('${ACT}', '${SESSION}')`, /not found/i);
  await expectError("only a collaborative-board activity gets a board", teacher, `select live.ensure_collab_board('${QUIZ}', '${SESSION}')`, /not a collaborative board/);

  await q(`delete from live.collab_boards where session_id = '${SESSION}'`);
  await q(`delete from live.activities where id in ('${ACT}', '${QUIZ}')`);
  await q(`delete from live.session_guests where session_id = '${SESSION}'`);
  await q(`delete from live.class_sessions where id = '${SESSION}'`);
  await q(`delete from live.users where id in ('${GUEST}', '${STRANGER}')`);
  await q(`delete from auth.users where id in ('${GUEST}', '${STRANGER}')`);
}
