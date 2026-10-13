/**
 * What can be imported and exported, the columns of each, and how a file's
 * headers map onto them. Aliases cover the column names used by other school
 * systems and by spreadsheets schools keep by hand. Pure, unit tested.
 */

export type FieldType = "text" | "email" | "phone" | "date" | "number" | "gender" | "bool" | "int";
export type ImportField = { key: string; label: string; required?: boolean; type?: FieldType; aliases?: string[]; example?: string };
export type Entity = { key: string; label: string; hint: string; finance?: boolean; fields: ImportField[]; matchOn: string };

export const ENTITIES: Entity[] = [
  { key: "students", label: "Students (with a parent)", matchOn: "admission_no", hint: "Existing admission numbers are updated; new ones are added. Classes are created when missing.", fields: [
    { key: "admission_no", label: "Admission number", required: true, aliases: ["adm no", "admission no", "admission number", "reg no", "registration number", "student id", "student no", "pupil id", "id number"], example: "2024/001" },
    { key: "first_name", label: "First name", required: true, aliases: ["firstname", "first", "given name", "forename"], example: "Ada" },
    { key: "last_name", label: "Last name", required: true, aliases: ["surname", "lastname", "last", "family name"], example: "Obi" },
    { key: "other_names", label: "Other names", aliases: ["middle name", "middle names", "othername"], example: "Chiamaka" },
    { key: "gender", label: "Gender", type: "gender", aliases: ["sex"], example: "F" },
    { key: "date_of_birth", label: "Date of birth", type: "date", aliases: ["dob", "birth date", "birthday", "date of birth"], example: "2014-03-21" },
    { key: "class", label: "Class", aliases: ["class name", "class arm", "arm", "form", "class group", "current class", "year group"], example: "JSS 1 A" },
    { key: "address", label: "Address", aliases: ["home address", "residential address"] },
    { key: "guardian_name", label: "Parent name", aliases: ["parent name", "guardian", "parent", "father name", "mother name", "parent guardian name"], example: "Mrs Ngozi Obi" },
    { key: "guardian_phone", label: "Parent phone", type: "phone", aliases: ["parent phone", "guardian phone", "phone", "phone number", "mobile", "parent mobile", "gsm"], example: "08031234567" },
    { key: "guardian_email", label: "Parent email", type: "email", aliases: ["parent email", "guardian email", "email"], example: "ngozi@example.com" },
    { key: "guardian_relation", label: "Relationship", aliases: ["relation", "relationship"], example: "mother" }
  ] },
  { key: "guardians", label: "Parents and guardians", matchOn: "admission_no", hint: "Each row links a parent to a child by admission number. Parents with the same phone or email are matched, so siblings share one parent record.", fields: [
    { key: "admission_no", label: "Child's admission number", required: true, aliases: ["adm no", "admission no", "student id", "reg no", "child admission no"], example: "2024/001" },
    { key: "full_name", label: "Parent name", required: true, aliases: ["name", "parent name", "guardian name", "full name"], example: "Mr Tunde Bello" },
    { key: "phone", label: "Phone", type: "phone", aliases: ["phone number", "mobile", "gsm", "telephone"], example: "08021234567" },
    { key: "whatsapp_phone", label: "WhatsApp number", type: "phone", aliases: ["whatsapp", "whatsapp number"] },
    { key: "email", label: "Email", type: "email", aliases: ["email address", "e-mail"] },
    { key: "relation", label: "Relationship", aliases: ["relationship"], example: "father" },
    { key: "is_primary", label: "Main contact (yes/no)", type: "bool", aliases: ["primary", "main contact", "primary contact"], example: "yes" }
  ] },
  { key: "staff", label: "Staff", matchOn: "staff_no", hint: "Existing staff numbers are updated. Sign-in accounts are created only if you tick the option and the row has an email and a role.", fields: [
    { key: "staff_no", label: "Staff number", required: true, aliases: ["staff id", "employee id", "employee no", "staff number", "file no"], example: "ST-014" },
    { key: "full_name", label: "Full name", required: true, aliases: ["name", "staff name", "employee name"], example: "Mrs Funmi Ade" },
    { key: "email", label: "Email", type: "email", aliases: ["email address", "work email"] },
    { key: "phone", label: "Phone", type: "phone", aliases: ["phone number", "mobile", "gsm"] },
    { key: "department", label: "Department", aliases: ["dept"] },
    { key: "position", label: "Position", aliases: ["job title", "title", "designation"], example: "Mathematics teacher" },
    { key: "employment_type", label: "Employment type", aliases: ["type", "contract type"], example: "full_time" },
    { key: "hire_date", label: "Start date", type: "date", aliases: ["hire date", "date employed", "date of employment", "start date", "resumption date"] },
    { key: "role", label: "Role in the app", aliases: ["app role", "access role", "user role"], example: "teacher" }
  ] },
  { key: "classes", label: "Classes", matchOn: "name", hint: "Existing class names are updated.", fields: [
    { key: "name", label: "Class name", required: true, aliases: ["class", "class name", "arm"], example: "JSS 1 A" },
    { key: "level", label: "Level", aliases: ["year", "grade", "class level"], example: "JSS 1" },
    { key: "section", label: "Section", aliases: ["school section", "division"], example: "Junior Secondary" },
    { key: "form_teacher_email", label: "Form teacher's email", type: "email", aliases: ["form teacher", "class teacher email", "form teacher email"] }
  ] },
  { key: "subjects", label: "Subjects", matchOn: "name", hint: "Existing subject names are updated.", fields: [
    { key: "name", label: "Subject", required: true, aliases: ["subject", "subject name", "course"], example: "Basic Science" },
    { key: "code", label: "Code", aliases: ["subject code", "course code"], example: "BSC" },
    { key: "department", label: "Department", aliases: ["dept"] }
  ] },
  { key: "class_subjects", label: "Who teaches what", matchOn: "class", hint: "Adds each subject to the class and sets its teacher.", fields: [
    { key: "class", label: "Class", required: true, aliases: ["class name", "arm"], example: "JSS 1 A" },
    { key: "subject", label: "Subject", required: true, aliases: ["subject name", "course"], example: "Mathematics" },
    { key: "teacher_email", label: "Teacher's email", type: "email", aliases: ["teacher", "teacher email", "subject teacher"] }
  ] },
  { key: "balances", label: "Opening fee balances", finance: true, matchOn: "admission_no", hint: "Creates one invoice per row for what each student owed in your old system.", fields: [
    { key: "admission_no", label: "Admission number", required: true, aliases: ["adm no", "admission no", "student id", "reg no"], example: "2024/001" },
    { key: "amount", label: "Amount owed", required: true, type: "number", aliases: ["balance", "outstanding", "amount", "arrears", "debt"], example: "45000" },
    { key: "title", label: "Description", aliases: ["description", "item", "narration"], example: "Balance brought forward" },
    { key: "due_date", label: "Due date", type: "date", aliases: ["due", "due date"] }
  ] },
  { key: "alumni", label: "Alumni", matchOn: "email", hint: "Rows with an email already on the list are updated.", fields: [
    { key: "full_name", label: "Full name", required: true, aliases: ["name"], example: "Kemi Lawal" },
    { key: "graduation_year", label: "Year left", type: "int", aliases: ["year", "graduation year", "class of", "set"], example: "2015" },
    { key: "email", label: "Email", type: "email", aliases: ["email address"] },
    { key: "phone", label: "Phone", type: "phone", aliases: ["phone number", "mobile"] },
    { key: "occupation", label: "Job", aliases: ["occupation", "profession", "job title"] },
    { key: "employer", label: "Employer", aliases: ["company", "organisation", "organization"] },
    { key: "city", label: "City", aliases: ["town"] },
    { key: "country", label: "Country" }
  ] },
  { key: "partners", label: "Partners and vendors", finance: true, matchOn: "name", hint: "Existing names are updated.", fields: [
    { key: "name", label: "Name", required: true, aliases: ["company", "vendor", "supplier", "organisation", "organization"], example: "Uniform Co" },
    { key: "kind", label: "Kind", aliases: ["type"], example: "supplier" },
    { key: "category", label: "Category", aliases: ["service", "supplies"], example: "uniforms" },
    { key: "contact_name", label: "Contact person", aliases: ["contact", "contact person"] },
    { key: "email", label: "Email", type: "email" },
    { key: "phone", label: "Phone", type: "phone" }
  ] }
];

export const entity = (key: string) => ENTITIES.find(e => e.key === key) ?? null;

export const norm = (h: string) => h.toLowerCase().replace(/^﻿/, "").replace(/[^a-z0-9]+/g, " ").trim();

/** Which file column feeds each field (index, or -1). Exact key or label first, then aliases. */
export function autoMap(e: Entity, headers: string[]): Record<string, number> {
  const h = headers.map(norm);
  const used = new Set<number>();
  const out: Record<string, number> = {};
  const pick = (names: string[]) => { for (const n of names) { const i = h.findIndex((x, j) => !used.has(j) && x === norm(n)); if (i >= 0) return i; } return -1; };
  for (const f of e.fields) { const i = pick([f.key.replace(/_/g, " "), f.label]); if (i >= 0) { out[f.key] = i; used.add(i); } }
  for (const f of e.fields) { if (out[f.key] !== undefined) continue; const i = pick(f.aliases ?? []); out[f.key] = i; if (i >= 0) used.add(i); }
  return out;
}

/** Dates as typed in schools: 2014-03-21, 21/03/2014, 21-03-2014, 21.03.14, 21 March 2014. Day first. */
export function parseDate(v: string): string | null {
  const s = v.trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})$/);
  if (m) { const y = m[3].length === 2 ? (+m[3] > 50 ? 1900 : 2000) + +m[3] : +m[3]; return valid(y, +m[2], +m[1]); }
  m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,})\.?,?\s+(\d{4})$/);
  if (m) { const mon = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1; return mon ? valid(+m[3], mon, +m[1]) : null; }
  return null;
}
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
function valid(y: number, mo: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d || y < 1900 || y > 2200) return null;
  return dt.toISOString().slice(0, 10);
}

export function parseGender(v: string): "male" | "female" | "other" | null {
  const s = v.trim().toLowerCase();
  if (!s) return null;
  if (/^(m|male|boy|man)$/.test(s)) return "male";
  if (/^(f|female|girl|woman)$/.test(s)) return "female";
  return "other";
}

export function parseBool(v: string): boolean | null {
  const s = v.trim().toLowerCase();
  if (!s) return null;
  if (["yes", "y", "true", "1", "x", "✓"].includes(s)) return true;
  if (["no", "n", "false", "0"].includes(s)) return false;
  return null;
}

/** Amounts as typed: "₦45,000.00", "45 000", "(1,200)" for negative. */
export function parseAmount(v: string): number | null {
  const s = v.trim();
  if (!s) return null;
  const neg = /^\(.*\)$/.test(s) || s.startsWith("-");
  const n = Number(s.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(n) || !/\d/.test(s)) return null;
  return Math.round((neg ? -n : n) * 100) / 100;
}

export type RowResult = { row: number; values: Record<string, string | number | boolean | null>; errors: string[] };

/** Reads one row through the mapping, cleaning and checking every field. `row` is the spreadsheet row number. */
export function readRow(e: Entity, map: Record<string, number>, cells: string[], row: number): RowResult {
  const values: RowResult["values"] = {};
  const errors: string[] = [];
  for (const f of e.fields) {
    const i = map[f.key] ?? -1;
    const raw = (i >= 0 ? cells[i] ?? "" : "").trim().replace(/^'(?=[=+\-@])/, "");
    if (!raw) { values[f.key] = null; if (f.required) errors.push(`${f.label} is missing`); continue; }
    switch (f.type) {
      case "date": { const d = parseDate(raw); if (!d) errors.push(`${f.label}: "${raw}" is not a date`); values[f.key] = d; break; }
      case "email": { const ok = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(raw); if (!ok) errors.push(`${f.label}: "${raw}" is not an email address`); values[f.key] = ok ? raw.toLowerCase() : null; break; }
      case "phone": { const d = raw.replace(/[^\d+]/g, ""); if (d.replace(/\D/g, "").length < 7) errors.push(`${f.label}: "${raw}" is too short for a phone number`); values[f.key] = d || null; break; }
      case "gender": values[f.key] = parseGender(raw); break;
      case "bool": values[f.key] = parseBool(raw); break;
      case "number": { const n = parseAmount(raw); if (n === null) errors.push(`${f.label}: "${raw}" is not a number`); values[f.key] = n; break; }
      case "int": { const n = Number(raw); if (!Number.isInteger(n)) errors.push(`${f.label}: "${raw}" is not a whole number`); values[f.key] = Number.isInteger(n) ? n : null; break; }
      default: values[f.key] = raw.slice(0, 300);
    }
  }
  return { row, values, errors };
}

/** Header row and one example row, for a blank template. */
export function template(e: Entity): { headers: string[]; rows: string[][] } {
  return { headers: e.fields.map(f => f.key), rows: [e.fields.map(f => f.example ?? "")] };
}
