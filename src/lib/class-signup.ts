/**
 * Class sign-up codes (migration 10300): one shared code per class. A student signs up with it
 * and waits; the class teacher matches them to their record (or adds them as new). Pure helpers.
 */

const words = (s: string) => String(s ?? "").toLowerCase().replace(/[^a-z0-9\s'-]/g, " ").split(/\s+/).filter(Boolean);

/** "Ada Ngozi Obi" → first name "Ada", last name "Ngozi Obi" (a name of one word has no last name). */
export function splitName(full: string): { first: string; last: string } {
  const parts = String(full ?? "").trim().split(/\s+/).filter(Boolean);
  return { first: parts[0] ?? "", last: parts.slice(1).join(" ") };
}

/** A full name for a new student record needs at least a first and a last name. */
export const isFullName = (full: string) => words(full).length >= 2 && String(full).trim().length <= 120;

/**
 * The record a typed name most likely belongs to: every word of one name is in the other
 * (order and middle names do not matter), and only one record fits. Null when unsure:
 * the teacher chooses.
 */
export function bestMatch<T extends { id: string; name: string }>(typed: string, records: T[]): T | null {
  const t = words(typed);
  if (t.length < 2) return null;
  const fits = records.filter(r => {
    const n = words(r.name);
    if (n.length < 2) return false;
    const [small, big] = t.length <= n.length ? [t, n] : [n, t];
    return small.every(w => big.includes(w));
  });
  return fits.length === 1 ? fits[0] : null;
}
