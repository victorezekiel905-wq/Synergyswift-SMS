// Sign-up codes (migration 9600): each person the school adds gets a one-use code to make their own
// account with the role the school chose; each student a parent code (up to 4 parents) to sign up
// with or add a child. Only the server can see or use codes.
export default async function ({ q, expectError, check, U, T }) {
  console.log("\nSign-up codes");
  const one = async sql => (await q(sql))[0];
  const codeOf = async (kind, col, id) => (await one(`select code, role from account_codes where kind = '${kind}' and ${col} = '${id}' and revoked_at is null`)) ?? {};
  const newAuth = async (id, email) => q(`insert into auth.users (id, email) values ('${id}', '${email}')`);
  const claim = (code, uid, email, name = null) => q(`select claim_account_code('${code}', '${uid}', '${email}', ${name ? `'${name}'` : "null"}) r`).then(r => r[0].r);

  // People added get codes; people with an account already get no personal code.
  const ST = "a8100000-0000-0000-0000-000000000001", ST2 = "a8100000-0000-0000-0000-000000000002", SF = "ac100000-0000-0000-0000-000000000001", GD = "a9100000-0000-0000-0000-000000000001";
  await q(`insert into students (id, tenant_id, admission_no, first_name, last_name) values ('${ST}', '${T.A}', 'SU-1', 'Chika', 'Eze'), ('${ST2}', '${T.A}', 'SU-2', 'Musa', 'Bello')`);
  await q(`insert into staff (id, tenant_id, staff_no, full_name, email) values ('${SF}', '${T.A}', 'SU-T1', 'Mrs Okon', null)`);
  await q(`insert into guardians (id, tenant_id, full_name, email) values ('${GD}', '${T.A}', 'Mr Eze', 'eze@home.ng')`);
  const sc = await codeOf("staff", "staff_id", SF), stc = await codeOf("student", "student_id", ST), pc = await codeOf("parent_link", "student_id", ST), gc = await codeOf("guardian", "guardian_id", GD);
  check("a new staff member gets a code, as a teacher until a role is set", /^[A-Z2-9]{8}$/.test(sc.code ?? "") && sc.role === "teacher", sc);
  check("a new student gets a sign-up code and a parent code", /^[A-Z2-9]{8}$/.test(stc.code ?? "") && /^[A-Z2-9]{8}$/.test(pc.code ?? "") && stc.code !== pc.code);
  check("a new parent gets a code", /^[A-Z2-9]{8}$/.test(gc.code ?? ""));
  check("codes have no look-alike characters", !/[01IO]/.test(sc.code + stc.code + pc.code + gc.code));
  check("a student who already has an account gets only a parent code",
    !(await one(`select 1 x from account_codes where kind = 'student' and student_id = 'a8000000-0000-0000-0000-000000000001' and revoked_at is null`))
    && Boolean(await one(`select 1 x from account_codes where kind = 'parent_link' and student_id = 'a8000000-0000-0000-0000-000000000001' and revoked_at is null`)));

  // Staff: the role the admin chose is the role they get.
  await q(`select issue_account_code('staff', '${SF}', null, 'bursar', '{librarian}')`);
  const sc2 = await codeOf("staff", "staff_id", SF);
  check("setting a role makes a new code (the old one stops working)", sc2.code !== sc.code && sc2.role === "bursar");
  const SFU = "ac200000-0000-0000-0000-000000000001";
  await newAuth(SFU, "okon@school.ng");
  try { await claim(sc.code, SFU, "okon@school.ng"); check("the old code is refused", false); } catch (e) { check("the old code is refused", /not right/.test(e.message), e.message); }
  const r1 = await claim(`${sc2.code.slice(0, 4)}-${sc2.code.slice(4).toLowerCase()}`, SFU, "Okon@School.ng");
  const prof = await one(`select role, extra_roles, email, full_name, tenant_id from users where id = '${SFU}'`);
  check("a staff member signs up with their code (dash and small letters fine)", r1.role === "bursar" && prof.role === "bursar" && prof.extra_roles.includes("librarian") && prof.tenant_id === T.A, { r1, prof });
  check("…with the school's name for them and their email", prof.full_name === "Mrs Okon" && prof.email === "okon@school.ng");
  check("…joined to their staff record, which takes the email", (await one(`select user_id, email from staff where id = '${SF}'`)).user_id === SFU);
  const SFU2 = "ac200000-0000-0000-0000-000000000002";
  await newAuth(SFU2, "other@x.ng");
  try { await claim(sc2.code, SFU2, "other@x.ng"); check("a used code can't be used again", false); } catch (e) { check("a used code can't be used again", /already been used/.test(e.message), e.message); }

  // Students and parents.
  const STU = "ac200000-0000-0000-0000-000000000003";
  await newAuth(STU, "chika@mail.ng");
  const r2 = await claim(stc.code, STU, "chika@mail.ng");
  check("a student signs up as a student, joined to their record", r2.role === "student" && r2.next === "/student" && (await one(`select user_id from students where id = '${ST}'`)).user_id === STU);
  const GDU = "ac200000-0000-0000-0000-000000000004";
  await newAuth(GDU, "eze@home.ng");
  const r3 = await claim(gc.code, GDU, "eze@home.ng");
  check("a parent signs up as a parent, joined to their record", r3.role === "parent" && r3.next === "/parent" && (await one(`select user_id from guardians where id = '${GD}'`)).user_id === GDU);

  // A parent with only the child's parent code: a parent record is made and linked.
  const P2 = "ac200000-0000-0000-0000-000000000005";
  await newAuth(P2, "mama.chika@mail.ng");
  const r4 = await claim(pc.code, P2, "Mama.Chika@mail.ng", "Mrs Ngozi Eze");
  const g2 = await one(`select g.id, g.full_name, g.email from guardians g where g.user_id = '${P2}'`);
  check("a parent signs up with their child's parent code", r4.role === "parent" && g2?.full_name === "Mrs Ngozi Eze" && g2?.email === "mama.chika@mail.ng", { r4, g2 });
  check("…and sees that child", Boolean(await one(`select 1 x from student_guardians where student_id = '${ST}' and guardian_id = '${g2.id}'`)));
  check("…without a stray code for their new record", !(await one(`select 1 x from account_codes where guardian_id = '${g2.id}' and revoked_at is null`)));
  // The school already has this parent on file (email, no account): that record is used.
  const GD3 = "a9100000-0000-0000-0000-000000000003", P3 = "ac200000-0000-0000-0000-000000000006";
  await q(`insert into guardians (id, tenant_id, full_name, email) values ('${GD3}', '${T.A}', 'Mr Musa Bello', 'musa.bello@mail.ng')`);
  await newAuth(P3, "musa.bello@mail.ng");
  const pc2 = await codeOf("parent_link", "student_id", ST2);
  await claim(pc2.code, P3, "musa.bello@mail.ng", "Musa");
  check("…using the parent record the school already has for that email", (await one(`select user_id from guardians where id = '${GD3}'`)).user_id === P3
    && Number((await one(`select count(*) n from guardians where lower(email) = 'musa.bello@mail.ng'`)).n) === 1);

  // A signed-in parent adds another child.
  const r5 = (await q(`select link_child_with_code('${pc2.code}', '${U.parentA}') r`))[0].r;
  check("a signed-in parent adds a child with its parent code", r5.already === false && r5.name === "Musa Bello"
    && Boolean(await one(`select 1 x from student_guardians sg join guardians g on g.id = sg.guardian_id where g.user_id = '${U.parentA}' and sg.student_id = '${ST2}'`)));
  check("adding the same child again just says so", (await q(`select link_child_with_code('${pc2.code}', '${U.parentA}') r`))[0].r.already === true);
  check("a parent code counts each parent", Number((await one(`select uses from account_codes where code = '${pc2.code}'`)).uses) === 2);
  const pB = await codeOf("parent_link", "student_id", "b8000000-0000-0000-0000-000000000001");
  try { await q(`select link_child_with_code('${pB.code}', '${U.parentA}')`); check("another school's child can't be added", false); }
  catch (e) { check("another school's child can't be added", /not right/.test(e.message), e.message); }
  try { await q(`select link_child_with_code('${pc.code}', '${U.teacherA}')`); check("staff can't add children with a parent code", false); }
  catch (e) { check("staff can't add children with a parent code", /Only parents/.test(e.message), e.message); }
  // At most four parents per code.
  await q(`update account_codes set uses = 3 where code = '${pc.code}'`);
  const P4 = "ac200000-0000-0000-0000-000000000007", P5 = "ac200000-0000-0000-0000-000000000008";
  await newAuth(P4, "aunty@mail.ng"); await newAuth(P5, "uncle@mail.ng");
  await claim(pc.code, P4, "aunty@mail.ng", "Aunty");
  try { await claim(pc.code, P5, "uncle@mail.ng", "Uncle"); check("a parent code stops after four parents", false); }
  catch (e) { check("a parent code stops after four parents", /already been used/.test(e.message), e.message); }

  // Wrong codes, suspended schools, and who can see codes.
  const X = "ac200000-0000-0000-0000-000000000009";
  await newAuth(X, "x@mail.ng");
  try { await claim("ZZZZ-ZZZZ", X, "x@mail.ng"); check("a wrong code is refused kindly", false); } catch (e) { check("a wrong code is refused kindly", /not right/.test(e.message), e.message); }
  const ST3 = "a8100000-0000-0000-0000-000000000003";
  await q(`insert into students (id, tenant_id, admission_no, first_name, last_name) values ('${ST3}', '${T.A}', 'SU-3', 'Ife', 'Ojo')`);
  const c3 = await codeOf("student", "student_id", ST3);
  await q(`update tenants set status = 'suspended' where id = '${T.A}'`);
  try { await claim(c3.code, X, "x@mail.ng"); check("a suspended school's codes don't work", false); } catch (e) { check("a suspended school's codes don't work", /not right/.test(e.message), e.message); }
  await q(`update tenants set status = 'active' where id = '${T.A}'`);
  check("a refused claim makes no account", !(await one(`select 1 x from users where id = '${X}'`)));
  await expectError("staff can't read codes", U.adminA, "select * from account_codes", /permission denied/);
  await expectError("signed-in users can't use codes directly", U.parentA, `select claim_account_code('${c3.code}', '${U.parentA}', 'p@a')`, /permission denied/);
  await expectError("…or add children directly", U.parentA, `select link_child_with_code('${c3.code}', '${U.parentA}')`, /permission denied/);

  // Deleting a student takes the codes with it, and the recycle bin never keeps them.
  await q(`delete from students where id = '${ST3}'`);
  check("codes go when the student goes", !(await one(`select 1 x from account_codes where student_id = '${ST3}'`)));
  check("…and are not kept in the recycle bin", !(await one(`select 1 x from recycle_bin where table_name = 'account_codes'`)));

  // Leave school A as the later tests expect it (they count its students, staff and parents).
  const made = [SFU, STU, GDU, P2, P3, P4];
  await q(`delete from student_guardians where student_id in ('${ST}', '${ST2}')`);
  await q(`delete from students where id in ('${ST}', '${ST2}')`);
  await q(`delete from staff where id = '${SF}'`);
  await q(`delete from guardians where id in ('${GD}', '${GD3}') or user_id in (${made.map(u => `'${u}'`).join(",")})`);
  await q(`delete from users where id in (${made.map(u => `'${u}'`).join(",")})`).catch(() => {});
  await q(`delete from recycle_bin where tenant_id = '${T.A}' and row_id in ('${ST}', '${ST2}', '${ST3}', '${SF}', '${GD}', '${GD3}')`).catch(() => {});
}
