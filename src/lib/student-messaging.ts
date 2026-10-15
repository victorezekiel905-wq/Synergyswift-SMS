/**
 * Teacher-student messaging under safeguarding rules, and alerts to the
 * school's safeguarding leads (admins, the principal, counsellors) when a
 * message in any thread needs looking at.
 *
 * Rules: the school switches student messaging on; staff write only to
 * students they teach (form or subject teacher) or as a counsellor or admin,
 * and only on school days within the school's hours; students write only to
 * those staff; no attachments; nothing is edited or deleted; every message is
 * readable by safeguarding leads and (if the school allows) the parents.
 */
import { staffRows, enqueue, tryDispatch, formatInZone } from "./messaging/outbox";
import { safeguardingFlags, withinMessagingHours } from "./communication";
import { teachersOfStudent } from "./conversations";
import { studentName } from "./school";

export class ThreadError extends Error { constructor(message: string, public status = 400) { super(message); } }

/** Tells the safeguarding leads that a message was flagged. */
export async function alertLeads(svc: any, p: { tenantId: string; where: string; reasons: string[]; url: string; refId: string }) {
  const { data: users } = await svc.from("users").select("id,role,extra_roles").eq("tenant_id", p.tenantId).eq("active", true);
  const ids = (users ?? []).filter((u: any) => [u.role, ...(u.extra_roles ?? [])].some((r: string) => ["school_admin", "principal", "counsellor"].includes(r))).map((u: any) => u.id);
  const rows = await staffRows(svc, { tenantId: p.tenantId, userIds: ids, kind: "safeguarding_flag", refId: p.refId, subject: `Message to review: ${p.where}`,
    text: `A message in ${p.where} mentioned ${p.reasons.join(" and ")}. Please read it today.`, url: p.url });
  if (rows.length) { await enqueue(svc, rows); await tryDispatch(svc, { budgetMs: 3000 }); }
}

export async function messagingSettings(svc: any, tenantId: string) {
  const { data } = await svc.from("tenant_settings").select("student_messaging,student_messaging_from,student_messaging_to,student_messaging_parents_see,school_weekdays").eq("tenant_id", tenantId).maybeSingle();
  return { enabled: Boolean(data?.student_messaging), from: String(data?.student_messaging_from ?? "07:00").slice(0, 5), to: String(data?.student_messaging_to ?? "18:00").slice(0, 5),
    parentsSee: data?.student_messaging_parents_see !== false, weekdays: (data?.school_weekdays ?? [1, 2, 3, 4, 5]) as number[] };
}

type Who = { tenantId: string; timezone: string; userId: string; name: string; isStaff: boolean; isLead: boolean };

async function staffMayWrite(svc: any, who: Who, studentId: string) {
  if (who.isLead) return true;
  return (await teachersOfStudent(svc, who.tenantId, studentId)).some((t: { id: string }) => t.id === who.userId);
}

async function checkStaffTime(svc: any, who: Who) {
  if (!who.isStaff) return;
  const s = await messagingSettings(svc, who.tenantId);
  if (!withinMessagingHours(new Date(), who.timezone, s.from, s.to, s.weekdays)) throw new ThreadError(`staff can message students on school days between ${s.from} and ${s.to}`, 403);
}

export async function startThread(svc: any, who: Who, p: { studentId: string; staffUserId?: string | null; subject: string; body: string; baseUrl: string }) {
  const s = await messagingSettings(svc, who.tenantId);
  if (!s.enabled) throw new ThreadError("student messaging is switched off for this school", 403);
  let studentId = p.studentId, staffId = who.userId;
  if (who.isStaff) {
    if (!(await staffMayWrite(svc, who, studentId))) throw new ThreadError("you can message only students you teach", 403);
    await checkStaffTime(svc, who);
  } else {
    const { data: me } = await svc.from("students").select("id").eq("tenant_id", who.tenantId).eq("user_id", who.userId).eq("status", "active").maybeSingle();
    if (!me) throw new ThreadError("only students can do this", 403);
    studentId = me.id;
    if (!p.staffUserId || !(await teachersOfStudent(svc, who.tenantId, studentId)).some((t: { id: string }) => t.id === p.staffUserId)) throw new ThreadError("you can message your own teachers only", 403);
    staffId = p.staffUserId;
  }
  const { data: t, error } = await svc.from("student_threads").insert({ tenant_id: who.tenantId, student_id: studentId, staff_user_id: staffId, subject: p.subject }).select("id").single();
  if (error) throw new ThreadError(error.message);
  await postToThread(svc, who, { threadId: t.id, body: p.body, baseUrl: p.baseUrl });
  return { id: t.id };
}

export async function postToThread(svc: any, who: Who, p: { threadId: string; body: string; baseUrl: string }) {
  const { data: t } = await svc.from("student_threads").select("id,tenant_id,student_id,staff_user_id,subject,status,student_unread,staff_unread,students(user_id,first_name,last_name,other_names)")
    .eq("tenant_id", who.tenantId).eq("id", p.threadId).maybeSingle();
  if (!t) throw new ThreadError("conversation not found", 404);
  const isStudent = t.students?.user_id === who.userId;
  const isTeacher = t.staff_user_id === who.userId;
  if (!isStudent && !isTeacher) throw new ThreadError("only the student and the teacher in this conversation can write in it", 403);
  if (t.status === "closed") throw new ThreadError("this conversation is closed");
  const s = await messagingSettings(svc, who.tenantId);
  if (!s.enabled) throw new ThreadError("student messaging is switched off for this school", 403);
  if (isTeacher) await checkStaffTime(svc, who);
  if (isStudent) {
    const { count } = await svc.from("student_thread_messages").select("id", { count: "exact", head: true }).eq("sender_user_id", who.userId).gte("created_at", new Date(Date.now() - 3600_000).toISOString());
    if ((count ?? 0) >= 20) throw new ThreadError("too many messages in the last hour; please try again later", 429);
  }
  const reasons = safeguardingFlags(p.body);
  const { data: m, error } = await svc.from("student_thread_messages").insert({ tenant_id: who.tenantId, thread_id: t.id, sender_kind: isTeacher ? "staff" : "student", sender_user_id: who.userId,
    body: p.body, flagged: reasons.length > 0, flag_reason: reasons.join("; ") || null }).select("id,created_at").single();
  if (error) throw new ThreadError(error.message);
  await svc.from("student_threads").update(isTeacher ? { student_unread: t.student_unread + 1, last_message_at: m.created_at } : { staff_unread: t.staff_unread + 1, last_message_at: m.created_at }).eq("id", t.id);
  try {
    const sname = studentName(t.students);
    if (reasons.length) await alertLeads(svc, { tenantId: who.tenantId, where: `a conversation between ${isTeacher ? who.name : sname} and ${isTeacher ? sname : "a teacher"}`, reasons, refId: m.id,
      url: `${p.baseUrl}/school/messaging-safety?thread=${t.id}` });
    const to = isTeacher ? t.students?.user_id : t.staff_user_id;
    if (to) {
      const rows = await staffRows(svc, { tenantId: who.tenantId, userIds: [to], kind: "student_message", refId: t.id, subject: `${who.name}: ${t.subject}`,
        text: p.body.slice(0, 200), url: `${p.baseUrl}${isTeacher ? "/student/messages" : "/school/student-messages"}?t=${t.id}` });
      // Students get app notifications only, never emails with message text.
      if (rows.length) await enqueue(svc, isTeacher ? rows.filter(r => r.channel === "push") : rows);
      await tryDispatch(svc, { budgetMs: 3000 });
    }
  } catch (e) { console.error("student message notification deferred:", (e as Error).message); }
  return { id: m.id, flagged: reasons.length > 0 };
}

export { formatInZone };
