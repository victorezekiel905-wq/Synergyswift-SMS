import { describe, it, expect } from "vitest";
import { parseCsv, toCsv, isLate, startOfTodayIso, distanceMetres, studentName } from "@/lib/school";
import { normalizeScan } from "@/lib/gate";

describe("CSV", () => {
  it("parses quotes, commas, CRLF and BOM, normalising headers", () => {
    const rows = parseCsv('﻿Admission No,First Name,Guardian Name\r\n001,Ada,"Okafor, Mrs"\r\n002,"Bola ""B""",\r\n\r\n');
    expect(rows).toEqual([
      { admission_no: "001", first_name: "Ada", guardian_name: "Okafor, Mrs" },
      { admission_no: "002", first_name: 'Bola "B"', guardian_name: "" }
    ]);
  });
  it("round-trips through toCsv", () => {
    const csv = toCsv([["a", "b"], ['x,"y"', null]]);
    expect(csv).toBe('a,b\r\n"x,""y""",');
  });
});

describe("attendance time helpers", () => {
  it("marks late relative to the school's time zone", () => {
    const t = new Date("2026-09-25T07:10:00Z"); // 08:10 in Lagos (UTC+1)
    expect(isLate(t, "08:00", "Africa/Lagos")).toBe(true);
    expect(isLate(t, "08:15", "Africa/Lagos")).toBe(false);
    expect(isLate(t, "07:00", "UTC")).toBe(true);
  });
  it("computes local midnight as UTC", () => {
    expect(startOfTodayIso("Africa/Lagos", new Date("2026-09-25T10:00:00Z"))).toBe("2026-09-24T23:00:00.000Z");
    expect(startOfTodayIso("Africa/Nairobi", new Date("2026-09-25T22:30:00Z"))).toBe("2026-09-25T21:00:00.000Z");
    expect(startOfTodayIso("Not/AZone", new Date("2026-09-25T10:00:00Z"))).toBe("2026-09-25T00:00:00.000Z");
  });
  it("measures geofence distance", () => {
    const d = distanceMetres(6.5244, 3.3792, 6.5254, 3.3792);
    expect(d).toBeGreaterThan(100);
    expect(d).toBeLessThan(120);
  });
});

describe("misc", () => {
  it("formats names and QR payloads", () => {
    expect(studentName({ first_name: "Ada", last_name: "Okafor", other_names: "Chioma" })).toBe("Ada Chioma Okafor");
    expect(normalizeScan("  EDU:abc123 ")).toBe("abc123");
    expect(normalizeScan("edu:XYZ")).toBe("XYZ");
  });
});
