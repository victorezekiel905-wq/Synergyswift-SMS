import { describe, it, expect } from "vitest";
import { daysLate, latePenalty, penalisedScore, canSubmit, words, overlap, styleProfile, styleShift, streak, earns, statsFrom, objectiveCoverage, languageProblem, STARTER_BADGES, POINTS } from "@/lib/lms";
import { renderRichText, escapeHtml } from "@/lib/richtext";
import { sniff } from "@/lib/files";

describe("late penalties", () => {
  const due = "2026-03-10T16:00:00Z";
  it("counts part days as whole days", () => {
    expect(daysLate(due, "2026-03-10T15:59:00Z")).toBe(0);
    expect(daysLate(due, "2026-03-10T16:00:00Z")).toBe(0);
    expect(daysLate(due, "2026-03-10T16:01:00Z")).toBe(1);
    expect(daysLate(due, "2026-03-12T17:00:00Z")).toBe(3);
  });
  it("applies a per-day rate up to the cap", () => {
    expect(latePenalty({ dueAt: due, submittedAt: "2026-03-11T10:00:00Z", pctPerDay: 10, maxPct: 50 })).toEqual({ days: 1, pct: 10 });
    expect(latePenalty({ dueAt: due, submittedAt: "2026-03-20T10:00:00Z", pctPerDay: 10, maxPct: 50 })).toEqual({ days: 10, pct: 50 });
    expect(latePenalty({ dueAt: due, submittedAt: "2026-03-09T10:00:00Z", pctPerDay: 10, maxPct: 50 }).pct).toBe(0);
    expect(latePenalty({ dueAt: due, submittedAt: "2026-03-20T10:00:00Z", pctPerDay: 0, maxPct: 100 }).pct).toBe(0);
  });
  it("reduces the mark", () => {
    expect(penalisedScore(18, 0)).toBe(18);
    expect(penalisedScore(18, 20)).toBe(14.4);
    expect(penalisedScore(7, 33)).toBe(4.7);
    expect(penalisedScore(null, 20)).toBeNull();
  });
});

describe("who may submit", () => {
  const now = new Date("2026-03-10T12:00:00Z");
  const open = { due_at: "2026-03-11T12:00:00Z", allow_late: false, allow_resubmit: false, max_attempts: 1 };
  const past = { ...open, due_at: "2026-03-09T12:00:00Z" };
  it("first attempt before the deadline, or late if allowed", () => {
    expect(canSubmit(open, null, now)).toEqual({ ok: true, attempt: 1 });
    expect(canSubmit(past, null, now).ok).toBe(false);
    expect(canSubmit({ ...past, allow_late: true }, null, now)).toEqual({ ok: true, attempt: 1 });
  });
  it("resubmission only when allowed and within attempts", () => {
    expect(canSubmit(open, { attempt: 1, status: "submitted" }, now).ok).toBe(false);
    expect(canSubmit({ ...open, allow_resubmit: true, max_attempts: 3 }, { attempt: 1, status: "submitted" }, now)).toEqual({ ok: true, attempt: 2 });
    expect(canSubmit({ ...open, allow_resubmit: true, max_attempts: 3 }, { attempt: 3, status: "submitted" }, now).ok).toBe(false);
    expect(canSubmit({ ...past, allow_resubmit: true, max_attempts: 3 }, { attempt: 1, status: "submitted" }, now).ok).toBe(false);
  });
  it("work sent back can be redone even after the deadline; marked work is closed", () => {
    expect(canSubmit({ ...past, max_attempts: 2 }, { attempt: 1, status: "returned" }, now)).toEqual({ ok: true, attempt: 2 });
    expect(canSubmit({ ...past, max_attempts: 2 }, { attempt: 2, status: "returned" }, now).ok).toBe(false);
    expect(canSubmit({ ...open, allow_resubmit: true, max_attempts: 5 }, { attempt: 1, status: "marked" }, now).ok).toBe(false);
  });
});

describe("originality", () => {
  const essay = "Photosynthesis is the process by which green plants use sunlight, water and carbon dioxide to make glucose and release oxygen into the air. It takes place mainly in the leaves, inside the chloroplasts, which contain the green pigment chlorophyll.";
  it("normalises words", () => {
    expect(words("Café, don't STOP!")).toEqual(["cafe", "don't", "stop"]);
  });
  it("finds copied passages and ignores short answers", () => {
    const copy = overlap(essay, `My notes. ${essay} The end.`);
    expect(copy.share).toBe(1);
    expect(copy.passages[0]).toContain("photosynthesis is the process");
    const own = overlap(essay, "Plants make food using light energy. Animals eat plants or other animals to get their energy, and they breathe out carbon dioxide all day.");
    expect(own.share).toBeLessThan(0.1);
    expect(overlap("Too short to compare at all.", "Too short to compare at all.")).toEqual({ share: 0, passages: [] });
  });
  it("partial copying gives a partial share", () => {
    const half = essay + " " + "In my own words I think plants are like little kitchens that cook food for the whole world every single day without stopping even once.";
    const r = overlap(half, essay);
    expect(r.share).toBeGreaterThan(0.3);
    expect(r.share).toBeLessThan(0.8);
  });
  it("measures writing style and flags a sudden change", () => {
    const simple = (n: number) => Array.from({ length: 30 }, (_, i) => `I like my dog ${n + i}. He is big.`).join(" ");
    const fancy = Array.from({ length: 12 }, () => "Notwithstanding considerable methodological disagreements, contemporary photosynthetic investigations demonstrate extraordinarily sophisticated biochemical mechanisms.").join(" ");
    const p = styleProfile(simple(0));
    expect(p.words).toBeGreaterThan(150);
    expect(p.sentence_len).toBeLessThan(6);
    expect(styleShift(fancy, [simple(0)])).toBeNull(); // needs two earlier pieces
    const same = styleShift(simple(100), [simple(0), simple(50)])!;
    const shift = styleShift(fancy, [simple(0), simple(50)])!;
    expect(same.score).toBeLessThan(0.2);
    expect(shift.score).toBeGreaterThan(0.7);
    expect(shift.notes.join(" ")).toMatch(/Sentence length much higher/);
  });
});

describe("streaks, points and badges", () => {
  // 2026-03-16 is a Monday.
  it("counts school days and skips weekends", () => {
    expect(streak(["2026-03-16", "2026-03-13", "2026-03-12"], "2026-03-16")).toBe(3);
    expect(streak(["2026-03-13", "2026-03-12"], "2026-03-16")).toBe(2); // nothing yet today: streak still alive
    expect(streak(["2026-03-12"], "2026-03-16")).toBe(0); // Friday missed
    expect(streak([], "2026-03-16")).toBe(0);
    expect(streak(["2026-03-14", "2026-03-13"], "2026-03-15")).toBe(1); // weekend work does not break or add
  });
  it("adds up activity and checks badge rules", () => {
    const act = [
      { kind: "homework", points: POINTS.homework, on_date: "2026-03-16" },
      { kind: "practice", points: POINTS.practice, on_date: "2026-03-13" },
      { kind: "forum", points: POINTS.forum, on_date: "2026-03-13" },
      { kind: "homework", points: POINTS.homework, on_date: "2026-03-12" }
    ];
    const s = statsFrom(act, "2026-03-16");
    expect(s).toEqual({ streak: 3, points: 27, homework: 2, practice: 1, forum: 1 });
    expect(earns({ type: "homework", threshold: 2 }, s)).toBe(true);
    expect(earns({ type: "streak", threshold: 5 }, s)).toBe(false);
    expect(earns(null, s)).toBe(false);
    expect(earns({ type: "points", threshold: 0 }, s)).toBe(false);
  });
  it("starter badges include one given by staff", () => {
    expect(STARTER_BADGES.filter(b => !b.rule)).toHaveLength(1);
    expect(new Set(STARTER_BADGES.map(b => b.name)).size).toBe(STARTER_BADGES.length);
  });
});

describe("schemes of work", () => {
  it("shows which objectives are planned and taught", () => {
    const c = objectiveCoverage(["a", "b", "c", "d"], [
      { objective_ids: ["a", "b"], status: "taught" },
      { objective_ids: ["b", "c"], status: "planned" },
      { objective_ids: [], status: "skipped" }
    ]);
    expect(c.total).toBe(4);
    expect(c.planned).toBe(3);
    expect(c.taught).toBe(2);
    expect(c.items.find(i => i.id === "b")).toEqual({ id: "b", planned: 2, taught: true });
    expect(c.items.find(i => i.id === "d")).toEqual({ id: "d", planned: 0, taught: false });
  });
});

describe("forum language", () => {
  it("blocks obvious abuse without catching ordinary words", () => {
    expect(languageProblem("You are a mumu")).toBeTruthy();
    expect(languageProblem("What the FUCK")).toBeTruthy();
    expect(languageProblem("Scunthorpe is a town; I passed my class assessment")).toBeNull();
    expect(languageProblem("Can someone explain question 3?")).toBeNull();
  });
});

describe("rich text", () => {
  it("escapes everything that is not formatting", () => {
    const h = renderRichText(`<script>alert(1)</script> <img src=x onerror=alert(1)> **bold** "q"`);
    expect(h).not.toMatch(/<script|<img/);
    expect(h).toContain("&lt;script&gt;");
    expect(h).toContain("<strong>bold</strong>");
    expect(escapeHtml(`<a href="x">'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&lt;/a&gt;");
  });
  it("only links https and cannot break out of the attribute", () => {
    expect(renderRichText("[go](javascript:alert(1))")).not.toContain("<a ");
    const h = renderRichText(`[go](https://example.com/"onmouseover="alert(1))`);
    expect(h).not.toMatch(/"onmouseover=/);
    expect(renderRichText("[BBC](https://www.bbc.co.uk)")).toContain(`<a href="https://www.bbc.co.uk" target="_blank" rel="noopener noreferrer nofollow">BBC</a>`);
  });
  it("renders headings and lists", () => {
    expect(renderRichText("# Title")).toBe("<h3>Title</h3>");
    expect(renderRichText("- a\n- b")).toBe("<ul><li>a</li><li>b</li></ul>");
    expect(renderRichText("1. a\n2. b")).toBe("<ol><li>a</li><li>b</li></ol>");
    expect(renderRichText("one\ntwo\n\nthree")).toBe("<p>one<br>two</p><p>three</p>");
  });
  it("renders maths but leaves money alone", () => {
    const m = renderRichText(String.raw`Solve $x^2 = 4$ and \(a < b\) for $5 and $10.`);
    expect(m).toContain("katex");
    expect(m).toContain("for $5 and $10.");
    const d = renderRichText(String.raw`$$\frac{a}{b}$$`);
    expect(d).toContain("katex-display");
    expect(renderRichText(String.raw`$\href{javascript:alert(1)}{x}$`)).not.toContain("javascript:");
  });
  it("highlights code and keeps it escaped", () => {
    const h = renderRichText("```python\nprint('<b>')\n```");
    expect(h).toContain(`class="hljs language-python"`);
    expect(h).toContain("&lt;b&gt;");
    expect(h).not.toContain("<b>");
    expect(renderRichText("use `a<b` here")).toContain(`<code class="rt-inline">a&lt;b</code>`);
  });
  it("ignores placeholder characters typed by a user", () => {
    expect(renderRichText("x\u00000\u0000y $a$")).not.toMatch(/\u0000/);
    expect(renderRichText("\u00000\u0000 $a$").startsWith("<p><span class=\"katex")).toBe(false);
  });
});

describe("recordings", () => {
  it("recognises WebM and Ogg recordings", () => {
    const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0]), ogg = Buffer.from("OggS\0\0\0\0\0\0\0\0");
    expect(sniff(webm, "webm")).toBe(true);
    expect(sniff(webm, "weba")).toBe(true);
    expect(sniff(ogg, "ogg")).toBe(true);
    expect(sniff(ogg, "webm")).toBe(false);
  });
});
