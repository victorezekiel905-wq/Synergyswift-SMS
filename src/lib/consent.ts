/**
 * Consent for children's data (Nigeria's NDPA 2023, the UK and EU GDPR).
 * Records are never edited: each answer is a new row, and the latest row for
 * a purpose, child and family is what counts. Changing a purpose's wording
 * raises its version, which asks families again. Pure, unit tested.
 */

export type Purpose = { id: string; key: string; title: string; description: string; per_child: boolean; required: boolean; version: number; active: boolean; position: number };
export type ConsentRecord = { purpose_id: string; version: number; guardian_id: string | null; student_id: string | null; granted: boolean; method: string; created_at: string };
export type ConsentState = "granted" | "declined" | "outdated" | "missing";

export const DEFAULT_PURPOSES: Omit<Purpose, "id" | "version" | "active">[] = [
  { key: "school_records", title: "Keeping your child's school records", per_child: true, required: true, position: 1,
    description: "We keep your child's details, attendance, results, health and behaviour records to educate and look after them, and share them only with the people and bodies the law requires (such as exam boards)." },
  { key: "medical_emergency", title: "Emergency medical care", per_child: true, required: false, position: 2,
    description: "If your child is hurt or ill and we cannot reach you, a doctor or nurse may give first aid and emergency treatment." },
  { key: "photos_internal", title: "Photos inside the school", per_child: true, required: false, position: 3,
    description: "Photos and videos of your child on classroom displays, in the yearbook and on the parent portal." },
  { key: "photos_public", title: "Photos on the website and social media", per_child: true, required: false, position: 4,
    description: "Photos and videos of your child on the school website, social media and printed adverts. We never add their full name." },
  { key: "trips", title: "Local trips and outings", per_child: true, required: false, position: 5,
    description: "Your child may join short supervised outings during school hours. We still ask separately for overnight and longer trips." },
  { key: "marketing", title: "Newsletters and school news", per_child: false, required: false, position: 6,
    description: "We may send you newsletters, event invitations and school news. You always get essential messages about your child either way." }
];

const key = (purposeId: string, studentId: string | null, guardianId: string | null) => `${purposeId}|${studentId ?? ""}|${guardianId ?? ""}`;

/** The latest answer for each purpose / child / family. */
export function latest(records: ConsentRecord[]): Map<string, ConsentRecord> {
  const out = new Map<string, ConsentRecord>();
  for (const r of [...records].sort((a, b) => a.created_at.localeCompare(b.created_at))) out.set(key(r.purpose_id, r.student_id, r.guardian_id), r);
  return out;
}

/**
 * Where a purpose stands for one child (per-child purposes) or one family.
 * Any guardian of the child may answer a per-child purpose.
 */
export function stateFor(p: Purpose, records: ConsentRecord[], who: { studentId?: string | null; guardianId?: string | null }): { state: ConsentState; record: ConsentRecord | null } {
  const mine = records.filter(r => r.purpose_id === p.id && (p.per_child ? r.student_id === (who.studentId ?? null) : r.guardian_id === (who.guardianId ?? null) && !r.student_id));
  if (!mine.length) return { state: "missing", record: null };
  const last = mine.reduce((a, b) => (a.created_at >= b.created_at ? a : b));
  if (last.version < p.version) return { state: "outdated", record: last };
  return { state: last.granted ? "granted" : "declined", record: last };
}

/** Counts per purpose across children (per-child purposes) or families. */
export function coverage(purposes: Purpose[], records: ConsentRecord[], studentIds: string[], guardianIds: string[]) {
  return purposes.filter(p => p.active).map(p => {
    const subjects = p.per_child ? studentIds.map(id => ({ studentId: id })) : guardianIds.map(id => ({ guardianId: id }));
    const counts = { granted: 0, declined: 0, outdated: 0, missing: 0 };
    for (const s of subjects) counts[stateFor(p, records, s).state]++;
    return { id: p.id, key: p.key, title: p.title, per_child: p.per_child, required: p.required, total: subjects.length, ...counts };
  });
}

/** Wording changes ask families again; reordering or switching a purpose on or off does not. */
export function nextVersion(old: Pick<Purpose, "title" | "description" | "version">, next: { title: string; description: string }): number {
  return old.title.trim() !== next.title.trim() || old.description.trim() !== next.description.trim() ? old.version + 1 : old.version;
}
