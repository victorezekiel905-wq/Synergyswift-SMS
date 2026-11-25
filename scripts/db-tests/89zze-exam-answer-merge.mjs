// Exam answers saved in one step (migration 10700): an autosave and an upload at the same moment
// both keep their answers; a handed-in attempt is not changed; only the server may call it.
export default async function ({ q, expectError, check, U, T }) {
  console.log("\nExam answers: saved in one step, nothing overwritten");
  const EXAM = "ab000000-0000-0000-0000-000000000000"; // the published exam made in Hardening
  const A = "ae700000-0000-0000-0000-000000000001";
  await q(`insert into exam_attempts (id, tenant_id, exam_id, student_user_id, started_at, deadline_at, answers)
    values ('${A}', '${T.A}', '${EXAM}', '${U.studentA}', now(), now() + interval '1 hour', '{"q1": "typed earlier"}')`);
  const answers = async () => (await q(`select answers from exam_attempts where id = '${A}'`))[0].answers;

  // Two saves made from the same starting point (what used to wipe one out): both are kept.
  await q(`select * from exam_merge_answers('${A}', '{"q2": "typed now"}'::jsonb)`);
  await q(`select * from exam_merge_answers('${A}', '{"q3": {"name": "photo.jpg", "size": 1200}}'::jsonb)`);
  const a = await answers();
  check("an autosave and an upload at the same time both keep their answers", a.q1 === "typed earlier" && a.q2 === "typed now" && a.q3?.name === "photo.jpg", a);
  await q(`select * from exam_merge_answers('${A}', '{"q2": "changed"}'::jsonb)`);
  check("…and a changed answer replaces only itself", (await answers()).q2 === "changed" && (await answers()).q1 === "typed earlier");

  await q(`update exam_attempts set status = 'submitted' where id = '${A}'`);
  const after = await q(`select * from exam_merge_answers('${A}', '{"q4": "too late"}'::jsonb)`);
  check("a handed-in attempt is not changed", after.length === 0 && (await answers()).q4 === undefined);

  await expectError("students cannot call it directly", U.studentA, `select * from exam_merge_answers('${A}', '{}'::jsonb)`, /permission denied/);
  await q(`delete from exam_attempts where id = '${A}'`);
}
