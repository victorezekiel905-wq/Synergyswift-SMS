// Applies every migration to an in-memory Postgres (PGlite) with stubbed Supabase
// auth/storage schemas, re-runs the new ones to prove idempotency, then checks
// tenant isolation and permission rules as real signed-in users.
// Usage: npm run test:db
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import fs from "fs";
import path from "path";

import { fileURLToPath } from "url";
const MIG = process.argv[2] ?? fileURLToPath(new URL("../supabase/migrations/", import.meta.url));
const db = new PGlite({ extensions: { pgcrypto } });

const bootstrap = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth; create schema storage;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create table storage.buckets (id text primary key, name text, public boolean);
grant usage on schema public, auth, storage to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;
await db.exec(bootstrap);

let failed = 0;
for (const f of fs.readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) {
  try { await db.exec(fs.readFileSync(path.join(MIG, f), "utf8")); console.log("OK   ", f); }
  catch (e) { failed++; console.log("FAIL ", f, "\n      ", e.message); }
}
// Idempotency: run the new migrations a second time.
for (const f of fs.readdirSync(MIG).filter(f => f >= "20260101001100").sort()) {
  try { await db.exec(fs.readFileSync(path.join(MIG, f), "utf8")); console.log("RERUN OK", f); }
  catch (e) { failed++; console.log("RERUN FAIL", f, "\n      ", e.message); }
}
if (failed) process.exit(1);

// ---------------- RLS scenario tests ----------------
const U = {
  adminA: "a0000000-0000-0000-0000-000000000001", teacherA: "a0000000-0000-0000-0000-000000000002",
  teacherA2: "a0000000-0000-0000-0000-000000000003", parentA: "a0000000-0000-0000-0000-000000000004",
  studentA: "a0000000-0000-0000-0000-000000000005", bursarA: "a0000000-0000-0000-0000-000000000006",
  adminB: "b0000000-0000-0000-0000-000000000001", platform: "c0000000-0000-0000-0000-000000000001"
};
const T = { A: "a1000000-0000-0000-0000-000000000000", B: "b1000000-0000-0000-0000-000000000000" };

await db.exec(`
insert into auth.users (id) values ${Object.values(U).map(u => `('${u}')`).join(",")};
insert into tenants (id, name, slug) values ('${T.A}', 'Alpha School', 'alpha-x'), ('${T.B}', 'Beta School', 'beta-x');
insert into users (id, tenant_id, email, full_name, role) values
 ('${U.adminA}', '${T.A}', 'a@a', 'Admin A', 'school_admin'), ('${U.teacherA}', '${T.A}', 't@a', 'Teacher A', 'teacher'),
 ('${U.teacherA2}', '${T.A}', 't2@a', 'Teacher A2', 'teacher'), ('${U.parentA}', '${T.A}', 'p@a', 'Parent A', 'parent'),
 ('${U.studentA}', '${T.A}', 's@a', 'Student A', 'student'), ('${U.bursarA}', '${T.A}', 'b@a', 'Bursar A', 'bursar'),
 ('${U.adminB}', '${T.B}', 'a@b', 'Admin B', 'school_admin');
insert into platform_admins (user_id) values ('${U.platform}');
insert into class_groups (id, tenant_id, name) values ('a2000000-0000-0000-0000-000000000000', '${T.A}', 'JSS1');
insert into subjects (id, tenant_id, name) values ('a3000000-0000-0000-0000-000000000000', '${T.A}', 'Maths');
insert into subject_offerings (tenant_id, class_group_id, subject_id, teacher_id) values ('${T.A}', 'a2000000-0000-0000-0000-000000000000', 'a3000000-0000-0000-0000-000000000000', '${U.teacherA}');
insert into academic_sessions (id, tenant_id, name) values ('a4000000-0000-0000-0000-000000000000', '${T.A}', '2025/2026');
insert into terms (id, tenant_id, session_id, name, is_current) values ('a5000000-0000-0000-0000-000000000000', '${T.A}', 'a4000000-0000-0000-0000-000000000000', 'First', true);
insert into grading_schemes (id, tenant_id, name, is_default) values ('a6000000-0000-0000-0000-000000000000', '${T.A}', 'S', true);
insert into grading_components (id, scheme_id, name, max_score, weight) values ('a7000000-0000-0000-0000-000000000000', 'a6000000-0000-0000-0000-000000000000', 'Exam', 100, 100);
insert into students (id, tenant_id, user_id, admission_no, first_name, last_name, class_group_id) values
 ('a8000000-0000-0000-0000-000000000001', '${T.A}', '${U.studentA}', '001', 'Ada', 'Obi', 'a2000000-0000-0000-0000-000000000000'),
 ('a8000000-0000-0000-0000-000000000002', '${T.A}', null, '002', 'Bola', 'Ade', 'a2000000-0000-0000-0000-000000000000');
insert into students (id, tenant_id, admission_no, first_name, last_name) values ('b8000000-0000-0000-0000-000000000001', '${T.B}', '001', 'Beta', 'Kid');
insert into guardians (id, tenant_id, user_id, full_name) values ('a9000000-0000-0000-0000-000000000001', '${T.A}', '${U.parentA}', 'Parent A');
insert into student_guardians (tenant_id, student_id, guardian_id) values ('${T.A}', 'a8000000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-000000000001');
insert into report_cards (tenant_id, term_id, student_id, status) values
 ('${T.A}', 'a5000000-0000-0000-0000-000000000000', 'a8000000-0000-0000-0000-000000000001', 'published'),
 ('${T.A}', 'a5000000-0000-0000-0000-000000000000', 'a8000000-0000-0000-0000-000000000002', 'draft');
insert into library_books (id, tenant_id, title, total_copies, available_copies) values ('aa000000-0000-0000-0000-000000000000', '${T.A}', 'Book', 1, 1);
`);

let pass = 0, fail = 0;
async function as(uid, fn) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
}
async function q(sql) { return (await db.query(sql)).rows; }
async function expectRows(name, uid, sql, n) {
  try {
    const rows = await as(uid, () => q(sql));
    const got = rows.length === 1 && rows[0].n !== undefined ? Number(rows[0].n) : rows.length;
    if (got === n) { pass++; console.log("  ✓", name); } else { fail++; console.log("  ✗", name, `expected ${n}, got ${got}`); }
  } catch (e) { fail++; console.log("  ✗", name, "error:", e.message); }
}
async function expectError(name, uid, sql, re) {
  try { await as(uid, () => q(sql)); fail++; console.log("  ✗", name, "expected an error"); }
  catch (e) { if (!re || re.test(e.message)) { pass++; console.log("  ✓", name, `(${e.message.slice(0, 70)})`); } else { fail++; console.log("  ✗", name, "wrong error:", e.message); } }
}
async function expectOk(name, uid, sql) {
  try { await as(uid, () => q(sql)); pass++; console.log("  ✓", name); } catch (e) { fail++; console.log("  ✗", name, "error:", e.message); }
}

console.log("\nTenant isolation");
await expectRows("tenant A admin sees only its own tenant", U.adminA, "select count(*) n from tenants", 1);
await expectRows("tenant A cannot see tenant B by id", U.adminA, `select count(*) n from tenants where id = '${T.B}'`, 0);
await expectRows("tenant A sees no tenant B users", U.adminA, `select count(*) n from users where tenant_id = '${T.B}'`, 0);
await expectRows("tenant A sees only its own students", U.adminA, "select count(*) n from students", 2);
await expectRows("tenant B sees only its own students", U.adminB, "select count(*) n from students", 1);
await expectError("tenant A cannot insert a student into tenant B", U.adminA, `insert into students (tenant_id, admission_no, first_name, last_name) values ('${T.B}', 'X', 'a', 'b')`, /row-level security/);
await expectError("tenant users cannot read platform_admins", U.adminA, "select * from platform_admins", /permission denied/);
await expectError("tenant users cannot read platform audit", U.adminA, "select * from platform_audit_logs", /permission denied/);
await expectRows("is_platform_admin false for tenant admin", U.adminA, "select 1 from (select is_platform_admin() v) x where v", 0);
await expectRows("is_platform_admin true for platform admin", U.platform, "select 1 from (select is_platform_admin() v) x where v", 1);
await expectRows("platform admin (no profile) sees no tenant data through RLS", U.platform, "select count(*) n from students", 0);
await expectError("nobody can create tenants from the client", U.adminA, "insert into tenants (name, slug) values ('x', 'x-y')", /row-level security/);

console.log("\nPrivilege escalation");
await expectError("users cannot insert their own profile", U.platform, `insert into users (id, tenant_id, email, full_name, role) values ('${U.platform}', '${T.A}', 'x', 'x', 'school_admin')`, /row-level security/);
await expectError("teacher cannot promote self", U.teacherA, `update users set role = 'school_admin' where id = '${U.teacherA}'`, /cannot change your own role/);
await expectError("teacher cannot move to another tenant", U.teacherA, `update users set tenant_id = '${T.B}' where id = '${U.teacherA}'`, /tenant_id cannot be changed/);
await expectOk("teacher can update own name", U.teacherA, `update users set full_name = 'T A' where id = '${U.teacherA}'`);
await expectOk("admin can change a teacher's role", U.adminA, `update users set extra_roles = '{gate_officer}' where id = '${U.teacherA2}'`);
await expectError("admin cannot mint a platform admin", U.adminA, `update users set role = 'platform_admin' where id = '${U.teacherA2}'`, /platform_admin cannot be granted/);
await expectError("admin cannot suspend or re-module own tenant", U.adminA, `update tenants set status = 'suspended' where id = '${T.A}'`, /only the platform/);
await expectOk("admin can rename own tenant", U.adminA, `update tenants set name = 'Alpha Academy' where id = '${T.A}'`);

console.log("\nResults");
await expectOk("subject teacher can enter scores", U.teacherA, `insert into score_entries (tenant_id, term_id, student_id, subject_id, component_id, score) values ('${T.A}', 'a5000000-0000-0000-0000-000000000000', 'a8000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000000', 'a7000000-0000-0000-0000-000000000000', 70)`);
await expectError("other teacher cannot enter scores for that subject", U.teacherA2, `insert into score_entries (tenant_id, term_id, student_id, subject_id, component_id, score) values ('${T.A}', 'a5000000-0000-0000-0000-000000000000', 'a8000000-0000-0000-0000-000000000002', 'a3000000-0000-0000-0000-000000000000', 'a7000000-0000-0000-0000-000000000000', 70)`, /row-level security/);
await expectError("teacher cannot publish report cards", U.teacherA, `update report_cards set status = 'published' where status = 'draft'`, /only school admins/);
await expectOk("teacher can write a comment", U.teacherA, `update report_cards set teacher_comment = 'Good' where status = 'draft'`);
await expectRows("parent sees only their child's published card", U.parentA, "select count(*) n from report_cards", 1);
await expectRows("student sees only own published card", U.studentA, "select count(*) n from report_cards", 1);
await expectRows("student cannot read score entries", U.studentA, "select count(*) n from score_entries", 0);
await expectRows("parent sees only their own child record", U.parentA, "select count(*) n from students", 1);
await expectRows("tenant B sees none of A's report cards", U.adminB, "select count(*) n from report_cards", 0);

console.log("\nOperations");
await expectOk("bursar cannot be blocked from reading requisitions", U.bursarA, "select * from requisitions");
await expectOk("teacher submits a requisition", U.teacherA, `insert into requisitions (tenant_id, requested_by, title) values ('${T.A}', '${U.teacherA}', 'Chalk')`);
await expectError("teacher cannot approve own requisition", U.teacherA, `update requisitions set status = 'approved' where title = 'Chalk'`, /only approvers/);
await expectOk("bursar approves it", U.bursarA, `update requisitions set status = 'approved' where title = 'Chalk'`);
await expectError("teacher cannot write gate events directly", U.teacherA, `insert into gate_events (tenant_id, person_type, student_id, direction) values ('${T.A}', 'student', 'a8000000-0000-0000-0000-000000000001', 'in')`, /row-level security/);
await expectError("authenticated users cannot claim the outbox", U.adminA, "select * from claim_outbox(10)", /permission denied/);
await expectError("teacher cannot issue library books", U.teacherA, `select library_issue('aa000000-0000-0000-0000-000000000000', 'a8000000-0000-0000-0000-000000000001', null, 14)`, /forbidden/);
await expectOk("admin issues a library book", U.adminA, `select library_issue('aa000000-0000-0000-0000-000000000000', 'a8000000-0000-0000-0000-000000000001', null, 14)`);
await expectError("no copies left after issue", U.adminA, `select library_issue('aa000000-0000-0000-0000-000000000000', 'a8000000-0000-0000-0000-000000000002', null, 14)`, /no copies/);
await expectRows("parent sees their child's loan", U.parentA, "select count(*) n from library_loans", 1);

console.log("\nSuspension");
await db.exec(`update tenants set status = 'suspended' where id = '${T.A}'`);
await expectRows("suspended tenant loses access to its data", U.adminA, "select count(*) n from students", 0);
await expectRows("suspended tenant can still read its own tenant row", U.adminA, "select count(*) n from tenants", 1);
await db.exec(`update tenants set status = 'active' where id = '${T.A}'`);

console.log("\nOutbox claim (service role)");
await db.exec(`insert into message_outbox (tenant_id, channel, to_address, kind, body_text) values ('${T.A}', 'email', 'x@y.z', 'test', 'hi')`);
const claimed = await q("select count(*) n from claim_outbox(10)");
const again = await q("select count(*) n from claim_outbox(10)");
if (Number(claimed[0].n) === 1 && Number(again[0].n) === 0) { pass++; console.log("  ✓ claim_outbox claims once"); } else { fail++; console.log("  ✗ claim_outbox", claimed, again); }

console.log("\nHardening");
await db.exec(`insert into exams (id, tenant_id, created_by, title, status, access_code, settings)
  values ('ab000000-0000-0000-0000-000000000000', '${T.A}', '${U.teacherA}', 'Maths exam', 'published', 'SECRET', '{"quit_password":"pw"}')`);
await expectRows("students cannot read exam rows (codes, SEB keys)", U.studentA, "select count(*) n from exams", 0);
await expectRows("teachers can read exam rows", U.teacherA, "select count(*) n from exams", 1);
await expectRows("parents cannot list students or other parents", U.parentA, "select count(*) n from users where role in ('student','parent') and id <> auth.uid()", 0);
await expectRows("parents can still see staff", U.parentA, "select count(*) n from users where role = 'teacher'", 2);
await expectError("device rows cannot be injected into another school", U.parentA,
  `insert into devices (tenant_id, device_uid, kind) values ('${T.B}', 'ext-evil', 'browser')`, /row-level security/);

// ---- module scenario tests (appended per module) ----
await moduleTests({ db, as, q, expectRows, expectError, expectOk, U, T });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

async function moduleTests(ctx) {
  for (const f of fs.readdirSync(new URL("./db-tests/", import.meta.url)).filter(x => x.endsWith(".mjs")).sort()) {
    const mod = await import(new URL(`./db-tests/${f}`, import.meta.url));
    await mod.default(ctx);
  }
}
