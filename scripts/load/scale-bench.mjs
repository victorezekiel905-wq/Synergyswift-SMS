// Phase 14m: a 20,000-user school database, and how long the busiest permission-checked queries take.
// Builds the whole schema in an in-memory Postgres (PGlite), seeds 10 schools x 2,000 accounts
// (1,400 students, 500 parents, 100 staff each) with a month of attendance, sign-ins, report cards,
// invoices and change history, then times each query as a real signed-in user (row-level security on)
// and prints the query plans of the slowest. PGlite is single-threaded WebAssembly: absolute times are
// several times slower than Supabase, but the ratios and the plans (sequential scans, per-row function
// calls) are what matter.  Usage: node scripts/load/scale-bench.mjs [--quick] [--schools=25]
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const QUICK = process.argv.includes("--quick");
// --schools=N: N schools of 2,000 accounts each (default 10 = 20,000 accounts; 25 = 50,000).
const ARG_SCHOOLS = Number((process.argv.find(x => x.startsWith("--schools=")) ?? "").split("=")[1]);
const SCHOOLS = QUICK ? 2 : ARG_SCHOOLS > 0 ? ARG_SCHOOLS : 10, STUDENTS = 1400, PARENTS = 500, STAFF = 100, CLASSES = 30, DAYS = QUICK ? 5 : 20;
const MIG = fileURLToPath(new URL("../../supabase/migrations/", import.meta.url));
const harness = fs.readFileSync(fileURLToPath(new URL("../db-test.mjs", import.meta.url)), "utf8");
const bootstrap = harness.slice(harness.indexOf("const bootstrap = `") + 19, harness.indexOf("`;", harness.indexOf("const bootstrap = `")));

const db = new PGlite({ extensions: { pgcrypto, pg_trgm } });
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);
await db.exec(bootstrap);
// --before: leave out the row-level-security speed-up (migration 7400), to measure what it changed.
const BEFORE = process.argv.includes("--before");
for (const f of fs.readdirSync(MIG).filter(f => f.endsWith(".sql") && !(BEFORE && f.startsWith("20260101007400"))).sort()) await db.exec(fs.readFileSync(path.join(MIG, f), "utf8"));
log("schema ready");

// Deterministic ids: uuid of md5(text).
const u = (expr) => `md5(${expr})::uuid`;
await db.exec(`set session_replication_role = replica;`);   // seed fast: skip triggers (account automation, live-lesson sync)
for (let s = 1; s <= SCHOOLS; s++) {
  const T = `'${"t" + s}'`;
  await db.exec(`
  insert into tenants (id, name, slug) values (${u(T)}, 'School ${s}', 'school-${s}');
  insert into tenant_settings (tenant_id) values (${u(T)}) on conflict do nothing;
  insert into academic_sessions (id, tenant_id, name) values (${u(`${T}||'-sess'`)}, ${u(T)}, '2026/2027');
  insert into terms (id, tenant_id, session_id, name, is_current) values (${u(`${T}||'-term'`)}, ${u(T)}, ${u(`${T}||'-sess'`)}, 'First', true);
  insert into auth.users (id) select ${u(`${T}||'-u-'||g`)} from generate_series(1, ${STUDENTS + PARENTS + STAFF}) g;
  insert into users (id, tenant_id, email, full_name, role)
    select ${u(`${T}||'-u-'||g`)}, ${u(T)}, 'u'||g||'@school${s}.ng', 'Person '||g,
      case when g <= ${STAFF} then (case when g <= 5 then 'school_admin' when g = 6 then 'bursar' when g = 7 then 'hr_manager' when g = 8 then 'exam_officer' when g = 9 then 'gate_officer' else 'teacher' end)
           when g <= ${STAFF + STUDENTS} then 'student' else 'parent' end
    from generate_series(1, ${STUDENTS + PARENTS + STAFF}) g;
  insert into staff (tenant_id, user_id, staff_no, full_name) select ${u(T)}, ${u(`${T}||'-u-'||g`)}, 'S-'||g, 'Person '||g from generate_series(1, ${STAFF}) g;
  insert into class_groups (id, tenant_id, name, form_teacher_id) select ${u(`${T}||'-c-'||g`)}, ${u(T)}, 'Class '||g, ${u(`${T}||'-u-'||(10+g)`)} from generate_series(1, ${CLASSES}) g;
  insert into subjects (id, tenant_id, name) select ${u(`${T}||'-sub-'||g`)}, ${u(T)}, 'Subject '||g from generate_series(1, 10) g;
  insert into subject_offerings (tenant_id, class_group_id, subject_id, teacher_id)
    select ${u(T)}, ${u(`${T}||'-c-'||c`)}, ${u(`${T}||'-sub-'||j`)}, ${u(`${T}||'-u-'||(10 + ((c * 10 + j) % 90))`)} from generate_series(1, ${CLASSES}) c, generate_series(1, 10) j;
  insert into students (id, tenant_id, user_id, admission_no, first_name, last_name, class_group_id)
    select ${u(`${T}||'-s-'||g`)}, ${u(T)}, ${u(`${T}||'-u-'||(${STAFF}+g)`)}, 'A'||g, 'Student', 'No'||g, ${u(`${T}||'-c-'||(1 + g % ${CLASSES})`)} from generate_series(1, ${STUDENTS}) g;
  insert into guardians (id, tenant_id, user_id, full_name, phone)
    select ${u(`${T}||'-g-'||g`)}, ${u(T)}, ${u(`${T}||'-u-'||(${STAFF + STUDENTS}+g)`)}, 'Parent '||g, '+23480'||lpad(g::text, 8, '0') from generate_series(1, ${PARENTS}) g;
  insert into student_guardians (tenant_id, student_id, guardian_id) select ${u(T)}, ${u(`${T}||'-s-'||g`)}, ${u(`${T}||'-g-'||(1 + g % ${PARENTS})`)} from generate_series(1, ${STUDENTS}) g;
  insert into class_attendance (tenant_id, student_id, date, status, class_group_id)
    select ${u(T)}, ${u(`${T}||'-s-'||g`)}, current_date - d, case when (g + d) % 17 = 0 then 'absent' when (g + d) % 11 = 0 then 'late' else 'present' end, ${u(`${T}||'-c-'||(1 + g % ${CLASSES})`)}
    from generate_series(1, ${STUDENTS}) g, generate_series(0, ${DAYS - 1}) d;
  insert into gate_events (tenant_id, person_type, student_id, direction, method, at)
    select ${u(T)}, 'student', ${u(`${T}||'-s-'||g`)}, 'in', 'kiosk', now() - make_interval(days => d, mins => g % 60) from generate_series(1, ${STUDENTS}) g, generate_series(0, ${Math.min(DAYS, 10) - 1}) d;
  insert into report_cards (tenant_id, term_id, student_id, status, average, total)
    select ${u(T)}, ${u(`${T}||'-term'`)}, ${u(`${T}||'-s-'||g`)}, 'published', 40 + (g % 55), 400 + g % 300 from generate_series(1, ${STUDENTS}) g;
  insert into fee_invoices (tenant_id, student_id, term_id, invoice_no, total, amount_paid, status)
    select ${u(T)}, ${u(`${T}||'-s-'||g`)}, ${u(`${T}||'-term'`)}, 'INV-'||g, 250000, (g % 4) * 62500, case when g % 4 = 0 then 'issued' when g % 4 = 3 then 'part_paid' else 'part_paid' end from generate_series(1, ${STUDENTS}) g;
  insert into audit_logs (tenant_id, actor_id, action, ts) select ${u(T)}, ${u(`${T}||'-u-'||(1 + g % ${STAFF})`)}, (array['results.saved','fees.paid','exams.started','hr.leave','gate.in'])[1 + g % 5], now() - make_interval(hours => g % 1400) from generate_series(1, 5000) g;
  `);
  log(`school ${s} seeded`);
}
await db.exec(`set session_replication_role = origin; analyze;`);
const counts = (await db.query(`select (select count(*) from users) users, (select count(*) from students) students, (select count(*) from class_attendance) attendance, (select count(*) from gate_events) gate, (select count(*) from audit_logs) audit`)).rows[0];
log("seeded", JSON.stringify(counts));

// ---------- the benchmark ----------
const pick = async (sql) => (await db.query(sql)).rows[0]?.id;
const S1 = "'t1'";
const who = {
  admin: await pick(`select md5(${S1}||'-u-1')::uuid id`),
  teacher: await pick(`select md5(${S1}||'-u-20')::uuid id`),
  student: await pick(`select md5(${S1}||'-u-${STAFF + 7}')::uuid id`),
  parent: await pick(`select md5(${S1}||'-u-${STAFF + STUDENTS + 7}')::uuid id`)
};
const cls = await pick(`select md5(${S1}||'-c-10')::uuid id`);
async function as(uid, sql) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false); select set_config('request.jwt.claims', '{"sub":"${uid}","aal":"aal1"}', false);`);
  try { return await db.query(sql); } finally { await db.exec(`reset role;`); }
}
const CASES = [
  ["parent", "My children (portal home)", `select s.id, s.first_name from students s order by s.first_name`],
  ["parent", "My children's report cards", `select r.student_id, r.average from report_cards r where r.status = 'published'`],
  ["parent", "My children's attendance this month", `select student_id, status, count(*) from class_attendance where date > current_date - 30 group by 1, 2`],
  ["student", "My report card", `select average from report_cards`],
  ["teacher", "A class register for today", `select s.id, a.status from students s left join class_attendance a on a.student_id = s.id and a.date = current_date where s.class_group_id = '${cls}'`],
  ["teacher", "My classes' attendance this week", `select class_group_id, status, count(*) from class_attendance where date > current_date - 7 group by 1, 2`],
  ["admin", "School: students on roll", `select count(*) from students where status = 'active'`],
  ["admin", "School: today's attendance summary", `select status, count(*) from class_attendance where date = current_date group by 1`],
  ["admin", "School: 30-day attendance (dashboards, analytics)", `select date, status, count(*) from class_attendance where date > current_date - 30 group by 1, 2`],
  ["admin", "School: fees outstanding", `select sum(total - amount_paid) from fee_invoices where status <> 'void'`],
  ["admin", "School: gate log today", `select count(*) from gate_events where at > current_date`],
  ["admin", "School: change history (latest 50)", `select * from audit_logs order by ts desc limit 50`]
];
const RUNS = QUICK ? 3 : 7;
const results = [];
for (const [role, label, sql] of CASES) {
  const times = [];
  let rows = 0;
  for (let i = 0; i < RUNS; i++) { const a = performance.now(); const r = await as(who[role], sql); times.push(performance.now() - a); rows = r.rows.length; }
  times.sort((a, b) => a - b);
  results.push({ role, label, rows, median_ms: Math.round(times[Math.floor(times.length / 2)]), worst_ms: Math.round(times[times.length - 1]), sql });
  log(`${role.padEnd(7)} ${label.padEnd(52)} median ${Math.round(times[Math.floor(times.length / 2)])} ms, worst ${Math.round(times[times.length - 1])} ms, ${rows} rows`);
}
// What the permission checks cost: the same count as the school's admin (RLS) and as the server with an explicit school filter.
{
  const tid = await pick(`select md5(${S1})::uuid id`);
  const m = async (fn) => { const ts = []; for (let i = 0; i < RUNS; i++) { const a = performance.now(); await fn(); ts.push(performance.now() - a); } ts.sort((a, b) => a - b); return Math.round(ts[Math.floor(ts.length / 2)]); };
  const rls = await m(() => as(who.admin, "select count(*) from class_attendance"));
  const direct = await m(() => db.query(`select count(*) from class_attendance where tenant_id = '${tid}'`));
  results.push({ role: "compare", label: "Count one school's attendance rows: RLS (median) vs server filter (worst column)", rows: 1, median_ms: rls, worst_ms: direct, sql: null });
  log("RLS cost: admin count", rls, "ms vs explicit filter", direct, "ms");
}
// The platform's own view across every school.
{ const a = performance.now(); await db.query(`select * from platform_customer_metrics()`); results.push({ role: "platform", label: "Super admin: customer health (all schools)", rows: SCHOOLS, median_ms: Math.round(performance.now() - a), worst_ms: null, sql: null }); }
log("platform_customer_metrics", results[results.length - 1].median_ms, "ms");
// --platform-plan: where that time goes (the function's query, analysed), written to out/platform-plan.txt.
if (process.argv.includes("--platform-plan")) {
  const src = fs.readdirSync(MIG).sort().map(f => fs.readFileSync(path.join(MIG, f), "utf8")).join("\n");
  const body = [...src.matchAll(/create or replace function public\.platform_customer_metrics\(\)[\s\S]*?as \$\$([\s\S]*?)\$\$;/g)].at(-1)[1];
  const p = await db.query(`explain (analyze, costs off) ${body}`);
  fs.mkdirSync(fileURLToPath(new URL("./out/", import.meta.url)), { recursive: true });
  fs.writeFileSync(fileURLToPath(new URL("./out/platform-plan.txt", import.meta.url)), p.rows.map(r => r["QUERY PLAN"]).join("\n"));
  log("platform plan written");
}

// Plans for the slowest three under RLS.
const slow = [...results].filter(r => r.sql).sort((a, b) => b.median_ms - a.median_ms).slice(0, 3);
const plans = [];
for (const r of slow) {
  const p = await as(who[r.role], `explain ${r.sql}`);
  plans.push({ label: r.label, plan: p.rows.map(x => x["QUERY PLAN"]).join("\n") });
}
const out = { seeded: counts, schools: SCHOOLS, runs: RUNS, results, plans, at: new Date().toISOString() };
fs.mkdirSync(fileURLToPath(new URL("./out/", import.meta.url)), { recursive: true });
fs.writeFileSync(fileURLToPath(new URL(`./out/scale-bench${SCHOOLS !== 10 && !QUICK ? `-${SCHOOLS * 2}k` : ""}${BEFORE ? "-before" : ""}.json`, import.meta.url)), JSON.stringify({ ...out, before: BEFORE }, null, 2));
log("written scripts/load/out/scale-bench.json");
for (const p of plans) console.log(`\n--- plan: ${p.label}\n${p.plan}`);
process.exit(0);
