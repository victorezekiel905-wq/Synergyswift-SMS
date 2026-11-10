/**
 * Staff analysis and the school's activity, the arithmetic (pure: no database, unit tested).
 * lib/analysis-staff-server.ts fetches the rows.
 */
import { pct } from "./analysis";

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * For each class and subject a teacher teaches: how many students have marks this term, the
 * average total (a subject's parts added up), and how many are below the pass mark.
 */
export function classSubjectAverages(scores: { student_id: string; subject_id: string; score: number | string | null }[],
  classOf: Map<string, string>, pairs: { class_group_id: string; subject_id: string }[], passMark = 40) {
  const totals = new Map<string, number>();       // class:subject:student -> total
  const wanted = new Set(pairs.map(p => `${p.class_group_id}:${p.subject_id}`));
  for (const s of scores) {
    const cls = classOf.get(s.student_id);
    if (!cls || s.score === null || s.score === undefined) continue;
    const pair = `${cls}:${s.subject_id}`;
    if (!wanted.has(pair)) continue;
    const k = `${pair}:${s.student_id}`;
    totals.set(k, (totals.get(k) ?? 0) + (Number(s.score) || 0));
  }
  return pairs.map(p => {
    const prefix = `${p.class_group_id}:${p.subject_id}:`;
    const list = [...totals.entries()].filter(([k]) => k.startsWith(prefix)).map(([, v]) => v);
    return { ...p, students: list.length, average: list.length ? r1(list.reduce((a, b) => a + b, 0) / list.length) : null, below_pass: list.filter(v => v < passMark).length };
  });
}

/** Students in a teacher's classes who need help: low attendance, or low marks in the teacher's subjects. Worst first. */
export function studentsNeedingHelp(students: { id: string; name: string; class_name: string | null }[],
  attendance: Map<string, { marked: number; present: number }>, lowMarks: Map<string, string[]>, limit = 12) {
  const out: { id: string; name: string; class_name: string | null; reasons: string[]; weight: number }[] = [];
  for (const s of students) {
    const reasons: string[] = [];
    let weight = 0;
    const a = attendance.get(s.id);
    const rate = a && a.marked >= 5 ? pct(a.present, a.marked) : null;
    if (rate !== null && rate < 90) { reasons.push(`attendance ${rate}%`); weight += (90 - rate) / 5 + 1; }
    const low = lowMarks.get(s.id) ?? [];
    if (low.length) { reasons.push(`low marks in ${low.join(", ")}`); weight += low.length * 2; }
    if (reasons.length) out.push({ ...s, reasons, weight });
  }
  return out.sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name)).slice(0, limit);
}

/** The part of the school an action in the change history belongs to ("fees.payment_recorded" → Fees). */
const AREAS: [RegExp, string][] = [
  [/^(fee|fees|invoice|payment|wallet|shop|ledger|expense|budget|payroll)/, "Money"],
  [/^(result|score|report|grading|transcript|exam|question|cbt|entrance)/, "Results & exams"],
  [/^(attendance|register|gate|pickup|visitor|transport|bus|hostel|exeat|clock)/, "Attendance & safety"],
  [/^(homework|lesson|scheme|learning|lms|live|forum|classroom|content|path)/, "Teaching & learning"],
  [/^(student|guardian|parent|sims|admission|application|lead|alumni|class|account)/, "Students & families"],
  [/^(staff|hr|leave|recruit|appraisal|cpd|qa)/, "Staff & HR"],
  [/^(notice|message|broadcast|inbox|conversation|event|meeting|conference|ticket|community|survey)/, "Communication"],
  [/^(behaviour|health|sickbay|sen|pastoral|safeguard|wellbeing|counsel)/, "Welfare"],
  [/^(library|book|inventory|asset|requisition|purchase)/, "Library & stock"],
  [/^(settings|security|role|module|subscription|integration|branding|consent|data|import|export|recycle)/, "Settings & data"]
];
export function areaOf(action: string): string {
  const a = action.toLowerCase();
  for (const [re, name] of AREAS) if (re.test(a)) return name;
  return "Other";
}

/**
 * The school's activity from its change history: actions per area, per role of the person who
 * did them, per day, and how many different people were active.
 */
export function activitySummary(logs: { action: string; actor_id: string | null; ts: string }[], roleOf: Map<string, string>, days: string[], dayOf: (ts: string) => string) {
  const byArea = new Map<string, number>(), byRole = new Map<string, number>(), byDay = new Map<string, number>(days.map(d => [d, 0]));
  const people = new Set<string>();
  for (const l of logs) {
    byArea.set(areaOf(l.action), (byArea.get(areaOf(l.action)) ?? 0) + 1);
    const role = l.actor_id ? (roleOf.get(l.actor_id) ?? "other").replace(/_/g, " ") : "system";
    byRole.set(role, (byRole.get(role) ?? 0) + 1);
    const d = dayOf(l.ts);
    if (byDay.has(d)) byDay.set(d, byDay.get(d)! + 1);
    if (l.actor_id) people.add(l.actor_id);
  }
  const sorted = (m: Map<string, number>) => [...m.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  return { actions: logs.length, people: people.size, by_area: sorted(byArea), by_role: sorted(byRole), by_day: days.map(d => ({ date: d, count: byDay.get(d) ?? 0 })) };
}
