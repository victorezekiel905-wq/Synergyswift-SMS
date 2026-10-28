/**
 * How a school's overview page is arranged (migration 8400:
 * tenant_settings.dashboard_layout): which panels show, in what order, and which
 * "Right now" tiles and "Go to" shortcuts. Admins set it once for the school.
 */
export const SECTIONS = [
  { id: "kpis", label: "School figures (attendance, fees, targets)" },
  { id: "summary", label: "This week in plain words" },
  { id: "now", label: "Right now" },
  { id: "links", label: "Go to (shortcuts)" }
] as const;
export type SectionId = (typeof SECTIONS)[number]["id"];

export const STATS = [
  ["students", "Students"], ["students_on_site", "On site now"], ["staff_on_site", "Staff on site"], ["late_today", "Late today"], ["open_exams", "Open exams"],
  ["published_report_cards", "Report cards out"], ["pending_requisitions", "Pending requisitions"], ["pending_leave", "Pending leave"], ["guardians", "Guardians"],
  ["class_groups", "Classes"], ["failed_messages", "Failed messages"]
] as const;

export type Layout = { sections: SectionId[]; hidden_stats: string[]; hidden_links: string[] };
export const DEFAULT_LAYOUT: Layout = { sections: SECTIONS.map(s => s.id), hidden_stats: [], hidden_links: [] };

/** A saved layout, cleaned up: unknown entries dropped, nothing listed twice. */
export function normalizeLayout(raw: unknown): Layout {
  const r = (raw ?? {}) as Partial<Layout>;
  const ids = new Set<string>(SECTIONS.map(s => s.id));
  const sections = Array.isArray(r.sections) ? [...new Set(r.sections.filter((x): x is SectionId => typeof x === "string" && ids.has(x)))] : DEFAULT_LAYOUT.sections;
  const statIds = new Set<string>(STATS.map(([k]) => k));
  const strs = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string"))] : []);
  return { sections, hidden_stats: strs(r.hidden_stats).filter(k => statIds.has(k)), hidden_links: strs(r.hidden_links).slice(0, 50) };
}

/** Moves a panel one place up (-1) or down (+1). */
export function move(sections: SectionId[], id: SectionId, by: -1 | 1): SectionId[] {
  const i = sections.indexOf(id), j = i + by;
  if (i < 0 || j < 0 || j >= sections.length) return sections;
  const out = [...sections];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}
