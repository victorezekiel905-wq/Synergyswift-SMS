// Phase 14m: fill a STAGING Supabase project with 10 schools x 2,000 accounts for the load test.
// It refuses to run against the live project. Accounts get the password in LOAD_PASSWORD and are
// written to scripts/load/out/users.csv (email,role,school) for k6.
//   STAGING=yes NEXT_PUBLIC_SUPABASE_URL=https://<staging>.supabase.co SUPABASE_SERVICE_ROLE_KEY=... LOAD_PASSWORD=... node scripts/load/seed-staging.mjs
import { createClient } from "@supabase/supabase-js";
import fs from "fs";

const LIVE_REF = "zltofhayjsvtktmmlqmh";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "", pw = process.env.LOAD_PASSWORD ?? "";
if (process.env.STAGING !== "yes" || !url || !key || pw.length < 12) { console.error("Set STAGING=yes, the staging URL and service key, and LOAD_PASSWORD (12+ characters)."); process.exit(1); }
if (url.includes(LIVE_REF)) { console.error("This is the live project. Use a staging copy."); process.exit(1); }
// 10 schools x 2,000 = 20,000 accounts by default; SCHOOLS=25 makes 50,000.
const SCHOOLS = Number(process.env.SCHOOLS ?? 10), STUDENTS = Number(process.env.STUDENTS ?? 1400), PARENTS = Number(process.env.PARENTS ?? 500), STAFF = Number(process.env.STAFF ?? 100), CLASSES = 30;
const svc = createClient(url, key, { auth: { persistSession: false } });
const csv = ["email,role,school"];
const chunk = (n, f) => Promise.all(Array.from({ length: n }, (_, i) => f(i)));

async function account(email, role) {
  const { data, error } = await svc.auth.admin.createUser({ email, password: pw, email_confirm: true });
  if (error && !/already/.test(error.message)) throw error;
  return data?.user?.id ?? (await svc.from("users").select("id").eq("email", email).maybeSingle()).data?.id;
}

for (let s = 1; s <= SCHOOLS; s++) {
  const slug = `load-${s}`;
  let { data: t } = await svc.from("tenants").select("id").eq("slug", slug).maybeSingle();
  if (!t) ({ data: t } = await svc.from("tenants").insert({ name: `Load Test School ${s}`, slug }).select("id").single());
  const tid = t.id;
  const { data: sess } = await svc.from("academic_sessions").upsert({ tenant_id: tid, name: "2026/2027" }, { onConflict: "tenant_id,name" }).select("id").single();
  await svc.from("terms").upsert({ tenant_id: tid, session_id: sess.id, name: "First", is_current: true }, { onConflict: "session_id,name" });
  const { data: classes } = await svc.from("class_groups").upsert(Array.from({ length: CLASSES }, (_, i) => ({ tenant_id: tid, name: `Class ${i + 1}` })), { onConflict: "tenant_id,name" }).select("id");
  const people = [
    ...Array.from({ length: STAFF }, (_, i) => ({ email: `staff${i + 1}@${slug}.load.test`, role: i < 3 ? "school_admin" : "teacher" })),
    ...Array.from({ length: STUDENTS }, (_, i) => ({ email: `student${i + 1}@${slug}.load.test`, role: "student", n: i })),
    ...Array.from({ length: PARENTS }, (_, i) => ({ email: `parent${i + 1}@${slug}.load.test`, role: "parent", n: i }))
  ];
  for (let i = 0; i < people.length; i += 20) {
    await chunk(Math.min(20, people.length - i), async j => {
      const p = people[i + j];
      p.id = await account(p.email, p.role);
      csv.push(`${p.email},${p.role},${slug}`);
    });
  }
  await svc.from("users").upsert(people.map(p => ({ id: p.id, tenant_id: tid, email: p.email, full_name: p.email.split("@")[0], role: p.role })), { onConflict: "id" });
  const students = people.filter(p => p.role === "student");
  const { data: st } = await svc.from("students").upsert(students.map(p => ({ tenant_id: tid, user_id: p.id, admission_no: `L${s}-${p.n + 1}`, first_name: "Load", last_name: `Student${p.n + 1}`,
    class_group_id: classes[p.n % CLASSES].id })), { onConflict: "tenant_id,admission_no" }).select("id,admission_no");
  const parents = people.filter(p => p.role === "parent");
  const { data: gs } = await svc.from("guardians").upsert(parents.map(p => ({ tenant_id: tid, user_id: p.id, full_name: p.email.split("@")[0] })), { onConflict: "user_id" }).select("id");
  await svc.from("student_guardians").upsert(st.map((x, i) => ({ tenant_id: tid, student_id: x.id, guardian_id: gs[i % gs.length].id })), { onConflict: "student_id,guardian_id", ignoreDuplicates: true });
  console.log(`school ${s}: ${people.length} accounts`);
}
// A platform owner for the browser tests, and one account per role (all with LOAD_PASSWORD).
// Platform accounts have no row in users, so on a second run the owner is found through platform_admins.
const ownerId = (await account("owner@platform.load.test", "owner"))
  ?? (await svc.from("platform_admins").select("user_id").eq("email", "owner@platform.load.test").maybeSingle()).data?.user_id;
if (ownerId) await svc.from("platform_admins").upsert({ user_id: ownerId, role: "owner", email: "owner@platform.load.test" }, { onConflict: "user_id" });
else console.warn("Could not find the test owner account; the owner browser test will be skipped.");
const e2e = ["# For npm run test:e2e against the staging app. Every account uses LOAD_PASSWORD: set E2E_PASSWORD to it.",
  "E2E_OWNER_EMAIL=owner@platform.load.test", "E2E_ADMIN_EMAIL=staff1@load-1.load.test", "E2E_TEACHER_EMAIL=staff4@load-1.load.test",
  "E2E_PARENT_EMAIL=parent1@load-1.load.test", "E2E_STUDENT_EMAIL=student1@load-1.load.test"];
fs.mkdirSync(new URL("./out/", import.meta.url), { recursive: true });
fs.writeFileSync(new URL("./out/users.csv", import.meta.url), csv.join("\n"));
fs.writeFileSync(new URL("./out/e2e.env", import.meta.url), e2e.join("\n") + "\n");
console.log("written scripts/load/out/users.csv and scripts/load/out/e2e.env");
