import { describe, it, expect } from "vitest";
import { contentHash, fileFingerprint, checkSignature, progress, contractText, auditTrail } from "@/lib/esign";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=";

describe("fingerprints", () => {
  it("change when anything signed changes", () => {
    const h = contentHash("Trip form", "I agree.");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(contentHash(" Trip form ", "I agree.")).toBe(h);
    expect(contentHash("Trip form", "I agree!")).not.toBe(h);
    expect(contentHash("Trip form", "I agree.", fileFingerprint(Buffer.from("pdf")))).not.toBe(h);
  });
});

describe("checkSignature", () => {
  it("needs agreement and a typed name; a drawing is optional but must be a PNG", () => {
    expect(checkSignature({ agree: true, typed_name: "Ada Obi" })).toBeNull();
    expect(checkSignature({ agree: true, typed_name: "Ada Obi", signature_png: PNG })).toBeNull();
    expect(checkSignature({ agree: false, typed_name: "Ada Obi" })).toMatch(/agree/);
    expect(checkSignature({ agree: true, typed_name: " " })).toMatch(/name/);
    expect(checkSignature({ agree: true, typed_name: "Ada", signature_png: "data:image/jpeg;base64,xxx" })).toMatch(/PNG/);
    expect(checkSignature({ agree: true, typed_name: "Ada", signature_png: PNG + "A".repeat(400_000) })).toMatch(/too large/);
  });
});

describe("progress", () => {
  it("counts children for parents' forms", () => {
    const p = progress([
      { id: "1", status: "signed", student_id: "k1", name: "Mum" }, { id: "2", status: "not_needed", student_id: "k1", name: "Dad" },
      { id: "3", status: "viewed", student_id: "k2", name: "Aunt" }, { id: "4", status: "pending", student_id: "k3", name: "Gran" }
    ], "any_per_child");
    expect(p).toMatchObject({ total: 3, done: 1, signed: 1, not_needed: 1, waiting: ["Aunt", "Gran"] });
  });
  it("counts people when everyone must sign", () => {
    expect(progress([{ id: "1", status: "signed", student_id: null, name: "A" }, { id: "2", status: "declined", student_id: null, name: "B" }], "all"))
      .toMatchObject({ total: 2, done: 1, declined: 1, waiting: [] });
  });
});

describe("contracts and audit", () => {
  it("writes the contract text", () => {
    const t = contractText({ kind: "fixed_term", position: "Maths teacher", starts_on: "2026-09-01", ends_on: "2027-07-31", probation_ends_on: null, notice_days: 30, salary_note: "Grade 7", notes: null }, "Ada Obi", "Greenfield School");
    expect(t).toContain("This fixed term contract is between Greenfield School");
    expect(t).toContain("End date: 2027-07-31.");
    expect(t).toContain("Notice period: 30 days.");
    expect(t).not.toContain("Probation");
  });
  it("lists the audit trail and flags a mismatched fingerprint", () => {
    const h = "a".repeat(64);
    const lines = auditTrail({ title: "Form", content_hash: h, created_at: "t0", completed_at: null, status: "open" }, [
      { id: "1", status: "signed", student_id: null, name: "Ada", signed_at: "t1", typed_name: "Ada Obi", ip: "1.2.3.4", signed_hash: h },
      { id: "2", status: "signed", student_id: null, name: "Bayo", signed_at: "t2", typed_name: "Bayo", signed_hash: "b".repeat(64) },
      { id: "3", status: "not_needed", student_id: "k", name: "Dad" }
    ]);
    expect(lines[3]).toBe('Ada: signed, signed t1 as "Ada Obi", from 1.2.3.4, fingerprint matches');
    expect(lines[4]).toContain("DOES NOT MATCH");
    expect(lines[5]).toContain("not needed");
    expect(lines.at(-1)).toBe("Status: open");
  });
});
