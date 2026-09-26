/**
 * Two-way messaging between parents and staff.
 *
 *  - Parents write from the portal (signed in or through their private link),
 *    so no app or phone number is exposed on either side.
 *  - Teachers can only message families of students they teach; admins can
 *    message any family and can read every thread (safeguarding).
 *  - Messages are permanent: there is no edit or delete.
 *  - Each side reads in their own language when the parent chose one.
 *
 * All writes use the service role after the caller has been authorised here.
 */
import { aiConfigured, translateTexts } from "./ai";
import { needsTranslation } from "./languages";
import { enqueue, tryDispatch, loadBrand, rowsForGuardian, staffRows, type Guardian } from "./messaging/outbox";
import { newMessage } from "./messaging/notices";
import { studentName } from "./school";

export class MessagingError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

const GUARDIAN_HOURLY_LIMIT = 30;

/** Staff a parent may write to about a child: the form teacher and subject teachers. */
export async function teachersOfStudent(svc: any, tenantId: string, studentId: string) {
  const { data: s } = await svc.from("students").select("class_group_id,class_groups(form_teacher_id)").eq("tenant_id", tenantId).eq("id", studentId).maybeSingle();
  if (!s?.class_group_id) return [];
  const { data: offers } = await svc.from("subject_offerings").select("teacher_id,subjects(name)").eq("tenant_id", tenantId).eq("class_group_id", s.class_group_id).not("teacher_id", "is", null);
  const ids = new Set<string>((offers ?? []).map((o: any) => o.teacher_id));
  if (s.class_groups?.form_teacher_id) ids.add(s.class_groups.form_teacher_id);
  if (!ids.size) return [];
  const { data: users } = await svc.from("users").select("id,full_name").eq("tenant_id", tenantId).eq("active", true).in("id", [...ids]);
  return (users ?? []).map((u: any) => ({
    id: u.id, name: u.full_name,
    role: u.id === s.class_groups?.form_teacher_id ? "Form teacher"
      : (offers ?? []).filter((o: any) => o.teacher_id === u.id).map((o: any) => o.subjects?.name).filter(Boolean).join(", ") || "Teacher"
  }));
}

async function teaches(svc: any, tenantId: string, userId: string, studentId: string) {
  return (await teachersOfStudent(svc, tenantId, studentId)).some((t: { id: string }) => t.id === userId);
}

async function languages(svc: any, tenantId: string, guardianId: string) {
  const [{ data: s }, { data: g }] = await Promise.all([
    svc.from("tenant_settings").select("default_language").eq("tenant_id", tenantId).maybeSingle(),
    svc.from("guardians").select("language").eq("id", guardianId).maybeSingle()
  ]);
  return { school: s?.default_language ?? "en", guardian: g?.language ?? null };
}

async function translateFor(body: string, from: string | null, to: string | null) {
  if (!to || !aiConfigured()) return null;
  try { const [t] = await translateTexts({ texts: [body], target: to, source: from }); return t !== body ? t : null; }
  catch { return null; }
}

type Sender = { kind: "staff"; userId: string; name: string } | { kind: "guardian"; guardianId: string; name: string };

/** Adds a message, translates it for the reader, bumps unread counts and notifies the other side. */
export async function postMessage(svc: any, p: { tenantId: string; conversationId: string; sender: Sender; body: string; baseUrl: string }) {
  const { data: c } = await svc.from("conversations").select("id,tenant_id,guardian_id,student_id,staff_user_id,subject,status,staff_unread,guardian_unread")
    .eq("tenant_id", p.tenantId).eq("id", p.conversationId).maybeSingle();
  if (!c) throw new MessagingError("conversation not found", 404);
  if (c.status === "closed") throw new MessagingError("this conversation is closed; please start a new one");
  if (p.sender.kind === "guardian") {
    if (c.guardian_id !== p.sender.guardianId) throw new MessagingError("conversation not found", 404);
    const since = new Date(Date.now() - 3600_000).toISOString();
    const { count } = await svc.from("conversation_messages").select("id", { count: "exact", head: true })
      .eq("tenant_id", p.tenantId).eq("sender_kind", "guardian").gte("created_at", since)
      .in("conversation_id", (await svc.from("conversations").select("id").eq("guardian_id", c.guardian_id)).data?.map((x: { id: string }) => x.id) ?? []);
    if ((count ?? 0) >= GUARDIAN_HOURLY_LIMIT) throw new MessagingError("too many messages in the last hour; please try again later", 429);
  }

  const lang = await languages(svc, p.tenantId, c.guardian_id);
  const translate = needsTranslation(lang.guardian, lang.school);
  const translated = !translate ? null : p.sender.kind === "staff"
    ? await translateFor(p.body, lang.school, lang.guardian)
    : await translateFor(p.body, lang.guardian, lang.school);
  const { data: msg, error } = await svc.from("conversation_messages").insert({
    tenant_id: p.tenantId, conversation_id: c.id, sender_kind: p.sender.kind,
    sender_user_id: p.sender.kind === "staff" ? p.sender.userId : null, sender_name: p.sender.name, body: p.body,
    translated_body: translated, source_lang: translated ? (p.sender.kind === "staff" ? lang.school : lang.guardian) : null,
    target_lang: translated ? (p.sender.kind === "staff" ? lang.guardian : lang.school) : null
  }).select("id,created_at").single();
  if (error) throw new MessagingError(error.message);
  await svc.from("conversations").update(p.sender.kind === "staff"
    ? { guardian_unread: c.guardian_unread + 1, last_message_at: msg.created_at }
    : { staff_unread: c.staff_unread + 1, last_message_at: msg.created_at }).eq("id", c.id);

  // Tell the other side. Failures here never lose the message itself.
  try {
    if (p.sender.kind === "staff") {
      const { data: g } = await svc.from("guardians")
        .select("id,user_id,full_name,email,phone,whatsapp_phone,notify_email,notify_whatsapp,notify_sms,portal_token,language,push_subscriptions(id)")
        .eq("id", c.guardian_id).maybeSingle();
      if (g) {
        const brand = await loadBrand(svc, p.tenantId);
        const link = g.user_id ? `${p.baseUrl}/parent#messages` : `${p.baseUrl}/g/${g.portal_token}#messages`;
        await enqueue(svc, rowsForGuardian(p.tenantId, g as Guardian, "message", newMessage(brand, {
          guardianName: g.full_name, from: p.sender.name, subject: c.subject, text: translated ?? p.body, link
        }), c.id, p.sender.userId));
      }
    } else {
      let to: string[] = c.staff_user_id ? [c.staff_user_id] : [];
      if (!to.length) {
        const { data: admins } = await svc.from("users").select("id").eq("tenant_id", p.tenantId).eq("active", true).in("role", ["school_admin", "principal"]).limit(10);
        to = (admins ?? []).map((a: { id: string }) => a.id);
      }
      const rows = await staffRows(svc, { tenantId: p.tenantId, userIds: to, kind: "message", refId: c.id,
        subject: `${p.sender.name}: ${c.subject}`, text: translated ?? p.body, url: `${p.baseUrl}/school/inbox?c=${c.id}` });
      if (rows.length) await enqueue(svc, rows);
    }
    await tryDispatch(svc, { budgetMs: 4000 });
  } catch (e) { console.error("message notification deferred:", (e as Error).message); }
  return { id: msg.id, translated: Boolean(translated) };
}

/** Staff start a thread with a family. Teachers only for students they teach. */
export async function startFromStaff(svc: any, p: { tenantId: string; staff: { userId: string; name: string; isAdmin: boolean }; guardianId: string; studentId: string; subject: string; body: string; baseUrl: string }) {
  const { data: link } = await svc.from("student_guardians").select("student_id").eq("tenant_id", p.tenantId).eq("guardian_id", p.guardianId).eq("student_id", p.studentId).maybeSingle();
  if (!link) throw new MessagingError("that parent is not linked to this student");
  if (!p.staff.isAdmin && !(await teaches(svc, p.tenantId, p.staff.userId, p.studentId))) throw new MessagingError("you can only message families of students you teach", 403);
  const { data: c, error } = await svc.from("conversations").insert({
    tenant_id: p.tenantId, guardian_id: p.guardianId, student_id: p.studentId, staff_user_id: p.staff.userId, subject: p.subject, started_by: "staff"
  }).select("id").single();
  if (error) throw new MessagingError(error.message);
  await postMessage(svc, { tenantId: p.tenantId, conversationId: c.id, sender: { kind: "staff", userId: p.staff.userId, name: p.staff.name }, body: p.body, baseUrl: p.baseUrl });
  return { id: c.id };
}

/** A parent starts a thread with one of their child's teachers, or the school office (staffUserId null). */
export async function startFromGuardian(svc: any, p: { tenantId: string; guardianId: string; guardianName: string; studentId: string; staffUserId: string | null; subject: string; body: string; baseUrl: string }) {
  const { data: link } = await svc.from("student_guardians").select("student_id").eq("tenant_id", p.tenantId).eq("guardian_id", p.guardianId).eq("student_id", p.studentId).maybeSingle();
  if (!link) throw new MessagingError("you are not linked to this student", 403);
  if (p.staffUserId && !(await teaches(svc, p.tenantId, p.staffUserId, p.studentId))) throw new MessagingError("please choose one of your child's teachers or the school office");
  const { count } = await svc.from("conversations").select("id", { count: "exact", head: true }).eq("guardian_id", p.guardianId).gte("created_at", new Date(Date.now() - 86400_000).toISOString());
  if ((count ?? 0) >= 10) throw new MessagingError("you have started many conversations today; please continue an existing one", 429);
  const { data: c, error } = await svc.from("conversations").insert({
    tenant_id: p.tenantId, guardian_id: p.guardianId, student_id: p.studentId, staff_user_id: p.staffUserId, subject: p.subject, started_by: "guardian"
  }).select("id").single();
  if (error) throw new MessagingError(error.message);
  await postMessage(svc, { tenantId: p.tenantId, conversationId: c.id, sender: { kind: "guardian", guardianId: p.guardianId, name: p.guardianName }, body: p.body, baseUrl: p.baseUrl });
  return { id: c.id };
}

/** The parent's threads (most recent first) and, when asked, one thread's messages, marked read. */
export async function guardianInbox(svc: any, tenantId: string, guardianId: string, conversationId?: string | null) {
  const { data: list } = await svc.from("conversations")
    .select("id,subject,status,guardian_unread,last_message_at,student_id,staff_user_id,students(first_name,last_name,other_names),users!conversations_staff_user_id_fkey(full_name)")
    .eq("tenant_id", tenantId).eq("guardian_id", guardianId).order("last_message_at", { ascending: false }).limit(50);
  const threads = (list ?? []).map((c: any) => ({
    id: c.id, subject: c.subject, status: c.status, unread: c.guardian_unread, last_message_at: c.last_message_at, student_id: c.student_id,
    student: studentName(c.students), with: c.users?.full_name ?? "School office"
  }));
  let messages: unknown[] = [];
  if (conversationId && threads.some((t: { id: string }) => t.id === conversationId)) {
    const { data } = await svc.from("conversation_messages").select("id,sender_kind,sender_name,body,translated_body,created_at")
      .eq("conversation_id", conversationId).order("created_at").limit(500);
    // Parents read the translated version of staff messages; their own messages as written.
    messages = (data ?? []).map((m: any) => ({ id: m.id, mine: m.sender_kind === "guardian", sender: m.sender_name,
      text: m.sender_kind === "staff" ? (m.translated_body ?? m.body) : m.body, original: m.sender_kind === "staff" && m.translated_body ? m.body : null, at: m.created_at }));
    await svc.from("conversations").update({ guardian_unread: 0 }).eq("id", conversationId);
  }
  return { threads, messages };
}
