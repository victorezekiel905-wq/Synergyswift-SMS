/**
 * Portal and dashboard rules: a student's or teacher's day, homework status,
 * a family's fees, a teacher's to-do list, and the head's key numbers with
 * trends and targets. Pure and unit tested.
 */
import { localParts, type Mark } from "./attendance";

// ---------------- the day ----------------

export type PeriodRow = { id: string; name: string; starts_at: string; ends_at: string; position: number; is_break: boolean };
export type LessonRow = {
  id: string; period_id: string; subject: string | null; class_name: string | null; class_group_id?: string | null;
  teacher: string | null; room: string | null; cover?: boolean; register_taken?: boolean;
};
export type SlotState = "done" | "now" | "next" | "later";
export type Slot = { period: PeriodRow; lesson: LessonRow | null; state: SlotState };

/** "08:30" or "08:30:00" as minutes after midnight. */
export const minutesOf = (t: string) => { const [h, m] = t.split(":").map(Number); return (h || 0) * 60 + (m || 0); };

/**
 * Each period of the day with its lesson (if any) and whether it is over, on
 * now, the next lesson, or later.
 */
export function dayPlan(periods: PeriodRow[], lessons: LessonRow[], nowMinutes: number): Slot[] {
  const byPeriod = new Map<string, LessonRow>();
  for (const l of lessons) if (!byPeriod.has(l.period_id)) byPeriod.set(l.period_id, l);
  let nextGiven = false;
  return [...periods].sort((a, b) => a.position - b.position || minutesOf(a.starts_at) - minutesOf(b.starts_at)).map(p => {
    const lesson = p.is_break ? null : byPeriod.get(p.id) ?? null;
    const start = minutesOf(p.starts_at), end = minutesOf(p.ends_at);
    let state: SlotState = "later";
    if (end <= nowMinutes) state = "done";
    else if (start <= nowMinutes) state = "now";
    else if (lesson && !nextGiven) { state = "next"; nextGiven = true; }
    if (state === "now" && lesson) nextGiven = true;
    return { period: p, lesson, state };
  });
}

// ---------------- homework ----------------

export type HomeworkRow = { id: string; title: string; subject: string | null; due_at: string; allow_late?: boolean; max_score?: number | null };
export type SubmissionRow = { homework_id: string; submitted_at: string; late?: boolean; score?: number | null; marked_at?: string | null; feedback?: string | null };
export type HomeworkState = "overdue" | "due_today" | "due" | "submitted" | "marked";
export type HomeworkItem = HomeworkRow & { state: HomeworkState; score: number | null; feedback: string | null };

const STATE_ORDER: Record<HomeworkState, number> = { overdue: 0, due_today: 1, due: 2, submitted: 3, marked: 4 };

/** A student's homework, most pressing first: overdue, due today, due later, then handed in and marked. */
export function homeworkStatus(hw: HomeworkRow[], subs: SubmissionRow[], now: Date, timeZone: string): HomeworkItem[] {
  const mine = new Map(subs.map(s => [s.homework_id, s]));
  const today = localParts(now, timeZone).date;
  return hw.map(h => {
    const s = mine.get(h.id);
    let state: HomeworkState;
    if (s?.marked_at || (s && s.score !== null && s.score !== undefined)) state = "marked";
    else if (s) state = "submitted";
    else if (new Date(h.due_at) < now) state = "overdue";
    else if (localParts(new Date(h.due_at), timeZone).date === today) state = "due_today";
    else state = "due";
    return { ...h, state, score: s?.score ?? null, feedback: s?.feedback ?? null };
  }).sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state]
    || (a.state === "marked" || a.state === "submitted" ? b.due_at.localeCompare(a.due_at) : a.due_at.localeCompare(b.due_at)));
}

// ---------------- fees ----------------

export type InvoiceRow = { total: number | string; amount_paid: number | string; status: string; due_date: string | null };
export type FeeSummary = { billed: number; paid: number; owed: number; overdue: number; next_due: string | null; invoices: number };

const n = (v: number | string | null | undefined) => Number(v ?? 0) || 0;
const r2 = (v: number) => Math.round(v * 100) / 100;

/** What has been billed and paid, what is still owed, how much of it is past due, and the next due date. Void invoices do not count. */
export function feeSummary(invoices: InvoiceRow[], today: string): FeeSummary {
  let billed = 0, paid = 0, owed = 0, overdue = 0, next: string | null = null, count = 0;
  for (const i of invoices) {
    if (i.status === "void") continue;
    count++;
    billed += n(i.total); paid += n(i.amount_paid);
    const bal = Math.max(0, n(i.total) - n(i.amount_paid));
    owed += bal;
    if (bal > 0 && i.due_date) {
      if (i.due_date < today) overdue += bal;
      else if (!next || i.due_date < next) next = i.due_date;
    }
  }
  return { billed: r2(billed), paid: r2(paid), owed: r2(owed), overdue: r2(overdue), next_due: next, invoices: count };
}

// ---------------- numbers ----------------

/** part / whole as a percentage to one decimal place, or null when there is nothing to divide by. */
export function rate(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;
}

/** Attendance rate from marks: present and late count as attended. */
export function attendanceRate(marks: { status: Mark }[]): number | null {
  return rate(marks.filter(m => m.status === "present" || m.status === "late").length, marks.length);
}

export type Point = { day: string; value: number | null };
export type Trend = { latest: number | null; previous: number | null; change: number | null; direction: "up" | "down" | "flat" | null };

/**
 * The latest value against the one about a week before (or the earliest there
 * is), ignoring days with no figure. Changes under 0.5 count as flat.
 */
export function trend(series: Point[], lookbackDays = 7): Trend {
  const pts = series.filter(p => p.value !== null && Number.isFinite(p.value)).sort((a, b) => a.day.localeCompare(b.day)) as { day: string; value: number }[];
  if (!pts.length) return { latest: null, previous: null, change: null, direction: null };
  const last = pts[pts.length - 1];
  if (pts.length === 1) return { latest: last.value, previous: null, change: null, direction: null };
  const cutoff = new Date(`${last.day}T12:00:00Z`); cutoff.setUTCDate(cutoff.getUTCDate() - lookbackDays);
  const c = cutoff.toISOString().slice(0, 10);
  const before = pts.slice(0, -1);
  const prev = [...before].reverse().find(p => p.day <= c) ?? before[0];
  const change = Math.round((last.value - prev.value) * 10) / 10;
  return { latest: last.value, previous: prev.value, change, direction: Math.abs(change) < 0.5 ? "flat" : change > 0 ? "up" : "down" };
}

/** An SVG path for a small line chart; gaps where there is no figure. */
export function sparkline(values: (number | null)[], width = 120, height = 32, pad = 2): string {
  const nums = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (!nums.length) return "";
  const min = Math.min(...nums), max = Math.max(...nums);
  const span = max - min || 1;
  const step = values.length > 1 ? (width - pad * 2) / (values.length - 1) : 0;
  let d = "", pen = false;
  values.forEach((v, i) => {
    if (v === null || !Number.isFinite(v)) { pen = false; return; }
    const x = Math.round((pad + i * step) * 10) / 10;
    const y = Math.round((height - pad - ((v - min) / span) * (height - pad * 2)) * 10) / 10;
    d += `${pen ? "L" : "M"}${x} ${y} `;
    pen = true;
  });
  return d.trim();
}

/** Colour for a figure against the school's target: met, within 5 points, or short. */
export function targetTone(value: number | null, target: number | null | undefined, higherIsBetter = true): "good" | "warn" | "bad" | undefined {
  if (value === null || target === null || target === undefined || !Number.isFinite(target)) return undefined;
  const gap = higherIsBetter ? value - target : target - value;
  if (gap >= 0) return "good";
  return gap >= -5 ? "warn" : "bad";
}

// ---------------- the head's numbers ----------------

export type KpiInput = {
  students: number; staff: number; staffOnLeave: number;
  classes: number; classesMarked: number; marksToday: { status: Mark }[];
  billed: number; paid: number; overdueInvoices: number; overdueAmount: number;
  libraryOverdue: number; lowStock: number; incidentsWeek: number; applicationsOpen: number; admittedThisTerm: number;
};
export type Kpis = {
  students: number; staff: number; staff_on_leave: number;
  attendance_rate: number | null; registers_taken: number | null; absent_today: number;
  billed: number; paid: number; outstanding: number; collection_rate: number | null; overdue_invoices: number; overdue_amount: number;
  library_overdue: number; low_stock: number; incidents_week: number; applications_open: number; admitted_this_term: number;
};

/** The figures shown on the head's dashboard and kept each day for trends. */
export function kpis(i: KpiInput): Kpis {
  return {
    students: i.students, staff: i.staff, staff_on_leave: i.staffOnLeave,
    attendance_rate: attendanceRate(i.marksToday),
    registers_taken: rate(Math.min(i.classesMarked, i.classes), i.classes),
    absent_today: i.marksToday.filter(m => m.status === "absent").length,
    billed: r2(i.billed), paid: r2(i.paid), outstanding: r2(Math.max(0, i.billed - i.paid)),
    collection_rate: rate(i.paid, i.billed), overdue_invoices: i.overdueInvoices, overdue_amount: r2(i.overdueAmount),
    library_overdue: i.libraryOverdue, low_stock: i.lowStock, incidents_week: i.incidentsWeek,
    applications_open: i.applicationsOpen, admitted_this_term: i.admittedThisTerm
  };
}

/** Targets the school may set, and whether a higher figure is better. */
export const KPI_TARGETS: { key: keyof Kpis; label: string; higherIsBetter: boolean }[] = [
  { key: "attendance_rate", label: "Attendance today (%)", higherIsBetter: true },
  { key: "registers_taken", label: "Registers taken (%)", higherIsBetter: true },
  { key: "collection_rate", label: "Fees collected this term (%)", higherIsBetter: true },
  { key: "incidents_week", label: "Behaviour incidents this week", higherIsBetter: false },
  { key: "library_overdue", label: "Overdue library books", higherIsBetter: false }
];

/** Keeps only known targets with sensible numbers. */
export function cleanTargets(raw: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of KPI_TARGETS) {
    const v = raw[t.key];
    if (v === null || v === undefined || v === "") continue;
    const num = Number(v);
    if (Number.isFinite(num) && num >= 0 && num <= 100000) out[t.key] = num;
  }
  return out;
}

// ---------------- a teacher's to-do list ----------------

export type TeacherTask = { kind: "register" | "marking" | "scores" | "notes" | "messages"; label: string; count: number; href: string; urgent: boolean };

/**
 * What a teacher should do next: registers for lessons that have started,
 * homework waiting to be marked (urgent after a week), score sheets to finish
 * or fix, lesson notes sent back, and unread parent messages.
 */
export function teacherTasks(p: {
  slots: Slot[]; toMark: number; oldestUnmarkedDays: number;
  sheets: { status: string }[]; notesReturned: number; unread: number;
}): TeacherTask[] {
  const tasks: TeacherTask[] = [];
  const registers = p.slots.filter(s => s.lesson && (s.state === "done" || s.state === "now") && !s.lesson.register_taken).length;
  if (registers) tasks.push({ kind: "register", label: registers === 1 ? "Take the register for a lesson" : `Take registers for ${registers} lessons`, count: registers, href: "/school/attendance?tab=lessons", urgent: true });
  const returned = p.sheets.filter(s => s.status === "returned").length;
  if (returned) tasks.push({ kind: "scores", label: `Fix ${returned} score sheet${returned === 1 ? "" : "s"} sent back`, count: returned, href: "/school/results", urgent: true });
  if (p.toMark) tasks.push({ kind: "marking", label: `Mark ${p.toMark} homework submission${p.toMark === 1 ? "" : "s"}`, count: p.toMark, href: "/school/homework", urgent: p.oldestUnmarkedDays > 7 });
  const drafts = p.sheets.filter(s => s.status === "draft").length;
  if (drafts) tasks.push({ kind: "scores", label: `Finish and submit ${drafts} score sheet${drafts === 1 ? "" : "s"}`, count: drafts, href: "/school/results", urgent: false });
  if (p.notesReturned) tasks.push({ kind: "notes", label: `Revise ${p.notesReturned} lesson note${p.notesReturned === 1 ? "" : "s"} sent back`, count: p.notesReturned, href: "/school/lesson-notes", urgent: false });
  if (p.unread) tasks.push({ kind: "messages", label: `Reply to ${p.unread} unread parent message${p.unread === 1 ? "" : "s"}`, count: p.unread, href: "/school/inbox", urgent: false });
  return tasks.sort((a, b) => Number(b.urgent) - Number(a.urgent));
}

// ---------------- a child at a glance (for families) ----------------

export type ChildGlance = { attendance_rate: number | null; absences: number; late: number; homework_overdue: number; homework_due_week: number; owed: number; overdue: number };

export function childGlance(p: { marks: { status: Mark }[]; homework: HomeworkItem[]; fees: FeeSummary | null; now: Date }): ChildGlance {
  const week = p.now.getTime() + 7 * 86400_000;
  return {
    attendance_rate: attendanceRate(p.marks),
    absences: p.marks.filter(m => m.status === "absent").length,
    late: p.marks.filter(m => m.status === "late").length,
    homework_overdue: p.homework.filter(h => h.state === "overdue").length,
    homework_due_week: p.homework.filter(h => (h.state === "due" || h.state === "due_today") && new Date(h.due_at).getTime() <= week).length,
    owed: p.fees?.owed ?? 0,
    overdue: p.fees?.overdue ?? 0
  };
}
