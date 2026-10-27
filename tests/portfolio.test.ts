import { describe, it, expect } from "vitest";
import { targetProgress, shareName, shareState, type Target, type Evidence } from "@/lib/portfolio";

const ev: Evidence = {
  averages: [{ term_id: "t2", average: 71.5, subjects: [{ subject_id: "maths", total: 58 }, { subject_id: "eng", total: 80 }] },
    { term_id: "t1", average: 64, subjects: [{ subject_id: "maths", total: 49 }] }],
  attendance: 93
};
const t = (o: Partial<Target>): Target => ({ id: "x", kind: "average", target: 70, subject_id: null, term_id: null, status: "active", description: null, ...o });

describe("targets", () => {
  it("compares the latest result, or the target's own term", () => {
    expect(targetProgress(t({}), ev)).toEqual({ current: 71.5, met: true });
    expect(targetProgress(t({ term_id: "t1" }), ev)).toEqual({ current: 64, met: false });
  });
  it("reads a subject's score and attendance", () => {
    expect(targetProgress(t({ kind: "subject_score", subject_id: "maths", target: 60 }), ev)).toEqual({ current: 58, met: false });
    expect(targetProgress(t({ kind: "attendance", target: 95 }), ev)).toEqual({ current: 93, met: false });
    expect(targetProgress(t({ kind: "subject_score", subject_id: "art", target: 60 }), ev)).toEqual({ current: null, met: null });
  });
  it("leaves personal goals to the person", () => {
    expect(targetProgress(t({ kind: "personal", target: null }), ev)).toEqual({ current: null, met: null });
    expect(targetProgress(t({ kind: "personal", target: null, status: "met" }), ev)).toEqual({ current: null, met: true });
  });
});

describe("share links", () => {
  it("shows only the first name and an initial", () => {
    expect(shareName("Adaeze", "okafor")).toBe("Adaeze O.");
    expect(shareName("Tobi", "")).toBe("Tobi");
  });
  it("knows when a link has stopped", () => {
    const now = new Date("2026-11-01T00:00:00Z");
    expect(shareState({ revoked_at: null, expires_at: "2026-12-01T00:00:00Z" }, now)).toBe("live");
    expect(shareState({ revoked_at: null, expires_at: "2026-10-01T00:00:00Z" }, now)).toBe("expired");
    expect(shareState({ revoked_at: "2026-10-20T00:00:00Z", expires_at: "2026-12-01T00:00:00Z" }, now)).toBe("revoked");
  });
});
