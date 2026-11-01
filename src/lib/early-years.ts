/**
 * Preschool assessment (migration 9200): no scores or positions. Each child is
 * rated against the school's own checklist (areas of learning and what the child
 * can do) on the school's own scale, with a short comment per area. Pure, safe
 * in the browser, unit tested.
 */
import type { ScaleItem } from "./traits";

export type EyOptions = {
  area_comments: boolean;   // a comment box per area of learning
  show_traits: boolean;     // print the school's Character & skills ratings too
  show_attendance: boolean;
  show_key: boolean;        // print what each point on the scale means
};
export type EySettings = { scale: ScaleItem[]; options: EyOptions };

export const EY_SCALE_PRESETS: { name: string; scale: ScaleItem[] }[] = [
  { name: "Emerging / Developing / Secure", scale: [{ value: 3, short: "S", label: "Secure" }, { value: 2, short: "D", label: "Developing" }, { value: 1, short: "E", label: "Emerging" }] },
  { name: "Emerging / Expected / Exceeding (EYFS)", scale: [{ value: 3, short: "EX", label: "Exceeding" }, { value: 2, short: "EXP", label: "Expected" }, { value: 1, short: "EM", label: "Emerging" }] },
  { name: "Not yet / Sometimes / Mostly / Always", scale: [{ value: 4, short: "A", label: "Always" }, { value: 3, short: "M", label: "Mostly" }, { value: 2, short: "S", label: "Sometimes" }, { value: 1, short: "N", label: "Not yet" }] },
  { name: "Beginning / Progressing / Achieved", scale: [{ value: 3, short: "A", label: "Achieved" }, { value: 2, short: "P", label: "Progressing" }, { value: 1, short: "B", label: "Beginning" }] }
];
export const DEFAULT_EY_OPTIONS: EyOptions = { area_comments: true, show_traits: false, show_attendance: true, show_key: true };

/** The school's preschool scale and options from its settings row, with safe defaults. */
export function earlyYearsSettings(settings: unknown): EySettings {
  const raw = (settings as { early_years?: { scale?: unknown; options?: unknown } } | null)?.early_years ?? {};
  const scale = Array.isArray(raw.scale)
    ? raw.scale.filter((x: any) => Number.isInteger(x?.value) && x.value >= 1 && x.value <= 6 && typeof x.label === "string")
        .map((x: any) => ({ value: x.value, short: String(x.short ?? x.value).slice(0, 4), label: String(x.label).slice(0, 40) }))
    : [];
  const o = (raw.options && typeof raw.options === "object" ? raw.options : {}) as Partial<EyOptions>;
  const options = Object.fromEntries(Object.entries(DEFAULT_EY_OPTIONS).map(([k, d]) => [k, typeof o[k as keyof EyOptions] === "boolean" ? o[k as keyof EyOptions] : d])) as EyOptions;
  return { scale: scale.length >= 2 ? scale.sort((a, b) => b.value - a.value) : EY_SCALE_PRESETS[0].scale, options };
}

/** Problems with a scale a school typed in (2 to 6 points, each value once). */
export function checkEyScale(scale: ScaleItem[]): string[] {
  const out: string[] = [];
  if (scale.length < 2 || scale.length > 6) out.push("A preschool scale has 2 to 6 points.");
  if (new Set(scale.map(s => s.value)).size !== scale.length) out.push("Each point on the scale needs its own value.");
  if (scale.some(s => !s.label.trim() || !s.short.trim())) out.push("Every point needs a short code and a label.");
  return out;
}

/** Ready-made checklists a school starts from, then edits. */
export const EY_FRAMEWORKS: { key: string; name: string; hint: string; areas: { name: string; items: string[] }[] }[] = [
  { key: "eyfs", name: "EYFS (England): seven areas of learning", hint: "The Early Years Foundation Stage areas, used by British schools from Nursery to Reception.", areas: [
    { name: "Communication and language", items: ["Listens attentively and responds in a group", "Asks and answers questions about what they hear", "Talks about their ideas and experiences in full sentences", "Uses new words in conversation"] },
    { name: "Personal, social and emotional development", items: ["Shows confidence to try new activities", "Manages own feelings and behaviour", "Plays and takes turns with others", "Looks after own needs (dressing, toileting, hand-washing)"] },
    { name: "Physical development", items: ["Moves safely with control and coordination", "Holds a pencil with a comfortable grip", "Uses scissors and small tools with care", "Understands healthy eating and keeping clean"] },
    { name: "Literacy", items: ["Enjoys stories and joins in with repeated parts", "Recognises letter sounds (phonics)", "Blends sounds to read simple words", "Writes recognisable letters and their own name"] },
    { name: "Mathematics", items: ["Counts objects reliably to 10", "Recognises numerals 0 to 10", "Compares quantities (more, fewer, the same)", "Recognises and names simple shapes and patterns"] },
    { name: "Understanding the world", items: ["Talks about people and families around them", "Notices similarities and differences in the natural world", "Talks about past and present events in their own life"] },
    { name: "Expressive arts and design", items: ["Explores colour, texture and materials in art", "Sings songs and moves to music", "Uses imagination in role play and stories"] }
  ] },
  { key: "ng_nursery", name: "Nigerian nursery: learning areas", hint: "Literacy, numeracy, science, social habits, health and creative arts, as in most Nigerian nursery classes.", areas: [
    { name: "Language and literacy", items: ["Says the alphabet and letter sounds", "Recognises and reads simple words", "Writes letters and own name", "Speaks clearly and answers questions"] },
    { name: "Numeracy", items: ["Counts from 1 to 20", "Recognises and writes numbers", "Adds and takes away small numbers with objects", "Sorts objects by size, colour and shape"] },
    { name: "Basic science and environment", items: ["Names parts of the body", "Names common animals and plants", "Talks about the weather and seasons"] },
    { name: "Social habits and moral values", items: ["Greets and says please and thank you", "Shares and plays well with others", "Follows class rules and routines"] },
    { name: "Health and physical development", items: ["Washes hands and keeps clean", "Runs, jumps and throws with control", "Uses crayons and pencils with control"] },
    { name: "Creative arts and rhymes", items: ["Recites rhymes and sings songs", "Draws and colours with care", "Takes part in drama and dance"] }
  ] },
  { key: "montessori", name: "Montessori", hint: "Practical life, sensorial, language, mathematics and culture.", areas: [
    { name: "Practical life", items: ["Pours, spoons and transfers with care", "Cares for self and the environment", "Completes a work cycle and puts materials away"] },
    { name: "Sensorial", items: ["Grades by size, colour and texture", "Matches and pairs sensorial materials"] },
    { name: "Language", items: ["Traces sandpaper letters and says their sounds", "Builds words with the moveable alphabet", "Reads phonetic words"] },
    { name: "Mathematics", items: ["Counts with number rods and spindle boxes", "Associates quantity with numerals", "Works with the golden beads"] },
    { name: "Culture", items: ["Explores maps, flags and continents", "Learns about plants, animals and the seasons", "Takes part in art and music"] }
  ] }
];

/** Ratings in an area: how many statements are rated, and the most common point. */
export function areaSummary(itemIds: string[], ratings: Record<string, number | null | undefined>, scale: ScaleItem[]): { rated: number; total: number; typical: ScaleItem | null } {
  const values = itemIds.map(id => ratings[id]).filter((v): v is number => typeof v === "number");
  if (!values.length) return { rated: 0, total: itemIds.length, typical: null };
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  // The most common rating; on a tie, the lower one (a cautious summary for families).
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
  return { rated: values.length, total: itemIds.length, typical: scale.find(s => s.value === best) ?? null };
}
