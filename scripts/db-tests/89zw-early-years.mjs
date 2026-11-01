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

  await db.exec(`delete from early_years_areas where id = '${AREA}'`);
  await expectRows("deleting an area takes its statements and ratings with it", U.adminA,
    "select (select count(*) from early_years_items) + (select count(*) from early_years_ratings) + (select count(*) from early_years_comments) n", 0);
  await db.exec(`delete from grading_schemes where name = 'Preschool' and tenant_id = '${T.A}'`);
}
