/**
 * Every chapter of "Take a tour", in the order of the Features page: one or more
 * chapters for every feature in lib/features.ts (tests/tour.test.ts checks that
 * none is left out).
 */
import { CHAPTERS as FIRST, type Chapter } from "@/components/site/tour-scenes";
import { MORE } from "@/components/site/tour-scenes-more";
import { FEATURES } from "@/lib/features";

// Which area and features the first twelve chapters show.
const META: Record<string, { group: string; features: string[] }> = {
  setup: { group: "results", features: ["Your assessment pattern"] },
  classes: { group: "core", features: ["Classes and teams"] },
  admissions: { group: "families", features: ["Admissions"] },
  gate: { group: "safety", features: ["Gate sign-in and sign-out"] },
  live: { group: "learning", features: ["Live lessons and games"] },
  discuss: { group: "learning", features: ["Homework", "Class discussions"] },
  exams: { group: "exams", features: ["Secure CBT"] },
  results: { group: "results", features: ["Report cards and transcripts"] },
  fees: { group: "money", features: ["Fees and online payments"] },
  safety: { group: "safety", features: ["Pickup and drop-off"] },
  families: { group: "families", features: ["Parent app", "Basic phones by USSD"] },
  lead: { group: "leadership", features: ["Head's dashboard"] }
};

const all: Chapter[] = [...FIRST.map(c => ({ ...c, ...META[c.id] })), ...MORE];
const groupAt = (g?: string) => FEATURES.findIndex(x => x.id === g);
const featureAt = (c: Chapter) => {
  const g = FEATURES.find(x => x.id === c.group);
  return Math.min(...(c.features ?? []).map(f => g?.items.findIndex(i => i.title === f) ?? 99));
};

export const CHAPTERS: Chapter[] = all.sort((a, b) => groupAt(a.group) - groupAt(b.group) || featureAt(a) - featureAt(b));
export const GROUPS = FEATURES.map(g => ({ id: g.id, title: g.title }));
export type { Chapter };
