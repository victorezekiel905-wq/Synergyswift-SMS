/**
 * Ratings of the whole child on report cards (migration 8400): the school's own
 * areas and its own scale. Safe in the browser.
 */
export type ScaleItem = { value: number; short: string; label: string };

export const DEFAULT_SCALE: ScaleItem[] = [
  { value: 5, short: "5", label: "Excellent" }, { value: 4, short: "4", label: "Very good" }, { value: 3, short: "3", label: "Good" },
  { value: 2, short: "2", label: "Fair" }, { value: 1, short: "1", label: "Needs improvement" }
];

/** Ready-made scales a school can start from. */
export const SCALE_PRESETS: { name: string; scale: ScaleItem[] }[] = [
  { name: "1 to 5, in words", scale: DEFAULT_SCALE },
  { name: "A to E", scale: [{ value: 5, short: "A", label: "Excellent" }, { value: 4, short: "B", label: "Very good" }, { value: 3, short: "C", label: "Good" }, { value: 2, short: "D", label: "Fair" }, { value: 1, short: "E", label: "Poor" }] },
  { name: "Exceeds / Meets / Working towards", scale: [{ value: 3, short: "EX", label: "Exceeds expectations" }, { value: 2, short: "ME", label: "Meets expectations" }, { value: 1, short: "WT", label: "Working towards" }] },
  { name: "1 to 10", scale: Array.from({ length: 10 }, (_, i) => ({ value: 10 - i, short: String(10 - i), label: ["Outstanding", "Excellent", "Very good", "Good", "Above average", "Average", "Below average", "Fair", "Weak", "Poor"][i] })) }
];

/** Ready-made areas with their usual items. */
export const TRAIT_PRESETS: { domain: string; title: string; items: string[] }[] = [
  { domain: "affective", title: "Character", items: ["Punctuality", "Attendance", "Neatness", "Politeness", "Honesty", "Self-control", "Relationship with others", "Leadership", "Attentiveness"] },
  { domain: "psychomotor", title: "Skills", items: ["Handwriting", "Verbal fluency", "Sports and games", "Handling tools", "Drawing and painting", "Musical skills"] },
  { domain: "Effort", title: "Effort", items: ["Effort in class", "Effort with homework", "Perseverance", "Organisation"] },
  { domain: "Co-curricular", title: "Co-curricular", items: ["Sports", "Clubs and societies", "Music and drama", "Debate and quiz", "Community service"] },
  { domain: "Social and emotional", title: "Social and emotional", items: ["Works well with others", "Manages feelings", "Confidence", "Kindness"] }
];

/** The heading an area prints under. */
export const areaTitle = (domain: string) => TRAIT_PRESETS.find(p => p.domain === domain)?.title ?? domain;

/** The school's scale from its settings row, falling back to 1 to 5 in words. */
export function traitScale(settings: unknown): ScaleItem[] {
  const raw = (settings as { trait_scale?: unknown } | null)?.trait_scale;
  if (!Array.isArray(raw)) return DEFAULT_SCALE;
  const ok = raw.filter((x: any) => Number.isInteger(x?.value) && x.value >= 1 && x.value <= 10 && typeof x.label === "string")
    .map((x: any) => ({ value: x.value, short: String(x.short ?? x.value).slice(0, 4), label: String(x.label).slice(0, 40) }));
  return ok.length >= 2 ? ok.sort((a, b) => b.value - a.value) : DEFAULT_SCALE;
}

/** "Excellent" for a rating, or the number when it is off the scale. */
export const ratingShort = (scale: ScaleItem[], v: number | null | undefined) => (v == null ? "—" : scale.find(s => s.value === v)?.short ?? String(v));
export const scaleKey = (scale: ScaleItem[]) => scale.map(s => `${s.short} ${s.label}`).join(" · ");
