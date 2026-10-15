/** Homework rules shared by the student, staff and family routes. */
import { overlap, styleShift } from "./lms";
import { fetchAll } from "./results";

/** Homework a student can see: their class's, unless it is set for groups they are not in. */
export async function homeworkForStudent(svc: any, tenantId: string, student: { id: string; class_group_id: string | null }) {
  if (!student.class_group_id) return [];
  const [{ data: hw }, { data: groups }] = await Promise.all([
    svc.from("homework").select("id,title,instructions,attachment_url,due_at,max_score,allow_late,allow_resubmit,max_attempts,accept_files,late_penalty_pct,late_penalty_max,group_ids,subjects(name)")
      .eq("tenant_id", tenantId).eq("class_group_id", student.class_group_id).order("due_at", { ascending: false }).limit(100),
    svc.from("learning_group_members").select("group_id").eq("student_id", student.id)
  ]);
  const mine = new Set((groups ?? []).map((g: any) => g.group_id));
  return (hw ?? []).filter((h: any) => !h.group_ids?.length || h.group_ids.some((g: string) => mine.has(g)));
}


/**
 * Compares an answer with classmates' answers to the same homework (shared
 * passages) and with the student's own earlier work (change of style). The
 * result helps a teacher decide whether to talk to a student; it proves nothing.
 */
export async function checkOriginality(svc: any, p: { tenantId: string; submissionId: string; homeworkId: string; studentId: string; body: string; subjectId: string | null }) {
  if ((p.body.match(/\S+/g) ?? []).length < 25) return null;
  const others = await fetchAll<any>(() => svc.from("homework_submissions").select("id,student_id,body").eq("homework_id", p.homeworkId).neq("student_id", p.studentId).order("id"));
  const matches = others.filter(o => o.body).map(o => ({ student_id: o.student_id, ...overlap(p.body, o.body) }))
    .filter(m => m.share >= 0.15).sort((a, b) => b.share - a.share).slice(0, 5);
  // The student's own earlier written work in the same subject, newest first.
  let q = svc.from("homework_submissions").select("body,homework!inner(subject_id)").eq("tenant_id", p.tenantId).eq("student_id", p.studentId).neq("homework_id", p.homeworkId)
    .order("submitted_at", { ascending: false }).limit(12);
  if (p.subjectId) q = q.eq("homework.subject_id", p.subjectId);
  const { data: mine } = await q;
  const style = styleShift(p.body, (mine ?? []).map((m: any) => m.body ?? "").filter(Boolean));
  const result = { similarity: matches[0]?.share ?? 0, matches, style, checked_at: new Date().toISOString() };
  await svc.from("homework_submissions").update({ originality: result }).eq("id", p.submissionId);
  return result;
}
