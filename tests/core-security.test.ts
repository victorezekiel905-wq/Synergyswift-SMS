import { describe, it, expect } from "vitest";
import { checkPassword, passwordRulesText, passwordDaysLeft, restrictionApplies, decideAccess, accessMessage, tokenClaims, signedInWithSso, deviceLabel, cleanDomains, emailDomain } from "@/lib/security";
import { FRAMEWORKS, GRADING, planCurriculum, stage, curriculumLabel } from "@/lib/curricula";
import { parseDelimited, toCsv, readXlsx, writeXlsx, excelDate, columnIndex, columnName } from "@/lib/spreadsheet";
import { ENTITIES, entity, autoMap, parseDate, parseAmount, parseGender, parseBool, readRow, template } from "@/lib/importers";
import { stateFor, coverage, nextVersion, latest, DEFAULT_PURPOSES, type Purpose, type ConsentRecord } from "@/lib/consent";
import { phoneVariants, codeHash, sameHash } from "@/lib/phone-login";

describe("password rules", () => {
  it("accepts a sensible password under the default rules", () => expect(checkPassword("Mango-tree-42")).toEqual([]));
  it("applies the school's rules", () => {
    const p = { min_length: 12, require_mixed_case: true, require_number: true, require_symbol: true };
    expect(checkPassword("short1", p)).toEqual(expect.arrayContaining(["use at least 12 characters", "mix capital and small letters", "include a symbol such as ! or #"]));
    expect(checkPassword("Long-enough-pw9", p)).toEqual([]);
  });
  it("refuses common passwords and ones built from the person's name or email", () => {
    expect(checkPassword("Password123")).toContain("choose something less common");
    expect(checkPassword("aaaaaaaa1")).toEqual([]);   // has a number, length ok; repeated chars only caught when the whole thing repeats
    expect(checkPassword("11111111")).toContain("choose something less common");
    expect(checkPassword("ngozi2026!x", {}, { email: "ngozi@school.ng" })).toContain("do not include your email address");
    expect(checkPassword("Okonkwo-2026", {}, { name: "Mrs Ada Okonkwo" })).toContain("do not include your name");
  });
  it("describes the rules in words", () => {
    expect(passwordRulesText({ min_length: 10, require_number: true, require_symbol: true })).toBe("Use at least 10 characters, a number and a symbol.");
  });
  it("counts days until a password expires", () => {
    const now = new Date("2026-03-31T12:00:00Z");
    expect(passwordDaysLeft("2026-03-01T12:00:00Z", 90, now)).toBe(60);
    expect(passwordDaysLeft("2025-01-01T00:00:00Z", 90, now)).toBeLessThan(0);
    expect(passwordDaysLeft(null, 0, now)).toBeNull();
  });
});

describe("staff access restrictions", () => {
  it("never applies to families, students or alumni, and can spare admins", () => {
    expect(restrictionApplies("ip", "all_staff", ["parent"])).toBe(false);
    expect(restrictionApplies("ip", "all_staff", ["alumni"])).toBe(false);
    expect(restrictionApplies("ip", "except_admins", ["teacher", "school_admin"])).toBe(false);
    expect(restrictionApplies("ip", "except_admins", ["teacher"])).toBe(true);
    expect(restrictionApplies("off", "all_staff", ["teacher"])).toBe(false);
  });
  it("decides by network, device, or either", () => {
    expect(decideAccess("ip", true, null)).toEqual({ ok: true });
    expect(decideAccess("ip", false, "approved")).toMatchObject({ ok: false, reason: "network" });
    expect(decideAccess("device", true, "pending")).toMatchObject({ ok: false, reason: "device" });
    expect(decideAccess("ip_or_device", false, "approved")).toEqual({ ok: true });
    const d = decideAccess("ip_or_device", false, "pending");
    expect(d).toMatchObject({ ok: false, reason: "network_or_device" });
    expect(accessMessage(d)).toMatch(/waiting for approval/);
  });
  it("reads the session id and sign-in method from a token", () => {
    const payload = Buffer.from(JSON.stringify({ session_id: "s1", amr: [{ method: "oauth" }] })).toString("base64url");
    const c = tokenClaims(`x.${payload}.y`);
    expect(c.session_id).toBe("s1");
    expect(signedInWithSso(c)).toBe(true);
    expect(signedInWithSso({ amr: [{ method: "password" }] })).toBe(false);
    expect(tokenClaims("garbage")).toEqual({});
  });
  it("names devices and cleans domains", () => {
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36")).toBe("Chrome on Windows");
    expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1")).toBe("Safari on iPhone");
    expect(cleanDomains(["@MySchool.edu.ng", "myschool.edu.ng", "not a domain", "x"])).toEqual(["myschool.edu.ng"]);
    expect(emailDomain("Ada@MySchool.edu.ng")).toBe("myschool.edu.ng");
  });
});

describe("curricula", () => {
  it("every stage points at a grading template whose bands cover 0–100 without gaps", () => {
    for (const f of FRAMEWORKS) for (const s of f.stages) {
      const g = GRADING[s.grading];
      expect(g, s.key).toBeTruthy();
      const bands = [...g.bands].sort((a, b) => a.min_score - b.min_score);
      expect(bands[0].min_score).toBe(0);
      expect(bands[bands.length - 1].max_score).toBe(100);
      for (let i = 1; i < bands.length; i++) expect(bands[i].min_score - bands[i - 1].max_score).toBeLessThanOrEqual(0.01 + 1e-9);
      expect(g.components.reduce((a, c) => a + c.weight, 0)).toBe(100);
    }
  });
  it("plans classes per level and arm, reusing what exists", () => {
    const p = planCurriculum({ stages: ["ng_jss"], arms: ["A", "B"], existingClasses: ["jss 1 a"], existingSubjects: ["mathematics"] });
    expect(p.sections).toEqual([{ stage: "ng_jss", name: "Junior Secondary", kind: "secondary" }]);
    expect(p.classes.map(c => c.name)).toEqual(["JSS 1 B", "JSS 2 A", "JSS 2 B", "JSS 3 A", "JSS 3 B"]);
    expect(p.subjects).not.toContain("Mathematics");
    expect(p.subjects).toContain("Basic Science");
    expect(p.offerings.length).toBe(6 * stage("ng_jss")!.stage.subjects.length);
    expect(p.grading).toEqual(["bece"]);
  });
  it("mixes frameworks without duplicating subjects", () => {
    const p = planCurriculum({ stages: ["uk_ks2", "ng_jss"], arms: [], existingClasses: [], existingSubjects: [] });
    const lower = p.subjects.map(s => s.toLowerCase());
    expect(new Set(lower).size).toBe(lower.length);
    expect(p.classes.map(c => c.name)).toContain("Year 6");
    expect(curriculumLabel("uk_ks4")).toBe("British National Curriculum: Key Stage 4 (GCSE)");
  });
});

describe("spreadsheets", () => {
  it("reads CSV with quotes, semicolons and a BOM", () => {
    expect(parseDelimited('﻿Name,Note\n"Obi, Ada","said ""hi"""\r\n\nBola,\n')).toEqual({ headers: ["Name", "Note"], rows: [["Obi, Ada", 'said "hi"'], ["Bola", ""]] });
    expect(parseDelimited("a;b\n1;2").rows).toEqual([["1", "2"]]);
  });
  it("writes CSV that guards formulas but keeps phone numbers", () => {
    const csv = toCsv({ headers: ["a", "b", "c"], rows: [["=SUM(A1)", "+2348031234567", "x,y"]] });
    expect(csv).toContain(`"'=SUM(A1)"`);
    expect(csv).toContain(",+2348031234567,");
    expect(parseDelimited(csv).rows[0]).toEqual(["'=SUM(A1)", "+2348031234567", "x,y"]);
  });
  it("round-trips an Excel file and keeps leading zeros", async () => {
    const t = { headers: ["admission_no", "name"], rows: [["007", "Ada & <Bola>"], ["010", "Émeka"]] };
    expect(await readXlsx(await writeXlsx(t, "Students"))).toEqual(t);
  });
  it("converts column letters and Excel dates", () => {
    expect(columnIndex("A1")).toBe(0);
    expect(columnIndex("AB12")).toBe(27);
    expect(columnName(27)).toBe("AB");
    expect(excelDate(45000)).toBe("2023-03-15");
  });
});

describe("importers", () => {
  it("matches headers from other systems", () => {
    const e = entity("students")!;
    const m = autoMap(e, ["Adm No", "Surname", "Firstname", "Sex", "DOB", "Class Arm", "GSM", "Parent Name"]);
    expect(m).toMatchObject({ admission_no: 0, last_name: 1, first_name: 2, gender: 3, date_of_birth: 4, class: 5, guardian_phone: 6, guardian_name: 7 });
    expect(m.other_names).toBe(-1);
  });
  it("reads dates, amounts, genders and yes/no as schools type them", () => {
    expect(parseDate("21/03/2014")).toBe("2014-03-21");
    expect(parseDate("21-3-14")).toBe("2014-03-21");
    expect(parseDate("21st March 2014")).toBe("2014-03-21");
    expect(parseDate("2014-02-30")).toBeNull();
    expect(parseAmount("₦45,000.50")).toBe(45000.5);
    expect(parseAmount("(1,200)")).toBe(-1200);
    expect(parseAmount("abc")).toBeNull();
    expect(parseGender("F")).toBe("female");
    expect(parseBool("Yes")).toBe(true);
  });
  it("reports every problem on a row", () => {
    const e = entity("students")!;
    const r = readRow(e, { admission_no: 0, first_name: 1, last_name: 2, date_of_birth: 3, guardian_email: 4 }, ["001", "", "Obi", "31/31/2010", "not-an-email"], 5);
    expect(r.row).toBe(5);
    expect(r.errors).toEqual(["First name is missing", 'Date of birth: "31/31/2010" is not a date', 'Parent email: "not-an-email" is not an email address']);
  });
  it("has a template for every entity whose example row passes", () => {
    for (const e of ENTITIES) {
      const t = template(e);
      const map = Object.fromEntries(t.headers.map((h, i) => [h, i]));
      expect(readRow(e, map, t.rows[0], 2).errors, e.key).toEqual([]);
    }
  });
});

describe("consent", () => {
  const p: Purpose = { id: "p1", key: "photos_public", title: "Photos", description: "x", per_child: true, required: false, version: 2, active: true, position: 1 };
  const fam: Purpose = { ...p, id: "p2", key: "marketing", per_child: false, version: 1 };
  const recs: ConsentRecord[] = [
    { purpose_id: "p1", version: 2, guardian_id: "g1", student_id: "s1", granted: true, method: "portal", created_at: "2026-01-01" },
    { purpose_id: "p1", version: 2, guardian_id: "g2", student_id: "s1", granted: false, method: "portal", created_at: "2026-02-01" },
    { purpose_id: "p1", version: 1, guardian_id: "g1", student_id: "s2", granted: true, method: "paper", created_at: "2025-01-01" },
    { purpose_id: "p2", version: 1, guardian_id: "g1", student_id: null, granted: true, method: "portal", created_at: "2026-01-01" }
  ];
  it("uses the latest answer from any guardian, and asks again after a wording change", () => {
    expect(stateFor(p, recs, { studentId: "s1" }).state).toBe("declined");
    expect(stateFor(p, recs, { studentId: "s2" }).state).toBe("outdated");
    expect(stateFor(p, recs, { studentId: "s3" }).state).toBe("missing");
    expect(stateFor(fam, recs, { guardianId: "g1" }).state).toBe("granted");
    expect(latest(recs).size).toBe(4);
  });
  it("counts coverage per purpose", () => {
    const c = coverage([p, fam], recs, ["s1", "s2", "s3"], ["g1", "g2"]);
    expect(c[0]).toMatchObject({ total: 3, granted: 0, declined: 1, outdated: 1, missing: 1 });
    expect(c[1]).toMatchObject({ total: 2, granted: 1, missing: 1 });
  });
  it("bumps the version only when the wording changes", () => {
    expect(nextVersion({ title: "A", description: "B", version: 3 }, { title: "A", description: "B " })).toBe(3);
    expect(nextVersion({ title: "A", description: "B", version: 3 }, { title: "A", description: "C" })).toBe(4);
    expect(DEFAULT_PURPOSES.filter(x => x.required).map(x => x.key)).toEqual(["school_records"]);
  });
});

describe("phone sign-in", () => {
  it("matches the ways a number is stored", () => {
    expect(phoneVariants("0803 123 4567", "234").sort()).toEqual(["+2348031234567", "08031234567", "2348031234567", "8031234567"].sort());
    expect(phoneVariants("abc")).toEqual([]);
  });
  it("hashes codes per account and compares in constant time", () => {
    const h = codeHash("u1", "2348031234567", "123456");
    expect(sameHash(h, codeHash("u1", "2348031234567", "123456"))).toBe(true);
    expect(sameHash(h, codeHash("u2", "2348031234567", "123456"))).toBe(false);
  });
});
