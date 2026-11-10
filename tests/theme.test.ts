import { describe, expect, it } from "vitest";
import { brandPalette, brandVars, chosenBrand, contrast, parseHex, toHex, BRAND_BOOT_SCRIPT, PUBLIC_PAGES, DB_DEFAULT_BRAND, SHADES, tintPalette, tintVars, chosenTint, logoColours, DEFAULT_TINT } from "@/lib/theme";

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

describe("a school's second colour and its logo's colours", () => {
  it("the second colour keeps small text readable, even when it is light", () => {
    for (const hex of ["#ffd400", "#a3e635", "#b08d4f", "#e0f2fe"]) expect(contrast(tintPalette(hex)[700], WHITE), hex).toBeGreaterThanOrEqual(4.5);
    expect(toHex(tintPalette("#9a5b2e")[500])).toBe("#9a5b2e");      // the colour itself, for lines and dots
    expect(Object.keys(tintVars("#0284c7"))).toEqual(["--tint-100", "--tint-300", "--tint-500", "--tint-700"]);
  });
  it("brass means 'not chosen'", () => {
    expect(chosenTint(DEFAULT_TINT)).toBeNull();
    expect(chosenTint("")).toBeNull();
    expect(chosenTint("#0284C7")).toBe("#0284c7");
  });
  it("finds a logo's main colours, leaving out white, black, grey and see-through", () => {
    const px: number[] = [];
    const put = (n: number, c: [number, number, number, number]) => { for (let i = 0; i < n; i++) px.push(...c); };
    put(500, [255, 255, 255, 255]);      // white background
    put(300, [128, 0, 32, 255]);         // maroon, most used
    put(120, [212, 175, 55, 255]);       // gold
    put(100, [20, 20, 20, 255]);         // black text
    put(80, [130, 130, 130, 255]);       // grey
    put(200, [0, 90, 200, 0]);           // see-through
    put(40, [132, 4, 36, 255]);          // nearly the same maroon: not a second pick
    const found = logoColours(px);
    expect(found).toHaveLength(2);
    expect(parseHex(found[0])![0]).toBeGreaterThan(120);   // the maroon first
    expect(found[1]).toBe("#d4af37");                        // then the gold
  });
  it("the start-up script also brings back the second colour", () => {
    expect(BRAND_BOOT_SCRIPT).toContain("(brand|tint)");
  });
});
