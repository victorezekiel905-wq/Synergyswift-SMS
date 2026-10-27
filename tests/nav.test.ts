import { describe, it, expect } from "vitest";
import { NAV, visibleNav, activeHref, bottomBar } from "@/lib/nav";

const R = (...r: string[]) => new Set(r);

describe("menu", () => {
  it("has eight plain areas and no page twice", () => {
    expect(NAV.map(g => g.title)).toEqual(["Home", "Teaching", "Exams & results", "Students & welfare", "Safety & gate", "Messages & families", "Money", "School office"]);
    const hrefs = visibleNav(R("school_admin", "teacher", "bursar", "student"), {}).flatMap(g => g.links.map(l => l.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
  it("shows people only their own pages", () => {
    const parent = visibleNav(R("parent"), {}).flatMap(g => g.links.map(l => l.href));
    expect(parent).toContain("/parent");
    expect(parent).not.toContain("/school/fees");
    const cashier = visibleNav(R("cashier"), {}).flatMap(g => g.links.map(l => l.href));
    expect(cashier).toContain("/school/shop");
    expect(cashier).not.toContain("/school/results");
  });
  it("hides modules the school does not have", () => {
    const off = visibleNav(R("school_admin"), { fees: false, transport: false }).flatMap(g => g.links.map(l => l.href));
    expect(off).not.toContain("/school/fees");
    expect(off).not.toContain("/school/transport");
    expect(off).toContain("/school/students");
  });
  it("finds the page you are on", () => {
    const g = visibleNav(R("school_admin", "teacher"), {});
    expect(activeHref(g, "/exams/bank")).toBe("/exams/bank");
    expect(activeHref(g, "/exams/123")).toBe("/exams");
    expect(activeHref(g, "/school")).toBe("/school");
    expect(activeHref(g, "/school/fees/x")).toBe("/school/fees");
  });
  it("gives each person a phone bar of everyday places", () => {
    expect(bottomBar(R("parent"), {}).map(i => i.href)).toEqual(["/parent", "/calendar", "/account/security"]);
    expect(bottomBar(R("student"), { exams: false }).map(i => i.label)).toEqual(["Today", "Learn", "Messages"]);
    expect(bottomBar(R("teacher"), {})[0].href).toBe("/teacher");
    expect(bottomBar(R("bursar"), {}).length).toBeLessThanOrEqual(4);
  });
});
