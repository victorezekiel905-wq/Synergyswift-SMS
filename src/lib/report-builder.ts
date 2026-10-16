/**
 * The custom report builder: the datasets people may report on (and who may
 * use each), the columns in each, and how a saved report's filters, grouping,
 * totals and sort are applied. Also when a scheduled report next goes out.
 * Pure and unit tested; rows are loaded by report-builder-server.ts.
 */
import { localParts, zonedToUtc, addDays, weekday } from "./attendance";

export type ColType = "text" | "number" | "money" | "date" | "bool";
export type Column = { key: string; label: string; type: ColType };
export type Dataset = { id: string; label: string; description: string; roles: string[]; params: ("term" | "dates" | "class")[]; columns: Column[]; defaults: string[] };

const ADMIN = ["school_admin", "principal", "platform_admin"];
const ACADEMIC = [...ADMIN, "teacher", "qa_officer", "it_admin"];
const FINANCE = [...ADMIN, "bursar"];
const c = (key: string, label: string, type: ColType = "text"): Column => ({ key, label, type });

export const DATASETS: Dataset[] = [
  { id: "students", label: "Students", description: "One row per student on roll", roles: [...ACADEMIC, "admissions_officer", "bursar", "counsellor"], params: ["class"],
    columns: [c("admission_no", "Admission no."), c("name", "Name"), c("gender", "Sex"), c("date_of_birth", "Date of birth", "date"), c("age", "Age", "number"),
      c("class", "Class"), c("level", "Year group"), c("house", "House"), c("admitted_on", "Admitted", "date"), c("fee_category", "Fee category"), c("status", "Status"),
      c("guardian", "First guardian"), c("guardian_phone", "Guardian phone")],
    defaults: ["admission_no", "name", "class", "gender"] },
  { id: "attendance", label: "Attendance", description: "Morning register totals per student between two dates", roles: [...ACADEMIC, "counsellor"], params: ["dates", "class"],
    columns: [c("name", "Name"), c("admission_no", "Admission no."), c("class", "Class"), c("level", "Year group"), c("gender", "Sex"), c("days", "Days marked", "number"),
      c("present", "Present", "number"), c("late", "Late", "number"), c("absent", "Absent", "number"), c("excused", "Excused", "number"), c("rate", "Attendance %", "number")],
    defaults: ["name", "class", "days", "absent", "rate"] },
  { id: "results", label: "Results by subject", description: "One row per student per subject for a term", roles: ACADEMIC, params: ["term", "class"],
    columns: [c("name", "Name"), c("admission_no", "Admission no."), c("class", "Class"), c("level", "Year group"), c("gender", "Sex"), c("subject", "Subject"),
      c("total", "Score", "number"), c("grade", "Grade"), c("passed", "Passed", "bool"), c("position", "Subject position", "number")],
    defaults: ["name", "class", "subject", "total", "grade"] },
  { id: "report_cards", label: "Report cards", description: "One row per student's term report card", roles: ACADEMIC, params: ["term", "class"],
    columns: [c("name", "Name"), c("admission_no", "Admission no."), c("class", "Class"), c("level", "Year group"), c("gender", "Sex"), c("average", "Average", "number"),
      c("position", "Position", "number"), c("class_size", "Class size", "number"), c("subjects_passed", "Subjects passed", "number"), c("status", "Status")],
    defaults: ["name", "class", "average", "position", "status"] },
  { id: "invoices", label: "Fee invoices", description: "One row per invoice", roles: FINANCE, params: ["term", "class", "dates"],
    columns: [c("invoice_no", "Invoice no."), c("name", "Student"), c("admission_no", "Admission no."), c("class", "Class"), c("title", "Title"),
      c("total", "Billed", "money"), c("paid", "Paid", "money"), c("balance", "Balance", "money"), c("status", "Status"), c("due_date", "Due", "date"), c("created", "Issued", "date")],
    defaults: ["invoice_no", "name", "class", "total", "paid", "balance", "status"] },
  { id: "payments", label: "Payments received", description: "One row per successful payment", roles: FINANCE, params: ["dates", "class"],
    columns: [c("receipt_no", "Receipt no."), c("date", "Date", "date"), c("month", "Month"), c("name", "Student"), c("class", "Class"), c("amount", "Amount", "money"),
      c("method", "Method"), c("provider", "Provider"), c("reference", "Reference"), c("payer", "Paid by")],
    defaults: ["date", "receipt_no", "name", "amount", "method"] },
  { id: "applications", label: "Admissions applications", description: "One row per application", roles: [...ADMIN, "admissions_officer"], params: ["dates"],
    columns: [c("application_no", "Application no."), c("name", "Applicant"), c("applying_for", "Applying for"), c("status", "Status"), c("source", "Source"),
      c("month", "Month"), c("created", "Applied", "date"), c("guardian", "Parent"), c("guardian_phone", "Parent phone"), c("guardian_email", "Parent email"), c("fee_paid", "Form fee paid", "bool")],
    defaults: ["application_no", "name", "applying_for", "status", "source"] },
  { id: "staff", label: "Staff", description: "One row per member of staff", roles: [...ADMIN, "hr_manager"], params: [],
    columns: [c("staff_no", "Staff no."), c("name", "Name"), c("department", "Department"), c("position", "Position"), c("employment_type", "Employment"),
      c("gender", "Sex"), c("hire_date", "Started", "date"), c("status", "Status"), c("email", "Email"), c("phone", "Phone")],
    defaults: ["staff_no", "name", "department", "position", "status"] },
  { id: "library_loans", label: "Library loans", description: "One row per book lent between two dates", roles: [...ADMIN, "librarian"], params: ["dates"],
    columns: [c("title", "Book"), c("borrower", "Borrower"), c("class", "Class"), c("issued", "Lent", "date"), c("due", "Due", "date"), c("returned", "Returned", "date"),
      c("overdue_days", "Days overdue", "number"), c("fine", "Fine", "money")],
    defaults: ["title", "borrower", "class", "due", "returned", "overdue_days"] },
  { id: "behaviour", label: "Behaviour incidents", description: "One row per student involved in an incident between two dates", roles: [...ADMIN, "teacher", "counsellor"], params: ["dates", "class"],
    columns: [c("date", "Date", "date"), c("name", "Student"), c("class", "Class"), c("category", "Category"), c("severity", "Severity"), c("role", "Involvement"), c("status", "Status"), c("location", "Where")],
    defaults: ["date", "name", "class", "category", "severity"] }
];

export const datasetById = (id: string) => DATASETS.find(d => d.id === id) ?? null;
export const canUse = (d: Dataset, roles: Iterable<string>) => [...roles].some(r => d.roles.includes(r));

export type Op = "eq" | "neq" | "contains" | "gt" | "gte" | "lt" | "lte" | "empty" | "not_empty";
export type Agg = "count" | "sum" | "avg" | "min" | "max";
export type Spec = {
  columns: string[];
  filters?: { column: string; op: Op; value?: string | number | boolean | null }[];
  params?: { term_id?: string | null; from?: string | null; to?: string | null; class_group_id?: string | null };
  group_by?: string | null;
  aggregates?: { column: string; fn: Agg }[];
  sort?: { column: string; dir: "asc" | "desc" } | null;
  limit?: number | null;
};

export const OPS: { id: Op; label: string; needsValue: boolean }[] = [
  { id: "eq", label: "is", needsValue: true }, { id: "neq", label: "is not", needsValue: true }, { id: "contains", label: "contains", needsValue: true },
  { id: "gt", label: "more than", needsValue: true }, { id: "gte", label: "at least", needsValue: true }, { id: "lt", label: "less than", needsValue: true },
  { id: "lte", label: "at most", needsValue: true }, { id: "empty", label: "is blank", needsValue: false }, { id: "not_empty", label: "is not blank", needsValue: false }
];

/** Problems with a report's settings for its dataset (empty when it can run). */
export function validateSpec(d: Dataset, s: Spec): string[] {
  const keys = new Set(d.columns.map(x => x.key));
  const errs: string[] = [];
  if (!Array.isArray(s.columns) || !s.columns.length) errs.push("choose at least one column");
  for (const k of s.columns ?? []) if (!keys.has(k)) errs.push(`unknown column ${k}`);
  for (const f of s.filters ?? []) {
    if (!keys.has(f.column)) errs.push(`unknown filter column ${f.column}`);
    const op = OPS.find(o => o.id === f.op);
    if (!op) errs.push(`unknown filter ${f.op}`);
    else if (op.needsValue && (f.value === undefined || f.value === null || f.value === "")) errs.push(`give a value for the ${f.column} filter`);
  }
  if (s.group_by && !keys.has(s.group_by)) errs.push(`unknown group ${s.group_by}`);
  for (const a of s.aggregates ?? []) {
    if (!["count", "sum", "avg", "min", "max"].includes(a.fn)) errs.push(`unknown total ${a.fn}`);
    if (a.fn !== "count" && !keys.has(a.column)) errs.push(`unknown total column ${a.column}`);
    const col = d.columns.find(x => x.key === a.column);
    if (["sum", "avg"].includes(a.fn) && col && !["number", "money"].includes(col.type)) errs.push(`${col.label} cannot be added up`);
  }
  if (s.sort && !keys.has(s.sort.column) && !(s.group_by && (s.sort.column === s.group_by || (s.aggregates ?? []).some(a => aggKey(a) === s.sort!.column)))) errs.push(`unknown sort ${s.sort.column}`);
  if (s.limit !== undefined && s.limit !== null && (!Number.isInteger(s.limit) || s.limit < 1 || s.limit > 20000)) errs.push("limit must be between 1 and 20000");
  return errs;
}

const isBlank = (v: unknown) => v === null || v === undefined || v === "";
const cmp = (a: unknown, b: unknown) => {
  if (typeof a === "number" && typeof b === "number") return a - b;
  const na = Number(a), nb = Number(b);
  if (a !== "" && b !== "" && Number.isFinite(na) && Number.isFinite(nb) && typeof a !== "boolean") return na - nb;
  return String(a ?? "").localeCompare(String(b ?? ""), undefined, { numeric: true, sensitivity: "base" });
};

export function matches(row: Record<string, unknown>, f: NonNullable<Spec["filters"]>[number]): boolean {
  const v = row[f.column];
  switch (f.op) {
    case "empty": return isBlank(v);
    case "not_empty": return !isBlank(v);
    case "contains": return String(v ?? "").toLowerCase().includes(String(f.value ?? "").toLowerCase());
    case "eq": return typeof v === "boolean" ? v === (f.value === true || f.value === "true" || f.value === "yes") : !isBlank(v) && cmp(v, f.value) === 0;
    case "neq": return typeof v === "boolean" ? v !== (f.value === true || f.value === "true" || f.value === "yes") : isBlank(v) || cmp(v, f.value) !== 0;
    case "gt": return !isBlank(v) && cmp(v, f.value) > 0;
    case "gte": return !isBlank(v) && cmp(v, f.value) >= 0;
    case "lt": return !isBlank(v) && cmp(v, f.value) < 0;
    case "lte": return !isBlank(v) && cmp(v, f.value) <= 0;
  }
}

export const aggKey = (a: { column: string; fn: Agg }) => (a.fn === "count" ? "count" : `${a.fn}_${a.column}`);
const AGG_LABEL: Record<Agg, string> = { count: "Number", sum: "Total", avg: "Average", min: "Lowest", max: "Highest" };

export type Output = { columns: Column[]; rows: (string | number | boolean | null)[][]; total_rows: number; truncated: boolean };

/** Applies filters, then either groups with totals or picks the columns; then sorts and limits. */
export function runSpec(d: Dataset, s: Spec, rows: Record<string, unknown>[]): Output {
  const byKey = new Map(d.columns.map(x => [x.key, x]));
  let data = rows.filter(r => (s.filters ?? []).every(f => matches(r, f)));
  let columns: Column[], out: (string | number | boolean | null)[][];
  if (s.group_by) {
    const g = byKey.get(s.group_by)!;
    const aggs = s.aggregates?.length ? s.aggregates : [{ column: "", fn: "count" as Agg }];
    const groups = new Map<string, Record<string, unknown>[]>();
    for (const r of data) { const k = String(r[s.group_by] ?? ""); groups.set(k, [...(groups.get(k) ?? []), r]); }
    columns = [g, ...aggs.map(a => ({ key: aggKey(a), label: a.fn === "count" ? "Number" : `${AGG_LABEL[a.fn]} ${byKey.get(a.column)?.label.toLowerCase() ?? ""}`.trim(),
      type: (a.fn === "count" ? "number" : byKey.get(a.column)?.type === "money" ? "money" : byKey.get(a.column)?.type === "date" ? "date" : "number") as ColType }))];
    out = [...groups.entries()].map(([k, rs]) => [k || "(blank)", ...aggs.map(a => aggregate(rs, a))]);
    data = [];
  } else {
    columns = s.columns.map(k => byKey.get(k)!);
    out = data.map(r => s.columns.map(k => (r[k] ?? null) as string | number | boolean | null));
  }
  if (s.sort) {
    const i = columns.findIndex(x => x.key === s.sort!.column);
    if (i >= 0) out.sort((a, b) => isBlank(a[i]) ? (isBlank(b[i]) ? 0 : 1) : isBlank(b[i]) ? -1 : (s.sort!.dir === "desc" ? -1 : 1) * cmp(a[i], b[i]));
  }
  const total = out.length, limit = s.limit ?? 20000;
  return { columns, rows: out.slice(0, limit), total_rows: total, truncated: total > limit };
}

function aggregate(rows: Record<string, unknown>[], a: { column: string; fn: Agg }): number | string | null {
  if (a.fn === "count") return rows.length;
  const vals = rows.map(r => r[a.column]).filter(v => !isBlank(v));
  if (!vals.length) return null;
  if (a.fn === "min" || a.fn === "max") {
    const s = [...vals].sort(cmp);
    return (a.fn === "min" ? s[0] : s[s.length - 1]) as number | string;
  }
  const nums = vals.map(Number).filter(Number.isFinite);
  if (!nums.length) return null;
  const sum = nums.reduce((x, y) => x + y, 0);
  return Math.round((a.fn === "sum" ? sum : sum / nums.length) * 100) / 100;
}

/** Spreadsheet rows: headings, then values (yes/no for true/false). */
export function outputRows(o: Output): (string | number)[][] {
  return [o.columns.map(x => x.label), ...o.rows.map(r => r.map(v => (v === true ? "yes" : v === false ? "no" : v ?? "")))];
}

export type Schedule = { schedule: "none" | "daily" | "weekly" | "monthly"; schedule_day?: number | null; schedule_hour: number };

/**
 * The next time a scheduled report goes out after `after`, at the chosen hour
 * in the school's time zone: every day, on a weekday (1 = Monday), or on a day
 * of the month (1–28). Null when not scheduled.
 */
export function nextRun(s: Schedule, after: Date, timeZone: string): Date | null {
  if (s.schedule === "none") return null;
  const hh = String(s.schedule_hour).padStart(2, "0");
  const start = localParts(after, timeZone).date;
  for (let i = 0; i < 62; i++) {
    const day = addDays(start, i);
    const ok = s.schedule === "daily" || (s.schedule === "weekly" && weekday(day) === s.schedule_day) || (s.schedule === "monthly" && Number(day.slice(8, 10)) === s.schedule_day);
    if (!ok) continue;
    const at = zonedToUtc(`${day}T${hh}:00`, timeZone);
    if (at && at > after) return at;
  }
  return null;
}
