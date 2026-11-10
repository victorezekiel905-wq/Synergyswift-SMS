/**
 * One student's analysis, the arithmetic (pure: no database, unit tested). The same figures
 * are shown to their parents (/parent/analysis) and to the student (/student/analysis);
 * lib/analysis-student-server.ts fetches the rows.
 */
import { pct, countBy } from "./analysis";

const PRESENT = new Set(["present", "late"]);
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const r1 = (n: number) => Math.round(n * 10) / 10;

/** Attendance: the rate, absences and lates, month by month, and which weekdays absences fall on. */
export function attendanceSummary(marks: { date: string; status: string }[]) {
  const months = new Map<string, { marked: number; present: number }>();
  for (const m of marks) {
    const k = m.date.slice(0, 7), v = months.get(k) ?? { marked: 0, present: 0 };
    v.marked++; if (PRESENT.has(m.status)) v.present++;
    months.set(k, v);
  }
  const absent = marks.filter(m => m.status === "absent");
  return {
    days: marks.length,
    rate: pct(marks.filter(m => PRESENT.has(m.status)).length, marks.length),
    absent: absent.length,
    late: marks.filter(m => m.status === "late").length,
    excused: marks.filter(m => m.status === "excused").length,
    by_month: [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, v]) => ({ month, rate: pct(v.present, v.marked) ?? 0, marked: v.marked })),
    absent_weekdays: countBy(absent, m => WEEKDAYS[new Date(`${m.date}T12:00:00Z`).getUTCDay()]).filter(x => x.key !== "Not set")
  };
}

export type CardSubject = { subject_id: string; subject: string; score: number; grade: string | null; class_average: number | null; position: number | null };

/**
 * The subjects on a published report card (only what the school has published is shown to
 * families), highest score first.
 */
export function cardSubjects(data: unknown): CardSubject[] {
  const list = (data as { subjects?: unknown[] } | null)?.subjects;
  if (!Array.isArray(list)) return [];
  return list.flatMap((s: any) => (s && typeof s.subject_id === "string" && s.total !== null && s.total !== undefined && Number.isFinite(Number(s.total)))
    ? [{ subject_id: s.subject_id, subject: String(s.subject ?? "Subject"), score: r1(Number(s.total)), grade: s.grade ?? null,
        class_average: s.class_average === null || s.class_average === undefined ? null : r1(Number(s.class_average)), position: s.position ?? null }]
    : []).sort((a, b) => b.score - a.score || a.subject.localeCompare(b.subject));
}

/** Change per subject from the term before (positive = better). */
export function subjectChanges(now: { subject_id: string; score: number }[], before: { subject_id: string; score: number }[]) {
  const prev = new Map(before.map(b => [b.subject_id, b.score]));
  return now.filter(n => prev.has(n.subject_id)).map(n => ({ subject_id: n.subject_id, change: r1(n.score - prev.get(n.subject_id)!) }));
}

/** Report card averages and positions, term by term (oldest first). */
export function termTrend(cards: { term_id: string; average: number | string | null; position: number | null; class_size: number | null; status: string }[],
  terms: { id: string; name: string; starts_on: string | null }[]) {
  const order = new Map(terms.map((t, i) => [t.id, { i, name: t.name, at: t.starts_on ?? "" }]));
  return cards.filter(c => order.has(c.term_id) && c.average !== null)
    .sort((a, b) => (order.get(a.term_id)!.at || String(order.get(a.term_id)!.i)).localeCompare(order.get(b.term_id)!.at || String(order.get(b.term_id)!.i)))
    .map(c => ({ term_id: c.term_id, term: order.get(c.term_id)!.name, average: r1(Number(c.average)), position: c.position, class_size: c.class_size }));
}

/** Homework: set, handed in, on time, late, missing (past due, nothing handed in), marks, and per subject. */
export function homeworkStats(work: { id: string; due_at: string | null; subject: string | null; max_score: number | string | null }[],
  subs: { homework_id: string; submitted_at: string | null; late: boolean | null; score: number | string | null }[], now = new Date().toISOString()) {
  const mine = new Map<string, (typeof subs)[number]>();
  for (const s of subs) if (s.submitted_at) mine.set(s.homework_id, s);
  let handed = 0, onTime = 0, late = 0, missing = 0, due = 0;
  const marks: number[] = [];
  const bySubject = new Map<string, { set: number; done: number }>();
  for (const w of work) {
    const s = mine.get(w.id), subject = w.subject ?? "Other";
    const b = bySubject.get(subject) ?? { set: 0, done: 0 };
    b.set++;
    if (s) {
      handed++; b.done++;
      if (s.late) late++; else onTime++;
      const max = Number(w.max_score) || 0;
      if (s.score !== null && s.score !== undefined && max > 0) marks.push((Number(s.score) / max) * 100);
    } else if (w.due_at && w.due_at < now) missing++;
    else due++;
    bySubject.set(subject, b);
  }
  const past = work.filter(w => mine.has(w.id) || (w.due_at && w.due_at < now)).length;
  return {
    set: work.length, handed_in: handed, on_time: onTime, late, missing, still_due: due,
    completion: pct(handed, past), average_mark: marks.length ? r1(marks.reduce((a, b) => a + b, 0) / marks.length) : null,
    by_subject: [...bySubject.entries()].map(([key, v]) => ({ key, count: pct(v.done, v.set) ?? 0, set: v.set, done: v.done })).sort((a, b) => a.count - b.count)
  };
}

/** Tests: online exams and practice, as percentages, newest first. */
export function testScores(rows: { title: string; at: string | null; score: number | string | null; max: number | string | null }[]) {
  const list = rows.filter(r => r.at && Number(r.max) > 0 && r.score !== null)
    .map(r => ({ title: r.title, at: r.at!, percent: r1((Number(r.score) / Number(r.max)) * 100) }))
    .sort((a, b) => b.at.localeCompare(a.at));
  return { count: list.length, average: list.length ? r1(list.reduce((a, b) => a + b.percent, 0) / list.length) : null, recent: list.slice(0, 10) };
}

export type ChildNote = { tone: "bad" | "warn" | "good"; text: string; href: string | null };

/**
 * Plain-English points from the figures, worst first, worded for the parent ("Ada's attendance…")
 * or for the student ("Your attendance…").
 */
export function childNotes(a: {
  attendance?: { rate: number | null; absent: number; late: number; absent_weekdays: { key: string; count: number }[] } | null;
  results?: { trend: { average: number }[]; weakest?: { subject: string; score: number } | null; strongest?: { subject: string; score: number } | null; falling?: { subject: string; change: number }[] } | null;
  homework?: { missing: number; completion: number | null; late: number } | null;
  behaviour?: { negative: number; positive: number } | null;
  fees?: { overdue: number } | null;
  library?: { overdue: number } | null;
  lateArrivals?: number | null;
}, who: { forParent: boolean; name: string }): ChildNote[] {
  const out: ChildNote[] = [];
  const subj = who.forParent ? `${who.name}'s` : "Your";
  const they = who.forParent ? who.name : "You";
  const has = who.forParent ? "has" : "have";
  const att = a.attendance;
  if (att && att.rate !== null) {
    if (att.rate < 90) out.push({ tone: "bad", text: `${subj} attendance is ${att.rate}% (${att.absent} day${att.absent === 1 ? "" : "s"} absent). Under 90% makes it hard to keep up.`, href: null });
    else if (att.rate < 95) out.push({ tone: "warn", text: `${subj} attendance is ${att.rate}%. Aim for 95% or more.`, href: null });
    else out.push({ tone: "good", text: `${subj} attendance is ${att.rate}%. Well done.`, href: null });
    const top = att.absent_weekdays[0];
    if (top && top.count >= 3 && att.absent >= 4 && top.count / att.absent >= 0.5) out.push({ tone: "warn", text: `Most absences are on ${top.key}s (${top.count} of ${att.absent}).`, href: null });
    if (att.late >= 5) out.push({ tone: "warn", text: `${they} ${has} been late ${att.late} times.`, href: null });
  }
  const t = a.results?.trend ?? [];
  if (t.length >= 2) {
    const d = r1(t[t.length - 1]!.average - t[t.length - 2]!.average);
    if (d <= -5) out.push({ tone: "bad", text: `${subj} average fell by ${Math.abs(d)} points since last term (${t[t.length - 1]!.average}%).`, href: null });
    else if (d >= 5) out.push({ tone: "good", text: `${subj} average rose by ${d} points since last term (${t[t.length - 1]!.average}%).`, href: null });
  }
  for (const f of (a.results?.falling ?? []).slice(0, 2)) out.push({ tone: "warn", text: `${f.subject} dropped ${Math.abs(f.change)} points since last term.`, href: null });
  if (a.results?.weakest && a.results.weakest.score < 50) out.push({ tone: "warn", text: `${a.results.weakest.subject} needs the most help (${a.results.weakest.score}).`, href: null });
  if (a.results?.strongest) out.push({ tone: "good", text: `Strongest subject: ${a.results.strongest.subject} (${a.results.strongest.score}).`, href: null });
  if (a.homework) {
    if (a.homework.missing > 0) out.push({ tone: a.homework.missing >= 3 ? "bad" : "warn", text: `${a.homework.missing} piece${a.homework.missing === 1 ? "" : "s"} of homework past the due date and not handed in.`, href: null });
    else if (a.homework.completion !== null && a.homework.completion >= 95) out.push({ tone: "good", text: `All homework handed in.`, href: null });
  }
  if (a.behaviour && a.behaviour.negative >= 3 && a.behaviour.negative > a.behaviour.positive) out.push({ tone: "warn", text: `${a.behaviour.negative} behaviour concerns recorded this term, against ${a.behaviour.positive} good marks.`, href: null });
  else if (a.behaviour && a.behaviour.positive >= 5) out.push({ tone: "good", text: `${a.behaviour.positive} good-behaviour marks this term.`, href: null });
  if (a.lateArrivals && a.lateArrivals >= 5) out.push({ tone: "warn", text: `Arrived late at the gate ${a.lateArrivals} times this term.`, href: null });
  if (who.forParent && a.fees && a.fees.overdue > 0) out.push({ tone: "warn", text: `Some school fees are past the due date.`, href: null });
  if (a.library && a.library.overdue > 0) out.push({ tone: "warn", text: `${a.library.overdue} library book${a.library.overdue === 1 ? " is" : "s are"} overdue.`, href: null });
  const order = { bad: 0, warn: 1, good: 2 };
  return out.sort((x, y) => order[x.tone] - order[y.tone]);
}
