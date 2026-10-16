/**
 * Parent-side actions shared by the logged-in parent portal and the
 * passwordless /g/<token> portal: event consent (with payment), meeting
 * booking and exeat requests. Every function checks that the guardian is
 * linked to the student.
 */
import { familyReenrolment } from "./community-server";
import { familyConsent } from "./consent-server";
import { familyRecords } from "./sis-server";
import { createInvoice } from "./fees";
import { notifyGuardians, notifyContact, money } from "./notify";
import { meetingBooked } from "./messaging/notices";
import { formatInZone } from "./messaging/outbox";
import { studentName } from "./school";

async function assertLinked(svc: any, tenantId: string, guardianId: string, studentId: string) {
  const { data } = await svc.from("student_guardians").select("student_id").eq("tenant_id", tenantId).eq("guardian_id", guardianId).eq("student_id", studentId).maybeSingle();
  if (!data) throw new Error("you are not linked to this student");
}

export async function respondToEvent(svc: any, p: { tenantId: string; guardianId: string; studentId: string; eventId: string; consent: boolean; note?: string | null }) {
  await assertLinked(svc, p.tenantId, p.guardianId, p.studentId);
  const { data: ev } = await svc.from("school_events").select("*").eq("tenant_id", p.tenantId).eq("id", p.eventId).maybeSingle();
  if (!ev) throw new Error("event not found");
  if (ev.respond_by && new Date(ev.respond_by) < new Date()) throw new Error("responses for this event have closed");
  const { data: st } = await svc.from("students").select("id,class_group_id,first_name,last_name,other_names").eq("tenant_id", p.tenantId).eq("id", p.studentId).maybeSingle();
  if (ev.class_group_ids?.length && !ev.class_group_ids.includes(st?.class_group_id)) throw new Error("this event is not for your child's class");
  if (p.consent && ev.capacity) {
    const { count } = await svc.from("event_responses").select("id", { count: "exact", head: true }).eq("event_id", ev.id).eq("consent", true).neq("student_id", p.studentId);
    if ((count ?? 0) >= ev.capacity) throw new Error("this event is full");
  }
  const { data: prev } = await svc.from("event_responses").select("invoice_id").eq("event_id", ev.id).eq("student_id", p.studentId).maybeSingle();
  let invoiceId: string | null = prev?.invoice_id ?? null;
  let payToken: string | null = null;
  if (p.consent && Number(ev.fee) > 0 && !invoiceId) {
    const inv = await createInvoice(svc, { tenantId: p.tenantId, studentId: p.studentId, title: ev.title, lines: [{ description: ev.title, amount: Number(ev.fee), fee_item_id: ev.fee_item_id }] });
    invoiceId = inv.id; payToken = inv.pay_token;
  } else if (invoiceId) {
    const { data: inv } = await svc.from("fee_invoices").select("pay_token,status").eq("tenant_id", p.tenantId).eq("id", invoiceId).maybeSingle();
    if (!p.consent && inv && inv.status === "issued") { await svc.from("fee_invoices").update({ status: "void", voided_at: new Date().toISOString(), notes: "Consent withdrawn" }).eq("tenant_id", p.tenantId).eq("id", invoiceId); invoiceId = null; }
    else payToken = inv?.pay_token ?? null;
  }
  await svc.from("event_responses").upsert({ event_id: ev.id, tenant_id: p.tenantId, student_id: p.studentId, guardian_id: p.guardianId, consent: p.consent,
    note: p.note ?? null, invoice_id: invoiceId, responded_at: new Date().toISOString() }, { onConflict: "event_id,student_id" });
  return { ok: true, pay_token: payToken };
}

export async function bookMeeting(svc: any, p: { tenantId: string; guardianId: string; studentId: string; slotId: string; note?: string | null; timezone: string }) {
  await assertLinked(svc, p.tenantId, p.guardianId, p.studentId);
  const { data: want } = await svc.from("consultation_slots").select("id,starts_at,ends_at,conference_id,pt_conferences(status,booking_closes_at)").eq("tenant_id", p.tenantId).eq("id", p.slotId).maybeSingle();
  if (!want) throw new Error("that slot is no longer available");
  const conf = want.pt_conferences as { status: string; booking_closes_at: string | null } | null;
  if (conf && (conf.status !== "open" || (conf.booking_closes_at && Date.parse(conf.booking_closes_at) < Date.now()))) throw new Error("booking for this evening has closed");
  const { data: mine } = await svc.from("consultation_slots").select("starts_at,ends_at").eq("tenant_id", p.tenantId).eq("guardian_id", p.guardianId)
    .lt("starts_at", want.ends_at).gt("ends_at", want.starts_at);
  if (mine?.length) throw new Error("you already have an appointment at that time; please pick another slot");
  const { data: slot, error } = await svc.from("consultation_slots")
    .update({ guardian_id: p.guardianId, student_id: p.studentId, booked_at: new Date().toISOString(), note: p.note ?? null })
    .eq("tenant_id", p.tenantId).eq("id", p.slotId).is("guardian_id", null).gt("starts_at", new Date().toISOString())
    .select("id,starts_at,location,staff_user_id,users!consultation_slots_staff_user_id_fkey(full_name,email)").maybeSingle();
  if (error || !slot) throw new Error("that slot has just been taken; please pick another");
  const { data: st } = await svc.from("students").select("first_name,last_name,other_names").eq("id", p.studentId).maybeSingle();
  const when = (() => { const f = formatInZone(new Date(slot.starts_at), p.timezone); return `${f.date} ${f.time}`; })();
  const teacher = slot.users?.full_name ?? "the teacher";
  await notifyGuardians(svc, { tenantId: p.tenantId, studentIds: [p.studentId], kind: "meeting", refId: slot.id,
    build: (brand, g) => meetingBooked(brand, { name: g.full_name, teacher, studentName: studentName(st), when, where: slot.location }) });
  if (slot.users?.email) {
    const { data: gd } = await svc.from("guardians").select("full_name").eq("id", p.guardianId).maybeSingle();
    await notifyContact(svc, { tenantId: p.tenantId, name: teacher, email: slot.users.email, kind: "meeting",
      build: brand => meetingBooked(brand, { name: gd?.full_name ?? "A parent", teacher, studentName: studentName(st), when, where: slot.location, toTeacher: true }) });
  }
  return { ok: true, when };
}

export async function cancelMeeting(svc: any, p: { tenantId: string; guardianId: string; slotId: string }) {
  await svc.from("consultation_slots").update({ guardian_id: null, student_id: null, booked_at: null, note: null })
    .eq("tenant_id", p.tenantId).eq("id", p.slotId).eq("guardian_id", p.guardianId).gt("starts_at", new Date().toISOString());
  return { ok: true };
}

export async function requestExeat(svc: any, p: { tenantId: string; guardianId: string; studentId: string; reason: string; leaveAt: string; returnBy: string; collector?: string | null }) {
  await assertLinked(svc, p.tenantId, p.guardianId, p.studentId);
  const { data: alloc } = await svc.from("hostel_allocations").select("id").eq("tenant_id", p.tenantId).eq("student_id", p.studentId).is("ended_at", null).maybeSingle();
  if (!alloc) throw new Error("your child is not a boarder");
  if (new Date(p.returnBy) <= new Date(p.leaveAt)) throw new Error("return time must be after leaving time");
  const { data, error } = await svc.from("exeat_requests").insert({ tenant_id: p.tenantId, student_id: p.studentId, guardian_id: p.guardianId, requested_by: "guardian",
    reason: p.reason, leave_at: p.leaveAt, return_by: p.returnBy, collector_name: p.collector ?? null }).select("id").single();
  if (error) throw new Error(error.message);
  return { id: data.id };
}

/** A parent agrees (or not) to an exeat the boarding house or their child asked for. */
export async function consentExeat(svc: any, p: { tenantId: string; guardianId: string; id: string; approve: boolean }) {
  const { data: e } = await svc.from("exeat_requests").select("id,student_id,requested_by,status").eq("tenant_id", p.tenantId).eq("id", p.id).maybeSingle();
  if (!e) throw new Error("exeat not found");
  await assertLinked(svc, p.tenantId, p.guardianId, e.student_id);
  if (e.status !== "awaiting_parent") throw new Error("this exeat no longer needs your answer");
  const { exeatAfterParent } = await import("@/lib/boarding");
  const status = exeatAfterParent(e.requested_by, p.approve);
  const { data, error } = await svc.from("exeat_requests").update({ status, parent_decided_by: p.guardianId, parent_decided_at: new Date().toISOString(),
    ...(p.approve ? {} : { decision_note: "Declined by the parent" }) }).eq("id", e.id).eq("status", "awaiting_parent").select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("this exeat no longer needs your answer");
  return { status };
}

/** Everything a guardian sees beyond the basics: fees, events, meetings, homework, behaviour, attendance, boarding. */
export async function familyExtras(svc: any, tenantId: string, guardianId: string, studentIds: string[], classGroupIds: string[]) {
  if (!studentIds.length) return { invoices: [], events: [], slots: [], homework: [], behaviour: [], attendance: [], exeats: [], absences: [], currency: "NGN", bookings: [], transport: [], hostel: [], support: await familySupport(svc, tenantId, guardianId) };
  const now = new Date().toISOString();
  const since30 = new Date(Date.now() - 30 * 86400_000).toISOString();
  const [settings, invoices, events, responses, homework, behaviour, attendance, exeats, bookings, transport, hostel, teachers] = await Promise.all([
    svc.from("tenant_settings").select("currency").eq("tenant_id", tenantId).maybeSingle(),
    svc.from("fee_invoices").select("id,student_id,invoice_no,title,status,total,amount_paid,due_date,pay_token").eq("tenant_id", tenantId).in("student_id", studentIds).neq("status", "void").order("created_at", { ascending: false }).limit(50),
    svc.from("school_events").select("id,title,description,kind,starts_at,ends_at,location,class_group_ids,requires_consent,fee,respond_by,departs_at,returns_at,meeting_point").eq("tenant_id", tenantId).gte("starts_at", new Date(Date.now() - 86400_000).toISOString()).order("starts_at").limit(40),
    svc.from("event_responses").select("event_id,student_id,consent,invoice_id").eq("tenant_id", tenantId).in("student_id", studentIds),
    classGroupIds.length ? svc.from("homework").select("id,class_group_id,title,due_at,group_ids,subjects(name)").eq("tenant_id", tenantId).in("class_group_id", classGroupIds).gte("due_at", since30).order("due_at", { ascending: false }).limit(60) : { data: [] },
    svc.from("behaviour_records").select("student_id,kind,points,note,occurred_at,behaviour_categories(name)").eq("tenant_id", tenantId).in("student_id", studentIds).gte("occurred_at", since30).order("occurred_at", { ascending: false }).limit(60),
    svc.from("class_attendance").select("student_id,status").eq("tenant_id", tenantId).in("student_id", studentIds).gte("date", since30.slice(0, 10)).limit(5000),
    svc.from("exeat_requests").select("id,student_id,kind,reason,leave_at,return_by,status,decision_note,requested_by,collector_name").eq("tenant_id", tenantId).in("student_id", studentIds).order("created_at", { ascending: false }).limit(20),
    svc.from("consultation_slots").select("id,starts_at,ends_at,location,student_id,conference_id,users!consultation_slots_staff_user_id_fkey(full_name)").eq("tenant_id", tenantId).eq("guardian_id", guardianId).gte("starts_at", now).order("starts_at"),
    svc.from("transport_assignments").select("student_id,stop_name,transport_routes(name,vehicle,driver_name,driver_phone)").eq("tenant_id", tenantId).in("student_id", studentIds),
    svc.from("hostel_allocations").select("student_id,bed_label,hostel_rooms(name,hostels(name))").eq("tenant_id", tenantId).in("student_id", studentIds).is("ended_at", null),
    classGroupIds.length ? svc.from("subject_offerings").select("teacher_id,class_group_id").eq("tenant_id", tenantId).in("class_group_id", classGroupIds).not("teacher_id", "is", null) : { data: [] }
  ]);
  const teacherIds = [...new Set((teachers.data ?? []).map((t: any) => t.teacher_id))];
  const { data: slots } = teacherIds.length ? await svc.from("consultation_slots").select("id,starts_at,ends_at,location,staff_user_id,conference_id,users!consultation_slots_staff_user_id_fkey(full_name),pt_conferences(title,status,booking_closes_at)")
    .eq("tenant_id", tenantId).in("staff_user_id", teacherIds).is("guardian_id", null).gte("starts_at", now).order("starts_at").limit(1500) : { data: [] };
  // Notices for this family (the last 60 days).
  const { data: notices } = await svc.from("notice_recipients").select("id,read_at,acknowledged_at,notices!inner(id,kind,title,body,requires_ack,sent_at,expires_at,status)")
    .eq("tenant_id", tenantId).eq("guardian_id", guardianId).eq("notices.status", "sent").gte("created_at", new Date(Date.now() - 60 * 86400_000).toISOString()).order("created_at", { ascending: false }).limit(50);
  const { data: memberships } = await svc.from("learning_group_members").select("group_id").in("student_id", studentIds);
  const myGroups = new Set((memberships ?? []).map((m: any) => m.group_id));
  const { data: subs } = (homework.data ?? []).length ? await svc.from("homework_submissions").select("homework_id,student_id,submitted_at,score,late").in("student_id", studentIds).in("homework_id", (homework.data ?? []).map((h: any) => h.id)) : { data: [] };
  // Boarders: notes the house shared with the family, and this week's menus.
  const boarding = (hostel.data ?? []).length ? await Promise.all([
    svc.from("boarding_notes").select("id,student_id,kind,note,created_at").eq("tenant_id", tenantId).in("student_id", studentIds).eq("visible_to_parent", true).order("created_at", { ascending: false }).limit(30),
    svc.from("meal_menus").select("on_date,meal,items,alternatives,hostel_id").eq("tenant_id", tenantId).gte("on_date", now.slice(0, 10)).lte("on_date", new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10)).order("on_date")
  ]) : [{ data: [] }, { data: [] }];
  // Clubs and teams, competition results this past year, and where each child is on a trip.
  const eventIds = (events.data ?? []).map((e: any) => e.id);
  const [clubs, results, roster] = await Promise.all([
    svc.from("cc_members").select("student_id,status,role,cc_groups(name,meets,location)").eq("tenant_id", tenantId).in("student_id", studentIds).in("status", ["active", "requested"]),
    svc.from("competition_entries").select("id,student_id,event,position,award,score,competitions!inner(title,held_on,level)").eq("tenant_id", tenantId).in("student_id", studentIds)
      .gte("competitions.held_on", new Date(Date.now() - 365 * 86400_000).toISOString().slice(0, 10)).limit(60),
    eventIds.length ? svc.from("trip_roster").select("event_id,student_id,status,departed_at,returned_at").in("event_id", eventIds).in("student_id", studentIds) : { data: [] }
  ]);
  const { data: absences } = await svc.from("student_absence_requests").select("id,student_id,kind,starts_on,ends_on,reason,status,decision_note,created_at")
    .eq("tenant_id", tenantId).in("student_id", studentIds).gte("ends_on", new Date(Date.now() - 60 * 86400_000).toISOString().slice(0, 10)).order("starts_on", { ascending: false }).limit(40);
  return {
    currency: settings.data?.currency ?? "NGN",
    absences: absences ?? [],
    invoices: invoices.data ?? [],
    events: (events.data ?? []).map((e: any) => ({ ...e, responses: (responses.data ?? []).filter((r: any) => r.event_id === e.id), roster: (roster.data ?? []).filter((r: any) => r.event_id === e.id) })),
    clubs: clubs.data ?? [],
    competition_results: (results.data ?? []).sort((a: any, b: any) => b.competitions.held_on.localeCompare(a.competitions.held_on)),
    // Homework set for groups shows only to families with a child in one of them.
    homework: (homework.data ?? []).filter((h: any) => !h.group_ids?.length || h.group_ids.some((g: string) => myGroups.has(g)))
      .map((h: any) => ({ ...h, group_ids: undefined, submissions: (subs ?? []).filter((s: any) => s.homework_id === h.id) })),
    behaviour: behaviour.data ?? [],
    attendance: attendance.data ?? [],
    exeats: exeats.data ?? [],
    bookings: bookings.data ?? [],
    slots: (slots ?? []).filter((s: any) => !s.pt_conferences || (s.pt_conferences.status === "open" && (!s.pt_conferences.booking_closes_at || Date.parse(s.pt_conferences.booking_closes_at) > Date.now()))),
    notices: (notices ?? []).map((r: any) => ({ receipt_id: r.id, read_at: r.read_at, acknowledged_at: r.acknowledged_at, ...r.notices })),
    transport: transport.data ?? [],
    hostel: hostel.data ?? [],
    boarding_notes: boarding[0].data ?? [],
    menus: boarding[1].data ?? [],
    support: await familySupport(svc, tenantId, guardianId),
    records: await familyRecords(svc, tenantId, studentIds).catch(() => null)
  };
}

/** The family's complaints and requests, the open re-enrolment question and unanswered surveys. */
export async function familySupport(svc: any, tenantId: string, guardianId: string) {
  const [{ data: tickets }, { data: invites }, reenrolment, consent] = await Promise.all([
    svc.from("tickets").select("ticket_no,kind,subject,status,created_at,updated_at,token").eq("tenant_id", tenantId).eq("guardian_id", guardianId).order("created_at", { ascending: false }).limit(30),
    svc.from("survey_invites").select("token,surveys(title,status,closes_at)").eq("tenant_id", tenantId).eq("guardian_id", guardianId).is("responded_at", null).limit(10),
    familyReenrolment(svc, tenantId, guardianId).catch(() => null),
    familyConsent(svc, tenantId, guardianId).catch(() => null)
  ]);
  const now = new Date().toISOString();
  return {
    tickets: tickets ?? [],
    surveys: (invites ?? []).filter((i: any) => i.surveys?.status === "open" && (!i.surveys.closes_at || i.surveys.closes_at > now)).map((i: any) => ({ title: i.surveys.title, token: i.token })),
    reenrolment,
    consent
  };
}

export { money };
