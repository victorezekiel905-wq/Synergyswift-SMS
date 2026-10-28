import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod/v4";

// A school with 100 staff, 3,000 requests a month, and this month's use.
const db = { used: 0, mineUsed: 0, tutorUsed: 0, tutorOn: false, role: "teacher", extra: [] as string[] };
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    rpc: async () => ({ data: db.used }),
    from: (table: string) => {
      const f: Record<string, unknown> = {};
      const q: any = {
        select: () => q, gte: () => q, not: () => q, eq: (k: string, v: unknown) => { f[k] = v; return q; },
        insert: async () => ({ error: null }),
        maybeSingle: async () => ({ data: table === "users" ? { role: db.role, extra_roles: db.extra } : table === "tenants" ? { modules: { ai: true } } : { ai_monthly_limit: 3000, ai_tutor_enabled: db.tutorOn } }),
        then: (res: (v: unknown) => unknown) => res(table === "users" ? { count: 100 } : { count: f.task === "tutor" ? db.tutorUsed : db.mineUsed })
      };
      return q;
    }
  })
}));
vi.mock("@/lib/request-actor", () => ({ currentRequest: () => ({ tenantId: "school-1", userId: "person-1" }) }));

import { staffShare, splitAllowance, generateJson, resetAiAllowanceCache, AiUnavailable } from "@/lib/ai";

const ok = () => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ a: "x" }) }] }, finishReason: "STOP" }] }) });
const ask = (task = "lesson_note") => generateJson({ task, system: "s", prompt: "p", schema: z.object({ a: z.string() }) });

describe("sharing the school's AI allowance", () => {
  beforeEach(() => {
    resetAiAllowanceCache(); process.env.GEMINI_API_KEY = "g";
    Object.assign(db, { used: 0, mineUsed: 0, tutorUsed: 0, tutorOn: false, role: "teacher", extra: [] });
    vi.stubGlobal("fetch", vi.fn(async () => ok()));
  });
  afterEach(() => { vi.unstubAllGlobals(); delete process.env.GEMINI_API_KEY; });

  it("splits evenly across staff, keeping 30% for the study helper while it is on", () => {
    expect(staffShare(3000, 100)).toBe(30);
    expect(splitAllowance(3000, 100, false)).toEqual({ tutorPool: 0, staffPool: 3000, perStaff: 30 });
    expect(splitAllowance(3000, 100, true)).toEqual({ tutorPool: 900, staffPool: 2100, perStaff: 21 });
    const s = splitAllowance(20000, 60, true);
    expect(s.tutorPool + 60 * s.perStaff).toBeLessThanOrEqual(20000);
    expect(staffShare(500, 0)).toBe(500);
  });

  it("lets a teacher use their share, then explains when it is used up", async () => {
    db.mineUsed = 29;
    await expect(ask()).resolves.toEqual({ a: "x" });
    await expect(ask()).rejects.toThrow(/your share of the school's AI for this month \(30 requests\)/);
  });

  it("gives students the study helper when the school switches it on, and nothing else", async () => {
    db.role = "student";
    const off = await ask("tutor").catch(e => e);
    expect(off.message).toBe("The study helper is switched off at your school.");
    resetAiAllowanceCache(); db.tutorOn = true;
    await expect(ask("tutor")).resolves.toEqual({ a: "x" });
    const notes = await ask("lesson_note").catch(e => e);
    expect(notes).toBeInstanceOf(AiUnavailable);
    expect(notes.message).toMatch(/Students can use the study helper/);
  });

  it("stops the study helper when its 30% is used, without touching the teachers' shares", async () => {
    db.role = "student"; db.tutorOn = true; db.tutorUsed = 900;
    await expect(ask("tutor")).rejects.toThrow(/study helper has used this month's share/);
    resetAiAllowanceCache(); db.role = "teacher"; db.mineUsed = 0;
    await expect(ask()).resolves.toEqual({ a: "x" });
  });

  it("doesn't let parents generate anything, but still translates their messages", async () => {
    db.role = "parent";
    await expect(ask("tutor")).rejects.toThrow("AI tools are for teachers and school staff.");
    await expect(ask("translate")).resolves.toEqual({ a: "x" });
  });

  it("doesn't hold the principal or school admins to a share, but still to the school's total", async () => {
    db.extra = ["principal"]; db.mineUsed = 500;
    await expect(ask()).resolves.toEqual({ a: "x" });
    resetAiAllowanceCache(); db.used = 3000;
    await expect(ask()).rejects.toThrow(/school has used this month's AI allowance/);
  });
});
