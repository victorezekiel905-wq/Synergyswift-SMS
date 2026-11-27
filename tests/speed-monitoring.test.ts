import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { readFileSync } from "node:fs";
import { normalise, fingerprint } from "@/lib/error-log";
import { cached, forget } from "@/lib/memo";

const read = (f: string) => readFileSync(f, "utf8");

describe("who is signed in, remembered for a few seconds", () => {
  const auth = read("src/lib/auth.ts");
  it("the profile, the school and a custom role come from the short memory", () => {
    expect(auth).toMatch(/cached\(`ctx-user:\$\{user\.id\}`, PROFILE_TTL/);
    expect(auth).toMatch(/cached\(`ctx-school:\$\{me\.tenant_id\}`, SCHOOL_TTL/);
    expect(auth).toMatch(/cached\(`ctx-role:\$\{me\.custom_role_id\}`, SCHOOL_TTL/);
  });
  it("the network and device rules still run on every request", () => {
    expect(auth).toMatch(/checkAccess\(user\.id, session\?\.access_token \?\? null\)/);
  });
  it("an account not found is never remembered, and a new password is seen at once", () => {
    expect(auth).toMatch(/forget\(`ctx-user:\$\{user\.id\}`\); \/\/ not set up yet/);
    expect(read("src/app/api/account/password/route.ts")).toMatch(/forgetUser\(w\.user\.id\)/);
  });
});

describe("who am I: fast on every page", () => {
  it("/api/me checks the session token locally and reads in two rounds", () => {
    const me = read("src/app/api/me/route.ts");
    expect(me).toMatch(/const user = await sessionUser\(sb\)/);
    expect(me).not.toMatch(/auth\.getUser\(\)/);
    expect(me).toMatch(/checkAccess\(user\.id, session\?\.access_token \?\? null\),\s*sb\.from\("users"\)/);
  });
  it("the page frame and the page share one /api/me request", () => {
    expect(read("src/components/ui.tsx")).toMatch(/const SHARED = new Set\(\["\/api\/me"\]\)/);
    expect(read("src/components/AppShell.tsx")).toMatch(/sharedFetch\("\/api\/me"\)/);
  });
  it("busy routes no longer ask Supabase Auth on every request", () => {
    for (const f of ["api/classes/route.ts", "api/classes/[id]/attendance/route.ts", "api/classes/[id]/roster/route.ts", "api/reports/route.ts", "dashboard/page.tsx", "api/parent-link/route.ts"]) {
      const t = read(`src/app/${f}`);
      expect(t, f).not.toMatch(/auth\.getUser\(\)/);
      expect(t, f).toMatch(/sessionUser\(sb\)/);
    }
  });
});

describe("school data remembered, and forgotten when it changes", () => {
  it("the current term and a class's grading scheme are remembered", () => {
    const school = read("src/lib/school.ts");
    expect(school).toMatch(/remembered\(`sd:\$\{tenantId\}:term`/);
    expect(school).toMatch(/remembered\(`sd:\$\{tenantId\}:scheme:/);
  });
  it("every page that changes terms, schemes or classes forgets it after saving", () => {
    for (const r of ["school/grading", "school/sections", "school/structure", "school/academic", "auth/setup", "results/subject-parts", "school/class-teams", "timetable"]) {
      expect(read(`src/app/api/${r}/route.ts`), r).toMatch(/finally \{ forgetSchoolData\(\); \}/);
    }
  });
  it("forget clears by prefix, and an empty answer is not kept", async () => {
    let n = 0;
    await cached("sd:t1:term", 30_000, async () => ++n);
    await cached("sd:t1:term", 30_000, async () => ++n);
    expect(n).toBe(1);
    forget("sd:");
    await cached("sd:t1:term", 30_000, async () => ++n);
    expect(n).toBe(2);
  });
});

describe("the error log", () => {
  it("groups the same error with different ids and numbers into one kind", () => {
    expect(normalise("student 4f1c2a3b-1111-2222-3333-444455556666 not found (row 12)")).toBe("student <id> not found (row <n>)");
    expect(fingerprint("server", "GET /api/x", "timeout after 3000 ms")).toBe(fingerprint("server", "GET /api/x", "timeout after 5000 ms"));
    expect(fingerprint("server", "GET /api/x", "boom")).not.toBe(fingerprint("server", "GET /api/y", "boom"));
  });
  it("server crashes, browser crashes and the console are wired up", () => {
    expect(read("src/instrumentation.ts")).toMatch(/export async function onRequestError/);
    expect(read("src/app/layout.tsx")).toMatch(/<ErrorReporter \/>/);
    expect(read("src/app/api/platform/performance/route.ts")).toMatch(/from\("error_events"\)/);
  });
});
