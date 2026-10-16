import { describe, it, expect } from "vitest";
import { isValidIsbn10, isValidIsbn13, toIsbn13, classifyScan, parseOpenLibrary, loanState, fineFor, canOpen, reminderDue } from "@/lib/library";

describe("ISBNs and scans", () => {
  it("checks ISBN-10 and ISBN-13 check digits", () => {
    expect(isValidIsbn10("0-306-40615-2")).toBe(true);
    expect(isValidIsbn10("0306406153")).toBe(false);
    expect(isValidIsbn10("080442957X")).toBe(true);
    expect(isValidIsbn13("978-0-306-40615-7")).toBe(true);
    expect(isValidIsbn13("9780306406158")).toBe(false);
    expect(isValidIsbn13("4006381333931")).toBe(false);        // an EAN, not a book
  });
  it("turns any ISBN into ISBN-13", () => {
    expect(toIsbn13("0306406152")).toBe("9780306406157");
    expect(toIsbn13("978 0 306 40615 7")).toBe("9780306406157");
    expect(toIsbn13("12345")).toBeNull();
  });
  it("tells books, cards and labels apart", () => {
    expect(classifyScan("9780306406157")).toEqual({ kind: "isbn", isbn: "9780306406157" });
    expect(classifyScan("EDU:ab12cd")).toEqual({ kind: "card", code: "ab12cd" });
    expect(classifyScan("LIB-0042")).toEqual({ kind: "label", code: "LIB-0042" });
  });
  it("reads Open Library's answer", () => {
    const json = { "ISBN:9780306406157": { title: "Things Fall Apart", subtitle: "A novel", authors: [{ name: "Chinua Achebe" }], publishers: [{ name: "Heinemann" }],
      publish_date: "March 1958", cover: { medium: "https://covers.example/m.jpg" }, subjects: [{ name: "Igbo (African people)" }] } };
    expect(parseOpenLibrary(json, "9780306406157")).toEqual({ isbn: "9780306406157", title: "Things Fall Apart: A novel", author: "Chinua Achebe", publisher: "Heinemann",
      year: 1958, cover_url: "https://covers.example/m.jpg", category: "Igbo (African people)" });
    expect(parseOpenLibrary({}, "9780306406157")).toBeNull();
  });
});

describe("loans", () => {
  const now = new Date("2026-10-16T12:00:00Z");
  it("knows where a loan stands", () => {
    expect(loanState({ due_at: "2026-10-13T12:00:00Z", returned_at: null }, now)).toEqual({ state: "overdue", days: 3 });
    expect(loanState({ due_at: "2026-10-17T12:00:00Z", returned_at: null }, now)).toEqual({ state: "due_soon", days: 1 });
    expect(loanState({ due_at: "2026-10-30T12:00:00Z", returned_at: null }, now).state).toBe("on_loan");
    expect(loanState({ due_at: "x", returned_at: "y", lost_at: "z" }, now).state).toBe("lost");
  });
  it("fines whole late days", () => {
    expect(fineFor("2026-10-13T12:00:00Z", now, 50)).toBe(150);
    expect(fineFor("2026-10-16T11:00:00Z", now, 50)).toBe(50);
    expect(fineFor("2026-10-20T12:00:00Z", now, 50)).toBe(0);
  });
  it("reminds every few days", () => {
    expect(reminderDue({ due_at: "2026-10-10T00:00:00Z", returned_at: null, last_reminded_at: null }, now)).toBe(true);
    expect(reminderDue({ due_at: "2026-10-10T00:00:00Z", returned_at: null, last_reminded_at: "2026-10-15T00:00:00Z" }, now)).toBe(false);
    expect(reminderDue({ due_at: "2026-10-20T00:00:00Z", returned_at: null, last_reminded_at: null }, now)).toBe(false);
  });
  it("opens digital items for the right people", () => {
    expect(canOpen("staff", new Set(["teacher"]))).toBe(true);
    expect(canOpen("staff", new Set(["student"]))).toBe(false);
    expect(canOpen("students", new Set(["student"]))).toBe(true);
    expect(canOpen("students", new Set(["parent"]))).toBe(false);
    expect(canOpen("everyone", new Set(["parent"]))).toBe(true);
  });
});
