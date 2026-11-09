/**
 * The analysis dashboard's arithmetic (pure: no database, unit tested).
 * The route (src/app/api/school/analysis) fetches; these turn rows into figures.
 */

/** A percentage to one decimal place, or null when there is nothing to divide by. */
export function pct(part: number, whole: number): number | null {
  if (!whole || !Number.isFinite(part) || !Number.isFinite(whole)) return null;
  return Math.round((part / whole) * 1000) / 10;
}

/** The calendar day (YYYY-MM-DD) a moment falls on in the school's time zone. */
export function dayIn(at: string | Date, timezone: string): string {
  const d = typeof at === "string" ? new Date(at) : at;
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** The last n days ending today (oldest first), as YYYY-MM-DD. */
export function lastDays(today: string, n: number): string[] {
  const end = Date.parse(`${today}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) => new Date(end - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10));
}

/** The last n months ending with this one (oldest first), as YYYY-MM. */
export function lastMonths(today: string, n: number): string[] {
  const [y, m] = today.split("-").map(Number) as [number, number];
  return Array.from({ length: n }, (_, i) => {
    const k = (y * 12 + (m - 1)) - (n - 1 - i);
    return `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, "0")}`;
  });
}

const PRESENT = new Set(["present", "late"]);

/** Attendance per day: of the marks taken that day, the share present (late counts as present). */
export function attendanceByDay(marks: { date: string; status: string }[], days: string[]) {
  const by = new Map<string, { marked: number; present: number }>();
  for (const m of marks) {
    const d = by.get(m.date) ?? { marked: 0, present: 0 };
    d.marked++; if (PRESENT.has(m.status)) d.present++;
    by.set(m.date, d);
  }
  return days.map(date => { const d = by.get(date); return { date, marked: d?.marked ?? 0, rate: d ? pct(d.present, d.marked) : null }; });
}

/** Overall attendance for a set of marks. */
export function attendanceRate(marks: { status: string }[]): number | null {
  return pct(marks.filter(m => PRESENT.has(m.status)).length, marks.length);
}

/** Money per month (school time zone), for the months asked. */
export function sumByMonth(rows: { at: string | null; amount: number | string | null }[], months: string[], timezone: string) {
  const by = new Map<string, number>(months.map(m => [m, 0]));
  for (const r of rows) {
    if (!r.at) continue;
    const m = dayIn(r.at, timezone).slice(0, 7);
    if (by.has(m)) by.set(m, by.get(m)! + (Number(r.amount) || 0));
  }
  return months.map(month => ({ month, amount: Math.round(by.get(month)! * 100) / 100 }));
}

/** How many rows have each value of a field, most first. */
export function countBy<T>(rows: T[], key: (r: T) => string | null | undefined): { key: string; count: number }[] {
  const by = new Map<string, number>();
  for (const r of rows) { const k = key(r) || "Not set"; by.set(k, (by.get(k) ?? 0) + 1); }
  return [...by.entries()].map(([k, count]) => ({ key: k, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

/** Fees for a set of invoices (voided ones left out). */
export function feeSummary(invoices: { total: number | string | null; amount_paid: number | string | null; status: string; due_date: string | null }[], today: string) {
  let billed = 0, paid = 0, overdue = 0, overdueAmount = 0;
  for (const i of invoices) {
    if (i.status === "void") continue;
    const t = Number(i.total) || 0, p = Math.min(Number(i.amount_paid) || 0, t);
    billed += t; paid += p;
    if (t - p > 0.005 && i.due_date && i.due_date < today) { overdue++; overdueAmount += t - p; }
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return { billed: r2(billed), collected: r2(paid), outstanding: r2(billed - paid), rate: pct(paid, billed), overdue_invoices: overdue, overdue_amount: r2(overdueAmount) };
}

/** Plain-English things worth the head's attention, from the figures. Most important first. */
export function highlights(a: {
  attendance_today: number | null; attendance_30: number | null; fee_rate: number | null; overdue_invoices: number;
  high_risk?: number; open_tickets?: number; overdue_books?: number; unpublished_cards?: number; leads_waiting?: number;
}): { tone: "bad" | "warn" | "good"; text: string; href: string }[] {
  const out: { tone: "bad" | "warn" | "good"; text: string; href: string }[] = [];
  if (a.attendance_today !== null && a.attendance_today < 85) out.push({ tone: "bad", text: `Only ${a.attendance_today}% of students marked present today.`, href: "/school/attendance" });
  else if (a.attendance_30 !== null && a.attendance_30 < 90) out.push({ tone: "warn", text: `Attendance over 30 days is ${a.attendance_30}% (aim for 90% or more).`, href: "/school/attendance" });
  if (a.fee_rate !== null && a.fee_rate < 60) out.push({ tone: "bad", text: `${a.fee_rate}% of this term's fees collected.`, href: "/school/fees" });
  if (a.overdue_invoices > 0) out.push({ tone: "warn", text: `${a.overdue_invoices} invoice${a.overdue_invoices === 1 ? " is" : "s are"} past the due date.`, href: "/school/fees" });
  if (a.high_risk) out.push({ tone: "warn", text: `${a.high_risk} student${a.high_risk === 1 ? "" : "s"} flagged as high risk.`, href: "/school/analytics" });
  if (a.unpublished_cards) out.push({ tone: "warn", text: `${a.unpublished_cards} report card${a.unpublished_cards === 1 ? "" : "s"} not yet published this term.`, href: "/school/results/report-cards" });
  if (a.open_tickets) out.push({ tone: "warn", text: `${a.open_tickets} parent request${a.open_tickets === 1 ? "" : "s"} still open.`, href: "/school/community" });
  if (a.leads_waiting) out.push({ tone: "warn", text: `${a.leads_waiting} admissions enquir${a.leads_waiting === 1 ? "y has" : "ies have"} no follow-up booked.`, href: "/school/admissions" });
  if (a.overdue_books) out.push({ tone: "warn", text: `${a.overdue_books} library book${a.overdue_books === 1 ? " is" : "s are"} overdue.`, href: "/school/library" });
  if (!out.length) out.push({ tone: "good", text: "Nothing needs your attention right now.", href: "/school" });
  return out;
}
