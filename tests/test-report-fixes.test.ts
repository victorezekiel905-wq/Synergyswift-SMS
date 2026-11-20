import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { schoolInitials, nextStudentId } from "@/lib/admission-numbers";
import { termCheck } from "@/lib/term-check";

describe("student IDs given by the app when the database update is missing", () => {
  it("uses the same initials as the database", () => {
    expect(schoolInitials("Corona Day Secondary School Lekki")).toBe("CDSSL");
    expect(schoolInitials("Greenfield College")).toBe("GC");
    expect(schoolInitials("The School of Kings")).toBe("SK");
    expect(schoolInitials("Kings")).toBe("KIN");
    expect(schoolInitials("")).toBe("SCH");
  });
  it("continues after the highest number", () => {
    expect(nextStudentId([], "GC")).toBe("GC-0001");
    expect(nextStudentId(["GC-0007", "GC-0012", "2026/9001", null, "GCX-0099"], "GC")).toBe("GC-0013");
  });
});

describe("the current term check", () => {
  const t = (ends_on: string, name: string) => ({ ends_on, academic_sessions: { name } });
  it("says when the current term has ended", () => {
    expect(termCheck(t("2026-10-30", "2026-2027"), "2026-11-20")).toEqual({ ended_on: "2026-10-30", session_typo: null });
    expect(termCheck(t("2026-12-15", "2026-2027"), "2026-11-20")).toBeNull();
  });
  it("spots a mistyped session", () => {
    expect(termCheck(t("2026-12-15", "2026-2927"), "2026-11-20")).toEqual({ ended_on: null, session_typo: "2026-2027" });
    expect(termCheck(t("2026-12-15", "2026/2027"), "2026-11-20")).toBeNull();
  });
  it("is quiet with no term", () => expect(termCheck(null, "2026-11-20")).toBeNull());
});

describe("fixes from the 20 Nov test report", () => {
  const src = (f: string) => readFileSync(f, "utf8");
  it("collections never sort by a column the table does not have", () => {
    expect(src("src/lib/collections-server.ts")).not.toMatch(/fee_collection_cases"\)[^\n]*order\("id"\)/);
  });
  it("the ISBN box is not a form inside the book form", () => {
    const s = src("src/components/library/ScanInput.tsx");
    expect(s).not.toMatch(/<form/);
    expect(s).toMatch(/type="button"[^>]*onClick=\{submit\}/);
  });
  it("every way of adding a student fills a missing ID", () => {
    for (const f of ["src/app/api/sims/students/route.ts", "src/app/api/sims/students/import/route.ts", "src/lib/admissions.ts", "src/lib/class-signup-server.ts"])
      expect(src(f), f).toMatch(/withStudentId\(/);
  });
  it("menu links do not preload pages", () => {
    expect((src("src/components/SideNav.tsx").match(/<Link /g) ?? []).length).toBe((src("src/components/SideNav.tsx").match(/prefetch=\{false\}/g) ?? []).length);
  });
});
