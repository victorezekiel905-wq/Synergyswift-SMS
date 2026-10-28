import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod/v4";

// A school with 100 staff and 1,400 students, 3,000 requests a month, and this month's use per person.
const db = { used: 0, mineUsed: 0, role: "teacher", extra: [] as string[] };
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    rpc: async () => ({ data: db.used }),
    from: (table: string) => {
      const f: Record<string, unknown> = {};
      const q: any = {
        select: () => q, gte: () => q, neq: (k: string, v: string) => { f.neq = v; return q; },
        eq: (k: string, v: unknown) => { f[k] = v; return q; },
        insert: async () => ({ error: null }),
        maybeSingle: async () => ({ data: table === "users" ? { role: db.role, extra_roles: db.extra } : table === "tenants" ? { modules: { ai: true } } : { ai_monthly_limit: 3000 } }),
        then: (res: (v: unknown) => unknown) => res(table === "users"
          ? { count: f.role === "student" ? 1400 : 1500 }
          : { count: db.mineUsed })
      };
      return q;
    }
  })
}));
vi.mock("@/lib/request-actor", () => ({ currentRequest: () => ({ tenantId: "school-1", userId: "person-1" }) }));

import { allowanceShares, generateJson, resetAiAllowanceCache, AiUnavailable } from "@/lib/ai";

const ok = () => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ a: "x" }) }] }, finishReason: "STOP" }] }) });
const ask = () => generateJson({ task: "t", system: "s", prompt: "p", schema: z.object({ a: z.string() }) });

describe("splitting the school's AI allowance", () => {
  beforeEach(() => { resetAiAllowanceCache(); process.env.GEMINI_API_KEY = "g"; db.used = 0; db.mineUsed = 0; db.role = "teacher"; db.extra = []; vi.stubGlobal("fetch", vi.fn(async () => ok())); });
  afterEach(() => { vi.unstubAllGlobals(); delete process.env.GEMINI_API_KEY; });

  it("gives staff four times a student's share, and the shares fit inside the total", () => {
    const s = allowanceShares(3000, 100, 1400);
    expect(s).toEqual({ staff: 6, student: 1 });
    expect(100 * s.staff + 1400 * s.student).toBeLessThanOrEqual(3000);
    expect(allowanceShares(20000, 60, 900)).toEqual({ staff: 70, student: 17 });
    expect(allowanceShares(500, 0, 0)).toEqual({ staff: 500, student: 500 });   // a school with nobody registered yet
  });

  it("lets a teacher use their share, then explains when it is used up", async () => {
    db.mineUsed = 5;
    await expect(ask()).resolves.toEqual({ a: "x" });         // the 6th request of the month
    await expect(ask()).rejects.toThrow(/your share of the school's AI for this month \(6 requests\)/);
  });

  it("holds a student to the student share", async () => {
    db.role = "student"; db.mineUsed = 1;
    const e = await ask().catch(x => x);
    expect(e).toBeInstanceOf(AiUnavailable);
    expect(e.status).toBe(429);
  });

  it("doesn't hold the principal or school admins to a share, but still to the school's total", async () => {
    db.role = "teacher"; db.extra = ["principal"]; db.mineUsed = 500;
    await expect(ask()).resolves.toEqual({ a: "x" });
    resetAiAllowanceCache(); db.used = 3000;
    await expect(ask()).rejects.toThrow(/school has used this month's AI allowance/);
  });
});
