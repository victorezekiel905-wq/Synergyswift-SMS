import { describe, expect, it } from "vitest";
import { brandPalette, brandVars, chosenBrand, contrast, parseHex, toHex, BRAND_BOOT_SCRIPT, PUBLIC_PAGES, DB_DEFAULT_BRAND, SHADES } from "@/lib/theme";

const WHITE: [number, number, number] = [255, 255, 255];

describe("a school's colour across the system", () => {
  it("reads colours the colour picker and people type", () => {
    expect(parseHex("#1D5DDB")).toEqual([29, 93, 219]);
    expect(parseHex("15d")).toEqual([17, 85, 221]);
    expect(parseHex("blue")).toBeNull();
    expect(parseHex(null)).toBeNull();
  });

  it("makes eleven shades, light to dark", () => {
    const p = brandPalette("#0f766e");
    const lum = SHADES.map(s => p[s].reduce((a, b) => a + b, 0));
    for (let i = 1; i < lum.length; i++) expect(lum[i]!).toBeLessThan(lum[i - 1]!);
    expect(toHex(p[600])).toBe("#0f766e");   // already readable: kept exactly
  });

  it("keeps white text readable on buttons, even for a light colour", () => {
    for (const hex of ["#ffd400", "#a3e635", "#f0f0f0", "#38bdf8"]) {
      expect(contrast(brandPalette(hex)[600], WHITE), hex).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("the starting colour in the database means 'not chosen'", () => {
    expect(chosenBrand(DB_DEFAULT_BRAND)).toBeNull();
    expect(chosenBrand("#0F766E")).toBe("#0f766e");
    expect(chosenBrand("nonsense")).toBeNull();
  });

  it("writes the variables Tailwind reads", () => {
    const v = brandVars("#9f1239");
    expect(Object.keys(v)).toHaveLength(11);
    expect(v["--brand-600"]).toMatch(/^\d{1,3} \d{1,3} \d{1,3}$/);
  });

  it("Synergy Swift's public pages keep its own colours; school pages don't", () => {
    for (const p of ["/", "/company", "/login", "/features/"]) expect(PUBLIC_PAGES.test(p), p).toBe(true);
    for (const p of ["/school", "/school/analysis", "/student", "/companyx"]) expect(PUBLIC_PAGES.test(p), p).toBe(false);
  });

  it("the start-up script is valid JavaScript", () => {
    expect(() => new Function(BRAND_BOOT_SCRIPT)).not.toThrow();
  });
});
