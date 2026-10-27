// Function hardening: what the anon key, signed-in users and the server may call directly.
export default async function ({ db, q, expectRows, expectError, expectOk, check, U }) {
  const anon = async (name, sql, re) => {
    await db.exec("set role anon");
    try { const rows = (await db.query(sql)).rows; check(name, !re, re ? "expected an error" : null); return rows; }
    catch (e) { check(name, Boolean(re && re.test(e.message)), e.message); }
    finally { await db.exec("reset role"); }
  };
  const can = async (role, fn) => (await q(`select has_function_privilege('${role}', 'public.${fn}', 'execute') v`))[0].v;

  console.log("\nFunction hardening");
  await anon("the anon key cannot issue library books", "select library_issue(gen_random_uuid(), null, null, 14)", /permission denied/);
  await anon("the anon key cannot move stock", "select inventory_move(gen_random_uuid(), 'in', 1, 'x', null)", /permission denied/);
  await anon("the anon key cannot look up games", "select * from game_by_code('ABC123')", /permission denied/);
  await anon("the anon key cannot take invoice numbers", "select next_platform_invoice_number()", /permission denied/);
  await expectError("signed-in users cannot take invoice numbers", U.adminA, "select next_platform_invoice_number()", /permission denied/);
  check("the server can still take invoice numbers", await can("service_role", "next_platform_invoice_number()"));

  const rows = await anon("the classroom extension can still look up a session code", "select * from session_by_code('NOPE00')");
  check("…and an unknown code finds nothing", Array.isArray(rows) && rows.length === 0);
  check("the extension can still send heartbeats", await can("anon", "device_heartbeat(text)"));
  const [st] = (await anon("access checks still answer the anon key", "select is_staff() v")) ?? [{}];
  check("…with no", st?.v === false || st?.v === null);
  const kids = await anon("anonymous table reads see nothing instead of failing", "select count(*) n from students");
  check("…zero students", kids && Number(kids[0].n) === 0);

  await expectOk("signed-in users can still check their roles", U.teacherA, "select my_roles()");
  await expectOk("signed-in users can still look up a class code", U.studentA, "select * from class_lookup_by_code('NOPE00')");
  check("nobody calls trigger functions directly", !(await can("anon", "users_guard()")) && !(await can("authenticated", "users_guard()")));
  const [{ n }] = await q(`select count(*) n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
    where s.nspname = 'public' and p.prosecdef and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`);
  check("every security-definer function pins its search_path", Number(n) === 0, `${n} without`);
}
