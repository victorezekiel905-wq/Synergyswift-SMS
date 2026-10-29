import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CHAPTERS, GROUPS } from "@/components/site/tour-chapters";
import { FEATURES } from "@/lib/features";

describe("Take a tour covers everything the system does", () => {
  it("has a chapter for every feature on the Features page", () => {
    const shown = new Set(CHAPTERS.flatMap(c => c.features ?? []));
    const missing = FEATURES.flatMap(g => g.items.map(i => i.title)).filter(t => !shown.has(t));
    expect(missing).toEqual([]);
  });
  it("names only real features, and each chapter once", () => {
    const real = new Set(FEATURES.flatMap(g => g.items.map(i => i.title)));
    for (const c of CHAPTERS) for (const f of c.features ?? []) expect(real.has(f), `${c.id}: ${f}`).toBe(true);
    expect(new Set(CHAPTERS.map(c => c.id)).size).toBe(CHAPTERS.length);
    expect(CHAPTERS.every(c => GROUPS.some(g => g.id === c.group))).toBe(true);
  });
  it("plays in the order of the Features page", () => {
    const order = CHAPTERS.map(c => GROUPS.findIndex(g => g.id === c.group));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
  it("only ever points the cursor at something on the screen", () => {
    for (const c of CHAPTERS) c.steps.forEach((s, n) => {
      const html = renderToStaticMarkup(createElement(c.Scene, { done: (k: number) => k < n, step: n }));
      expect(html.includes(`data-tour="${s.at}"`), `${c.id} step ${n + 1}: ${s.at}`).toBe(true);
    });
  });
  it("says what each chapter gives the school", () => {
    for (const c of CHAPTERS) { expect(c.benefit.length, c.id).toBeGreaterThan(20); expect(c.steps.length, c.id).toBeGreaterThanOrEqual(3); }
  });
});
