import { describe, it, expect } from "vitest";
import { fetchAll } from "@/lib/results";

/** A query builder like Supabase's: serves at most 1000 rows per request. */
function fakeQuery(rows: number[]) {
  return () => ({
    range: async (from: number, to: number) => ({ data: rows.slice(from, Math.min(to + 1, from + 1000)), error: null })
  });
}

describe("fetchAll", () => {
  it("reads past the 1000-row cap (a 40-student class with 12 subjects and 3 components)", async () => {
    const rows = Array.from({ length: 1440 }, (_, i) => i);
    expect(await fetchAll(fakeQuery(rows))).toEqual(rows);
  });
  it("handles an exact multiple of the page size and an empty result", async () => {
    expect((await fetchAll(fakeQuery(Array.from({ length: 2000 }, (_, i) => i)))).length).toBe(2000);
    expect(await fetchAll(fakeQuery([]))).toEqual([]);
  });
  it("surfaces database errors instead of returning partial data", async () => {
    const failing = () => ({ range: async () => ({ data: null, error: { message: "boom" } }) });
    await expect(fetchAll(failing)).rejects.toThrow("boom");
  });
});
