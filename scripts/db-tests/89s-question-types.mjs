// Phase 14a question types: the new types are accepted, unknown ones are not, and a reading passage carries no marks.
export default async function ({ q, expectOk, expectError, check, U, T }) {
  const EXAM = "ab000000-0000-0000-0000-000000000000";
  const server = async (name, sql, re) => {
    try { await q(sql); check(name, !re, re ? "expected an error" : null); }
    catch (e) { check(name, Boolean(re && re.test(e.message)), e.message); }
  };
  console.log("\nNew question types");
  for (const type of ["matrix", "highlight", "label_image", "graph_plot", "chem_equation", "rating", "drawing", "audio_response"]) {
    await expectOk(`a teacher can bank a ${type} question`, U.teacherA,
      `insert into question_bank (tenant_id, created_by, type, prompt) values ('${T.A}', '${U.teacherA}', '${type}', 'Q')`);
  }
  await expectError("an unknown type is refused", U.teacherA,
    `insert into question_bank (tenant_id, created_by, type, prompt) values ('${T.A}', '${U.teacherA}', 'magic', 'Q')`, /check constraint/);
  await server("a reading passage cannot carry marks",
    `insert into exam_questions (exam_id, type, prompt, points) values ('${EXAM}', 'passage', 'Read this', 2)`, /passage_points/);
  await server("a reading passage with no marks is fine",
    `insert into exam_questions (exam_id, type, prompt, points) values ('${EXAM}', 'passage', 'Read this', 0)`);
  await q(`delete from exam_questions where exam_id = '${EXAM}' and type = 'passage'`);
}
