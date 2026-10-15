/**
 * Builds one person's calendar: what their role, classes and children make
 * relevant. Used by the calendar page and the private feed for Google
 * Calendar and Outlook. Every query filters on the tenant passed in.
 */
import { ROLES } from "./auth";
import { expandTimetable, type CalItem, type CalKind } from "./calendar";
import { addDays, localParts, zonedToUtc } from "./attendance";
import { studentName } from "./school";
import { sha256hex, randomToken } from "./crypto";

type Who = { tenantId: string; timezone: string; userId: string; roles: Set<string> };

export async function buildCalendar(svc: any, who: Who, from: string, to: string): Promise<CalItem[]> {
  const { tenantId: tid, timezone: tz, userId } = who;
  const staff = ROLES.staff.some(r => who.roles.has(r));
  const admin = ROLES.admin.some(r => who.roles.has(r));
  const fromIso = zonedToUtc(`${from} 00:00`, tz)!.toISOString(), toIso = zonedToUtc(`${addDays(to, 1)} 00:00`, tz)!.toISOString();
  const local = (iso: string) => localParts(new Date(iso), tz).date;

  // Whose classes: a student's own, a parent's children's, a teacher's.
  let classIds: string[] = [], studentIds: string[] = [], myStudent: { id: string; class_group_id: string | null } | null = null;
  const { data: st } = await svc.from("students").select("id,class_group_id").eq("tenant_id", tid).eq("user_id", userId).eq("status", "active").maybeSingle();
  if (st) { myStudent = st; studentIds = [st.id]; if (st.class_group_id) classIds = [st.class_group_id]; }
  const { data: g } = await svc.from("guardians").select("id").eq("tenant_id", tid).eq("user_id", userId).maybeSingle();
  let kids: { id: string; first_name: string; last_name: string; other_names: string | null; class_group_id: string | null }[] = [];
  if (g) {
    const { data: links } = await svc.from("student_guardians").select("students(id,first_name,last_name,other_names,class_group_id,status)").eq("tenant_id", tid).eq("guardian_id", g.id);
    kids = (links ?? []).map((l: any) => l.students).filter((s: any) => s && s.status === "active");
    studentIds = [...studentIds, ...kids.map(k => k.id)];
    classIds = [...new Set([...classIds, ...kids.map(k => k.class_group_id).filter(Boolean) as string[]])];
  }
  if (staff) {
    const [{ data: offers }, { data: forms }] = await Promise.all([
      svc.from("subject_offerings").select("class_group_id").eq("tenant_id", tid).eq("teacher_id", userId),
      svc.from("class_groups").select("id").eq("tenant_id", tid).eq("form_teacher_id", userId)
    ]);
    classIds = [...new Set([...classIds, ...(offers ?? []).map((o: any) => o.class_group_id), ...(forms ?? []).map((f: any) => f.id)])];
  }
  const forClass = (ids: string[] | null | undefined) => !ids?.length || admin || ids.some(id => classIds.includes(id));

  const [{ data: terms }, { data: events }, { data: papers }, { data: online }] = await Promise.all([
    svc.from("terms").select("id,name,starts_on,ends_on,next_term_begins,academic_sessions(name)").eq("tenant_id", tid).or(`starts_on.lte.${to},ends_on.gte.${from}`),
    svc.from("school_events").select("id,title,description,kind,starts_at,ends_at,location,class_group_ids").eq("tenant_id", tid).lt("starts_at", toIso)
      .or(`ends_at.gte.${fromIso},and(ends_at.is.null,starts_at.gte.${fromIso})`).limit(500),
    svc.from("exam_papers").select("id,title,class_group_ids,slot_date,slot_session,duration_minutes,exam_series!inner(name,status,sessions)").eq("tenant_id", tid)
      .eq("exam_series.status", "published").gte("slot_date", from).lte("slot_date", to).limit(1000),
    classIds.length || staff ? svc.from("online_lessons").select("id,title,provider,starts_at,duration_min,class_group_id,created_by,status").eq("tenant_id", tid).eq("status", "scheduled")
      .gte("starts_at", fromIso).lt("starts_at", toIso).limit(500) : { data: [] }
  ]);
  const items: CalItem[] = [];
  const add = (i: CalItem) => items.push(i);

  for (const t of terms ?? []) {
    const label = `${t.academic_sessions?.name ? `${t.academic_sessions.name} ` : ""}${t.name}`;
    if (t.starts_on && t.starts_on >= from && t.starts_on <= to) add({ id: `term-start-${t.id}`, kind: "term", title: `${label} begins`, start: t.starts_on, allDay: true });
    if (t.ends_on && t.ends_on >= from && t.ends_on <= to) add({ id: `term-end-${t.id}`, kind: "term", title: `${label} ends`, start: t.ends_on, allDay: true });
    if (t.next_term_begins && t.next_term_begins >= from && t.next_term_begins <= to) add({ id: `term-next-${t.id}`, kind: "term", title: "Next term begins", start: t.next_term_begins, allDay: true });
  }
  const holidays: string[] = [];
  for (const e of events ?? []) {
    if (!forClass(e.class_group_ids)) continue;
    if (e.kind === "holiday") {
      const s = local(e.starts_at), en = e.ends_at ? local(e.ends_at) : s;
      for (let d = s, i = 0; d <= en && i < 120; d = addDays(d, 1), i++) holidays.push(d);
      add({ id: `ev-${e.id}`, kind: "holiday", title: e.title, start: s, end: en, allDay: true, description: e.description });
    } else {
      add({ id: `ev-${e.id}`, kind: e.kind as CalKind, title: e.title, start: e.starts_at, end: e.ends_at ?? new Date(Date.parse(e.starts_at) + 3600_000).toISOString(), location: e.location, description: e.description });
    }
  }
  for (const p of papers ?? []) {
    if (!staff && !(p.class_group_ids ?? []).some((c: string) => classIds.includes(c))) continue;
    if (staff && !admin && !(p.class_group_ids ?? []).some((c: string) => classIds.includes(c))) continue;
    const sess = (p.exam_series?.sessions ?? [])[p.slot_session ?? 0];
    const start = sess?.start ? zonedToUtc(`${p.slot_date} ${sess.start}`, tz) : null;
    if (start) add({ id: `exam-${p.id}`, kind: "exam", title: `Exam: ${p.title}`, start: start.toISOString(), end: new Date(start.getTime() + p.duration_minutes * 60_000).toISOString(), description: p.exam_series?.name ?? null });
    else add({ id: `exam-${p.id}`, kind: "exam", title: `Exam: ${p.title}`, start: p.slot_date, allDay: true });
  }
  for (const l of online ?? []) {
    if (staff ? l.created_by !== userId && !classIds.includes(l.class_group_id) : !classIds.includes(l.class_group_id)) continue;
    add({ id: `online-${l.id}`, kind: "online", title: `Online lesson: ${l.title}`, start: l.starts_at, end: new Date(Date.parse(l.starts_at) + l.duration_min * 60_000).toISOString(), location: "Online" });
  }

  // Meetings with families.
  if (staff) {
    const { data: slots } = await svc.from("consultation_slots").select("id,starts_at,ends_at,location,guardian_id,students(first_name,last_name,other_names)").eq("tenant_id", tid).eq("staff_user_id", userId)
      .not("guardian_id", "is", null).gte("starts_at", fromIso).lt("starts_at", toIso);
    for (const s of slots ?? []) add({ id: `meet-${s.id}`, kind: "meeting", title: `Parent meeting: ${studentName(s.students)}`, start: s.starts_at, end: s.ends_at, location: s.location });
  }
  if (g) {
    const { data: slots } = await svc.from("consultation_slots").select("id,starts_at,ends_at,location,users!consultation_slots_staff_user_id_fkey(full_name)").eq("tenant_id", tid).eq("guardian_id", g.id)
      .gte("starts_at", fromIso).lt("starts_at", toIso);
    for (const s of slots ?? []) add({ id: `meet-${s.id}`, kind: "meeting", title: `Meeting with ${s.users?.full_name ?? "a teacher"}`, start: s.starts_at, end: s.ends_at, location: s.location });
  }

  // Staff: room bookings and cover duties.
  if (staff) {
    const [{ data: bookings }, { data: covers }] = await Promise.all([
      svc.from("room_bookings").select("id,title,starts_at,ends_at,status,rooms(name)").eq("tenant_id", tid).eq("booked_by", userId).in("status", ["pending", "confirmed"]).lt("starts_at", toIso).gt("ends_at", fromIso),
      svc.from("cover_assignments").select("id,date,class_groups:timetable_entries(class_groups(name),subjects(name)),timetable_periods(starts_at,ends_at)").eq("tenant_id", tid).eq("cover_user_id", userId).gte("date", from).lte("date", to)
    ]);
    for (const b of bookings ?? []) add({ id: `book-${b.id}`, kind: "booking", title: `${b.rooms?.name ?? "Room"}: ${b.title}${b.status === "pending" ? " (waiting)" : ""}`, start: b.starts_at, end: b.ends_at, location: b.rooms?.name ?? null });
    for (const c of covers ?? []) {
      const s = zonedToUtc(`${c.date} ${c.timetable_periods?.starts_at?.slice(0, 5)}`, tz), e = zonedToUtc(`${c.date} ${c.timetable_periods?.ends_at?.slice(0, 5)}`, tz);
      const what = c.class_groups as any;
      if (s && e) add({ id: `cover-${c.id}`, kind: "cover", title: `Cover: ${what?.class_groups?.name ?? ""} ${what?.subjects?.name ?? ""}`.trim(), start: s.toISOString(), end: e.toISOString() });
    }
  }

  // Homework deadlines for students and parents; a teacher's own homework.
  {
    let q = svc.from("homework").select("id,title,due_at,class_group_id,subjects(name),class_groups(name)").eq("tenant_id", tid).gte("due_at", fromIso).lt("due_at", toIso).limit(500);
    q = staff && !myStudent && !g ? q.eq("set_by", userId) : classIds.length ? q.in("class_group_id", classIds) : null;
    if (q) {
      const { data: hw } = await q;
      for (const h of hw ?? []) add({ id: `hw-${h.id}`, kind: "homework", title: `Homework due: ${h.subjects?.name ? `${h.subjects.name}: ` : ""}${h.title}${kids.length > 1 || staff ? ` (${h.class_groups?.name ?? ""})` : ""}`, start: h.due_at, end: h.due_at });
    }
  }

  // Weekly lessons (only for short ranges: they repeat every week).
  const days = (Date.parse(to) - Date.parse(from)) / 86400_000;
  if (days <= 45 && (staff || myStudent)) {
    let q = svc.from("timetable_entries").select("id,day,room,subjects(name),class_groups(name),timetable_periods(starts_at,ends_at)").eq("tenant_id", tid);
    q = myStudent ? (myStudent.class_group_id ? q.eq("class_group_id", myStudent.class_group_id) : null) : q.eq("teacher_id", userId);
    if (q) {
      const { data: entries } = await q;
      items.push(...expandTimetable((entries ?? []).filter((e: any) => e.timetable_periods).map((e: any) => ({
        id: `lesson-${e.id}`, day: e.day, title: myStudent ? e.subjects?.name ?? "Lesson" : `${e.class_groups?.name ?? ""} ${e.subjects?.name ?? ""}`.trim(),
        location: e.room, starts_at: e.timetable_periods.starts_at, ends_at: e.timetable_periods.ends_at
      })), from, to, tz, { closed: holidays, terms: (terms ?? []).filter((t: any) => t.starts_on && t.ends_on) }));
    }
  }
  void studentIds;
  return items.sort((a, b) => a.start.localeCompare(b.start));
}

// ---------------- private feed links ----------------

export async function createFeed(svc: any, tenantId: string, userId: string): Promise<string> {
  const token = randomToken(24);
  await svc.from("calendar_feeds").upsert({ user_id: userId, tenant_id: tenantId, token_hash: sha256hex(token), created_at: new Date().toISOString(), last_used_at: null }, { onConflict: "user_id" });
  return token;
}

export async function feedOwner(svc: any, token: string) {
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(token)) return null;
  const { data } = await svc.from("calendar_feeds").select("user_id,tenant_id,users(full_name,role,extra_roles,active),tenants(name,timezone,status)").eq("token_hash", sha256hex(token)).maybeSingle();
  if (!data || data.tenants?.status !== "active" || data.users?.active === false) return null;
  await svc.from("calendar_feeds").update({ last_used_at: new Date().toISOString() }).eq("user_id", data.user_id);
  return { userId: data.user_id as string, tenantId: data.tenant_id as string, timezone: data.tenants?.timezone ?? "Africa/Lagos", school: data.tenants?.name ?? "School",
    roles: new Set<string>([data.users?.role, ...(data.users?.extra_roles ?? [])].filter(Boolean)) };
}
