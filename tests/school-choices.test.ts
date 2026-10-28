import { describe, it, expect } from "vitest";
import { GRADING_PRESETS, checkPreset } from "@/lib/grading-presets";
import { traitScale, ratingShort, scaleKey, areaTitle, DEFAULT_SCALE, SCALE_PRESETS } from "@/lib/traits";
import { normalizeLayout, move, DEFAULT_LAYOUT } from "@/lib/dashboard-layout";
import { gradeFor } from "@/lib/grading";

describe("ready-made assessment patterns", () => {
  it("each adds up to 100 and grades every score from 0 to 100 exactly once", () => {
    for (const p of GRADING_PRESETS) expect(checkPreset(p), p.id).toEqual([]);
  });
  it("grade a score the way that system does", () => {
    const band = (id: string, score: number) => gradeFor(score, GRADING_PRESETS.find(p => p.id === id)!.bands as any)?.grade;
    expect(band("ng-secondary", 76)).toBe("A1");
    expect(band("ng-secondary", 39.5)).toBe("F9");
    expect(band("uk-gcse", 41)).toBe("4");
    expect(band("us-gpa", 91)).toBe("A-");
  });
});

describe("the school's own rating scale", () => {
  it("falls back to 1 to 5 in words, and reads the school's scale best first", () => {
    expect(traitScale(null)).toEqual(DEFAULT_SCALE);
    expect(traitScale({ trait_scale: [{ value: 1, short: "WT", label: "Working towards" }, { value: 3, short: "EX", label: "Exceeds" }, { value: 2, short: "ME", label: "Meets" }] }).map(s => s.short)).toEqual(["EX", "ME", "WT"]);
    expect(traitScale({ trait_scale: [{ value: 42, label: "x" }] })).toEqual(DEFAULT_SCALE);
  });
  it("prints the school's marks and a key", () => {
    const ae = SCALE_PRESETS.find(p => p.name === "A to E")!.scale;
    expect(ratingShort(ae, 5)).toBe("A");
    expect(ratingShort(ae, null)).toBe("—");
    expect(scaleKey(ae)).toBe("A Excellent · B Very good · C Good · D Fair · E Poor");
    expect(areaTitle("affective")).toBe("Character");
    expect(areaTitle("Clubs")).toBe("Clubs");
  });
});

describe("the school's dashboard layout", () => {
  it("keeps only known panels and tiles, once each", () => {
    expect(normalizeLayout(null)).toEqual(DEFAULT_LAYOUT);
    expect(normalizeLayout({ sections: ["now", "now", "evil", "kpis"], hidden_stats: ["late_today", "nope"], hidden_links: ["/school/fees"] }))
      .toEqual({ sections: ["now", "kpis"], hidden_stats: ["late_today"], hidden_links: ["/school/fees"] });
  });
  it("moves panels up and down", () => {
    expect(move(["kpis", "summary", "now"], "now", -1)).toEqual(["kpis", "now", "summary"]);
    expect(move(["kpis", "summary"], "kpis", -1)).toEqual(["kpis", "summary"]);
  });
});
