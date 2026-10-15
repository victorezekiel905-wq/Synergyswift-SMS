import { describe, it, expect } from "vitest";
import { leavingEffect, clearance, extraMinutes, iepReviewState, targetProgress, certificateText, canonicalCertificate, attendanceRate, yearsAttended, CERT_KINDS, type CertFacts } from "@/lib/sis";
import { sniff } from "@/lib/files";

const facts: CertFacts = { student: "Ada Obi", admission_no: "2019/014", date_of_birth: "2010-04-02", gender: "female", admitted_on: "2019-09-09", left_on: "2025-07-18",
  last_class: "SS 3 A", leaving_reason: "Completed secondary school", destination_school: null, fees_cleared: true, positions: ["Head Girl"], achievements: ["Inter-house sports, 1st place"], attendance_rate: 0.964 };

describe("leaving", () => {
  it("maps each way of leaving to a status and a history entry", () => {
    expect(leavingEffect("graduated")).toEqual({ status: "graduated", movement: "graduated" });
    expect(leavingEffect("transferred")).toEqual({ status: "withdrawn", movement: "transferred_out" });
    expect(leavingEffect("expelled")).toEqual({ status: "withdrawn", movement: "expelled" });
    expect(leavingEffect("deceased")).toEqual({ status: "withdrawn", movement: "other" });
  });
  it("lists what to settle before a child leaves", () => {
    const c = clearance({ balance: 45000, unreturnedBooks: 2, hostelBed: false, walletBalance: 1200, currency: "NGN" }, n => `₦${n}`);
    expect(c.map(x => [x.key, x.ok])).toEqual([["fees", false], ["library", false], ["boarding", true], ["wallet", false]]);
    expect(c[0].detail).toBe("₦45000 still owed");
    expect(c[3].detail).toMatch(/refund/);
  });
});

describe("SEN", () => {
  it("works out extra exam time", () => {
    expect(extraMinutes(60, 25)).toBe(15);
    expect(extraMinutes(45, 25)).toBe(12);
    expect(extraMinutes(60, 0)).toBe(0);
    expect(extraMinutes(60, 500)).toBe(60);
    expect(extraMinutes(60, null)).toBe(0);
  });
  it("flags plan reviews that are due or overdue", () => {
    expect(iepReviewState("2026-03-01", "active", "2026-03-10")).toBe("overdue");
    expect(iepReviewState("2026-03-20", "active", "2026-03-10")).toBe("due_soon");
    expect(iepReviewState("2026-06-20", "active", "2026-03-10")).toBe("ok");
    expect(iepReviewState("2026-03-01", "draft", "2026-03-10")).toBe("none");
  });
  it("summarises target progress", () => {
    expect(targetProgress([{ progress: "achieved" }, { progress: "secure" }, { progress: "emerging" }, { progress: "not_started" }])).toEqual({ total: 4, achieved: 1, on_track: 2, pct: 50 });
    expect(targetProgress([]).pct).toBeNull();
  });
});

describe("certificates", () => {
  it("words a transfer certificate from the record", () => {
    const t = certificateText("transfer", { ...facts, destination_school: "Kings College, Lagos", leaving_reason: "Relocation", fees_cleared: false }, "Alpha School");
    expect(t.title).toBe("Transfer Certificate");
    expect(t.body).toContain("Ada Obi (admission number 2019/014) was a student of Alpha School");
    expect(t.body).toContain("Admitted: 9 September 2019. Left: 18 July 2025. Last class attended: SS 3 A.");
    expect(t.body).toContain("Proceeding to: Kings College, Lagos.");
    expect(t.body).toContain("School fees: not fully paid.");
  });
  it("words a testimonial with positions, achievements and attendance", () => {
    const t = certificateText("testimonial", facts, "Alpha School");
    expect(t.body).toContain("she held the following positions: Head Girl.");
    expect(t.body).toContain("Attendance: 96%.");
    expect(t.body).toContain("We recommend Ada Obi without reservation.");
  });
  it("has wording for every kind and respects a custom title", () => {
    for (const k of CERT_KINDS) expect(certificateText(k, facts, "Alpha School").body.length, k).toBeGreaterThan(10);
    expect(certificateText("award", { ...facts, award: "Best in Mathematics" }, "X", "Prize Day").title).toBe("Prize Day");
    expect(certificateText("attendance", { ...facts, attendance_rate: 1 }, "X").body).toContain("perfect attendance (100%)");
  });
  it("signs the same content the same way whatever the key order", () => {
    const base = { id: "c", tenant_id: "t", student_id: "s", kind: "award", serial_no: "CERT-2026-000001", issued_on: "2026-07-01", title: "T", body: "B " };
    expect(canonicalCertificate({ ...base, data: { a: 1, b: { y: 2, x: 1 } } })).toBe(canonicalCertificate({ ...base, body: "B", data: { b: { x: 1, y: 2 }, a: 1 } }));
    expect(canonicalCertificate({ ...base, data: { a: 1 } })).not.toBe(canonicalCertificate({ ...base, data: { a: 2 } }));
  });
});

describe("helpers", () => {
  it("computes attendance and years attended", () => {
    expect(attendanceRate([{ status: "present" }, { status: "late" }, { status: "absent" }, { status: "excused" }])).toBe(0.5);
    expect(attendanceRate([])).toBeNull();
    expect(yearsAttended("2019-09-09", "2025-07-18")).toBe("2019 – 2025");
    expect(yearsAttended("2025-01-09", "2025-07-18")).toBe("2025");
  });
  it("recognises real files by their first bytes", () => {
    expect(sniff(Buffer.from("%PDF-1.7 rest"), "pdf")).toBe(true);
    expect(sniff(Buffer.from("MZ executable"), "pdf")).toBe(false);
    expect(sniff(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]), "png")).toBe(true);
    expect(sniff(Buffer.from("PK\u0003\u0004word"), "docx")).toBe(true);
    expect(sniff(Buffer.from("\u0000\u0000\u0000\u0018ftypmp42"), "mp4")).toBe(true);
  });
});
