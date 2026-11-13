import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

/** Every source file that can end up in the browser. */
function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== "node_modules") sources(p, out); }
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

/**
 * Older phones are common among parents, students and teachers. Two things break them outright:
 *  - a regular expression with a lookbehind: iPhones before iOS 16.4 cannot even load the file, so
 *    every page that includes it shows "Application error";
 *  - newer array helpers (.at, .toSorted, .findLast…): the page crashes when that line runs.
 */
describe("works on older phones", () => {
  const files = sources(join(__dirname, "..", "src")).map(p => ({ p, text: readFileSync(p, "utf8") }));
  it("no lookbehind in regular expressions", () => {
    const bad = files.filter(f => /\(\?<[=!]/.test(f.text)).map(f => f.p);
    expect(bad).toEqual([]);
  });
  it("no newer array helpers in pages and components", () => {
    const bad = files.filter(f => /[\\/](app|components|live)[\\/]/.test(f.p) && !/[\\/]app[\\/]api[\\/]/.test(f.p)
      && /\.at\(-?\d+\)|\.toSorted\(|\.toReversed\(|\.toSpliced\(|\.findLast(Index)?\(|Object\.groupBy\(/.test(f.text)).map(f => f.p);
    expect(bad).toEqual([]);
  });
});
