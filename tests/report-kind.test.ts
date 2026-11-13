import { describe, expect, it } from "vitest";
import { reportKindOf, REPORT_TITLE, termName } from "@/lib/report-kind";

describe("mid-term and end of term reports", () => {
  it("knows which report a card is", () => {
    expect(reportKindOf("midterm")).toBe("midterm");
    expect(reportKindOf("term")).toBe("term");
    expect(reportKindOf(null, { kind: "midterm" })).toBe("midterm");     // older rows carry it in their data
    expect(reportKindOf(undefined)).toBe("term");
    expect(REPORT_TITLE[reportKindOf("midterm")]).toBe("Mid-term report");
    expect(REPORT_TITLE[reportKindOf("term")]).toBe("End of term report");
  });
  it("shows the term's name once", () => {
    expect(termName("First term 2026/2027 (mid-term)")).toBe("First term 2026/2027");
    expect(termName("Second term")).toBe("Second term");
    expect(termName(null)).toBe("");
  });
});
