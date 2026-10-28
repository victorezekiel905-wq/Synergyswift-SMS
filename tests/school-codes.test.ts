import { describe, it, expect } from "vitest";
import { newSchoolCode, normalizeSchoolCode, isSchoolCodeShape, hashSchoolCode, codeStatus } from "@/lib/school-codes";

describe("one-time school codes", () => {
  it("makes long codes without look-alike characters, never the same twice", () => {
    const codes = new Set(Array.from({ length: 500 }, () => newSchoolCode()));
    expect(codes.size).toBe(500);
    for (const c of codes) {
      expect(c).toMatch(/^SSC-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
      expect(c).not.toMatch(/[01OIL]/);
      expect(isSchoolCodeShape(c)).toBe(true);
    }
  });
  it("accepts the code however it is typed, and stores only a hash", () => {
    const c = "SSC-ABCD-EFGH-JKMN";
    expect(normalizeSchoolCode(" ssc abcd-efgh jkmn ")).toBe("ABCDEFGHJKMN");
    expect(hashSchoolCode("abcdefghjkmn")).toBe(hashSchoolCode(c));
    expect(hashSchoolCode(c)).toMatch(/^[0-9a-f]{64}$/);
    expect(isSchoolCodeShape("ABC123")).toBe(false);
  });
  it("tells used, cancelled, expired and open codes apart", () => {
    const now = Date.parse("2026-11-01T10:00:00Z");
    expect(codeStatus({ used_at: "2026-10-30", revoked_at: null, expires_at: "2026-11-05" }, now)).toBe("used");
    expect(codeStatus({ used_at: null, revoked_at: "2026-10-30", expires_at: "2026-11-05" }, now)).toBe("revoked");
    expect(codeStatus({ used_at: null, revoked_at: null, expires_at: "2026-10-31" }, now)).toBe("expired");
    expect(codeStatus({ used_at: null, revoked_at: null, expires_at: "2026-11-05" }, now)).toBe("open");
  });
});
