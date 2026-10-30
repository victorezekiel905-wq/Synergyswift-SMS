import { describe, it, expect, vi } from "vitest";

// Creating a school on the owner console: a student limit is required, except on the Custom plan.
let tenantInserts = 0;
vi.mock("@/lib/auth", async orig => ({ ...(await orig<typeof import("@/lib/auth")>()), requirePlatformAdmin: async () => ({ userId: "owner-1", role: "owner" }) }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({
  // The school insert is refused as a taken link name, so a request that gets this far is easy to tell apart.
  from: () => ({ insert: () => { tenantInserts++; return { select: () => ({ single: async () => ({ data: null, error: { message: "duplicate key" } }) }) }; } })
}) }));

const { POST } = await import("@/app/api/platform/tenants/route");
const create = (extra: Record<string, unknown>) => POST(new Request("http://localhost/api/platform/tenants", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ name: "Corona Day", slug: "corona-day", ...extra })
}) as never);
const plan = (plan_code: string) => ({ plan_code, band: plan_code === "custom" ? null : 1, cycle: "annual", custom_annual: plan_code === "custom" ? 1_000_000 : null });

describe("student limit when creating a school", () => {
  it("is required on a priced plan", async () => {
    const r = await create({ subscription: plan("growth") });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/student limit/i);
    expect(tenantInserts).toBe(0);
  });
  it("is required when the school has no plan yet", async () => {
    const r = await create({});
    expect((await r.json()).error).toMatch(/student limit/i);
  });
  it("may be left out on the Custom plan", async () => {
    const r = await create({ subscription: plan("custom") });
    expect((await r.json()).error).toMatch(/slug is already taken/);   // past the limit check
    expect(tenantInserts).toBe(1);
  });
  it("is accepted when given", async () => {
    const r = await create({ subscription: plan("growth"), student_limit: 250 });
    expect((await r.json()).error).toMatch(/slug is already taken/);
  });
});
