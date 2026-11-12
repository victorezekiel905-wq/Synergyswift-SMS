import { describe, expect, it } from "vitest";
import { matchSubject, subjectsFrom, staffListFromGrid, stageOf, assignmentChanges } from "@/lib/staff-onboarding";
import { parseGrid } from "@/lib/spreadsheet";

const subjects = [
  { id: "m", name: "Mathematics", code: "MTH" }, { id: "fm", name: "Further Mathematics" }, { id: "e", name: "English Language" },
  { id: "bs", name: "Basic Science" }, { id: "p", name: "Physics" }, { id: "crs", name: "C.R.S" }
];

describe("staff onboarding: subjects by name", () => {
  it("matches the school's subjects forgivingly", () => {
    expect(matchSubject("mathematics", subjects)?.id).toBe("m");
    expect(matchSubject("Maths", subjects)?.id).toBe("m");
    expect(matchSubject("MTH", subjects)?.id).toBe("m");
    expect(matchSubject("English", subjects)?.id).toBe("e");
    expect(matchSubject("crs", subjects)?.id).toBe("crs");
    expect(matchSubject("Further maths", subjects)?.id).toBe("fm");
    expect(matchSubject("Science", subjects)).toBeNull();                 // not sure: left for the admin to see
    expect(matchSubject("Chemistry", subjects)).toBeNull();
    expect(matchSubject("ph", subjects)).toBeNull();                      // too short to guess
  });
  it("reads several subjects in one cell", () => {
    expect(subjectsFrom("Maths; Physics / English and Basic Science", subjects)).toEqual({ ids: ["m", "p", "e", "bs"], unknown: [] });
    expect(subjectsFrom("Physics, Chemistry", subjects)).toEqual({ ids: ["p"], unknown: ["Chemistry"] });
  });
});

describe("staff onboarding: a staff list", () => {
  it("reads a spreadsheet with headings in any order", () => {
    const rows = staffListFromGrid([["Email", "Full name", "Subjects", "ID number"], ["ADA@x.com", "Ada Obi", "Maths; Physics", "T-01"], ["tunde@x.com", "Tunde Bello", "English", ""]], subjects);
    expect(rows).toMatchObject([
      { line: 2, full_name: "Ada Obi", email: "ada@x.com", subject_ids: ["m", "p"], staff_no: "T-01", problem: null },
      { line: 3, full_name: "Tunde Bello", subject_ids: ["e"], problem: null }
    ]);
  });
  it("reads pasted lines with no headings", () => {
    const rows = staffListFromGrid(parseGrid("Ada Obi, ada@x.com, Maths; Physics\nTunde Bello, tunde@x.com, English, Basic Science"), subjects);
    expect(rows.map(r => [r.full_name, r.email, r.subject_ids])).toEqual([["Ada Obi", "ada@x.com", ["m", "p"]], ["Tunde Bello", "tunde@x.com", ["e", "bs"]]]);
  });
  it("marks the lines that can't be added", () => {
    const rows = staffListFromGrid([["A", "a@x.com"], ["Bola", "bola@x"], ["Chi", ""], ["Ada again", "A@x.com"]], subjects);
    expect(rows.map(r => r.problem)).toEqual(["no name", "email is not right", "no email", "this email is on the list twice"]);
  });
});

describe("staff onboarding: where everyone is", () => {
  it("waiting, joined with no class, or ready", () => {
    expect(stageOf({ has_account: false, classes: 0 })).toBe("waiting");
    expect(stageOf({ has_account: true, classes: 0 })).toBe("needs_classes");
    expect(stageOf({ has_account: true, classes: 2 })).toBe("ready");
    // An email link or one-time password makes the account at once: until they sign in, they are still waiting.
    expect(stageOf({ has_account: true, classes: 2, signed_in: false })).toBe("waiting");
    expect(stageOf({ has_account: true, classes: 0, signed_in: true })).toBe("needs_classes");
    expect(stageOf({ has_account: true, classes: 1, signed_in: null })).toBe("ready");     // not known (before the database update)
  });
  it("works out which classes to add and take away", () => {
    const have = [{ class_group_id: "1A", subject_id: "m" }, { class_group_id: "2B", subject_id: null }];
    const want = [{ class_group_id: "1A", subject_id: "m" }, { class_group_id: "1B", subject_id: "m" }, { class_group_id: "1B", subject_id: "m" }];
    expect(assignmentChanges(have, want)).toEqual({ add: [{ class_group_id: "1B", subject_id: "m" }], remove: [{ class_group_id: "2B", subject_id: null }] });
  });
});
