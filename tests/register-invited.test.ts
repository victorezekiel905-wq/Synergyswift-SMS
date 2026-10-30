import { describe, it, expect, vi, beforeEach } from "vitest";

// A stand-in for Supabase that behaves as it does for an email with an unopened invitation:
// generateLink("signup") hands back the existing invited account and ignores the password.
const calls = { updateUserById: [] as unknown[][], deleteUser: [] as string[] };
let existing: Record<string, unknown> | null = null;

const chain = (result: unknown) => {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "gt", "update", "upsert", "insert", "order", "limit"]) c[m] = () => c;
  c.maybeSingle = async () => result;
  c.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok);
  return c;
};
const svc = {
  from: (t: string) => chain(t === "school_signup_codes" ? { data: { id: "code-1" } } : t === "tenants" ? { data: { status: "active" } } : { data: null }),
  rpc: async (name: string) => (name === "claim_school_code" ? { data: "code-1" } : name === "class_lookup_by_code" ? { data: [{ tenant_id: "t1" }] } : { data: null }),
  auth: { admin: {
    generateLink: async () => ({ data: { user: existing ?? { id: "u-new", invited_at: null, last_sign_in_at: null, email_confirmed_at: null, user_metadata: {} }, properties: { hashed_token: "h" } }, error: null }),
    updateUserById: async (...a: unknown[]) => { calls.updateUserById.push(a); return { error: null }; },
    deleteUser: async (id: string) => { calls.deleteUser.push(id); return { error: null }; }
  } }
};
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => svc }));
vi.mock("@/lib/auth-mail", () => ({
  authMailConfigured: () => false, mailable: () => true, mailThrottled: async () => false, logMail: async () => null,
  linkFrom: () => null, sendAuthEmail: async () => ({ ok: true })
}));
vi.mock("@/lib/school-codes", () => ({ hashSchoolCode: () => "hash", isSchoolCodeShape: () => true }));

const { POST } = await import("@/app/api/auth/register/route");
const post = (body: Record<string, unknown>) => POST(new Request("http://localhost/api/auth/register", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
}) as never);
const common = { email: "head@school.ng", password: "a-good-password", full_name: "Head Teacher" };

describe("signing up when the email already has an unopened invitation", () => {
  beforeEach(() => { calls.updateUserById = []; calls.deleteUser = []; existing = null; });

  it("with a one-time school code, the password typed is saved on that account", async () => {
    existing = { id: "u-invited", invited_at: "2026-10-30T13:30:19Z", last_sign_in_at: null, email_confirmed_at: null, user_metadata: { full_name: "Head" } };
    const r = await post({ as: "school", ...common, school_name: "Corona Day", school_code: "SSC-AAAA-BBBB-CCCC" });
    expect(r.status).toBe(200);
    expect(calls.updateUserById).toHaveLength(1);
    expect(calls.updateUserById[0][0]).toBe("u-invited");
    expect(calls.updateUserById[0][1]).toMatchObject({ password: "a-good-password" });
  });

  it("with a class code, someone else's invitation is not taken over", async () => {
    existing = { id: "u-invited", invited_at: "2026-10-30T13:30:19Z", last_sign_in_at: null, email_confirmed_at: null, user_metadata: {} };
    const r = await post({ as: "student", ...common, join_code: "ABC123" });
    expect(r.status).toBe(409);
    expect(calls.updateUserById).toHaveLength(0);
  });

  it("an invitation that was already used (signed in or confirmed) is never changed", async () => {
    existing = { id: "u-active", invited_at: "2026-10-01T10:00:00Z", last_sign_in_at: "2026-10-02T10:00:00Z", email_confirmed_at: "2026-10-01T11:00:00Z", user_metadata: {} };
    await post({ as: "school", ...common, school_name: "X", school_code: "SSC-AAAA-BBBB-CCCC" });
    expect(calls.updateUserById).toHaveLength(0);
  });

  it("a brand-new account is left to Supabase (the password is already set)", async () => {
    const r = await post({ as: "school", ...common, school_name: "New School", school_code: "SSC-AAAA-BBBB-CCCC" });
    expect(r.status).toBe(200);
    expect(calls.updateUserById).toHaveLength(0);
  });
});
