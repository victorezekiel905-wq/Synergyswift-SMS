/**
 * "Create slides with AI": turns the outline the AI writes (layout, heading, points,
 * a picture idea, teacher notes) into designed slides on the 1600 x 900 grid, in one
 * of the lesson themes. All the design decisions live here, not in the AI:
 *  - the deck always opens with a title slide and (if long enough) ends with a recap;
 *  - text is trimmed and sized to fit its box, so nothing spills off a slide;
 *  - a slide that wanted a picture but got none falls back to a text layout;
 *  - every photo carries its photographer's credit (Unsplash's rule); AI pictures say so;
 *  - soft shapes, numbered cards, an underline under each heading and a footer (lesson title,
 *    slide number) make every slide look finished.
 * Relative imports only: the unit tests load this file directly.
 */
import type { CanvasContent, CanvasElement, ImageElement, ShapeElement, TextElement } from "./canvas";

export const DECK_LAYOUTS = ["title", "objectives", "points", "picture", "big_picture", "compare", "key_fact", "question", "summary"] as const;
export type DeckLayout = (typeof DECK_LAYOUTS)[number];

export type OutlineSlide = {
  layout: DeckLayout; heading: string; subheading?: string; points?: string[];
  left_heading?: string; left_points?: string[]; right_heading?: string; right_points?: string[];
  image_query?: string; notes?: string;
  /** What the picture must show ("plant leaf"), and more searches for it, broader each time. */
  image_subject?: string; image_queries?: string[];
};
export type Outline = { title: string; slides: OutlineSlide[] };
/** source: where it came from (credited on the slide). Pixabay photos and AI pictures are copied to the school's storage (media_path); Unsplash ones are linked (url). */
export type Photo = { url: string; media_path?: string; alt: string; credit: string; credit_url: string; download_location: string; source?: "pixabay" | "unsplash" | "ai" };
const sourceName = (p: Photo) => (p.source === "pixabay" ? "Pixabay" : p.source === "ai" ? "AI-generated" : "Unsplash");
export type DeckSlide = { content: CanvasContent; notes: string; heading: string; photo?: Photo };

export type ThemeKey = "swift" | "ocean" | "sunrise" | "forest" | "royal" | "coral" | "midnight";
type Theme = { label: string; dark: string; light: string; soft: string; accent: string; primary: string; text: string; muted: string; onDark: string; onDarkMuted: string };
export const THEMES: Record<ThemeKey, Theme> = {
  swift: { label: "Synergy Swift", dark: "#111827", light: "#ffffff", soft: "#f5f3ef", accent: "#c6f432", primary: "#2547d0", text: "#111827", muted: "#475569", onDark: "#ffffff", onDarkMuted: "#cbd5e1" },
  ocean: { label: "Ocean", dark: "#0c4a6e", light: "#f8fafc", soft: "#e0f2fe", accent: "#7dd3fc", primary: "#0e7490", text: "#0f172a", muted: "#475569", onDark: "#ffffff", onDarkMuted: "#bae6fd" },
  sunrise: { label: "Sunrise", dark: "#7c2d12", light: "#fffbeb", soft: "#ffedd5", accent: "#fbbf24", primary: "#c2410c", text: "#1c1917", muted: "#57534e", onDark: "#ffffff", onDarkMuted: "#fed7aa" },
  forest: { label: "Forest", dark: "#14532d", light: "#f7fdf9", soft: "#dcfce7", accent: "#a3e635", primary: "#15803d", text: "#052e16", muted: "#3f6212", onDark: "#ffffff", onDarkMuted: "#bbf7d0" },
  royal: { label: "Royal", dark: "#3b0764", light: "#faf5ff", soft: "#f3e8ff", accent: "#f0abfc", primary: "#7e22ce", text: "#1e1b4b", muted: "#5b5675", onDark: "#ffffff", onDarkMuted: "#e9d5ff" },
  coral: { label: "Coral", dark: "#881337", light: "#fff7f7", soft: "#ffe4e6", accent: "#fda4af", primary: "#e11d48", text: "#1f1720", muted: "#64505a", onDark: "#ffffff", onDarkMuted: "#fecdd3" },
  midnight: { label: "Midnight", dark: "#020617", light: "#f8fafc", soft: "#e2e8f0", accent: "#38bdf8", primary: "#1d4ed8", text: "#0f172a", muted: "#475569", onDark: "#ffffff", onDarkMuted: "#94a3b8" }
};

let n = 0;
const id = () => `ai${Date.now().toString(36)}${(n++).toString(36)}`;
const clip = (s: string | undefined, max: number) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).replace(/\s+\S*$/, "")}…`;
};
const list = (xs: string[] | undefined, count: number, each: number) =>
  (xs ?? []).map((x) => clip(x.replace(/^\s*[-*•\d.)]+\s*/, ""), each)).filter(Boolean).slice(0, count);

/**
 * The largest font size (from `max` down to `min`) at which `text` fits a w x h box,
 * estimating an average character at 0.52 of the size and lines at 1.3.
 */
export function fitSize(text: string, w: number, h: number, max: number, min: number): number {
  const paras = text.split("\n");
  for (let size = max; size > min; size -= 2) {
    const perLine = Math.max(1, Math.floor(w / (size * 0.52)));
    const lines = paras.reduce((sum, p) => sum + Math.max(1, Math.ceil(p.length / perLine)), 0);
    if (lines * size * 1.3 <= h) return size;
  }
  return min;
}

const text = (over: Partial<TextElement> & Pick<TextElement, "x" | "y" | "w" | "h" | "text">): TextElement => ({
  id: id(), type: "text", size: 40, color: "#111827", font: "sans", align: "left", valign: "top", ...over
});
const shape = (over: Partial<ShapeElement> & Pick<ShapeElement, "x" | "y" | "w" | "h">): ShapeElement => ({
  id: id(), type: "shape", shape: "rect", fill: "#2547d0", stroke: "transparent", strokeWidth: 0, ...over
});
const image = (p: Photo, over: Pick<ImageElement, "x" | "y" | "w" | "h"> & Partial<ImageElement>): ImageElement => ({
  id: id(), type: "image", ...(p.media_path ? { media_path: p.media_path } : { url: p.url }), alt: p.alt, fit: "cover", ...over
});
/** "Photo: Name / Pixabay" (or Unsplash), or "Image: AI-generated", small, in a corner of the slide. */
const credit = (p: Photo, onDark: boolean): TextElement => text({
  x: 1040, y: 852, w: 540, h: 36, text: p.source === "ai" ? "Image: AI-generated" : `Photo: ${clip(p.credit, 40)} / ${sourceName(p)}`, size: 18, align: "right", valign: "middle",
  color: onDark ? "#e2e8f0" : "#64748b"
});
const heading = (t: Theme, s: string, over: Partial<TextElement> = {}) => {
  const h = clip(s, 90);
  return text({ x: 100, y: 56, w: 1400, h: 130, text: h, size: fitSize(h, 1400, 130, 64, 40), bold: true, font: "display", color: t.text, valign: "middle", ...over });
};
/** The short coloured bar under a heading. */
const underline = (t: Theme, x = 100, y = 192) => shape({ x, y, w: 110, h: 10, shape: "round", fill: t.primary });
const bullets = (t: Theme, points: string[], box: { x: number; y: number; w: number; h: number }, max = 52, color = t.muted) => {
  const body = points.join("\n");
  return text({ ...box, text: body || " ", size: fitSize(body, box.w - 40, box.h, max, 22), color, list: true });
};
/** Soft shapes in two corners, so a slide never looks bare. */
const decor = (t: Theme, dark: boolean, where: "corners" | "right" = "corners"): ShapeElement[] => {
  const c = dark ? t.accent : t.primary;
  return where === "right"
    ? [shape({ x: 1340, y: -160, w: 420, h: 420, shape: "ellipse", fill: c, opacity: dark ? 0.16 : 0.07 }),
       shape({ x: 1460, y: 700, w: 260, h: 260, shape: "ellipse", fill: t.accent, opacity: dark ? 0.2 : 0.18 })]
    : [shape({ x: -140, y: 640, w: 380, h: 380, shape: "ellipse", fill: c, opacity: dark ? 0.14 : 0.06 }),
       shape({ x: 1380, y: -120, w: 360, h: 360, shape: "ellipse", fill: t.accent, opacity: dark ? 0.18 : 0.22 })];
};
/** Points as cards, each with a numbered (or ticked) circle: easier to read from the back of a class. */
const cards = (t: Theme, points: string[], box: { x: number; y: number; w: number; h: number }, mark: "number" | "tick" = "number", card = t.soft): CanvasElement[] => {
  const count = Math.max(1, points.length), gap = 18;
  const h = Math.min(150, Math.floor((box.h - gap * (count - 1)) / count));
  const longest = points.reduce((a, p) => (p.length > a.length ? p : a), "");
  const d = Math.min(64, h - 24);
  const size = fitSize(longest, box.w - d - 110, h - 20, 40, 22);
  return points.flatMap((p, i) => {
    const y = box.y + i * (h + gap);
    return [
      shape({ x: box.x, y, w: box.w, h, shape: "round", fill: card }),
      shape({ x: box.x, y: y + 14, w: 8, h: h - 28, shape: "round", fill: t.primary }),
      shape({ x: box.x + 30, y: y + (h - d) / 2, w: d, h: d, shape: "ellipse", fill: t.primary }),
      text({ x: box.x + 30, y: y + (h - d) / 2, w: d, h: d, text: mark === "tick" ? "✓" : String(i + 1), size: Math.round(d * 0.5), bold: true, color: "#ffffff", align: "center", valign: "middle", font: "display" }),
      text({ x: box.x + 30 + d + 26, y, w: box.w - d - 86, h, text: p, size, color: t.text, valign: "middle" })
    ];
  });
};
/** The lesson title and the slide number, small, along the bottom of a slide. */
const footer = (t: Theme, deck: { title?: string; n?: number; total?: number }, dark: boolean): CanvasElement[] => {
  if (!deck.n) return [];
  const c = dark ? t.onDarkMuted : "#94a3b8";
  return [
    text({ x: 100, y: 846, w: 900, h: 34, text: clip(deck.title, 70) || " ", size: 18, color: c, valign: "middle" }),
    text({ x: 1300, y: 846, w: 200, h: 34, text: deck.total ? `${deck.n} / ${deck.total}` : String(deck.n), size: 18, bold: true, color: c, align: "right", valign: "middle" })
  ];
};

/**
 * One outline slide in a theme. A slide that wanted a picture but has none gets a text layout.
 * `deck` (optional) adds the lesson title and slide number along the bottom.
 */
export function designSlide(s: OutlineSlide, t: Theme, photo?: Photo, deck: { title?: string; n?: number; total?: number } = {}): CanvasContent {
  const layout: DeckLayout = (s.layout === "picture" || s.layout === "big_picture") && !photo ? "points" : s.layout;
  const els: CanvasElement[] = [];
  let bg = t.light;
  let dark = false;
  const points = list(s.points, layout === "picture" ? 4 : 5, 110);

  switch (layout) {
    case "title": {
      bg = t.dark;
      const title = clip(s.heading, 80), sub = clip(s.subheading, 120);
      if (photo) {
        // The picture fills the right of the slide; the title sits on the colour beside it, with a slanted edge.
        els.push(image(photo, { x: 760, y: 0, w: 840, h: 900 }), shape({ x: 700, y: -60, w: 140, h: 1020, fill: t.dark, rotate: 6 }));
      } else {
        els.push(...decor(t, true, "right"), shape({ x: 1060, y: 220, w: 460, h: 460, shape: "ellipse", fill: t.primary, opacity: 0.55 }),
          shape({ x: 1180, y: 340, w: 220, h: 220, shape: "ellipse", fill: t.accent, opacity: 0.9 }));
      }
      const w = photo ? 600 : 900;
      els.push(text({ x: 120, y: 200, w: 300, h: 44, text: "LESSON", size: 22, bold: true, color: t.accent, valign: "middle" }),
        shape({ x: 120, y: 260, w: 120, h: 14, shape: "round", fill: t.accent }),
        text({ x: 120, y: 300, w, h: 300, text: title, size: fitSize(title, w, 300, photo ? 88 : 104, 52), bold: true, font: "display", color: t.onDark }));
      if (sub) els.push(text({ x: 120, y: 620, w, h: 140, text: sub, size: fitSize(sub, w, 140, 36, 24), color: t.onDarkMuted }));
      if (photo) els.push(credit(photo, true));
      return { background: { color: bg }, elements: els };
    }
    case "objectives": {
      els.push(...decor(t, false), heading(t, s.heading || "In this lesson we will"), underline(t),
        ...cards(t, list(s.points, 4, 100), { x: 100, y: 240, w: 1400, h: 580 }));
      break;
    }
    case "picture": {
      els.push(...decor(t, false, "right"), heading(t, s.heading, { w: 1280 }), underline(t),
        // A coloured frame offset behind the picture.
        shape({ x: 124, y: 254, w: 720, h: 560, shape: "round", fill: t.accent, opacity: 0.85 }),
        image(photo!, { x: 100, y: 230, w: 720, h: 560, radius: 28 }),
        ...cards(t, points, { x: 880, y: 236, w: 620, h: 560 }), credit(photo!, false));
      els.push(...footer(t, deck, false).slice(0, 1));   // the credit sits where the slide number would
      return { background: { color: bg }, elements: els };
    }
    case "big_picture": {
      bg = t.dark;
      const cap = clip(s.heading, 90);
      els.push(image(photo!, { x: 0, y: 0, w: 1600, h: 900 }),
        shape({ x: 0, y: 640, w: 1600, h: 260, fill: t.dark, opacity: 0.78 }),
        shape({ x: 80, y: 676, w: 90, h: 10, shape: "round", fill: t.accent }),
        text({ x: 80, y: 700, w: 1300, h: 120, text: cap, size: fitSize(cap, 1300, 120, 52, 30), bold: true, color: "#ffffff", valign: "middle", font: "display" }),
        credit(photo!, true));
      return { background: { color: bg }, elements: els };
    }
    case "compare": {
      els.push(...decor(t, false), heading(t, s.heading), underline(t));
      const col = (x: number, h: string | undefined, ps: string[] | undefined, fill: string, ink: string) => {
        const title = clip(h, 40);
        els.push(shape({ x, y: 236, w: 680, h: 580, shape: "round", fill }),
          shape({ x: x + 40, y: 266, w: 80, h: 80, shape: "ellipse", fill: ink, opacity: 0.18 }),
          text({ x: x + 140, y: 266, w: 500, h: 80, text: title || " ", size: fitSize(title, 500, 80, 44, 26), bold: true, color: ink, font: "display", valign: "middle" }),
          bullets(t, list(ps, 4, 90), { x: x + 40, y: 370, w: 600, h: 420 }, 40, t.text));
      };
      col(100, s.left_heading, s.left_points, t.soft, t.primary);
      col(820, s.right_heading, s.right_points, `${t.accent}55`, t.dark);
      els.push(shape({ x: 740, y: 486, w: 120, h: 120, shape: "ellipse", fill: t.dark }),
        text({ x: 740, y: 486, w: 120, h: 120, text: "vs", size: 40, bold: true, color: "#ffffff", align: "center", valign: "middle", font: "display" }));
      break;
    }
    case "key_fact": {
      bg = t.primary; dark = true;
      const fact = clip(s.heading, 120), more = clip(s.subheading, 160);
      els.push(...decor(t, true),
        text({ x: 160, y: 110, w: 1280, h: 60, text: "KEY FACT", size: 26, bold: true, color: t.accent, align: "center", valign: "middle" }),
        shape({ x: 745, y: 176, w: 110, h: 10, shape: "round", fill: t.accent }),
        text({ x: 160, y: 210, w: 1280, h: 380, text: fact, size: fitSize(fact, 1280, 380, 100, 50), bold: true, font: "display", color: "#ffffff", align: "center", valign: "middle" }));
      if (more) els.push(text({ x: 200, y: 610, w: 1200, h: 150, text: more, size: fitSize(more, 1200, 150, 38, 24), color: "#ffffff", align: "center", valign: "top", opacity: 0.92 }));
      break;
    }
    case "question": {
      bg = t.dark; dark = true;
      const q = clip(s.heading, 140);
      els.push(text({ x: 1080, y: 40, w: 500, h: 820, text: "?", size: 700, bold: true, color: t.accent, align: "center", valign: "middle", font: "display", opacity: 0.12 }),
        shape({ x: 160, y: 150, w: 330, h: 64, shape: "round", fill: t.accent }),
        text({ x: 160, y: 150, w: 330, h: 64, text: "THINK, PAIR, SHARE", size: 24, bold: true, color: t.dark, align: "center", valign: "middle" }),
        text({ x: 160, y: 250, w: 1200, h: 440, text: q, size: fitSize(q, 1200, 440, 92, 46), bold: true, font: "display", color: t.onDark, valign: "middle" }));
      if (s.subheading) els.push(text({ x: 160, y: 710, w: 1200, h: 90, text: `Hint: ${clip(s.subheading, 120)}`, size: 30, color: t.onDarkMuted, valign: "middle" }));
      break;
    }
    case "summary": {
      bg = t.soft;
      els.push(...decor(t, false), heading(t, s.heading || "Remember"), underline(t),
        ...cards(t, points, { x: 100, y: 240, w: 1400, h: 580 }, "tick", t.light));
      break;
    }
    default: {
      els.push(...decor(t, false), heading(t, s.heading), underline(t),
        ...(points.length ? cards(t, points, { x: 100, y: 240, w: 1400, h: 580 }) : [bullets(t, points, { x: 100, y: 240, w: 1400, h: 580 })]));
    }
  }
  els.push(...footer(t, deck, dark));
  return { background: { color: bg }, elements: els };
}

/** The outline, tidied: a title slide first, a recap last (when long enough), and no more than `max` slides. */
export function tidyOutline(o: Outline, max: number): Outline {
  const slides = o.slides.filter((s) => s && DECK_LAYOUTS.includes(s.layout) && (s.heading || s.points?.length)).slice(0, max);
  if (!slides.length || slides[0]!.layout !== "title") slides.unshift({ layout: "title", heading: o.title || "Lesson" });
  if (slides.length > max) slides.length = max;
  if (max >= 5 && slides[slides.length - 1]!.layout !== "summary" && slides.length < max) {
    const recap = slides.flatMap((s) => (s.layout === "points" || s.layout === "picture") ? [s.heading] : []).slice(0, 4);
    if (recap.length >= 2) slides.push({ layout: "summary", heading: "Remember", points: recap, notes: "Go over the main ideas once more, and ask a few quick questions." });
  }
  return { title: clip(o.title, 120) || clip(slides[0]!.heading, 120) || "Lesson", slides };
}

/** The whole deck: designed slides with their teacher notes (and picture credits in the notes too). */
export function buildDeck(o: Outline, photos: (Photo | undefined)[], theme: ThemeKey): DeckSlide[] {
  const t = THEMES[theme] ?? THEMES.swift;
  return o.slides.map((s, i) => {
    const photo = photos[i];
    const notes = [clip(s.notes, 1500), photo ? (photo.source === "ai" ? "Picture made with AI for this slide." : `Photo by ${photo.credit} on ${sourceName(photo)}: ${photo.credit_url}`) : ""].filter(Boolean).join("\n\n");
    return { content: designSlide(s, t, photo, { title: o.title, n: i + 1, total: o.slides.length }), notes, heading: clip(s.heading, 120), photo };
  });
}
