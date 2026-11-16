import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/exams/engine", () => ({ markAttempt: vi.fn(), questionsForAttempt: vi.fn() }));
import { classMaySit, examClasses } from "@/lib/exams/server";

/** Only the classes an exam is for may sit it: the class on the exam, or its exam-planner papers' classes. */
describe("who may sit an exam", () => {
  const svc = (papers: { class_group_ids: string[] }[]) => ({ from: () => ({ select: () => ({ eq: async () => ({ data: papers }) }) }) });
  it("a class set on the exam is the only class", async () => {
    const cls = await examClasses(svc([{ class_group_ids: ["B"] }]), { id: "e1", class_group_id: "A" });
    expect(cls).toEqual(["A"]);
    expect(classMaySit(cls, "A")).toBe(true);
    expect(classMaySit(cls, "B")).toBe(false);
    expect(classMaySit(cls, null)).toBe(false);
  });
  it("an exam timetabled for classes in the exam planner is only for those classes", async () => {
    const cls = await examClasses(svc([{ class_group_ids: ["A", "B"] }, { class_group_ids: ["C"] }]), { id: "e1", class_group_id: null });
    expect(cls.sort()).toEqual(["A", "B", "C"]);
    expect(classMaySit(cls, "B")).toBe(true);
    expect(classMaySit(cls, "D")).toBe(false);
  });
  it("only an exam the teacher set for the whole school is open to every class", async () => {
    const cls = await examClasses(svc([]), { id: "e1", class_group_id: null });
    expect(classMaySit(cls, "D")).toBe(true);
  });
});
