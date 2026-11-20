/**
 * Student lists often come without admission numbers. The import fills them in:
 * a student already in the school (same first name, last name and class) keeps
 * their number, so uploading the list again updates instead of duplicating;
 * everyone else gets the next student ID in the school's format: its initials and a
 * running number (GC-0001, GC-0002, …, migration 10600). Pure, unit tested.
 */
export type Existing = { admission_no: string; first_name: string; last_name: string; class_name: string | null };

const key = (first: string, last: string, cls: string | null | undefined) =>
  [first, last, cls ?? ""].map(s => s.trim().toLowerCase().replace(/\s+/g, " ")).join("|");

const SKIP = new Set(["OF", "THE", "AND", "FOR", "AT", "IN", "A", "AN", "LTD", "LIMITED"]);
/** A school's initials, as the database's school_acronym(): "Greenfield College" → GC, "Kings" → KIN. */
export function schoolInitials(name: string | null | undefined): string {
  const w = String(name ?? "").toUpperCase().replace(/[^A-Z0-9 ]/g, " ").trim().split(/\s+/).filter(x => x && !SKIP.has(x));
  if (w.length >= 2) return w.map(x => x[0]).join("").slice(0, 6);
  if (w.length === 1) return w[0].slice(0, 3);
  return "SCH";
}

/** The next ID after the highest PREFIX-n already used (PREFIX-0001 when none). */
export function nextStudentId(used: (string | null)[], prefix: string): string {
  const max = used.reduce((m: number, a) => {
    const x = String(a ?? "");
    const n = x.startsWith(`${prefix}-`) ? Number(x.slice(prefix.length + 1)) : NaN;
    return Number.isInteger(n) && n > m ? n : m;
  }, 0);
  return `${prefix}-${String(max + 1).padStart(4, "0")}`;
}

/** The admission number for each row: the one given, an existing student's, or the next new one. */
export function fillAdmissionNumbers(rows: { admission_no: string; first_name: string; last_name: string; class_name: string }[], existing: Existing[], prefix: string): { numbers: string[]; reused: number; made: number } {
  const known = new Map<string, string>();
  for (const s of existing) known.set(key(s.first_name, s.last_name, s.class_name), s.admission_no);
  const taken = new Set(existing.map(s => s.admission_no.trim().toLowerCase()));
  for (const r of rows) if (r.admission_no.trim()) taken.add(r.admission_no.trim().toLowerCase());
  let next = existing.reduce((m, s) => {
    const n = s.admission_no.startsWith(prefix) ? Number(s.admission_no.slice(prefix.length)) : NaN;
    return Number.isInteger(n) && n > m ? n : m;
  }, 0);
  let reused = 0, made = 0;
  const numbers = rows.map(r => {
    if (r.admission_no.trim()) return r.admission_no.trim();
    if (!r.first_name.trim() && !r.last_name.trim()) return "";
    const had = known.get(key(r.first_name, r.last_name, r.class_name));
    if (had) { reused++; return had; }
    let n: string;
    do { next++; n = `${prefix}${String(next).padStart(4, "0")}`; } while (taken.has(n.toLowerCase()));
    taken.add(n.toLowerCase());
    made++;
    return n;
  });
  return { numbers, reused, made };
}
