import { describe, expect, it } from "vitest";
import { isSecurityCheck } from "@/lib/client-errors";

const res = (status: number, headers: Record<string, string>) => ({ status, headers: { get: (n: string) => headers[n.toLowerCase()] ?? null } });

/** A request stopped by the website's security check is told apart from the app's own errors. */
describe("the security service's check", () => {
  it("is recognised by Cloudflare's own marker", () => {
    expect(isSecurityCheck(res(403, { "cf-mitigated": "challenge", "content-type": "text/html" }))).toBe(true);
  });
  it("is recognised as a Cloudflare page instead of data", () => {
    expect(isSecurityCheck(res(403, { "content-type": "text/html; charset=UTF-8", "cf-ray": "abc-LOS" }))).toBe(true);
  });
  it("is not the app's own refusals or errors", () => {
    expect(isSecurityCheck(res(403, { "content-type": "application/json", "cf-ray": "abc-LOS" }))).toBe(false);
    expect(isSecurityCheck(res(401, { "content-type": "application/json" }))).toBe(false);
    expect(isSecurityCheck(res(200, { "content-type": "application/json", "cf-ray": "abc-LOS" }))).toBe(false);
  });
});
