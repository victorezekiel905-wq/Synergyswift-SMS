import { describe, expect, it } from "vitest";
import { bestMatch, isFullName, splitName } from "@/lib/class-signup";

const list = [
  { id: "1", name: "Ada Ngozi Obi" },
  { id: "2", name: "Musa Bello" },
  { id: "3", name: "Ada Okafor" },
  { id: "4", name: "Chidi Eze" },
  { id: "5", name: "Chidi Eze" }
];

describe("class sign-up: matching a typed name to the class list", () => {
  it("finds the one record whose words all appear, in any order", () => {
    expect(bestMatch("Obi Ada", list)?.id).toBe("1");
    expect(bestMatch("ada ngozi obi", list)?.id).toBe("1");
    expect(bestMatch("Musa  Bello", list)?.id).toBe("2");
  });
  it("is unsure (the teacher chooses) when the name is short or fits more than one record", () => {
    expect(bestMatch("Ada", list)).toBeNull();
    expect(bestMatch("Chidi Eze", list)).toBeNull();
    expect(bestMatch("Tunde Bakare", list)).toBeNull();
  });
  it("needs a first name and a surname", () => {
    expect(isFullName("Ada Obi")).toBe(true);
    expect(isFullName("Ada")).toBe(false);
    expect(isFullName("  ")).toBe(false);
  });
  it("splits a full name for a new record", () => {
    expect(splitName(" Ada  Ngozi Obi ")).toEqual({ first: "Ada", last: "Ngozi Obi" });
    expect(splitName("Ada")).toEqual({ first: "Ada", last: "" });
  });
});
