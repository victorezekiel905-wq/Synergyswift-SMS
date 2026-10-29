import { describe, it, expect } from "vitest";
import { CAPABILITIES } from "@/lib/capabilities";

describe("the complete list on /guide", () => {
  const items = CAPABILITIES.flatMap(s => s.items);
  it("runs A to J, numbered straight through with no gaps", () => {
    expect(CAPABILITIES.map(s => s.letter).join("")).toBe("ABCDEFGHIJ");
    expect(items.map(i => i.n)).toEqual(items.map((_, k) => k + 1));
    expect(items.length).toBe(99);
  });
  it("says something for every item", () => {
    for (const i of items) expect((i.lead ?? "") + (i.text ?? ""), String(i.n)).not.toBe("");
  });
  it("is written for schools and investors, not the owner", () => {
    for (const i of items) expect(`${i.lead ?? ""} ${i.text ?? ""} ${(i.more ?? []).join(" ")}`, String(i.n)).not.toMatch(/\byou(r)?\b/i);
  });
});
