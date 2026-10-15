/**
 * Sending announcements, circulars and emergency alerts: working out who
 * receives them, writing each family's copy (their children's names, their
 * language), sending on the chosen channels and recording read receipts.
 */
import { guardiansByStudent, rowsForGuardian, staffRows, enqueue, tryDispatch, loadBrand, type OutboxRow, type Guardian } from "./messaging/outbox";
import { communityNote } from "./messaging/notices";
import { normalizePhone, smsText } from "./messaging/providers";
import { assistConfigured, translateTexts } from "./assist";
import { needsTranslation } from "./languages";
import { fillTemplate, joinNames } from "./communication";
import { ROLES } from "./auth";

export type Audience = { scope: "school" | "sections" | "classes" | "people"; ids?: string[]; students?: string[]; guardians?: string[]; staff?: string[] };
export type Notice = { id: string; tenant_id: string; kind: "announcement" | "circular" | "emergency"; title: string; body: string; audience: Audience;
  to_parents: boolean; to_students: boolean; to_staff: boolean; staff_roles: string[]; requires_ack: boolean; channels: string[]; translate: boolean; created_by: string | null };

/** The students a notice is about (for families and students). */
async function audienceStudents(svc: any, tid: string, a: Audience) {
  let q = svc.from("students").select("id,first_name,user_id,class_group_id,class_groups(name,section_id)").eq("tenant_id", tid).eq("status", "active").limit(20000);
  if (a.scope === "classes") q = q.in("class_group_id", a.ids?.length ? a.ids : ["00000000-0000-0000-0000-000000000000"]);
  if (a.scope === "people") q = q.in("id", a.students?.length ? a.students : ["00000000-0000-0000-0000-000000000000"]);
  const { data } = await q;
  let list = (data ?? []) as { id: string; first_name: string; user_id: string | null; class_group_id: string | null; class_groups: { name: string; section_id: string | null } | null }[];
  if (a.scope === "sections") list = list.filter(s => s.class_groups?.section_id && (a.ids ?? []).includes(s.class_groups.section_id));
  return list;
}

/** Everyone a notice goes to: families, students and staff, with each family's children. */
export async function resolveRecipients(svc: any, n: Notice) {
  const tid = n.tenant_id;
  const students = n.to_parents || n.to_students ? await audienceStudents(svc, tid, n.audience) : [];
  const families = new Map<string, { guardian: Guardian; studentIds: string[] }>();
  if (n.to_parents) {
    const by = await guardiansByStudent(svc, tid, students.map(s => s.id));
    by.forEach((gs, sid) => gs.forEach(g => {
      const f = families.get(g.id) ?? { guardian: g, studentIds: [] };
      f.studentIds.push(sid);
      families.set(g.id, f);
    }));
    if (n.audience.scope === "people" && n.audience.guardians?.length) {
      const { data: extra } = await svc.from("guardians").select("id").eq("tenant_id", tid).in("id", n.audience.guardians);
      const { data: links } = extra?.length ? await svc.from("student_guardians").select("guardian_id,student_id").eq("tenant_id", tid).in("guardian_id", extra.map((g: any) => g.id)) : { data: [] };
      const kids: string[] = [...new Set<string>((links ?? []).map((l: any) => l.student_id as string))];
      const by2 = await guardiansByStudent(svc, tid, kids);
      by2.forEach((gs, sid) => gs.filter(g => n.audience.guardians!.includes(g.id)).forEach(g => {
        const f = families.get(g.id) ?? { guardian: g, studentIds: [] };
        if (!f.studentIds.includes(sid)) f.studentIds.push(sid);
        families.set(g.id, f);
      }));
    }
  }
  const studentUsers = n.to_students ? students.filter(s => s.user_id).map(s => ({ user_id: s.user_id!, student_id: s.id })) : [];
  let staff: string[] = [];
  if (n.to_staff) {
    const { data: users } = await svc.from("users").select("id,role,extra_roles,active").eq("tenant_id", tid).eq("active", true);
    const roles = n.staff_roles.length ? n.staff_roles : ROLES.staff;
    staff = (users ?? []).filter((u: any) => [u.role, ...(u.extra_roles ?? [])].some((r: string) => (roles as readonly string[]).includes(r))).map((u: any) => u.id);
    if (n.audience.scope === "people") staff = staff.filter(id => (n.audience.staff ?? []).includes(id));
  }
  return { students, families, studentUsers, staff };
}

/** Sends a notice now. Safe to call twice: people already sent to are skipped. */
export async function sendNotice(svc: any, n: Notice, baseUrl: string) {
  const tid = n.tenant_id;
  const emergency = n.kind === "emergency";
  const { students, families, studentUsers, staff } = await resolveRecipients(svc, n);
  const firstName = new Map(students.map(s => [s.id, s.first_name]));
  const className = new Map(students.map(s => [s.id, s.class_groups?.name ?? ""]));

  // Receipts first, so links work as soon as a message arrives.
  const rows = [
    ...[...families.values()].map(f => ({ tenant_id: tid, notice_id: n.id, recipient_kind: "guardian", guardian_id: f.guardian.id, user_id: f.guardian.user_id ?? null, student_ids: f.studentIds })),
    ...studentUsers.map(s => ({ tenant_id: tid, notice_id: n.id, recipient_kind: "student", user_id: s.user_id, student_ids: [s.student_id] })),
    ...staff.map(u => ({ tenant_id: tid, notice_id: n.id, recipient_kind: "staff", user_id: u, student_ids: [] }))
  ];
  for (let i = 0; i < rows.length; i += 500) {
    const part = rows.slice(i, i + 500);
    await svc.from("notice_recipients").upsert(part.filter(r => r.recipient_kind === "guardian"), { onConflict: "notice_id,guardian_id", ignoreDuplicates: true });
    await svc.from("notice_recipients").upsert(part.filter(r => r.recipient_kind !== "guardian"), { onConflict: "notice_id,user_id", ignoreDuplicates: true });
  }
  const { data: receipts } = await svc.from("notice_recipients").select("id,recipient_kind,guardian_id,user_id,read_token,delivered_at").eq("notice_id", n.id).limit(50000);
  const todo = (receipts ?? []).filter((r: any) => !r.delivered_at);
  const brand = await loadBrand(svc, tid);

  // One translation per language.
  const { data: settings } = await svc.from("tenant_settings").select("default_language").eq("tenant_id", tid).maybeSingle();
  const schoolLang = settings?.default_language ?? "en";
  const versions = new Map<string, { title: string; body: string }>();
  if (n.translate && assistConfigured()) {
    const langs = [...new Set([...families.values()].map(f => f.guardian.language).filter(l => needsTranslation(l, schoolLang)))].slice(0, 12) as string[];
    await Promise.all(langs.map(async lang => {
      try { const [title, body] = await translateTexts({ texts: [n.title, n.body], target: lang, source: schoolLang }); versions.set(lang, { title, body }); } catch { /* original text */ }
    }));
  }
  const channels = emergency ? ["email", "whatsapp", "sms", "push"] : n.channels;
  const out: OutboxRow[] = [];
  const delivered: string[] = [];
  const link = (token: string) => `${baseUrl}/n/${token}`;
  const action = n.requires_ack || emergency ? (emergency ? "Tap to confirm you received this" : "Read and confirm") : "Read online";
  for (const r of todo) {
    if (r.recipient_kind === "guardian") {
      const f = families.get(r.guardian_id);
      if (!f) continue;
      const v = (f.guardian.language && versions.get(f.guardian.language)) || { title: n.title, body: n.body };
      const vars = { parent_name: f.guardian.full_name, child_name: firstName.get(f.studentIds[0]), child_names: joinNames(f.studentIds.map(id => firstName.get(id) ?? "")),
        class: className.get(f.studentIds[0]), school: brand.schoolName, date: new Date().toLocaleDateString("en-GB") };
      const g: Guardian = emergency ? { ...f.guardian, notify_email: true, notify_whatsapp: true, notify_sms: true } : f.guardian;
      const msg = communityNote(brand, { name: f.guardian.full_name, subject: `${emergency ? "URGENT: " : ""}${fillTemplate(v.title, vars)}`, lines: fillTemplate(v.body, vars).split(/\n{2,}/), link: link(r.read_token), linkLabel: action });
      const mine = rowsForGuardian(tid, g, emergency ? "emergency" : "notice", msg, n.id, n.created_by).filter(x => channels.includes(x.channel));
      if (mine.length) { out.push(...mine); delivered.push(r.id); }
    } else {
      const text = fillTemplate(n.body, { school: brand.schoolName, date: new Date().toLocaleDateString("en-GB") });
      const mine = await staffRows(svc, { tenantId: tid, userIds: [r.user_id], kind: emergency ? "emergency" : "notice", refId: n.id,
        subject: `${emergency ? "URGENT: " : ""}${fillTemplate(n.title, { school: brand.schoolName })}`, text, url: link(r.read_token) });
      out.push(...mine.filter(x => channels.includes(x.channel) || x.channel === "push"));
      delivered.push(r.id);
    }
  }
  // In an emergency staff also get a text message.
  if (emergency && staff.length) {
    const { data: phones } = await svc.from("staff").select("user_id,full_name,phone").eq("tenant_id", tid).in("user_id", staff);
    for (const s of phones ?? []) {
      const to = normalizePhone(s.phone);
      if (to) out.push({ tenant_id: tid, channel: "sms", to_address: to, to_name: s.full_name, kind: "emergency", subject: n.title, body_text: smsText(`${brand.schoolName}: ${n.title}. ${n.body}`), ref_id: n.id });
    }
  }
  for (let i = 0; i < out.length; i += 1000) await enqueue(svc, out.slice(i, i + 1000));
  const now = new Date().toISOString();
  for (let i = 0; i < delivered.length; i += 500) await svc.from("notice_recipients").update({ delivered_at: now }).in("id", delivered.slice(i, i + 500));
  await svc.from("notices").update({ status: "sent", sent_at: now, updated_at: now }).eq("id", n.id);
  const delivery = await tryDispatch(svc, { budgetMs: emergency ? 40_000 : 20_000, concurrency: 12 });
  return { recipients: (receipts ?? []).length, messages: out.length, families: families.size, students: studentUsers.length, staff: staff.length, translated_into: [...versions.keys()], delivery };
}

/** Sends the notice again to people who have not read (or acknowledged) it. */
export async function remindUnread(svc: any, n: Notice, baseUrl: string) {
  const col = n.requires_ack || n.kind === "emergency" ? "acknowledged_at" : "read_at";
  const { data: left } = await svc.from("notice_recipients").select("id").eq("notice_id", n.id).is(col, null).limit(50000);
  const ids = (left ?? []).map((r: any) => r.id);
  for (let i = 0; i < ids.length; i += 500) await svc.from("notice_recipients").update({ delivered_at: null, reminded_at: new Date().toISOString() }).in("id", ids.slice(i, i + 500));
  if (!ids.length) return { reminded: 0 };
  const r = await sendNotice(svc, { ...n, title: `Reminder: ${n.title}` }, baseUrl);
  return { reminded: ids.length, messages: r.messages };
}

/** Scheduled notices whose time has come (called by the every-minute worker). */
export async function sendScheduledNotices(svc: any, baseUrl: string) {
  const { data } = await svc.from("notices").select("*").eq("status", "scheduled").lte("scheduled_for", new Date().toISOString()).limit(5);
  let sent = 0;
  for (const n of data ?? []) {
    // Claim it first so two workers never send the same notice.
    const { data: claimed } = await svc.from("notices").update({ status: "sending" }).eq("id", n.id).eq("status", "scheduled").select("id").maybeSingle();
    if (!claimed) continue;
    try { await sendNotice(svc, n, baseUrl); sent++; } catch { await svc.from("notices").update({ status: "scheduled" }).eq("id", n.id); }
  }
  return sent;
}

/** Marks a receipt read (and acknowledged) from a link in a message. */
export async function markByToken(svc: any, token: string, ack: boolean) {
  if (!/^[0-9a-f]{20,64}$/.test(token)) return null;
  const { data: r } = await svc.from("notice_recipients").select("id,read_at,acknowledged_at,notice_id,notices(title,body,kind,requires_ack,sent_at,expires_at,tenant_id,tenants(name))").eq("read_token", token).maybeSingle();
  if (!r?.notices) return null;
  const now = new Date().toISOString();
  const patch: Record<string, string> = {};
  if (!r.read_at) patch.read_at = now;
  if (ack && !r.acknowledged_at) { patch.acknowledged_at = now; if (!r.read_at) patch.read_at = now; }
  if (Object.keys(patch).length) await svc.from("notice_recipients").update(patch).eq("id", r.id);
  return { notice: r.notices, read_at: r.read_at ?? patch.read_at, acknowledged_at: r.acknowledged_at ?? patch.acknowledged_at ?? null };
}
