import { describe, expect, it } from "vitest";
import { fetchAll, fetchAllSafe, chunks } from "@/lib/fetch-all";

/** A fake query that, like the real API, returns at most 1000 rows whatever it is asked for. */
function fakeTable(n: number, failAt = -1) {
  const rows = Array.from({ length: n }, (_, i) => ({ id: i }));
  const calls: [number, number][] = [];
  const build = () => ({
    range: async (from: number, to: number) => {
      calls.push([from, to]);
      if (failAt >= 0 && from >= failAt) return { data: null, error: { message: "boom" } };
      return { data: rows.slice(from, Math.min(to + 1, from + 1000)), error: null };
    }
  });
  return { build, calls };
}

describe("reading every row past the API's 1000-row stop", () => {
  it("reads 2,500 rows in three pages", async () => {
    const t = fakeTable(2500);
    const out = await fetchAll<{ id: number }>(t.build);
    expect(out.length).toBe(2500);
    expect(out.at(-1)!.id).toBe(2499);
    expect(t.calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });
  it("stops after a short page, and copes with exactly 1000 and with none", async () => {
    expect((await fetchAll(fakeTable(1000).build)).length).toBe(1000);
    expect((await fetchAll(fakeTable(0).build)).length).toBe(0);
    expect(fakeTable(999).calls.length).toBe(0);
  });
  it("respects the most it is asked to read", async () => {
    expect((await fetchAll(fakeTable(5000).build, 2000)).length).toBe(2000);
  });
  it("a failed read throws, and the safe version gives nothing rather than half", async () => {
    await expect(fetchAll(fakeTable(3000, 1000).build)).rejects.toThrow("boom");
    expect(await fetchAllSafe(fakeTable(3000, 1000).build)).toEqual([]);
  });
});

describe("splitting long id lists", () => {
  it("makes parts of the given size", () => {
    expect(chunks([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunks([], 2)).toEqual([]);
    expect(chunks(Array.from({ length: 650 }, (_, i) => i)).map(c => c.length)).toEqual([300, 300, 50]);
  });
});
