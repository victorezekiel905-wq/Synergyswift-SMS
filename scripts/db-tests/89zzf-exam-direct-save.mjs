// Exam autosaves straight to the database (migration 10800): only the student's own attempt, only
// questions on their paper, not when locked, handed in or out of time, and not for exams that need
// the server's network or Safe Exam Browser checks.
export default async function ({ db, q, as, check, U, T }) {
  console.log("\nExam autosave straight to the database");
  const EXAM = "ab000000-0000-0000-0000-000000000000"; // the published exam made in Hardening
  const A = "ae800000-0000-0000-0000-000000000001";
  const Q1 = "ae800000-0000-0000-0000-0000000000a1", Q2 = "ae800000-0000-0000-0000-0000000000a2";
  await q(`delete from exam_attempts where exam_id = '${EXAM}' and student_user_id = '${U.studentA}'`);
  await q(`insert into exam_attempts (id, tenant_id, exam_id, student_user_id, started_at, deadline_at, question_order, answers)
    values ('${A}', '${T.A}', '${EXAM}', '${U.studentA}', now(), now() + interval '1 hour', '["${Q1}", "${Q2}"]', '{"${Q1}": "kept"}')`);
  const save = async (uid, answers) => (await as(uid, () => q(`select exam_student_save('${EXAM}', '${JSON.stringify(answers)}'::jsonb) r`)))[0].r;
  const answers = async () => (await q(`select answers from exam_attempts where id = '${A}'`))[0].answers;

  const r1 = await save(U.studentA, { [Q2]: "B", "not-on-my-paper": "x" });
  const a1 = await answers();
  check("a student saves their own answers, merged with what was saved", r1.status === "in_progress" && r1.saved === 1 && a1[Q1] === "kept" && a1[Q2] === "B", { r1, a1 });
  check("…and questions not on their paper are ignored", a1["not-on-my-paper"] === undefined);

  const other = await save(U.teacherA, { [Q2]: "changed by someone else" });
  check("nobody else can save into the attempt", other.status === "not_started" && (await answers())[Q2] === "B", other);

  await q(`update exam_attempts set status = 'locked' where id = '${A}'`);
  check("a locked attempt is not saved", (await save(U.studentA, { [Q2]: "C" })).status === "locked" && (await answers())[Q2] === "B");
  await q(`update exam_attempts set status = 'in_progress', deadline_at = now() - interval '2 minutes' where id = '${A}'`);
  check("after the deadline and grace it says time is up", (await save(U.studentA, { [Q2]: "C" })).status === "time_up" && (await answers())[Q2] === "B");
  await q(`update exam_attempts set status = 'submitted', deadline_at = now() + interval '1 hour' where id = '${A}'`);
  check("a handed-in attempt is not changed", (await save(U.studentA, { [Q2]: "C" })).status === "submitted" && (await answers())[Q2] === "B");

  await q(`update exam_attempts set status = 'in_progress' where id = '${A}'`);
  await q(`update exams set settings = settings || '{"require_seb": true}' where id = '${EXAM}'`);
  check("an exam that needs Safe Exam Browser saves through the server", (await save(U.studentA, { [Q2]: "C" })).status === "use_server");
  await q(`update exams set settings = settings - 'require_seb' where id = '${EXAM}'`);

  let anon = "";
  await db.exec("set role anon");
  try { await q(`select exam_student_save('${EXAM}', '{}'::jsonb)`); anon = "allowed"; } catch (e) { anon = String(e.message); } finally { await db.exec("reset role"); }
  check("someone not signed in cannot use it", /permission denied/.test(anon), anon);
  await q(`delete from exam_attempts where id = '${A}'`);
}
