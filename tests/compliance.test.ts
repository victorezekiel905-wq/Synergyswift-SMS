import { describe, it, expect } from "vitest";
import { FRAMEWORKS, frameworkById, readiness, documentAlerts, scrMatrix, CHECKS } from "@/lib/compliance";

describe("frameworks", () => {
  it("have unique, well-formed requirement keys", () => {
    expect(FRAMEWORKS.map(f => f.id)).toEqual(["moe_subeb", "bso", "cobis", "cambridge"]);
    for (const f of FRAMEWORKS) {
      const keys = f.areas.flatMap(a => a.items.map(i => i.key));
      expect(new Set(keys).size).toBe(keys.length);
      for (const k of keys) expect(k).toMatch(/^[a-z0-9_.]{2,60}$/);
    }
    expect(frameworkById("bso")!.areas).toHaveLength(8);
    expect(frameworkById("nope")).toBeNull();
  });
  it("score readiness, leaving out items that do not apply", () => {
    const f = frameworkById("cambridge")!;
    const total = f.areas.flatMap(a => a.items).length;
    const r = readiness(f, [
      { framework: "cambridge", requirement_key: "centre.registration", status: "met" },
      { framework: "cambridge", requirement_key: "centre.entries", status: "in_progress" },
      { framework: "cambridge", requirement_key: "centre.data", status: "not_applicable" },
      { framework: "bso", requirement_key: "centre.registration", status: "met" }
    ]);
    expect(r).toMatchObject({ applicable: total - 1, met: 1, in_progress: 1, not_started: total - 3 });
    expect(r.pct).toBe(Math.round(100 / (total - 1)));
    expect(r.areas[0]).toMatchObject({ id: "centre", applicable: 2, met: 1, pct: 50 });
  });
});

describe("document alerts", () => {
  it("flag reviews and expiries, soonest first", () => {
    const a = documentAlerts([
      { id: "1", title: "Safeguarding", category: "policy", status: "approved", review_due_on: "2026-10-01", expires_on: null },
      { id: "2", title: "Behaviour", category: "policy", status: "approved", review_due_on: "2026-11-01", expires_on: null },
      { id: "3", title: "Fire cert", category: "certificate", status: "approved", review_due_on: null, expires_on: "2026-12-01" },
      { id: "4", title: "Old", category: "policy", status: "superseded", review_due_on: "2020-01-01", expires_on: null },
      { id: "5", title: "Later", category: "policy", status: "approved", review_due_on: "2027-06-01", expires_on: "2027-06-01" }
    ], "2026-10-16");
    expect(a.map(x => [x.id, x.kind, x.days])).toEqual([["1", "review_overdue", -15], ["2", "review_soon", 16], ["3", "expires_soon", 46]]);
  });
});

describe("single central record", () => {
  it("shows each check's state and the gaps", () => {
    const m = scrMatrix([{ id: "a", name: "Ada" }, { id: "b", name: "Bayo" }], [
      ...CHECKS.filter(c => c.required).map(c => ({ staff_id: "a", kind: c.kind, outcome: "clear", checked_on: "2026-01-01", expires_on: null })),
      { staff_id: "b", kind: "identity", outcome: "clear", checked_on: "2026-01-01", expires_on: null },
      { staff_id: "b", kind: "police_check", outcome: "clear", checked_on: "2023-01-01", expires_on: "2026-01-01" },
      { staff_id: "b", kind: "references", outcome: "pending", checked_on: null, expires_on: null },
      { staff_id: "b", kind: "medical_fitness", outcome: "concern", checked_on: "2026-02-01", expires_on: null },
      { staff_id: "b", kind: "right_to_work", outcome: "not_required", checked_on: null, expires_on: null }
    ], "2026-10-16");
    expect(m[0].name).toBe("Bayo");
    expect(m[0].cells).toMatchObject({ identity: "clear", police_check: "expired", references: "pending", medical_fitness: "concern", right_to_work: "not_required", qualifications: "missing" });
    expect(m[0].gaps).toEqual(["Qualifications", "References", "Police check", "Medical fitness", "Safeguarding training"]);
    expect(m[1]).toMatchObject({ name: "Ada", complete: true, gaps: [] });
  });
  it("uses the latest record of each kind", () => {
    const m = scrMatrix([{ id: "a", name: "Ada" }], [
      { staff_id: "a", kind: "police_check", outcome: "clear", checked_on: "2020-01-01", expires_on: "2023-01-01" },
      { staff_id: "a", kind: "police_check", outcome: "clear", checked_on: "2026-01-01", expires_on: "2029-01-01" }
    ], "2026-10-16");
    expect(m[0].cells.police_check).toBe("clear");
  });
});
