import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod/v4";

// A school with 100 staff, 3,000 requests a month, and this month's use per person.
const db = { used: 0, mineUsed: 0, role: "teacher", extra: [] as string[] };
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    rpc: async () => ({ data: db.used }),
    from: (table: string) => {
      const q: any = {
        select: () => q, gte: () => q, eq: () => q, not: () => q,
        insert: async () => ({ error: null }),
        maybeSingle: async () => ({ data: table === "users" ? { role: db.role, extra_roles: db.extra } : table === "tenants" ? { modules: { ai: true } } : { ai_monthly_limit: 3000 } }),
        then: (res: (v: unknown) => unknown) => res(table === "users" ? { count: 100 } : { count: db.mineUsed })
      };
      return q;
    }
  })
}));
vi.mock("@/lib/request-actor", () => ({ currentRequest: () => ({ tenantId: "school-1", userId: "person-1" }) }));

import { staffShare, generateJson, resetAiAllowanceCache, AiUnavailable } from "@/lib/ai";

const ok = () => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ a: "x" }) }] }, finishReason: "STOP" }] }) });
const ask = (task = "lesson_note") => generateJson({ task, system: "s", prompt: "p", schema: z.object({ a: z.string() }) });

describe("AI is for staff, and the allowance is shared across them", () => {
  beforeEach(() => { resetAiAllowanceCache(); process.env.GEMINI_API_KEY = "g"; db.used = 0; db.mineUsed = 0; db.role = "teacher"; db.extra = []; vi.stubGlobal("fetch", vi.fn(async () => ok())); });
  afterEach(() => { vi.unstubAllGlobals(); delete process.env.GEMINI_API_KEY; });

  it("splits the allowance evenly across staff, inside the total", () => {
    expect(staffShare(3000, 100)).toBe(30);
    expect(100 * staffShare(3000, 100)).toBeLessThanOrEqual(3000);
    expect(staffShare(20000, 60)).toBe(333);
    expect(staffShare(500, 0)).toBe(500);       // a school with no staff registered yet
  });

  it("lets a teacher use their share, then explains when it is used up", async () => {
    db.mineUsed = 29;
    await expect(ask()).resolves.toEqual({ a: "x" });         // the 30th request of the month
    await expect(ask()).rejects.toThrow(/your share of the school's AI for this month \(30 requests\)/);
  });

  it("doesn't let students or parents generate anything", async () => {
    for (const role of ["student", "parent"]) {
      resetAiAllowanceCache(); db.role = role;
      const e = await ask("tutor").catch(x => x);
      expect(e).toBeInstanceOf(AiUnavailable);
      expect(e.message).toBe("AI tools are for teachers and school staff.");
      expect(e.status).toBe(403);
    }
  });

  it("still translates a parent's message for the school", async () => {
    db.role = "parent";
    await expect(ask("translate")).resolves.toEqual({ a: "x" });
  });

  it("doesn't hold the principal or school admins to a share, but still to the school's total", async () => {
    db.extra = ["principal"]; db.mineUsed = 500;
    await expect(ask()).resolves.toEqual({ a: "x" });
    resetAiAllowanceCache(); db.used = 3000;
    await expect(ask()).rejects.toThrow(/school has used this month's AI allowance/);
  });
});
