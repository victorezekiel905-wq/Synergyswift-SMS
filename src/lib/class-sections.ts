/**
 * A whole school's student list in one file, with each class as a heading:
 *
 *   JSS 1A                                  ← a class heading (a line on its own)
 *   Adm No | Surname | First name | Gender  ← column names (once, or under every class)
 *   001    | Obi     | Ada        | F
 *   JSS 1B
 *   ...
 *
 * or just names under each heading, with no column names at all. This turns it
 * into one table with a Class column, which the student import then reads
 * (creating the classes). A single "Name" column is split into first, last and
 * other names. Pure, unit tested.
 */
import { autoMap, entity, norm } from "@/lib/importers";
import type { Table } from "@/lib/spreadsheet";

export type Organised = { table: Table; classes: { name: string; students: number }[]; namesSplit: boolean };

const STUDENTS = entity("students")!;
const blank = (r: string[]) => r.every(c => !c.trim());
const filled = (r: string[]) => r.map(c => c.trim()).filter(Boolean);
const NAME_HEADERS = new Set(["name", "names", "full name", "student name", "student names", "pupil name", "name of student", "name of pupil", "student", "pupil", "students name", "student s name"]);

/** "Class: JSS 1A", "JSS 1A (32 students)", "YEAR 7 BLUE:" → "JSS 1A", "YEAR 7 BLUE". */
export function className(raw: string): string {
  return raw.trim()
    .replace(/^(class|form|arm|grade|level)\s*[:\-–]\s*/i, "")
    .replace(/\s*[(\[]\s*\d+\s*(students?|pupils?|learners?)?\s*[)\]]\s*$/i, "")
    .replace(/\s*[-–:]\s*\d+\s*(students?|pupils?|learners?)\s*$/i, "")
    .replace(/\s*[:\-–]\s*$/, "")
    .replace(/\s+/g, " ").trim();
}

/** Looks like a class name, for lists that are only names (where one cell can't tell a heading from a pupil). */
export function looksLikeClass(raw: string): boolean {
  const s = raw.trim();
  if (!s || s.length > 40) return false;
  if (/^(class|form|arm)\s*[:\-–]/i.test(s) || /:\s*$/.test(s)) return true;
  return /^(jss|js|sss|ss|sec|primary|pry|pri|basic|bs|year|yr|grade|gr|nursery|nur|kg|kindergarten|reception|creche|crèche|pre-?k|pre-?school|playgroup|form|class|grade|stage|p)\s*[-.]?\s*\d{0,2}\b/i.test(s)
    && /\d/.test(s) || /^(nursery|reception|creche|crèche|playgroup|kindergarten|pre-?school)\b/i.test(s);
}

/** "Obi, Ada Chiamaka" / "OBI Ada Chiamaka" / "Ada Chiamaka Obi" → first, last, other. */
export function splitName(full: string): { first: string; last: string; other: string } {
  const s = full.trim().replace(/\s+/g, " ");
  if (s.includes(",")) {
    const [last, rest] = [s.slice(0, s.indexOf(",")).trim(), s.slice(s.indexOf(",") + 1).trim()];
    const [first = "", ...other] = rest.split(" ");
    return { first, last, other: other.join(" ") };
  }
  const w = s.split(" ");
  if (w.length === 1) return { first: w[0], last: "", other: "" };
  // A surname written in capitals first (common on Nigerian registers): OBI Ada Chiamaka.
  const caps = (x: string) => x.length > 1 && x === x.toUpperCase() && /[A-Z]/.test(x);
  if (caps(w[0]) && !w.slice(1).every(caps)) return { last: w[0], first: w[1], other: w.slice(2).join(" ") };
  return { first: w[0], last: w[w.length - 1], other: w.slice(1, -1).join(" ") };
}

const isHeaderRow = (r: string[]) => {
  const cells = r.map(c => c.trim());
  const mapped = Object.values(autoMap(STUDENTS, cells)).filter(i => i >= 0).length;
  return mapped >= 2 || (mapped >= 1 && cells.some(c => NAME_HEADERS.has(norm(c)))) || (filled(r).length >= 1 && filled(r).every(c => NAME_HEADERS.has(norm(c))));
};

/**
 * The whole file as rows (column names included, wherever they are). Returns null when the
 * file has no class headings, so an ordinary spreadsheet goes through the import as it is.
 */
export function organiseStudentList(grid: string[][]): Organised | null {
  const rows = grid.map(r => r.map(c => String(c ?? ""))).filter(r => !blank(r));
  if (!rows.length) return null;
  const headerAt = rows.findIndex(isHeaderRow);
  const header = headerAt >= 0 ? rows[headerAt].map(c => c.trim()) : null;
  const width = header ? header.length : 1;
  const wide = header ? width > 1 && rows.filter((r, i) => i !== headerAt && filled(r).length >= 2).length > 0 : false;

  const out: string[][] = [];
  const counts = new Map<string, number>();
  let current = "";
  let headings = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (header && i !== headerAt && isHeaderRow(r)) continue;                       // column names repeated under each class
    if (i === headerAt) continue;
    const cells = filled(r);
    const heading = cells.length === 1 && (wide ? true : looksLikeClass(cells[0])) && !(wide && /^\d+$/.test(cells[0]));
    if (heading) { current = className(cells[0]); headings++; if (!counts.has(current)) counts.set(current, 0); continue; }
    if (!current) continue;                                                         // a title above the first class
    // Without column names, two cells are a register's "Surname | First names".
    const row = header ? header.map((_, j) => (r[j] ?? "").trim()) : [cells.length === 2 ? `${cells[0]}, ${cells[1]}` : cells.join(" ")];
    out.push([...row, current]);
    counts.set(current, (counts.get(current) ?? 0) + 1);
  }
  if (!headings || !out.length) return null;

  let headers = [...(header ?? ["Name"]), "Class"];
  let body = out;
  // One "Name" column (or none): split into the first, last and other names the import needs.
  const map = autoMap(STUDENTS, headers);
  const nameCol = headers.findIndex(h => NAME_HEADERS.has(norm(h)));
  const namesSplit = (map.first_name ?? -1) < 0 && (map.last_name ?? -1) < 0 && nameCol >= 0;
  if (namesSplit) {
    headers = [...headers.slice(0, nameCol), "First name", "Last name", "Other names", ...headers.slice(nameCol + 1)];
    body = out.map(r => { const n = splitName(r[nameCol]); return [...r.slice(0, nameCol), n.first, n.last, n.other, ...r.slice(nameCol + 1)]; });
  }
  // A class heading that never got a student isn't a class.
  const classes = [...counts].filter(([, n]) => n > 0).map(([name, students]) => ({ name, students }));
  return { table: { headers, rows: body }, classes, namesSplit };
}
