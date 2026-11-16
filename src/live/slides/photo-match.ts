/**
 * Does a stock photo actually show what a slide is about? Pixabay gives each photo its tags and
 * Unsplash a description; both are compared with the words for what the picture must show.
 * A photo that shares none of those words is not used (a slide without a photo is better than a
 * slide with the wrong one). Pure, so it can be unit tested. Relative imports only.
 */

const STOP = new Set(("the a an and or of in on at to for with from by into over under about as is are be this that these those it its " +
  "their there here what which who how why when where photo image picture showing show shows close view background lesson class " +
  "students student teacher school simple real realistic clear good nice beautiful").split(" "));

/** A word in its simplest form: lower case, plural "s" / "es" / "ies" taken off. */
export function stem(w: string): string {
  const x = w.toLowerCase();
  if (x.length > 4 && x.endsWith("ies")) return `${x.slice(0, -3)}y`;
  // leaves → leaf, halves → half, shelves → shelf, wolves → wolf
  if (x.length > 5 && /[aeilor]ves$/.test(x)) return `${x.slice(0, -3)}f`;
  if (x.length > 4 && /(ches|shes|sses|xes)$/.test(x)) return x.slice(0, -2);
  if (x.length > 3 && x.endsWith("s") && !x.endsWith("ss") && !x.endsWith("us") && !x.endsWith("is")) return x.slice(0, -1);
  return x;
}

/** The words that matter in a piece of text (no small words, at least 3 letters), simplified. */
export function keywords(text: string | null | undefined): string[] {
  const out: string[] = [];
  for (const raw of String(text ?? "").toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 3 || STOP.has(raw) || /^\d+$/.test(raw)) continue;
    const s = stem(raw);
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

/** What a slide's picture must show: the subject the AI named first, then the search words and the heading. */
export type PictureNeed = { must: string[]; also: string[] };
export function pictureNeed(p: { subject?: string; queries?: string[]; heading?: string }): PictureNeed {
  const must = keywords(p.subject || p.queries?.[0]);
  const also = keywords([...(p.queries ?? []), p.heading].join(" ")).filter(w => !must.includes(w));
  return { must, also };
}

/**
 * How well a photo's tags or description fit: 3 for each word it must show, 1 for each other
 * word from the slide. 0 when it shows none of the words it must (not used).
 */
export function matchScore(need: PictureNeed, photoText: string | null | undefined): number {
  const words = new Set(keywords(photoText));
  if (!words.size) return 0;
  const has = (w: string) => words.has(w) || [...words].some(x => (x.length >= 5 && w.length >= 5) && (x.startsWith(w) || w.startsWith(x)));
  const must = need.must.filter(has).length;
  if (need.must.length && !must) return 0;
  return must * 3 + need.also.filter(has).length;
}

/** The best fitting candidate (highest score, then the first found), or undefined when none fits. */
export function bestMatch<T>(need: PictureNeed, candidates: T[], text: (c: T) => string | null | undefined, minScore = 1): T | undefined {
  let best: T | undefined, top = 0;
  for (const c of candidates) {
    const s = matchScore(need, text(c));
    if (s >= minScore && s > top) { best = c; top = s; }
  }
  return best;
}
