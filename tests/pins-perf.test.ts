import { describe, it, expect } from "vitest";
import { normalizePin, formatPin, serialFor, serialPrefix, pinDecision } from "@/lib/result-pins";
import { percentile, routePattern, perfReport, DEFAULT_BUDGETS, type Sample } from "@/lib/perf";
import { callName } from "@/lib/perf-server";

describe("result-checker PINs", () => {
  it("reads PINs however they are typed, and prints them in groups", () => {
    expect(normalizePin(" 1234-5678 9012 ")).toBe("123456789012");
    expect(formatPin("123456789012")).toBe("1234-5678-9012");
    expect(serialFor("GC", 42)).toBe("GC-000042");
  });
  it("makes a short serial prefix from the school's name", () => {
    expect(serialPrefix("Greenfield College")).toBe("GC");
    expect(serialPrefix("The Royal School of Arts and Sciences")).toBe("RAS");
    expect(serialPrefix("Kings")).toBe("KIN");
  });
  it("lets a PIN show one student's result a set number of times", () => {
    const batch = { max_uses: 5, expires_on: "2026-12-31", term_id: null };
    expect(pinDecision({ status: "active", uses: 0, student_id: null }, batch, "ada", "2026-11-01")).toEqual({ ok: true });
    expect(pinDecision({ status: "active", uses: 4, student_id: "ada" }, batch, "ada", "2026-11-01")).toEqual({ ok: true });
    expect(pinDecision({ status: "active", uses: 5, student_id: "ada" }, batch, "ada", "2026-11-01")).toMatchObject({ ok: false, error: expect.stringMatching(/5 times/) });
    expect(pinDecision({ status: "active", uses: 1, student_id: "bola" }, batch, "ada", "2026-11-01")).toMatchObject({ ok: false, error: expect.stringMatching(/another student/) });
    expect(pinDecision({ status: "void", uses: 0, student_id: null }, batch, "ada", "2026-11-01")).toMatchObject({ ok: false, error: expect.stringMatching(/cancelled/) });
    expect(pinDecision({ status: "active", uses: 0, student_id: null }, batch, "ada", "2027-01-01")).toMatchObject({ ok: false, error: expect.stringMatching(/expired/) });
    expect(pinDecision(null, null, "ada", "2026-11-01")).toMatchObject({ ok: false, error: expect.stringMatching(/not correct/) });
  });
});

describe("performance budgets", () => {
  it("takes percentiles", () => {
    expect(percentile([], 75)).toBeNull();
    expect(percentile([1, 2, 3, 4], 75)).toBe(3);
    expect(percentile([5, 1, 9, 3, 7, 2, 8, 4, 6, 10], 95)).toBe(10);
  });
  it("groups pages by pattern", () => {
    expect(routePattern("/school/students/3f2b1c2d-1111-2222-3333-444455556666/sen?tab=x")).toBe("/school/students/:id/sen");
    expect(routePattern("/r/" + "ab".repeat(24))).toBe("/r/:token");
    expect(routePattern("/live/student/game/123")).toBe("/live/student/game/:n");
  });
  it("names the database call", () => {
    expect(callName("https://x.supabase.co/rest/v1/exam_attempts?select=*")).toBe("exam_attempts");
    expect(callName("https://x.supabase.co/rest/v1/rpc/my_tenant_id")).toBe("rpc/my_tenant_id");
    expect(callName("https://x.supabase.co/auth/v1/user")).toBeNull();
  });
  it("compares the 75th percentile with each budget and lists the slowest pages and calls", () => {
    const v = (name: string, value: number, path = "/a"): Sample => ({ kind: "vital", name, path, value });
    const samples: Sample[] = [v("LCP", 1800), v("LCP", 2200), v("LCP", 2400), v("LCP", 4000, "/b"), v("LCP", 4200, "/b"), v("LCP", 4100, "/b"),
      v("INP", 120), v("CLS", 0.02), { kind: "slow_call", name: "report_cards", path: null, value: 1200 }, { kind: "slow_call", name: "report_cards", path: null, value: 2500 }];
    const r = perfReport(samples, DEFAULT_BUDGETS);
    expect(r.vitals.find(x => x.name === "LCP")).toMatchObject({ p75: 4100, within: false, samples: 6 });
    expect(r.vitals.find(x => x.name === "INP")!.within).toBe(true);
    expect(r.vitals.find(x => x.name === "TTFB")!.within).toBeNull();
    expect(r.pages.map(p => [p.path, p.within])).toEqual([["/b", false], ["/a", true]]);
    expect(r.calls).toEqual([{ name: "report_cards", count: 2, p95: 2500, worst: 2500 }]);
    expect(r.ok).toBe(false);
  });
});
