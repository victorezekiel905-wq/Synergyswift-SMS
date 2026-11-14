import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * The service worker keeps copies of the app's code files on the device. It once kept error replies
 * (a deploy in progress, the security check's page) as if they were the files, and every page then
 * failed on that device with "Reload this page", even after reloading.
 */
describe("the service worker", () => {
  const sw = readFileSync(join(__dirname, "..", "public", "sw.js"), "utf8");
  const assets = sw.slice(sw.indexOf("Immutable build assets"), sw.indexOf("Offline-capable pages"));
  it("keeps a code file only when it really loaded (200, not an HTML page)", () => {
    expect(assets).toMatch(/res\.ok && res\.status === 200 && !\/text\\\/html\/i\.test\(type\)/);
    expect(assets.indexOf("c.put(req, copy)")).toBeGreaterThan(assets.indexOf("res.ok && res.status === 200"));
  });
  it("uses a cache name newer than the one that could hold broken copies (v4)", () => {
    const v = Number(/educlass-static-v(\d+)/.exec(sw)?.[1]);
    expect(v).toBeGreaterThanOrEqual(5);
  });
  it("never keeps school data", () => {
    expect(sw).toMatch(/pathname\.startsWith\("\/api\/"\)\) return;/);
  });
});
