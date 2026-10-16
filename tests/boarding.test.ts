import { describe, it, expect } from "vitest";
import { startingRoll, rollSummary, exeatOverdue, exeatAfterParent, dietTags, mealHeadcount, expiringDocuments, vehicleBlocked, tripCheck } from "@/lib/boarding";

describe("boarding", () => {
  it("starts the roll from who is away or unwell", () => {
    const roll = startingRoll([{ student_id: "a", name: "Zed", room: "B2" }, { student_id: "b", name: "Amy", room: "B10" }, { student_id: "c", name: "Bo", room: "B2" }], new Set(["b"]), new Set(["c"]));
    expect(roll.map(r => [r.name, r.status])).toEqual([["Bo", "sick_bay"], ["Zed", "present"], ["Amy", "exeat"]]);
    expect(rollSummary([{ status: "present" }, { status: "late" }, { status: "absent" }, { status: "exeat" }])).toMatchObject({ total: 4, present: 2, absent: 1, exeat: 1, late: 1 });
  });
  it("spots late returns once", () => {
    const now = new Date("2026-10-18T19:00:00Z");
    expect(exeatOverdue({ status: "out", return_by: "2026-10-18T18:00:00Z", overdue_alerted_at: null }, now)).toBe(true);
    expect(exeatOverdue({ status: "out", return_by: "2026-10-18T18:45:00Z", overdue_alerted_at: null }, now)).toBe(false);
    expect(exeatOverdue({ status: "out", return_by: "2026-10-18T18:00:00Z", overdue_alerted_at: "x" }, now)).toBe(false);
    expect(exeatOverdue({ status: "returned", return_by: "2026-10-18T18:00:00Z", overdue_alerted_at: null }, now)).toBe(false);
  });
  it("routes an exeat after the parent decides", () => {
    expect(exeatAfterParent("staff", true)).toBe("approved");
    expect(exeatAfterParent("student", true)).toBe("pending");
    expect(exeatAfterParent("student", false)).toBe("rejected");
  });
  it("counts meals and special diets", () => {
    expect(dietTags("Vegetarian; no pork", "Peanuts, none")).toEqual({ diets: ["vegetarian", "no pork"], allergies: ["peanuts"] });
    const h = mealHeadcount([{ student_id: "a", dietary: "vegetarian", allergies: "peanuts" }, { student_id: "b", dietary: "Vegetarian", allergies: null }, { student_id: "c", dietary: null, allergies: "nil" }], new Set(["c"]));
    expect(h).toEqual({ eating: 2, away: 1, diets: [{ tag: "vegetarian", count: 2 }], allergies: [{ tag: "peanuts", count: 1 }] });
  });
});

describe("transport", () => {
  it("lists documents expiring, skipping retired buses and inactive drivers", () => {
    const docs = expiringDocuments("2026-10-16", 30,
      [{ id: "v1", reg_no: "LAG-123", status: "active", insurance_expires: "2026-10-01", roadworthy_expires: "2027-01-01", licence_expires: "2026-11-01", next_service_on: null },
       { id: "v2", reg_no: "OLD-1", status: "retired", insurance_expires: "2020-01-01", roadworthy_expires: null, licence_expires: null, next_service_on: null }],
      [{ id: "d1", full_name: "Musa", active: true, licence_expires: "2026-10-20", medical_expires: null }, { id: "d2", full_name: "Gone", active: false, licence_expires: "2020-01-01", medical_expires: null }]);
    expect(docs.map(d => [d.name, d.what, d.expired])).toEqual([["LAG-123", "insurance", true], ["Musa", "driving licence", false], ["LAG-123", "vehicle licence", false]]);
  });
  it("keeps unsafe buses off the road", () => {
    expect(vehicleBlocked({ status: "active", insurance_expires: "2026-10-15", roadworthy_expires: null }, "2026-10-16")).toBe("the insurance has expired");
    expect(vehicleBlocked({ status: "repair", insurance_expires: null, roadworthy_expires: null }, "2026-10-16")).toMatch(/repair/);
    expect(vehicleBlocked({ status: "active", insurance_expires: "2026-12-01", roadworthy_expires: "2026-12-01" }, "2026-10-16")).toBeNull();
  });
  it("finds children still on the bus and those who never boarded", () => {
    const riders = [{ student_id: "a", name: "Ada", direction: "both" }, { student_id: "b", name: "Ben", direction: "both" }, { student_id: "c", name: "Cy", direction: "morning" }, { student_id: "d", name: "Di", direction: "afternoon" }];
    const ev = [{ student_id: "a", kind: "boarded" as const, at: "1" }, { student_id: "a", kind: "alighted" as const, at: "2" }, { student_id: "b", kind: "boarded" as const, at: "1" }];
    expect(tripCheck(riders, ev, "afternoon")).toEqual({ still_on_bus: ["Ben"], not_boarded: ["Di"] });
    expect(tripCheck(riders, ev, "morning")).toEqual({ still_on_bus: ["Ben"], not_boarded: ["Cy"] });
  });
});
