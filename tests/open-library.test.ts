import { describe, it, expect } from "vitest";
import { OPEN_LIBRARY } from "@/lib/open-library";

describe("the free library collection", () => {
  it("lists every title once, with safe links from the trusted sources", () => {
    const keys = OPEN_LIBRARY.map(b => b.key);
    expect(new Set(keys).size).toBe(keys.length);
    const hosts = new Set(["www.gutenberg.org", "openstax.org", "assets.openstax.org", "nigeria.learningpassport.org", "www.thenational.academy", "www.bbc.co.uk",
      "www.khanacademy.org", "www.ck12.org", "www.siyavula.com", "storyweaver.org.in"]);
    for (const b of OPEN_LIBRARY) for (const u of [b.read_url, b.download_url].filter(Boolean) as string[]) {
      expect(u.startsWith("https://"), u).toBe(true);
      expect(hosts.has(new URL(u).host), u).toBe(true);
    }
  });
  it("only has books that are free to share, and never the ones we left out", () => {
    for (const b of OPEN_LIBRARY) expect(b.licence.length, b.title).toBeGreaterThan(3);
    expect(OPEN_LIBRARY.some(b => /gutenberg:(26184|30254)$/.test(b.key))).toBe(false);
  });
  it("covers every stage, every main subject and all three curricula", () => {
    expect(OPEN_LIBRARY.some(b => b.levels.startsWith("Primary"))).toBe(true);
    expect(OPEN_LIBRARY.some(b => b.levels.startsWith("Junior"))).toBe(true);
    expect(OPEN_LIBRARY.some(b => b.levels.startsWith("Senior"))).toBe(true);
    for (const s of ["Mathematics", "Physics", "Chemistry", "Biology", "Economics", "History", "Literature", "English language", "Computer studies"])
      expect(OPEN_LIBRARY.some(b => b.subject === s), s).toBe(true);
    for (const c of ["NG", "UK", "US"] as const) expect(OPEN_LIBRARY.some(b => b.kind === "Learning site" && b.curricula.includes(c)), c).toBe(true);
    expect(OPEN_LIBRARY.filter(b => b.kind !== "Learning site").every(b => b.download_url)).toBe(true);
  });
});
