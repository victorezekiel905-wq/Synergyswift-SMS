import { describe, expect, it } from "vitest";
import { nextStep, progress, promiseState, slugify, type FamilyDebt } from "@/lib/collections";

const today = "2026-11-10";

describe("promises to pay", () => {
  it("is kept as soon as payments cover it, even early", () => {
    expect(promiseState({ amount: 50000, promised_by: "2026-11-20" }, 50000, today)).toBe("kept");
  });
  it("stays open until its date", () => {
    expect(promiseState({ amount: 50000, promised_by: "2026-11-20" }, 20000, today)).toBe("open");
    expect(promiseState({ amount: 50000, promised_by: today }, 0, today)).toBe("open");
  });
  it("is broken once the date has passed without the money", () => {
    expect(promiseState({ amount: 50000, promised_by: "2026-11-09" }, 49000, today)).toBe("broken");
  });
});

const base: FamilyDebt = { balance: 120000, daysOverdue: 20, level: 0, lastContactDays: null, openPromise: null, brokenPromises: 0 };

describe("next step for a family that owes", () => {
  it("starts with a friendly reminder", () => {
    expect(nextStep(base, today)).toMatchObject({ label: "Send a friendly reminder", level: 1 });
  });
  it("waits while a promise is open", () => {
    expect(nextStep({ ...base, level: 2, openPromise: { amount: 120000, promised_by: "2026-11-30" } }, today).label).toMatch(/^Wait/);
  });
  it("follows up a broken promise first, urgently", () => {
    expect(nextStep({ ...base, level: 1, brokenPromises: 1, lastContactDays: 5 }, today)).toMatchObject({ level: 2, urgent: true });
  });
  it("calls after two weeks overdue, then the principal, then a final notice", () => {
    expect(nextStep({ ...base, level: 1, lastContactDays: 10 }, today).label).toMatch(/^Call the family/);
    expect(nextStep({ ...base, level: 2, daysOverdue: 65, lastContactDays: 10 }, today)).toMatchObject({ label: "Principal's letter", level: 3 });
    expect(nextStep({ ...base, level: 3, daysOverdue: 95, lastContactDays: 10 }, today)).toMatchObject({ label: "Final notice", level: 4 });
  });
  it("gives a recent contact time", () => {
    expect(nextStep({ ...base, level: 2, lastContactDays: 3 }, today).label).toMatch(/give it time/);
  });
  it("does nothing when nothing is owed or not yet due", () => {
    expect(nextStep({ ...base, balance: 0 }, today).label).toBe("Nothing owed");
    expect(nextStep({ ...base, daysOverdue: 0 }, today).label).toBe("Not yet due");
  });
});

describe("fundraising", () => {
  it("shows progress against the goal", () => {
    expect(progress(2_500_000, 10_000_000)).toBe(25);
    expect(progress(12_000_000, 10_000_000)).toBe(100);
    expect(progress(100, null)).toBeNull();
  });
  it("makes web-safe slugs", () => {
    expect(slugify("New Science Lab 2027!")).toBe("new-science-lab-2027");
  });
});
