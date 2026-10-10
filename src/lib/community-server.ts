/**
 * Parent and community CRM: database work behind the community pages, the
 * parent portal's support and re-enrolment cards, and the public survey,
 * ticket, alumni and unsubscribe pages. Every function uses the service
 * client, so callers must have authorised the action for this tenant.
 */
import { fetchAll } from "./results";
import { studentName } from "./school";
import { normalizePhone } from "./crm";
import { enqueue, tryDispatch, loadBrand, rowsForGuardian, staffRows, type Guardian, type OutboxRow } from "./messaging/outbox";
import { smsText } from "./messaging/providers";
import { communityNote } from "./messaging/notices";
import {
  dueDates, escalationLevel, slaState, npsCategory, retentionRisk, matchesSegment, renderCampaign, validateAnswers,
  type FamilySummary, type Priority, type Question, type SegmentRules, type Block
} from "./community";

export class CrmError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

const GUARDIAN_COLS = "id,user_id,full_name,email,phone,whatsapp_phone,notify_email,notify_whatsapp,notify_sms,portal_token,language,marketing_opt_out,unsubscribe_token,push_subscriptions(id)";
const DONE = ["resolved", "closed"];

export function portalUrl(base: string, g: { user_id?: string | null; portal_token?: string | null }, hash = "") {
  return (g.user_id ? `${base}/parent` : `${base}/g/${g.portal_token}`) + (hash ? `#${hash}` : "");
}

async function adminIds(svc: any, tenantId: string): Promise<string[]> {
  const { data } = await svc.from("users").select("id").eq("tenant_id", tenantId).eq("active", true).in("role", ["school_admin", "principal"]).limit(10);
  return (data ?? []).map((u: { id: string }) => u.id);
}

async function tellStaff(svc: any, p: { tenantId: string; userIds: string[]; subject: string; text: string; url: string; refId?: string | null }) {
  const ids = [...new Set(p.userIds.filter(Boolean))];
  if (!ids.length) return;
  const rows = await staffRows(svc, { tenantId: p.tenantId, userIds: ids, kind: "ticket", subject: p.subject, text: p.text, url: p.url, refId: p.refId ?? null });
  if (rows.length) await enqueue(svc, rows);
}

async function tellGuardian(svc: any, tenantId: string, guardianId: string, kind: string, build: (g: Guardian & { full_name: string }) => { subject: string; lines: string[]; link: string; linkLabel: string }, refId: string | null) {
  const { data: g } = await svc.from("guardians").select(GUARDIAN_COLS).eq("tenant_id", tenantId).eq("id", guardianId).maybeSingle();
  if (!g) return 0;
  const brand = await loadBrand(svc, tenantId);
  const m = build(g);
  const rows = rowsForGuardian(tenantId, g as Guardian, kind, communityNote(brand, { name: g.full_name, ...m }), refId, null);
  if (rows.length) await enqueue(svc, rows);
  return rows.length;
}

// ---------------- families ----------------

/** The open re-enrolment round (newest first) and its responses. */
export async function openRound(svc: any, tenantId: string) {
  const { data: round } = await svc.from("reenrolment_rounds").select("*").eq("tenant_id", tenantId).eq("status", "open").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!round) return null;
  const responses = await fetchAll<{ student_id: string; guardian_id: string | null; intent: string; reason: string | null; note: string | null; responded_at: string }>(
    () => svc.from("reenrolment_responses").select("student_id,guardian_id,intent,reason,note,responded_at").eq("round_id", round.id).order("student_id"));
  return { round, responses };
}

const inRound = (round: { class_group_ids: string[] } | null, classGroupId: string | null) =>
  Boolean(round) && (!round!.class_group_ids?.length || (classGroupId !== null && round!.class_group_ids.includes(classGroupId)));

/**
 * Every current family (a guardian with at least one active child) with the
 * numbers behind retention flags and segments. `only` limits it to one guardian.
 */
export async function loadFamilies(svc: any, tenantId: string, only?: string): Promise<FamilySummary[]> {
  const since30 = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  const yearAgo = new Date(Date.now() - 365 * 86400_000).toISOString();
  const today = new Date().toISOString().slice(0, 10);
  const byG = <T>(q: any) => (only ? q.eq("guardian_id", only) : q) as T;
  const [guardians, links] = await Promise.all([
    fetchAll<any>(() => { const q = svc.from("guardians").select("id,user_id,full_name,email,phone,whatsapp_phone,language,notify_email,notify_whatsapp,notify_sms,marketing_opt_out").eq("tenant_id", tenantId).order("id"); return only ? q.eq("id", only) : q; }),
    fetchAll<any>(() => byG(svc.from("student_guardians").select("guardian_id,student_id,students(id,first_name,last_name,other_names,status,class_group_id,class_groups(name,level))").eq("tenant_id", tenantId).order("student_id").order("guardian_id")))
  ]);
  const studentIds = [...new Set(links.map((l: any) => l.student_id))];
  const byStudents = (q: any) => (only ? q.in("student_id", studentIds.length ? studentIds : ["00000000-0000-0000-0000-000000000000"]) : q);
  const [invoices, nps, tickets, rates, round, referrals, interactions, convos] = await Promise.all([
    fetchAll<any>(() => byStudents(svc.from("fee_invoices").select("id,student_id,total,amount_paid,due_date").eq("tenant_id", tenantId).in("status", ["issued", "part_paid"]).order("id"))),
    fetchAll<any>(() => byG(svc.from("survey_responses").select("guardian_id,nps,created_at").eq("tenant_id", tenantId).not("guardian_id", "is", null).not("nps", "is", null).order("created_at", { ascending: false }))),
    fetchAll<any>(() => byG(svc.from("tickets").select("guardian_id,status,respond_due_at,resolve_due_at,first_response_at,resolved_at").eq("tenant_id", tenantId).not("guardian_id", "is", null).not("status", "in", `(${DONE.join(",")})`).order("id"))),
    fetchAll<any>(() => svc.rpc("attendance_rates", { p_tenant: tenantId, p_since: since30 }).order("student_id")),
    openRound(svc, tenantId),
    fetchAll<any>(() => { const q = svc.from("admission_leads").select("referred_by").eq("tenant_id", tenantId).not("referred_by", "is", null).order("id"); return only ? q.eq("referred_by", only) : q; }),
    fetchAll<any>(() => byG(svc.from("crm_interactions").select("guardian_id,occurred_at").eq("tenant_id", tenantId).not("guardian_id", "is", null).gte("occurred_at", yearAgo).order("occurred_at", { ascending: false }))),
    fetchAll<any>(() => byG(svc.from("conversations").select("guardian_id,last_message_at").eq("tenant_id", tenantId).gte("last_message_at", yearAgo).order("id")))
  ]);

  // An invoice is shared by every guardian of the student, so it is counted once per family.
  const invByStudent = new Map<string, any[]>();
  for (const i of invoices) { if (!invByStudent.has(i.student_id)) invByStudent.set(i.student_id, []); invByStudent.get(i.student_id)!.push(i); }
  const rateBy = new Map<string, { present: number; total: number }>(rates.map((r: any) => [r.student_id, r]));
  const lastNps = new Map<string, number>();
  for (const r of nps) if (!lastNps.has(r.guardian_id)) lastNps.set(r.guardian_id, r.nps);
  const refCount = new Map<string, number>();
  for (const r of referrals) refCount.set(r.referred_by, (refCount.get(r.referred_by) ?? 0) + 1);
  const lastContact = new Map<string, string>();
  for (const x of [...interactions.map((i: any) => [i.guardian_id, i.occurred_at]), ...convos.map((c: any) => [c.guardian_id, c.last_message_at])] as [string, string][]) {
    if (!lastContact.has(x[0]) || lastContact.get(x[0])! < x[1]) lastContact.set(x[0], x[1]);
  }
  const intentBy = new Map<string, string>((round?.responses ?? []).map(r => [r.student_id, r.intent]));
  const linksBy = new Map<string, any[]>();
  for (const l of links) { if (!linksBy.has(l.guardian_id)) linksBy.set(l.guardian_id, []); linksBy.get(l.guardian_id)!.push(l.students); }
  const ticketsBy = new Map<string, any[]>();
  for (const t of tickets) { if (!ticketsBy.has(t.guardian_id)) ticketsBy.set(t.guardian_id, []); ticketsBy.get(t.guardian_id)!.push(t); }

  const out: FamilySummary[] = [];
  for (const g of guardians) {
    const kids = (linksBy.get(g.id) ?? []).filter(Boolean);
    const active = kids.filter((s: any) => s.status === "active");
    if (!active.length) continue;
    let balance = 0, overdue = 0;
    for (const s of active) for (const i of invByStudent.get(s.id) ?? []) {
      const owed = Number(i.total) - Number(i.amount_paid);
      if (owed <= 0) continue;
      balance += owed;
      if (i.due_date && i.due_date < today) overdue++;
    }
    const rs = active.map((s: any) => rateBy.get(s.id)).filter((r: any) => r && r.total >= 5).map((r: any) => r.present / r.total);
    const attendance = rs.length ? Math.round(Math.min(...rs) * 100) / 100 : null;
    const scoped = active.filter((s: any) => inRound(round?.round ?? null, s.class_group_id));
    let reenrolment: FamilySummary["reenrolment"] = null;
    if (scoped.length) {
      const intents = scoped.map((s: any) => intentBy.get(s.id) ?? "no_response");
      reenrolment = (["not_returning", "undecided", "no_response", "returning"] as const).find(x => intents.includes(x)) ?? null;
    }
    const open = ticketsBy.get(g.id) ?? [];
    const breached = open.filter(t => slaState(t).breached).length;
    const last = lastContact.get(g.id) ?? null;
    const lastScore = lastNps.get(g.id) ?? null;
    const siblingLeft = kids.some((s: any) => s.status === "withdrawn");
    const daysSince = last ? Math.floor((Date.now() - new Date(last).getTime()) / 86400_000) : null;
    out.push({
      id: g.id, full_name: g.full_name, email: g.email, phone: g.phone, whatsapp_phone: g.whatsapp_phone, language: g.language,
      notify_email: g.notify_email, notify_whatsapp: g.notify_whatsapp, notify_sms: g.notify_sms ?? false, marketing_opt_out: g.marketing_opt_out ?? false,
      children: active.map((s: any) => ({ id: s.id, name: studentName(s), class_group_id: s.class_group_id, class_name: s.class_groups?.name ?? null, level: s.class_groups?.level ?? null })),
      balance: Math.round(balance * 100) / 100, overdue_invoices: overdue, last_nps: lastScore, open_tickets: open.length, breached_tickets: breached,
      attendance_rate: attendance, reenrolment, referrals: refCount.get(g.id) ?? 0, last_contact_at: last, sibling_left: siblingLeft,
      risk: retentionRisk({ balance, overdueInvoices: overdue, lastNps: lastScore, openTickets: open.length, breachedTickets: breached,
        attendanceRate: attendance, reenrolment, siblingLeft, daysSinceContact: daysSince })
    });
  }
  return out.sort((a, b) => b.risk.score - a.risk.score || a.full_name.localeCompare(b.full_name));
}

/** Everything the school knows about one family, newest first. */
export async function familyProfile(svc: any, tenantId: string, guardianId: string) {
  const [summary] = await loadFamilies(svc, tenantId, guardianId);
  const { data: g } = await svc.from("guardians").select("id,user_id,full_name,email,phone,whatsapp_phone,language,notify_email,notify_whatsapp,notify_sms,marketing_opt_out,referral_code,created_at")
    .eq("tenant_id", tenantId).eq("id", guardianId).maybeSingle();
  if (!g) throw new CrmError("family not found", 404);
  const { data: links } = await svc.from("student_guardians").select("relation,is_primary,can_pickup,students(id,first_name,last_name,other_names,admission_no,status,photo_url,class_groups(name))")
    .eq("tenant_id", tenantId).eq("guardian_id", guardianId);
  const kids = (links ?? []).filter((l: any) => l.students);
  const ids = kids.map((l: any) => l.students.id);
  const none = ["00000000-0000-0000-0000-000000000000"];
  const sids = ids.length ? ids : none;
  const contacts = [...new Set([g.email?.trim(), g.email?.trim().toLowerCase(), normalizePhone(g.whatsapp_phone || g.phone), normalizePhone(g.phone)].filter(Boolean))];
  const [co, interactions, tickets, convos, responses, payments, invoices, events, meetings, reenrol, leads, rewards, outbox, cards] = await Promise.all([
    svc.from("student_guardians").select("relation,guardians(id,full_name,phone,email)").eq("tenant_id", tenantId).in("student_id", sids).neq("guardian_id", guardianId),
    svc.from("crm_interactions").select("id,kind,body,occurred_at,follow_up_at,student_id,users:actor_id(full_name)").eq("tenant_id", tenantId).eq("guardian_id", guardianId).order("occurred_at", { ascending: false }).limit(100),
    svc.from("tickets").select("id,ticket_no,kind,category,priority,subject,status,created_at,resolved_at,satisfaction,respond_due_at,resolve_due_at,first_response_at").eq("tenant_id", tenantId).eq("guardian_id", guardianId).order("created_at", { ascending: false }).limit(50),
    svc.from("conversations").select("id,subject,status,started_by,last_message_at,users:staff_user_id(full_name)").eq("tenant_id", tenantId).eq("guardian_id", guardianId).order("last_message_at", { ascending: false }).limit(50),
    svc.from("survey_responses").select("id,nps,answers,created_at,surveys(title)").eq("tenant_id", tenantId).eq("guardian_id", guardianId).order("created_at", { ascending: false }).limit(20),
    svc.from("fee_payments").select("id,student_id,amount,method,receipt_no,status,paid_at,created_at").eq("tenant_id", tenantId).in("student_id", sids).order("created_at", { ascending: false }).limit(50),
    svc.from("fee_invoices").select("id,student_id,invoice_no,title,status,total,amount_paid,due_date").eq("tenant_id", tenantId).in("student_id", sids).neq("status", "void").order("created_at", { ascending: false }).limit(50),
    svc.from("event_responses").select("student_id,consent,responded_at,school_events(title,starts_at)").eq("tenant_id", tenantId).in("student_id", sids).limit(50),
    svc.from("consultation_slots").select("id,starts_at,location,student_id,users:staff_user_id(full_name)").eq("tenant_id", tenantId).eq("guardian_id", guardianId).order("starts_at", { ascending: false }).limit(30),
    svc.from("reenrolment_responses").select("student_id,intent,reason,note,responded_at,reenrolment_rounds(title)").eq("tenant_id", tenantId).in("student_id", sids).order("responded_at", { ascending: false }).limit(30),
    svc.from("admission_leads").select("id,parent_name,child_name,stage,created_at").eq("tenant_id", tenantId).eq("referred_by", guardianId).order("created_at", { ascending: false }).limit(50),
    svc.from("referral_rewards").select("id,kind,amount,status,created_at,issued_at").eq("tenant_id", tenantId).eq("guardian_id", guardianId).order("created_at", { ascending: false }),
    contacts.length ? svc.from("message_outbox").select("id,channel,kind,subject,status,created_at").eq("tenant_id", tenantId).in("to_address", contacts).order("created_at", { ascending: false }).limit(60) : { data: [] },
    svc.from("report_cards").select("student_id,average,published_at,terms(name)").eq("tenant_id", tenantId).in("student_id", sids).eq("kind", "term").eq("status", "published").order("published_at", { ascending: false }).limit(30)
  ]);

  type Item = { at: string; type: string; title: string; detail?: string | null; ref?: string | null; tone?: string };
  const tl: Item[] = [];
  const kidName = (sid: string | null) => { const k = kids.find((l: any) => l.students.id === sid); return k ? studentName(k.students) : ""; };
  for (const i of interactions.data ?? []) tl.push({ at: i.occurred_at, type: i.kind, title: `${i.kind[0].toUpperCase()}${i.kind.slice(1)} logged by ${i.users?.full_name ?? "staff"}`, detail: i.body, ref: i.id });
  for (const t of tickets.data ?? []) {
    tl.push({ at: t.created_at, type: "ticket", title: `${t.ticket_no}: ${t.subject}`, detail: `${t.kind} · ${t.category} · ${t.status.replace("_", " ")}`, ref: t.id, tone: DONE.includes(t.status) ? "green" : "amber" });
  }
  for (const c of convos.data ?? []) tl.push({ at: c.last_message_at, type: "message", title: `Message thread: ${c.subject}`, detail: `with ${c.users?.full_name ?? "school office"} · ${c.status}`, ref: c.id });
  for (const r of responses.data ?? []) tl.push({ at: r.created_at, type: "survey", title: `Answered "${r.surveys?.title ?? "survey"}"${r.nps !== null ? ` · NPS ${r.nps}` : ""}`, tone: npsCategory(r.nps) === "detractor" ? "red" : npsCategory(r.nps) === "promoter" ? "green" : undefined,
    detail: Object.values(r.answers ?? {}).filter(v => typeof v === "string").join(" · ") || null });
  for (const p of payments.data ?? []) if (p.status === "success") tl.push({ at: p.paid_at ?? p.created_at, type: "payment", title: `Paid ${Number(p.amount).toLocaleString()} (${p.method}) for ${kidName(p.student_id)}`, detail: p.receipt_no, tone: "green" });
  for (const m of meetings.data ?? []) tl.push({ at: m.starts_at, type: "meeting", title: `Meeting with ${m.users?.full_name ?? "staff"} about ${kidName(m.student_id)}`, detail: m.location });
  for (const r of reenrol.data ?? []) tl.push({ at: r.responded_at, type: "reenrolment", title: `${r.reenrolment_rounds?.title ?? "Re-enrolment"}: ${kidName(r.student_id)} ${r.intent.replace("_", " ")}`, detail: [r.reason, r.note].filter(Boolean).join(" · ") || null, tone: r.intent === "not_returning" ? "red" : r.intent === "returning" ? "green" : "amber" });
  for (const e of events.data ?? []) if (e.school_events) tl.push({ at: e.responded_at, type: "event", title: `${e.consent ? "Accepted" : "Declined"} ${e.school_events.title} for ${kidName(e.student_id)}` });
  for (const l of leads.data ?? []) tl.push({ at: l.created_at, type: "referral", title: `Referred ${l.parent_name}${l.child_name ? ` (${l.child_name})` : ""}`, detail: `now: ${l.stage.replace("_", " ")}`, tone: l.stage === "enrolled" ? "green" : undefined });
  for (const m of outbox.data ?? []) tl.push({ at: m.created_at, type: "sent", title: `${m.channel === "whatsapp" ? "WhatsApp" : m.channel === "sms" ? "SMS" : m.channel === "push" ? "Notification" : "Email"}: ${m.subject ?? m.kind}`, detail: m.status });
  for (const c of cards.data ?? []) tl.push({ at: c.published_at, type: "result", title: `${c.terms?.name ?? "Term"} result for ${kidName(c.student_id)}`, detail: c.average !== null ? `average ${c.average}%` : null });
  tl.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));

  const coMap = new Map<string, any>();
  for (const c of co.data ?? []) if (c.guardians && !coMap.has(c.guardians.id)) coMap.set(c.guardians.id, { ...c.guardians, relation: c.relation });
  return {
    guardian: g, summary: summary ?? null,
    children: kids.map((l: any) => ({ id: l.students.id, name: studentName(l.students), admission_no: l.students.admission_no, status: l.students.status, photo_url: l.students.photo_url,
      class_name: l.students.class_groups?.name ?? null, relation: l.relation, is_primary: l.is_primary,
      latest_average: (cards.data ?? []).find((c: any) => c.student_id === l.students.id)?.average ?? null })),
    co_guardians: [...coMap.values()],
    invoices: invoices.data ?? [], tickets: tickets.data ?? [], rewards: rewards.data ?? [],
    timeline: tl.slice(0, 300)
  };
}

// ---------------- tickets ----------------

export type NewTicket = {
  tenantId: string; guardianId?: string | null; studentId?: string | null; kind: string; category: string; priority: Priority; channel: string;
  subject: string; body: string; assignedTo?: string | null; createdBy?: string | null; baseUrl: string; acknowledge?: boolean;
};

export async function createTicket(svc: any, p: NewTicket) {
  if (p.studentId && p.guardianId) {
    const { data: link } = await svc.from("student_guardians").select("student_id").eq("tenant_id", p.tenantId).eq("guardian_id", p.guardianId).eq("student_id", p.studentId).maybeSingle();
    if (!link) throw new CrmError("that child is not linked to this family");
  }
  if (p.assignedTo) {
    const { data: u } = await svc.from("users").select("id").eq("tenant_id", p.tenantId).eq("id", p.assignedTo).eq("active", true).not("role", "in", "(student,parent)").maybeSingle();
    if (!u) throw new CrmError("choose an active member of staff to handle it");
  }
  const [{ data: s }, { data: no, error: noErr }] = await Promise.all([
    svc.from("tenant_settings").select("ticket_sla").eq("tenant_id", p.tenantId).maybeSingle(),
    svc.rpc("next_doc_no", { p_tenant: p.tenantId, p_kind: "tkt" })
  ]);
  if (noErr) throw new CrmError(noErr.message);
  const due = dueDates(p.priority, new Date(), s?.ticket_sla);
  const { data: t, error } = await svc.from("tickets").insert({
    tenant_id: p.tenantId, ticket_no: no, guardian_id: p.guardianId ?? null, student_id: p.studentId ?? null, kind: p.kind, category: p.category,
    priority: p.priority, channel: p.channel, subject: p.subject, body: p.body, assigned_to: p.assignedTo ?? null, created_by: p.createdBy ?? null, ...due
  }).select("id,ticket_no,token").single();
  if (error) throw new CrmError(error.message);
  try {
    const to = p.assignedTo ? [p.assignedTo] : await adminIds(svc, p.tenantId);
    await tellStaff(svc, { tenantId: p.tenantId, userIds: to.filter(id => id !== p.createdBy), refId: t.id,
      subject: `${p.priority === "urgent" ? "URGENT " : ""}${t.ticket_no}: ${p.subject}`, text: p.body.slice(0, 400), url: `${p.baseUrl}/school/support?ticket=${t.id}` });
    if (p.guardianId && p.acknowledge !== false) {
      await tellGuardian(svc, p.tenantId, p.guardianId, "ticket", () => ({
        subject: `We received your ${p.kind}: ${t.ticket_no}`,
        lines: [`Thank you for telling us about "${p.subject}". Your reference is ${t.ticket_no}.`, "We will reply soon. You can follow it and reply from the link below."],
        link: `${p.baseUrl}/t/${t.token}`, linkLabel: "Follow your request"
      }), t.id);
    }
    await tryDispatch(svc, { budgetMs: 4000 });
  } catch (e) { console.error("ticket notification deferred:", (e as Error).message); }
  return t as { id: string; ticket_no: string; token: string };
}

/** A reply on a ticket from staff (optionally an internal note) or from the family. */
export async function replyToTicket(svc: any, p: { tenantId: string; ticketId: string; author: "staff" | "family"; authorId?: string | null; authorName: string; body: string; internal?: boolean; baseUrl: string }) {
  const { data: t } = await svc.from("tickets").select("id,ticket_no,subject,status,guardian_id,assigned_to,first_response_at,token").eq("tenant_id", p.tenantId).eq("id", p.ticketId).maybeSingle();
  if (!t) throw new CrmError("ticket not found", 404);
  if (t.status === "closed") throw new CrmError("this request is closed; please raise a new one");
  const internal = p.author === "staff" && Boolean(p.internal);
  const { error } = await svc.from("ticket_messages").insert({ tenant_id: p.tenantId, ticket_id: t.id, author: p.author, author_id: p.authorId ?? null, body: p.body, internal });
  if (error) throw new CrmError(error.message);
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { updated_at: now };
  if (p.author === "staff" && !internal) {
    if (!t.first_response_at) patch.first_response_at = now;
    if (t.status === "open") patch.status = "in_progress";
  }
  if (p.author === "family" && (t.status === "waiting" || t.status === "resolved")) { patch.status = "open"; patch.resolved_at = null; }
  await svc.from("tickets").update(patch).eq("id", t.id);
  try {
    if (p.author === "staff" && !internal && t.guardian_id) {
      await tellGuardian(svc, p.tenantId, t.guardian_id, "ticket", () => ({
        subject: `Reply on ${t.ticket_no}: ${t.subject}`, lines: [`${p.authorName}: ${p.body.slice(0, 600)}`], link: `${p.baseUrl}/t/${t.token}`, linkLabel: "Read and reply"
      }), t.id);
    } else if (p.author === "family") {
      await tellStaff(svc, { tenantId: p.tenantId, userIds: t.assigned_to ? [t.assigned_to] : await adminIds(svc, p.tenantId), refId: t.id,
        subject: `${t.ticket_no}: family replied`, text: p.body.slice(0, 400), url: `${p.baseUrl}/school/support?ticket=${t.id}` });
    }
    await tryDispatch(svc, { budgetMs: 4000 });
  } catch (e) { console.error("ticket notification deferred:", (e as Error).message); }
  return { ok: true };
}

/** Status change by staff. Resolving asks the family to rate the outcome. */
export async function setTicketStatus(svc: any, p: { tenantId: string; ticketId: string; status: string; note?: string | null; actorId: string; actorName: string; baseUrl: string; sb: any }) {
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status: p.status, updated_at: now };
  if (p.status === "resolved") patch.resolved_at = now;
  if (p.status === "closed") patch.closed_at = now;
  if (p.status === "open" || p.status === "in_progress") { patch.resolved_at = null; patch.closed_at = null; }
  // The caller's own client applies RLS: only admins and the assignee can change a ticket.
  const { data: t, error } = await p.sb.from("tickets").update(patch).eq("tenant_id", p.tenantId).eq("id", p.ticketId).select("id,ticket_no,subject,guardian_id,token,first_response_at").maybeSingle();
  if (error) throw new CrmError(error.message);
  if (!t) throw new CrmError("ticket not found or not yours to change", 404);
  if (p.status === "resolved" && !t.first_response_at) await svc.from("tickets").update({ first_response_at: now }).eq("id", t.id);
  if (p.note) await svc.from("ticket_messages").insert({ tenant_id: p.tenantId, ticket_id: t.id, author: "staff", author_id: p.actorId, body: p.note, internal: false });
  await svc.from("ticket_messages").insert({ tenant_id: p.tenantId, ticket_id: t.id, author: "system", body: `${p.actorName} marked this ${p.status.replace("_", " ")}.`, internal: true });
  if (p.status === "resolved" && t.guardian_id) {
    try {
      await tellGuardian(svc, p.tenantId, t.guardian_id, "ticket", () => ({
        subject: `Resolved: ${t.ticket_no}`, lines: [`We have resolved "${t.subject}".${p.note ? ` ${p.note.slice(0, 500)}` : ""}`, "Please tell us how we did. If it is not sorted, reply and we will reopen it."],
        link: `${p.baseUrl}/t/${t.token}`, linkLabel: "Rate our response"
      }), t.id);
      await tryDispatch(svc, { budgetMs: 4000 });
    } catch (e) { console.error("ticket notification deferred:", (e as Error).message); }
  }
  return t;
}

/** Raise the escalation level of overdue tickets and tell the admins and the assignee. Run every minute. */
export async function escalateTickets(svc: any, baseUrl: string) {
  const now = new Date();
  const iso = now.toISOString();
  const { data } = await svc.from("tickets").select("id,tenant_id,ticket_no,subject,priority,status,assigned_to,escalation_level,respond_due_at,resolve_due_at,first_response_at,resolved_at,tenants(status)")
    .not("status", "in", `(${DONE.join(",")})`)
    .or(`and(first_response_at.is.null,respond_due_at.lt.${iso},escalation_level.lt.1),and(resolve_due_at.lt.${iso},escalation_level.lt.2)`)
    .limit(200);
  let n = 0;
  for (const t of data ?? []) {
    const level = escalationLevel(t, now);
    if (level <= t.escalation_level) continue;
    // Only one worker escalates each ticket to each level.
    const { data: won } = await svc.from("tickets").update({ escalation_level: level, escalated_at: iso }).eq("id", t.id).lt("escalation_level", level).select("id");
    if (!won?.length) continue;
    n++;
    if (t.tenants?.status !== "active") continue;
    const what = level === 2 ? "has not been resolved in the promised time" : "has had no reply in the promised time";
    await svc.from("ticket_messages").insert({ tenant_id: t.tenant_id, ticket_id: t.id, author: "system", body: `Escalated: ${what}.`, internal: true });
    try {
      await tellStaff(svc, { tenantId: t.tenant_id, userIds: [...await adminIds(svc, t.tenant_id), t.assigned_to], refId: t.id,
        subject: `Overdue ${t.ticket_no}: ${t.subject}`, text: `This ${t.priority} ticket ${what}.`, url: `${baseUrl}/school/support?ticket=${t.id}` });
    } catch (e) { console.error("escalation notice deferred:", (e as Error).message); }
  }
  return n;
}

// ---------------- audiences ----------------

type Contact = { id: string; full_name: string; email: string | null; phone: string | null; whatsapp_phone: string | null; unsubscribe_token?: string | null; guardian?: Guardian };
export type Audience =
  | { type: "parents"; class_group_ids?: string[]; segment_id?: string | null; rules?: SegmentRules | null }
  | { type: "alumni"; years?: number[]; mentors_only?: boolean }
  | { type: "partners"; kinds?: string[] };

/** Guardian ids for a parent audience: classes, a saved segment, or inline rules. */
export async function audienceGuardianIds(svc: any, tenantId: string, a: { class_group_ids?: string[]; segment_id?: string | null; rules?: SegmentRules | null }) {
  let rules: SegmentRules = { ...(a.rules ?? {}) };
  if (a.segment_id) {
    const { data: seg } = await svc.from("family_segments").select("rules").eq("tenant_id", tenantId).eq("id", a.segment_id).maybeSingle();
    if (!seg) throw new CrmError("segment not found", 404);
    rules = { ...seg.rules, ...rules };
  }
  if (a.class_group_ids?.length) rules.class_group_ids = a.class_group_ids;
  const families = await loadFamilies(svc, tenantId);
  return families.filter(f => matchesSegment(f, rules)).map(f => f.id);
}

async function guardiansById(svc: any, tenantId: string, ids: string[]) {
  const out: any[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await svc.from("guardians").select(GUARDIAN_COLS).eq("tenant_id", tenantId).in("id", ids.slice(i, i + 200));
    out.push(...(data ?? []));
  }
  return out;
}

export async function audienceContacts(svc: any, tenantId: string, a: Audience, opts: { marketing: boolean }): Promise<Contact[]> {
  if (a.type === "parents") {
    const gs = await guardiansById(svc, tenantId, await audienceGuardianIds(svc, tenantId, a));
    return gs.filter(g => !(opts.marketing && g.marketing_opt_out)).map(g => ({ id: g.id, full_name: g.full_name, email: g.email, phone: g.phone, whatsapp_phone: g.whatsapp_phone, unsubscribe_token: g.unsubscribe_token, guardian: g }));
  }
  if (a.type === "alumni") {
    const rows = await fetchAll<any>(() => {
      let q = svc.from("alumni").select("id,full_name,email,phone,unsubscribe_token,graduation_year,mentor").eq("tenant_id", tenantId).eq("status", "active").eq("consent_contact", true).order("id");
      if (a.years?.length) q = q.in("graduation_year", a.years);
      if (a.mentors_only) q = q.eq("mentor", true);
      return q;
    });
    return rows.map(r => ({ id: r.id, full_name: r.full_name, email: r.email, phone: r.phone, whatsapp_phone: null, unsubscribe_token: r.unsubscribe_token }));
  }
  const rows = await fetchAll<any>(() => {
    let q = svc.from("crm_partners").select("id,name,contact_name,email,phone").eq("tenant_id", tenantId).neq("status", "inactive").order("id");
    if (a.kinds?.length) q = q.in("kind", a.kinds);
    return q;
  });
  return rows.map(r => ({ id: r.id, full_name: r.contact_name || r.name, email: r.email, phone: r.phone, whatsapp_phone: null, unsubscribe_token: null }));
}

// ---------------- campaigns ----------------

/** Sends a draft or scheduled campaign now. Safe against double sends: only one caller can claim it. */
export async function sendCampaign(svc: any, tenantId: string, campaignId: string, baseUrl: string) {
  const { data: c } = await svc.from("crm_campaigns").update({ status: "sending", updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId).eq("id", campaignId).in("status", ["draft", "scheduled"]).select("*").maybeSingle();
  if (!c) throw new CrmError("this campaign has already been sent or cancelled");
  try {
    const contacts = await audienceContacts(svc, tenantId, c.audience as Audience, { marketing: true });
    const brand = await loadBrand(svc, tenantId);
    const rows: OutboxRow[] = [];
    const channels: string[] = c.channels ?? ["email"];
    for (const r of contacts) {
      const unsub = r.unsubscribe_token ? `${baseUrl}/unsubscribe/${r.unsubscribe_token}` : null;
      const m = renderCampaign(brand, { kind: c.kind, subject: c.subject, body: c.body, blocks: (c.blocks ?? []) as Block[] }, { name: r.full_name, unsubscribeUrl: unsub });
      const base = { tenant_id: tenantId, to_name: r.full_name, kind: c.kind, subject: m.subject, ref_id: c.id, created_by: c.created_by };
      if (channels.includes("email") && r.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email)) rows.push({ ...base, channel: "email", to_address: r.email.trim(), body_text: m.text, body_html: m.html });
      const wa = normalizePhone(r.whatsapp_phone || r.phone);
      if (channels.includes("whatsapp") && wa) rows.push({ ...base, channel: "whatsapp", to_address: wa, body_text: m.wa.text });
      const sms = normalizePhone(r.phone || r.whatsapp_phone);
      if (channels.includes("sms") && sms) rows.push({ ...base, channel: "sms", to_address: sms, body_text: smsText(`${m.subject}: ${m.wa.text.replace(/\*/g, "")}`) });
    }
    if (rows.length) await enqueue(svc, rows);
    await svc.from("crm_campaigns").update({ status: "sent", sent_at: new Date().toISOString(), recipients: contacts.length, updated_at: new Date().toISOString() }).eq("id", c.id);
    await tryDispatch(svc, { budgetMs: 20_000, concurrency: 10 });
    return { recipients: contacts.length, messages: rows.length };
  } catch (e) {
    await svc.from("crm_campaigns").update({ status: c.status === "scheduled" ? "scheduled" : "draft" }).eq("id", c.id).eq("status", "sending");
    throw e;
  }
}

/** Scheduled campaigns whose time has come. Run every minute. */
export async function sendDueCampaigns(svc: any, baseUrl: string) {
  const { data } = await svc.from("crm_campaigns").select("id,tenant_id,tenants(status)").eq("status", "scheduled").lte("scheduled_at", new Date().toISOString()).limit(5);
  let sent = 0;
  for (const c of data ?? []) {
    if (c.tenants?.status !== "active") continue;
    try { await sendCampaign(svc, c.tenant_id, c.id, baseUrl); sent++; } catch (e) { console.error("scheduled campaign failed:", (e as Error).message); }
  }
  return sent;
}

/** Delivery counts per campaign from the outbox. */
export async function campaignStats(svc: any, tenantId: string, ids: string[]) {
  const out: Record<string, Record<string, number>> = {};
  if (!ids.length) return out;
  const rows = await fetchAll<{ ref_id: string; status: string; channel: string }>(() => svc.from("message_outbox").select("ref_id,status,channel").eq("tenant_id", tenantId).in("ref_id", ids).order("id"));
  for (const r of rows) {
    const s = (out[r.ref_id] ??= {});
    s[r.status] = (s[r.status] ?? 0) + 1;
    s[`${r.channel}`] = (s[`${r.channel}`] ?? 0) + 1;
  }
  return out;
}

// ---------------- surveys ----------------

export async function sendSurvey(svc: any, p: { tenantId: string; surveyId: string; baseUrl: string; remind?: boolean }) {
  const { data: s } = await svc.from("surveys").select("*").eq("tenant_id", p.tenantId).eq("id", p.surveyId).maybeSingle();
  if (!s) throw new CrmError("survey not found", 404);
  if (s.status === "closed") throw new CrmError("this survey is closed");
  if (!(s.questions ?? []).length) throw new CrmError("add at least one question first");
  let invites: { id: string; guardian_id: string; token: string }[];
  if (p.remind) {
    const cutoff = new Date(Date.now() - 2 * 86400_000).toISOString();
    const all = await fetchAll<any>(() => svc.from("survey_invites").select("id,guardian_id,token,sent_at,reminded_at").eq("survey_id", s.id).is("responded_at", null).order("id"));
    invites = all.filter(i => (i.reminded_at ?? i.sent_at) < cutoff);
  } else {
    const ids = await audienceGuardianIds(svc, p.tenantId, s.audience ?? {});
    const existing = new Set((await fetchAll<any>(() => svc.from("survey_invites").select("guardian_id").eq("survey_id", s.id).order("id"))).map(i => i.guardian_id));
    const fresh = ids.filter(id => !existing.has(id));
    invites = [];
    for (let i = 0; i < fresh.length; i += 500) {
      const { data, error } = await svc.from("survey_invites").insert(fresh.slice(i, i + 500).map(guardian_id => ({ tenant_id: p.tenantId, survey_id: s.id, guardian_id }))).select("id,guardian_id,token");
      if (error) throw new CrmError(error.message);
      invites.push(...(data ?? []));
    }
  }
  const gs = new Map((await guardiansById(svc, p.tenantId, invites.map(i => i.guardian_id))).map(g => [g.id, g]));
  const brand = await loadBrand(svc, p.tenantId);
  const rows: OutboxRow[] = [];
  for (const i of invites) {
    const g = gs.get(i.guardian_id);
    if (!g) continue;
    rows.push(...rowsForGuardian(p.tenantId, g, "survey", communityNote(brand, {
      name: g.full_name, subject: p.remind ? `Reminder: ${s.title}` : s.title,
      lines: [`${p.remind ? "A quick reminder: " : ""}we would value your views. It takes about two minutes${s.anonymous ? " and your answers are anonymous" : ""}.`, ...(s.intro ? [s.intro.slice(0, 400)] : [])],
      link: `${p.baseUrl}/s/${i.token}`, linkLabel: "Answer the survey"
    }), s.id, null));
  }
  if (rows.length) await enqueue(svc, rows);
  if (p.remind) { for (let i = 0; i < invites.length; i += 200) await svc.from("survey_invites").update({ reminded_at: new Date().toISOString() }).in("id", invites.slice(i, i + 200).map(x => x.id)); }
  else await svc.from("surveys").update({ status: "open", sent_at: s.sent_at ?? new Date().toISOString() }).eq("id", s.id);
  await tryDispatch(svc, { budgetMs: 15_000, concurrency: 10 });
  return { invited: invites.length, messages: rows.length };
}

export async function surveyByToken(svc: any, token: string) {
  if (!/^[0-9a-f]{32}$/i.test(token)) return null;
  const { data } = await svc.from("survey_invites").select("id,tenant_id,guardian_id,responded_at,surveys(id,title,intro,questions,anonymous,status,closes_at),guardians(full_name),tenants(status)").eq("token", token).maybeSingle();
  if (!data || data.tenants?.status !== "active" || !data.surveys) return null;
  return data;
}

/** Records a family's answers once. Detractors on named surveys get a follow-up ticket so someone calls them. */
export async function submitSurvey(svc: any, token: string, raw: Record<string, unknown>, baseUrl: string) {
  const inv = await surveyByToken(svc, token);
  if (!inv) throw new CrmError("This survey link is not valid.", 404);
  const s = inv.surveys;
  if (s.status !== "open" || (s.closes_at && new Date(s.closes_at) < new Date())) throw new CrmError("This survey has closed. Thank you.");
  if (inv.responded_at) throw new CrmError("You have already answered this survey. Thank you.");
  const v = validateAnswers(s.questions as Question[], raw);
  if (v.errors.length) throw new CrmError(v.errors.join("; "));
  const { data: claimed } = await svc.from("survey_invites").update({ responded_at: new Date().toISOString() }).eq("id", inv.id).is("responded_at", null).select("id");
  if (!claimed?.length) throw new CrmError("You have already answered this survey. Thank you.");
  const { error } = await svc.from("survey_responses").insert({ tenant_id: inv.tenant_id, survey_id: s.id, guardian_id: s.anonymous ? null : inv.guardian_id, nps: v.nps, answers: v.answers });
  if (error) {
    await svc.from("survey_invites").update({ responded_at: null }).eq("id", inv.id);
    throw new CrmError(error.message);
  }
  if (!s.anonymous && npsCategory(v.nps) === "detractor") {
    const texts = (s.questions as Question[]).filter(q => q.type === "text" && v.answers[q.id]).map(q => `${q.label}\n${v.answers[q.id]}`);
    await createTicket(svc, {
      tenantId: inv.tenant_id, guardianId: inv.guardian_id, kind: "feedback", category: "other", priority: (v.nps ?? 10) <= 4 ? "high" : "normal", channel: "survey",
      subject: `Follow up: scored ${v.nps}/10 in "${s.title}"`.slice(0, 160),
      body: [`${inv.guardians?.full_name ?? "A family"} gave a score of ${v.nps} out of 10.`, ...texts].join("\n\n").slice(0, 5000),
      baseUrl, acknowledge: false
    }).catch(e => console.error("detractor follow-up not created:", (e as Error).message));
  }
  return { ok: true };
}

// ---------------- re-enrolment ----------------

/** Students in a round with their guardians, for sending and reminding. */
export async function roundStudents(svc: any, tenantId: string, round: { class_group_ids: string[] }) {
  return fetchAll<any>(() => {
    let q = svc.from("students").select("id,first_name,last_name,other_names,class_group_id").eq("tenant_id", tenantId).eq("status", "active").order("id");
    if (round.class_group_ids?.length) q = q.in("class_group_id", round.class_group_ids);
    return q;
  });
}

/** Asks every family in the round (or, when reminding, only those yet to answer for a child). */
export async function notifyRound(svc: any, p: { tenantId: string; roundId: string; baseUrl: string; remind?: boolean }) {
  const { data: round } = await svc.from("reenrolment_rounds").select("*").eq("tenant_id", p.tenantId).eq("id", p.roundId).maybeSingle();
  if (!round) throw new CrmError("round not found", 404);
  if (round.status !== "open") throw new CrmError("open the round first");
  const students = await roundStudents(svc, p.tenantId, round);
  const answered = new Set((await fetchAll<any>(() => svc.from("reenrolment_responses").select("student_id").eq("round_id", round.id).order("student_id"))).map(r => r.student_id));
  const todo = p.remind ? students.filter((s: any) => !answered.has(s.id)) : students;
  const kidsByGuardian = new Map<string, string[]>();
  for (let i = 0; i < todo.length; i += 200) {
    const { data } = await svc.from("student_guardians").select("student_id,guardian_id").eq("tenant_id", p.tenantId).in("student_id", todo.slice(i, i + 200).map((s: any) => s.id));
    for (const l of data ?? []) {
      const name = studentName(todo.find((s: any) => s.id === l.student_id)).split(" ")[0];
      if (!kidsByGuardian.has(l.guardian_id)) kidsByGuardian.set(l.guardian_id, []);
      kidsByGuardian.get(l.guardian_id)!.push(name);
    }
  }
  const gs = await guardiansById(svc, p.tenantId, [...kidsByGuardian.keys()]);
  const brand = await loadBrand(svc, p.tenantId);
  const rows: OutboxRow[] = [];
  const deadline = round.deadline ? new Date(`${round.deadline}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : null;
  for (const g of gs) {
    const names = kidsByGuardian.get(g.id)!.join(" and ");
    rows.push(...rowsForGuardian(p.tenantId, g, "reenrolment", communityNote(brand, {
      name: g.full_name, subject: `${p.remind ? "Reminder: " : ""}${round.title}: will ${names} return?`,
      lines: [`Please tell us whether ${names} will return for ${round.title}${deadline ? ` by ${deadline}` : ""}. It helps us plan classes and places.`, ...(round.message ? [round.message.slice(0, 500)] : [])],
      link: portalUrl(p.baseUrl, g, "reenrol"), linkLabel: "Answer now"
    }), round.id, null));
  }
  if (rows.length) await enqueue(svc, rows);
  await tryDispatch(svc, { budgetMs: 15_000, concurrency: 10 });
  return { families: gs.length, messages: rows.length };
}

/** What a family needs to answer: the open round and their children in it. */
export async function familyReenrolment(svc: any, tenantId: string, guardianId: string) {
  const o = await openRound(svc, tenantId);
  if (!o) return null;
  const { data: links } = await svc.from("student_guardians").select("students(id,first_name,last_name,other_names,status,class_group_id)").eq("tenant_id", tenantId).eq("guardian_id", guardianId);
  const kids = (links ?? []).map((l: any) => l.students).filter((s: any) => s && s.status === "active" && inRound(o.round, s.class_group_id));
  if (!kids.length) return null;
  return {
    round: { id: o.round.id, title: o.round.title, message: o.round.message, deadline: o.round.deadline },
    children: kids.map((s: any) => {
      const r = o.responses.find(x => x.student_id === s.id);
      return { id: s.id, name: studentName(s), intent: r?.intent ?? null, reason: r?.reason ?? null, note: r?.note ?? null };
    })
  };
}

export async function respondReenrolment(svc: any, p: { tenantId: string; guardianId: string; roundId: string; studentId: string; intent: string; reason?: string | null; note?: string | null }) {
  const o = await familyReenrolment(svc, p.tenantId, p.guardianId);
  if (!o || o.round.id !== p.roundId) throw new CrmError("re-enrolment is not open for this family");
  const kid = o.children.find((c: { id: string }) => c.id === p.studentId);
  if (!kid) throw new CrmError("that child is not part of this re-enrolment");
  const { error } = await svc.from("reenrolment_responses").upsert({
    round_id: p.roundId, student_id: p.studentId, tenant_id: p.tenantId, guardian_id: p.guardianId, intent: p.intent,
    reason: p.intent === "not_returning" ? (p.reason ?? "other") : null, note: p.note ?? null, responded_at: new Date().toISOString()
  }, { onConflict: "round_id,student_id" });
  if (error) throw new CrmError(error.message);
  if (p.intent !== "returning" && kid.intent !== p.intent) {
    await svc.from("crm_interactions").insert({ tenant_id: p.tenantId, guardian_id: p.guardianId, student_id: p.studentId, kind: "retention",
      body: `${o.round.title}: ${kid.name} ${p.intent === "not_returning" ? "will not return" : "is undecided"}${p.reason ? ` (reason: ${p.reason.replace("_", " ")})` : ""}${p.note ? `. "${p.note}"` : ""}` });
  }
  return { ok: true };
}

// ---------------- alumni ----------------

/** Adds every graduated student who is not yet on the alumni list. */
export async function importGraduates(svc: any, tenantId: string) {
  const grads = await fetchAll<any>(() => svc.from("students").select("id,first_name,last_name,other_names,user_id,class_groups(name),users:user_id(email)").eq("tenant_id", tenantId).eq("status", "graduated").order("id"));
  const have = new Set((await fetchAll<any>(() => svc.from("alumni").select("student_id").eq("tenant_id", tenantId).not("student_id", "is", null).order("id"))).map(a => a.student_id));
  const year = new Date().getFullYear();
  const rows = grads.filter(s => !have.has(s.id)).map(s => ({
    tenant_id: tenantId, student_id: s.id, full_name: studentName(s), last_class: s.class_groups?.name ?? null, graduation_year: year,
    email: s.users?.email ?? null, source: "graduated", status: "active"
  }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await svc.from("alumni").insert(rows.slice(i, i + 500));
    if (error) throw new CrmError(error.message);
  }
  return rows.length;
}
