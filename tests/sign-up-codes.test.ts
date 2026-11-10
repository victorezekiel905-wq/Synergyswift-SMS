import { describe, expect, it } from "vitest";
import { cleanCode, isCodeShape, formatCode, homeFor, passwordsMatch } from "@/lib/sign-up-codes";
import { NAV } from "@/lib/nav";

describe("sign-up codes", () => {
  it("reads codes however they are typed", () => {
    expect(cleanCode("abcd-efgh")).toBe("ABCDEFGH");
    expect(cleanCode(" AB CD EF GH ")).toBe("ABCDEFGH");
    expect(formatCode("abcdefgh")).toBe("ABCD-EFGH");
    expect(formatCode("ab")).toBe("AB");
  });
  it("accepts only the 32 characters without look-alikes", () => {
    expect(isCodeShape("HJKM-2345")).toBe(true);
    expect(isCodeShape("ABCD-EFG0")).toBe(false);   // zero
    expect(isCodeShape("ABCD-EFGO")).toBe(false);   // letter O
    expect(isCodeShape("ABCD-EFG1")).toBe(false);
    expect(isCodeShape("ABCD-EFGI")).toBe(false);
    expect(isCodeShape("ABCDEFG")).toBe(false);
  });
  it("sends each account to its own dashboard", () => {
    expect(homeFor("parent")).toBe("/parent");
    expect(homeFor("student")).toBe("/student");
    expect(homeFor("teacher")).toBe("/dashboard");
    expect(homeFor("bursar")).toBe("/dashboard");
  });
  it("needs the new password typed twice, the same both times", () => {
    expect(passwordsMatch("Secret-123", "Secret-123")).toBeNull();
    expect(passwordsMatch("Secret-123", "secret-123")).toMatch(/not the same/);
    expect(passwordsMatch("Secret-123", "")).toMatch(/again/);
    expect(passwordsMatch("", "")).toMatch(/Enter/);
  });
  it("is in the menu for school admins", () => {
    const link = NAV.flatMap(g => g.links).find(l => l.href === "/school/account-codes");
    expect(link?.roles).toEqual(expect.arrayContaining(["school_admin", "principal"]));
    expect(link?.roles).not.toContain("teacher");
  });
});
