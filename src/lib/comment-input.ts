/**
 * Turns a compiled report card (and last term's) into the facts a report
 * comment is written from (phase 14p). Pure, so it can be tested: first name,
 * pronoun, subjects, change since last term, attendance, character ratings,
 * effort. No surname, contact details or other personal data.
 */
import type { CommentInput } from "./assist";

type Subject = { subject_id?: string; subject: string; total: number | null; grade?: string | null; effort?: string | null; comment?: string | null };
export type CardForComment = {
  id: string; student_id: string; average: number | string | null; position: number | null; class_size: number | null;
  teacher_comment?: string | null; principal_comment?: string | null; status: string;
  data: {
    student_name?: string; subjects?: Subject[]; scheme?: { pass_mark?: number; show_position?: boolean };
    days_present?: number | null; days_opened?: number | null; traits?: { domain?: string; name: string; rating: number | null }[];
  } | null;
};
type PrevCard = { average: number | string | null; data: { subjects?: Subject[] } | null } | null;

const num = (v: number | string | null | undefined) => (v === null || v === undefined || v === "" ? null : Number(v));

export function commentInputFor(c: CardForComment, prev: PrevCard, gender: string | null, role: "form_teacher" | "principal"): CommentInput {
  const pass = c.data?.scheme?.pass_mark ?? 40;
  const subs = (c.data?.subjects ?? []).filter(s => s.total !== null).sort((a, b) => (b.total ?? 0) - (a.total ?? 0));
  const avg = num(c.average);
  const before = num(prev?.average ?? null);

  // Subjects that rose or fell by 8+ marks since last term, biggest first.
  const was = new Map((prev?.data?.subjects ?? []).filter(s => s.total !== null).map(s => [s.subject_id ?? s.subject, Number(s.total)]));
  const movers = subs
    .map(s => ({ s, d: was.has(s.subject_id ?? s.subject) ? Number(s.total) - was.get(s.subject_id ?? s.subject)! : 0 }))
    .filter(x => Math.abs(x.d) >= 8)
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))
    .slice(0, 3)
    .map(x => `${x.s.subject} ${x.d > 0 ? "+" : ""}${Math.round(x.d)}`);

  const present = c.data?.days_present ?? null, opened = c.data?.days_opened ?? null;
  const rated = (c.data?.traits ?? []).filter(t => t.rating !== null) as { name: string; rating: number }[];
  // The ratings worth a word: the best and the weakest, not the whole list.
  const traits = [...rated].sort((a, b) => b.rating - a.rating);
  const notable = traits.length > 4 ? [...traits.slice(0, 2), ...traits.slice(-2)] : traits;
  const effort = subs.filter(s => s.effort).slice(0, 4).map(s => `${s.subject}: effort ${s.effort}`);

  return {
    student_id: c.student_id,
    first_name: String(c.data?.student_name ?? "The student").trim().split(/\s+/)[0],
    gender: gender === "male" || gender === "female" ? gender : null,
    average: avg,
    position: c.data?.scheme?.show_position ? c.position : null,
    class_size: c.class_size ?? 0,
    strongest: subs.slice(0, 2).map(s => `${s.subject} (${s.total}${s.grade ? `, ${s.grade}` : ""})`),
    weakest: subs.slice(-2).reverse().filter(s => (s.total ?? 0) < pass + 15).map(s => `${s.subject} (${s.total}${s.grade ? `, ${s.grade}` : ""})`),
    attendance_rate: present !== null && opened ? Math.round((present / opened) * 100) : null,
    trend: before === null || avg === null ? "new" : avg - before >= 3 ? "up" : before - avg >= 3 ? "down" : "steady",
    previous_average: before,
    movers,
    traits: notable.map(t => `${t.name} ${t.rating}/5`),
    effort,
    teacher_comment: role === "principal" ? c.teacher_comment ?? null : null
  };
}
