import { describe, expect, it } from "vitest";
import { bestMatch, keywords, matchScore, pictureNeed } from "@/live/slides/photo-match";
import { buildDeck, designSlide, THEMES, DECK_LAYOUTS, type OutlineSlide, type Photo } from "@/live/slides/ai-deck";

describe("slide pictures must show what the slide is about", () => {
  const need = pictureNeed({ subject: "plant leaf", queries: ["green leaf sunlight", "leaf close up"], heading: "How plants make food" });
  it("knows the words the picture must show", () => {
    expect(need.must).toEqual(["plant", "leaf"]);
    // "Leaves" is the same word as "leaf"; "close" and "photo" say nothing about the subject.
    expect(keywords("Leaves of the Mango Trees, close-up photo")).toEqual(["leaf", "mango", "tree"]);
    expect(matchScore(need, "autumn leaves, branch")).toBeGreaterThan(0);
  });
  it("turns down a photo that shows none of them, however popular", () => {
    expect(matchScore(need, "business, office, laptop, success")).toBe(0);
    expect(matchScore(need, "smiling students, classroom")).toBe(0);
  });
  it("prefers the photo whose tags name the subject most fully", () => {
    const hits = [
      { id: 1, tags: "sunset, sky, clouds" },
      { id: 2, tags: "green, plant, garden" },
      { id: 3, tags: "leaf, plant, green, sunlight" }
    ];
    expect(bestMatch(need, hits, h => h.tags)?.id).toBe(3);
    expect(bestMatch(need, [hits[0]], h => h.tags)).toBeUndefined();
  });
});

describe("designed slides", () => {
  const ai: Photo = { url: "", media_path: "t/u/ai-1.png", alt: "volcano eruption", credit: "AI", credit_url: "", download_location: "", source: "ai" };
  const slide = (layout: OutlineSlide["layout"]): OutlineSlide => ({
    layout, heading: "Volcanoes and how they erupt", subheading: "Why the ground melts", points: ["Magma rises through cracks", "Pressure builds up", "Lava, ash and gas escape"],
    left_heading: "Active", left_points: ["Erupted recently"], right_heading: "Dormant", right_points: ["Sleeping for now"]
  });
  it("credits a picture made with AI as such", () => {
    const c = designSlide(slide("picture"), THEMES.forest, ai);
    expect(JSON.stringify(c.elements)).toContain("Image: AI-generated");
  });
  it("keeps every element on the slide, in every layout and theme", () => {
    for (const theme of Object.values(THEMES)) for (const layout of DECK_LAYOUTS) {
      for (const e of designSlide(slide(layout), theme, ai, { title: "Volcanoes", n: 3, total: 8 }).elements ?? []) {
        // Decorative shapes may run off an edge on purpose; text and pictures never do.
        if (e.type === "shape") continue;
        expect(e.x, `${layout} ${e.type}`).toBeGreaterThanOrEqual(0);
        expect(e.y, `${layout} ${e.type}`).toBeGreaterThanOrEqual(0);
        expect(e.x + e.w, `${layout} ${e.type}`).toBeLessThanOrEqual(1600);
        expect(e.y + e.h, `${layout} ${e.type}`).toBeLessThanOrEqual(900);
      }
    }
  });
  it("numbers the slides and says in the notes when a picture was made with AI", () => {
    const deck = buildDeck({ title: "Volcanoes", slides: [slide("title"), slide("points"), slide("picture")] }, [undefined, undefined, ai], "royal");
    expect(JSON.stringify(deck[1].content.elements)).toContain("2 / 3");
    expect(deck[2].notes).toContain("Picture made with AI");
  });
});
