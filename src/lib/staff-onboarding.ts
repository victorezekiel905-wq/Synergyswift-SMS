/**
 * Staff onboarding, the pure parts (browser and server): reading a pasted or uploaded staff
 * list, matching subjects by name, and where each person is in the process. Unit tested.
 */

export type Subject = { id: string; name: string; code?: string | null };
export type ListRow = { line: number; full_name: string; email: string; staff_no: string; phone: string; subject_ids: string[]; unknown: string[]; problem: string | null };
export type Stage = "waiting" | "needs_classes" | "ready";

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Finds the school's subject a typed name means: exact (ignoring case, spaces and dots), the
 * subject code, or a clear start of the name ("Maths" → "Mathematics"). Null when unsure.
 */
export function matchSubject(typed: string, subjects: Subject[]): Subject | null {
  const t = norm(typed);
  if (!t) return null;
  const exact = subjects.find(s => norm(s.name) === t || (s.code && norm(s.code) === t));
  if (exact) return exact;
  if (t.length < 3) return null;
  const close = subjects.filter(s => { const n = norm(s.name); return n.startsWith(t) || t.startsWith(n) || n.startsWith(t.replace(/s$/, "")); });
  return close.length === 1 ? close[0] : null;
}

/** "Maths; English / Basic Science" → the school's subjects, and the names it could not match. */
export function subjectsFrom(text: string, subjects: Subject[]): { ids: string[]; unknown: string[] } {
  const ids: string[] = [], unknown: string[] = [];
  for (const part of text.split(/[;,|/]|\band\b|&/i).map(x => x.trim()).filter(Boolean)) {
    const m = matchSubject(part, subjects);
    if (m) { if (!ids.includes(m.id)) ids.push(m.id); } else unknown.push(part);
  }
  return { ids, unknown };
}

/**
 * A staff list from a spreadsheet or pasted text. With a heading row, the columns are found by
 * their names (name, email, subjects, ID number, phone). Without one: the cell with an @ is the
 * email, the first other cell the name, and the rest are subjects.
 */
export function staffListFromGrid(grid: string[][], subjects: Subject[]): ListRow[] {
  const rows = grid.filter(r => r.some(c => c.trim()));
  if (!rows.length) return [];
  const head = rows[0].map(c => c.trim().toLowerCase());
  const hasHead = head.some(h => /e-?mail/.test(h)) && !rows[0].some(c => EMAIL.test(c.trim()));
  const col = (re: RegExp) => head.findIndex(h => re.test(h));
  const at = hasHead ? {
    name: col(/name|staff$|teacher/), email: col(/e-?mail/), subjects: col(/subject|teach/), id: col(/\bid\b|number|staff\s*no|staff_no/), phone: col(/phone|mobile|tel/)
  } : null;
  const seen = new Set<string>();
  return rows.slice(hasHead ? 1 : 0).map((r, i) => {
    const cells = r.map(c => (c ?? "").trim());
    let full_name = "", email = "", subjectText = "", staff_no = "", phone = "";
    if (at) {
      full_name = at.name >= 0 ? cells[at.name] ?? "" : "";
      email = at.email >= 0 ? cells[at.email] ?? "" : "";
      subjectText = at.subjects >= 0 ? cells[at.subjects] ?? "" : "";
      staff_no = at.id >= 0 && at.id !== at.name ? cells[at.id] ?? "" : "";
      phone = at.phone >= 0 ? cells[at.phone] ?? "" : "";
    } else {
      let e = cells.findIndex(c => EMAIL.test(c));
      if (e < 0) e = cells.findIndex(c => c.includes("@"));      // a mistyped email is still the email
      email = e >= 0 ? cells[e] : "";
      const rest = cells.filter((c, j) => j !== e && c);
      full_name = rest[0] ?? "";
      subjectText = rest.slice(1).join(";");
    }
    email = email.toLowerCase();
    const { ids, unknown } = subjectsFrom(subjectText, subjects);
    let problem: string | null = null;
    if (full_name.length < 2) problem = "no name";
    else if (!EMAIL.test(email)) problem = email ? "email is not right" : "no email";
    else if (seen.has(email)) problem = "this email is on the list twice";
    seen.add(email);
    return { line: i + (hasHead ? 2 : 1), full_name, email, staff_no, phone, subject_ids: ids, unknown, problem };
  });
}

/** Where someone is: invited and waiting, joined but in no class, or ready. */
export function stageOf(p: { has_account: boolean; classes: number; planned?: number }): Stage {
  if (!p.has_account) return "waiting";
  return p.classes > 0 ? "ready" : "needs_classes";
}

export const STAGE_TEXT: Record<Stage, string> = { waiting: "Invited, waiting", needs_classes: "Joined, needs classes", ready: "Ready" };

/** A class assignment: a subject in a class, or (subject null) form teacher of the class. */
export type Assignment = { class_group_id: string; subject_id: string | null };
export const assignmentKey = (a: Assignment) => `${a.class_group_id}:${a.subject_id ?? "form"}`;

/** What to add and what to take away to go from what someone has to what was ticked. */
export function assignmentChanges(have: Assignment[], want: Assignment[]): { add: Assignment[]; remove: Assignment[] } {
  const h = new Set(have.map(assignmentKey)), w = new Set(want.map(assignmentKey));
  const uniq = (xs: Assignment[]) => [...new Map(xs.map(x => [assignmentKey(x), x])).values()];
  return { add: uniq(want.filter(a => !h.has(assignmentKey(a)))), remove: uniq(have.filter(a => !w.has(assignmentKey(a)))) };
}
