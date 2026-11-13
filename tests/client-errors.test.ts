import { describe, expect, it } from "vitest";
import { isStaleBuildError } from "@/lib/client-errors";

describe("errors after a new version is deployed", () => {
  it("knows a missing file from the old version", () => {
    expect(isStaleBuildError({ name: "ChunkLoadError", message: "Loading chunk 4512 failed." })).toBe(true);
    expect(isStaleBuildError({ message: "Loading CSS chunk app-layout failed" })).toBe(true);
    expect(isStaleBuildError({ message: "Failed to fetch dynamically imported module: https://x/_next/static/chunks/a.js" })).toBe(true);
    expect(isStaleBuildError({ message: "Failed to load chunk /_next/static/chunks/abc.js" })).toBe(true);
  });
  it("leaves real errors alone", () => {
    expect(isStaleBuildError({ message: "Cannot read properties of undefined (reading 'map')" })).toBe(false);
    expect(isStaleBuildError(null)).toBe(false);
  });
});
