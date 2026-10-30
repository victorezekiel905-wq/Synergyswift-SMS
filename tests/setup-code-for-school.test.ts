import { describe, it, expect, vi, beforeEach } from "vitest";

// First sign-in after signing up with an onboarding code (migration 8900). A code made for a school
// the owner already created makes its holder that school's administrator; no new school is created.
type Call = { table: string; op: string; payload?: unknown };
const calls: Call[] = [];
let codeFor: string | null = null;

const chain = (table: string) => {
  const c: Record<string, unknown> = {};
  let op = "select", payload: unknown;
  for (const m of ["select", "eq", "is", "gt", "limit", "order", "contains"]) c[m] = () => c;
  for (const m of ["insert", "update", "upsert", "delete"]) c[m] = (p: unknown) => { op = m; payload = p; calls.push({ table, op, payload }); return c; };
  const result = () => {
    if (table === "school_signup_codes" && op === "select") return { data: { id: "code-1", for_tenant_id: codeFor }, error: null };
    if (table === "tenants" && op === "select") return { data: { id: "t-made", name: "Corona Day", contact_email: null }, error: null };
    if (table === "tenants" && op === "insert") return { data: { id: "t-new" }, error: null };
    if (table === "grading_schemes" && op === "insert") return { data: { id: "s1" }, error: null };
    if (table === "school_signup_codes" && op === "update") return { data: { lead_id: null, label: "x" }, error: null };
    return { data: null, error: null };
  };
  c.maybeSingle = async () => result();
  c.single = async () => result();
  c.then = (ok: (v: unknown) => unknown) => Promise.resolve(result()).then(ok);
  return c;
};
const user = { id: "0a1b2c3d-0000-0000-0000-000000000001", email: "head@corona.ng", user_metadata: { full_name: "Ada Head", signup_as: "school" }, app_metadata: { provider: "email" }, email_confirmed_at: "2026-10-30T13:37:00Z" };
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user } }) },
  from: () => chain("session"),
  rpc: async () => ({ data: null })
}) }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({ from: (t: string) => chain(t), rpc: async () => ({ data: null }) }) }));
vi.mock("@/lib/messaging/outbox", () => ({ staffRows: async () => [], enqueue: async () => null, tryDispatch: async () => null }));

const { POST } = await import("@/app/api/auth/setup/route");
const signIn = () => POST(new Request("http://localhost/api/auth/setup", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }) as never);

describe("first sign-in with an onboarding code", () => {
  beforeEach(() => { calls.length = 0; });

  it("a code made for an existing school makes its holder that school's administrator", async () => {
    codeFor = "t-made";
    const res = await signIn();
    expect(await res.json()).toMatchObject({ ok: true, role: "school_admin", next: "/school" });
    expect(calls.find(c => c.table === "users" && c.op === "insert")?.payload).toMatchObject({ id: user.id, tenant_id: "t-made", role: "school_admin", full_name: "Ada Head" });
    expect(calls.find(c => c.table === "staff" && c.op === "insert")?.payload).toMatchObject({ tenant_id: "t-made", position: "School administrator" });
    expect(calls.find(c => c.table === "school_signup_codes" && c.op === "update")?.payload).toEqual({ tenant_id: "t-made" });
    expect(calls.some(c => c.table === "tenants" && c.op === "insert")).toBe(false);   // no second school
  });

  it("a code for a new school still creates the school, as before", async () => {
    codeFor = null;
    const res = await signIn();
    expect(await res.json()).toMatchObject({ ok: true, role: "school_admin" });
    expect(calls.some(c => c.table === "tenants" && c.op === "insert")).toBe(true);
  });
});
