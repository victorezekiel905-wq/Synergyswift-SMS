// Migration 9200: grading systems per stage, and preschool (early years) assessment.
export default async function ({ db, expectRows, expectError, expectOk, U, T }) {
  const TERM = "a5000000-0000-0000-0000-000000000000", S1 = "a8000000-0000-0000-0000-000000000001";
  const AREA = "ae000000-0000-0000-0000-000000000001", ITEM = "ae100000-0000-0000-0000-000000000001";
  console.log("\nPreschool assessment and grading stages");

  await expectOk("a grading system can be for preschool and use the early-years layout", U.adminA,
    `insert into grading_schemes (tenant_id, name, template, stage) values ('${T.A}', 'Preschool', 'early_years', 'preschool')`);
  await expectError("stages are a fixed list", U.adminA,
    `insert into grading_schemes (tenant_id, name, stage) values ('${T.A}', 'Odd', 'nursery')`, /check constraint/);

  await expectOk("an admin adds an area of learning", U.adminA,
    `insert into early_years_areas (id, tenant_id, name) values ('${AREA}', '${T.A}', 'Literacy')`);
  await expectOk("…and what a child can do in it", U.adminA,
    `insert into early_years_items (id, tenant_id, area_id, text) values ('${ITEM}', '${T.A}', '${AREA}', 'Writes own name')`);
  await expectError("teachers can't change the checklist", U.teacherA,
    `insert into early_years_areas (tenant_id, name) values ('${T.A}', 'Mine')`, /row-level security/);
  await expectRows("everyone in the school reads the checklist", U.teacherA, "select count(*) n from early_years_items", 1);
  await expectRows("another school sees none of it", U.adminB, "select count(*) n from early_years_areas", 0);
  await expectError("another school can't hang its statement on this school's area", U.adminB,
    `insert into early_years_items (tenant_id, area_id, text) values ('${T.B}', '${AREA}', 'x')`, /foreign key|row-level security/);

  await expectOk("the child's teacher rates them", U.teacherA,
    `insert into early_years_ratings (tenant_id, term_id, student_id, item_id, rating) values ('${T.A}', '${TERM}', '${S1}', '${ITEM}', 2)`);
  await expectError("ratings stay on a small scale", U.adminA,
    `update early_years_ratings set rating = 9 where item_id = '${ITEM}'`, /check constraint/);
  await expectError("staff who don't teach the child can't rate them", U.bursarA,
    `insert into early_years_comments (tenant_id, term_id, student_id, area_id, comment) values ('${T.A}', '${TERM}', '${S1}', '${AREA}', 'x')`, /row-level security/);
  await expectOk("the teacher writes a comment for the area", U.teacherA,
    `insert into early_years_comments (tenant_id, term_id, student_id, area_id, comment) values ('${T.A}', '${TERM}', '${S1}', '${AREA}', 'Loves stories')`);
  await expectRows("staff read ratings", U.bursarA, "select count(*) n from early_years_ratings", 1);
  await expectRows("parents see them only on the published report card", U.parentA, "select count(*) n from early_years_ratings", 0);
  await expectRows("…and so do students", U.studentA, "select count(*) n from early_years_comments", 0);
  await expectRows("another school sees no ratings", U.adminB, "select count(*) n from early_years_ratings", 0);

  console.log("\nSubject teachers set their subject's own parts");
  const OFF = `(select id from subject_offerings where class_group_id = 'a2000000-0000-0000-0000-000000000000' and subject_id = 'a3000000-0000-0000-0000-000000000000')`;
  const PART = "ab000000-0000-0000-0000-000000000001";
  await expectError("a subject teacher can't set parts until the school allows it", U.teacherA,
    `insert into grading_components (offering_id, name, max_score, weight) values (${OFF}, 'CAT 1', 20, 10)`, /row-level security/);
  await expectOk("an admin lets subject teachers set their own parts", U.adminA,
    "update grading_schemes set subject_parts = true where id = 'a6000000-0000-0000-0000-000000000000'");
  await expectOk("then the subject's teacher sets a part for their subject in that class", U.teacherA,
    `insert into grading_components (id, offering_id, name, max_score, weight) values ('${PART}', ${OFF}, 'CAT 1', 20, 10)`);
  await expectError("…but a teacher who doesn't teach that subject there can't", U.teacherA2,
    `insert into grading_components (offering_id, name, max_score, weight) values (${OFF}, 'Mine', 10, 10)`, /row-level security/);
  await expectError("…and a teacher can't add parts to the school's grading system", U.teacherA,
    "insert into grading_components (scheme_id, name, max_score, weight) values ('a6000000-0000-0000-0000-000000000000', 'Sneaky', 10, 10)", /row-level security/);
  await expectError("a part belongs to a grading system or to a subject, not both", U.adminA,
    `insert into grading_components (scheme_id, offering_id, name, max_score, weight) values ('a6000000-0000-0000-0000-000000000000', ${OFF}, 'Both', 10, 10)`, /check constraint/);
  await expectRows("everyone in the school reads the subject's parts", U.teacherA2, `select count(*) n from grading_components where id = '${PART}'`, 1);
  await expectRows("another school doesn't", U.adminB, `select count(*) n from grading_components where id = '${PART}'`, 0);
  await expectOk("the teacher enters marks against the subject's own part", U.teacherA,
    `insert into score_entries (tenant_id, term_id, student_id, subject_id, component_id, score) values ('${T.A}', '${TERM}', '${S1}', 'a3000000-0000-0000-0000-000000000000', '${PART}', 17)`);
  await expectOk("when the school stops allowing it, the parts stay", U.adminA,
    "update grading_schemes set subject_parts = false where id = 'a6000000-0000-0000-0000-000000000000'");
  await expectRows("…but the teacher can no longer change them", U.teacherA,
    `with u as (update grading_components set max_score = 30 where id = '${PART}' returning 1) select count(*) n from u`, 0);
  await db.exec(`delete from score_entries where component_id = '${PART}'; delete from grading_components where id = '${PART}'`);

  await db.exec(`delete from early_years_areas where id = '${AREA}'`);
  await expectRows("deleting an area takes its statements and ratings with it", U.adminA,
    "select (select count(*) from early_years_items) + (select count(*) from early_years_ratings) + (select count(*) from early_years_comments) n", 0);
  await db.exec(`delete from grading_schemes where name = 'Preschool' and tenant_id = '${T.A}'`);
}
