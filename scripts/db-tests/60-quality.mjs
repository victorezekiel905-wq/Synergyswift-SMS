// Fixes found in review.
export default async function ({ expectRows, expectError, expectOk, U, T }) {
  console.log("\nBrowsing policies");
  await expectError("a policy without a school is refused", U.teacherA,
    `insert into environment_policies (tenant_id, name, mode) values (null, 'Loose', 'focus')`, /row-level security/);
  await expectError("a policy for another school is refused", U.teacherA,
    `insert into environment_policies (tenant_id, name, mode) values ('${T.B}', 'Foreign', 'focus')`, /row-level security/);
  await expectOk("a teacher creates a policy for their own school", U.teacherA,
    `insert into environment_policies (tenant_id, name, mode) values ('${T.A}', 'Exam focus', 'focus')`);
  await expectRows("the teacher can see it", U.teacherA, "select count(*) n from environment_policies where name = 'Exam focus'", 1);
  await expectRows("another school cannot", U.adminB, "select count(*) n from environment_policies", 0);
}
