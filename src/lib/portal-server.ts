/**
 * Data for the portals: a student's day, a teacher's day and to-do list, each
 * child at a glance for families, and the head's key numbers (kept daily for
 * trends). The rules live in portal.ts.
 */
import { localParts, weekday, type Mark } from "./attendance";
import { currentTerm } from "./school";
import {
  dayPlan, homeworkStatus, feeSummary, attendanceRate, teacherTasks, childGlance, kpis,
  type PeriodRow, type LessonRow, type HomeworkItem, type ChildGlance, type Kpis
} from "./portal";

const DAY = 86400_000;
const lessonOf = (e: any, extra: Partial<LessonRow> = {}): LessonRow => ({
  id: e.id, period_id: e.period_id, subject: e.subjects?.name ?? null, class_name: e.class_groups?.name ?? null, class_group_id: e.class_group_id ?? null,
  teacher: e.users?.full_name ?? null, room: e.rooms?.name ?? e.room ?? null, ...extra
});

async function termStart(sb: any, tenantId: string): Promise<{ id: string | null; starts_on: string | null }> {
  const t: any = await currentTerm(sb, tenantId);
  return { id: t?.id ?? null, starts_on: t?.starts_on ?? null };
}

/** A student's day, read as the student (row-level security applies). */
export async function studentToday(sb: any, tenantId: string, timeZone: string, student: { id: string; class_group_id: string | null }) {
  const now = new Date();
  const { date, minutes } = localParts(now, timeZone);
  const cg = student.class_group_id;
  const term = await termStart(sb, tenantId);
  const since = term.starts_on ?? new Date(now.getTime() - 90 * DAY).toISOString().slice(0, 10);
  const [{ data: periods }, entries, hw, { data: subs }, { data: loans }, { data: marks }, { data: seeFees }] = await Promise.all([
    sb.from("timetable_periods").select("id,name,starts_at,ends_at,position,is_break").eq("tenant_id", tenantId).order("position"),
    cg ? sb.from("timetable_entries").select("id,period_id,class_group_id,room,subjects(name),users(full_name)").eq("tenant_id", tenantId).eq("class_group_id", cg).eq("day", weekday(date)) : { data: [] },
    cg ? sb.from("homework").select("id,title,due_at,allow_late,max_score,subjects(name)").eq("tenant_id", tenantId).eq("class_group_id", cg)
      .gte("due_at", new Date(now.getTime() - 21 * DAY).toISOString()).lte("due_at", new Date(now.getTime() + 21 * DAY).toISOString()).order("due_at").limit(100) : { data: [] },
    sb.from("homework_submissions").select("homework_id,submitted_at,late,score,marked_at,feedback").eq("student_id", student.id).gte("submitted_at", new Date(now.getTime() - 60 * DAY).toISOString()),
    sb.from("library_loans").select("id,due_at,library_books(title)").eq("student_id", student.id).is("returned_at", null).order("due_at"),
    sb.from("class_attendance").select("status").eq("student_id", student.id).gte("date", since).limit(400),
    sb.rpc("students_see_fees")
  ]);
  const homework = homeworkStatus((hw.data ?? []).map((h: any) => ({ id: h.id, title: h.title, subject: h.subjects?.name ?? null, due_at: h.due_at, allow_late: h.allow_late, max_score: h.max_score })), subs ?? [], now, timeZone);
  let fees = null;
  if (seeFees !== false) {
    const { data: inv } = await sb.from("fee_invoices").select("total,amount_paid,status,due_date").eq("student_id", student.id);
    fees = feeSummary(inv ?? [], date);
  }
  const m = (marks ?? []) as { status: Mark }[];
  return {
    date,
    plan: dayPlan((periods ?? []) as PeriodRow[], (entries.data ?? []).map((e: any) => lessonOf(e)), minutes),
    homework: trimHomework(homework),
    loans: (loans ?? []).map((l: any) => ({ id: l.id, title: l.library_books?.title ?? "Book", due_at: l.due_at, overdue: new Date(l.due_at) < now })),
    fees,
    attendance: { rate: attendanceRate(m), absences: m.filter(x => x.status === "absent").length, late: m.filter(x => x.status === "late").length, days: m.length }
  };
}

/** Everything still to do, plus the last few marked pieces. */
function trimHomework(items: HomeworkItem[]) {
  const open = items.filter(h => h.state !== "marked" && h.state !== "submitted");
  const done = items.filter(h => h.state === "submitted" || h.state === "marked").slice(0, 4);
  return [...open, ...done];
}

/** A teacher's day: lessons (their own and any they cover) with register status, a to-do list, and their classes. */
export async function teacherToday(sb: any, tenantId: string, timeZone: string, userId: string) {
  const now = new Date();
  const { date, minutes } = localParts(now, timeZone);
  const sel = "id,period_id,class_group_id,room,subjects(name),class_groups(name)";
  const term = await termStart(sb, tenantId);
  const [{ data: periods }, { data: mine }, { data: covers }, { data: offerings }, { data: formClasses }, { data: myHw }, { data: notes }, { data: convs }] = await Promise.all([
    sb.from("timetable_periods").select("id,name,starts_at,ends_at,position,is_break").eq("tenant_id", tenantId).order("position"),
    sb.from("timetable_entries").select(sel).eq("tenant_id", tenantId).eq("teacher_id", userId).eq("day", weekday(date)),
    sb.from("cover_assignments").select(`timetable_entries(${sel})`).eq("tenant_id", tenantId).eq("date", date).eq("cover_user_id", userId),
    sb.from("subject_offerings").select("class_group_id,subject_id,subjects(name),class_groups(name)").eq("tenant_id", tenantId).eq("teacher_id", userId),
    sb.from("class_groups").select("id,name").eq("tenant_id", tenantId).eq("form_teacher_id", userId),
    sb.from("homework").select("id").eq("tenant_id", tenantId).eq("set_by", userId).gte("created_at", new Date(now.getTime() - 120 * DAY).toISOString()).limit(500),
    sb.from("lesson_notes").select("id").eq("tenant_id", tenantId).eq("author_id", userId).eq("status", "returned"),
    sb.from("conversations").select("staff_unread").eq("tenant_id", tenantId).eq("staff_user_id", userId).eq("status", "open").gt("staff_unread", 0)
  ]);
  const lessons: LessonRow[] = [
    ...(mine ?? []).map((e: any) => lessonOf(e)),
    ...(covers ?? []).map((c: any) => c.timetable_entries).filter(Boolean).map((e: any) => lessonOf(e, { cover: true }))
  ];
  const periodIds = [...new Set(lessons.map(l => l.period_id))];
  const { data: taken } = periodIds.length
    ? await sb.from("lesson_attendance").select("period_id,class_group_id").eq("tenant_id", tenantId).eq("date", date).in("period_id", periodIds).limit(5000)
    : { data: [] };
  const done = new Set((taken ?? []).map((t: any) => `${t.period_id}|${t.class_group_id}`));
  for (const l of lessons) l.register_taken = done.has(`${l.period_id}|${l.class_group_id}`);
  const slots = dayPlan((periods ?? []) as PeriodRow[], lessons, minutes);

  const hwIds = (myHw ?? []).map((h: any) => h.id);
  const { data: unmarked } = hwIds.length
    ? await sb.from("homework_submissions").select("submitted_at").in("homework_id", hwIds).is("marked_at", null).is("score", null).order("submitted_at").limit(1000)
    : { data: [] };
  const oldest = unmarked?.[0]?.submitted_at ? Math.floor((now.getTime() - new Date(unmarked[0].submitted_at).getTime()) / DAY) : 0;

  const pairs = new Set((offerings ?? []).map((o: any) => `${o.class_group_id}|${o.subject_id}`));
  const classIds = [...new Set((offerings ?? []).map((o: any) => o.class_group_id))];
  const { data: sheets } = term.id && classIds.length
    ? await sb.from("score_sheets").select("class_group_id,subject_id,status").eq("tenant_id", tenantId).eq("term_id", term.id).in("class_group_id", classIds)
    : { data: [] };
  const mySheets = (sheets ?? []).filter((s: any) => pairs.has(`${s.class_group_id}|${s.subject_id}`));

  return {
    date,
    plan: slots,
    tasks: teacherTasks({
      slots, toMark: (unmarked ?? []).length, oldestUnmarkedDays: oldest, sheets: mySheets,
      notesReturned: (notes ?? []).length, unread: (convs ?? []).reduce((a: number, c: any) => a + (c.staff_unread ?? 0), 0)
    }),
    classes: (offerings ?? []).map((o: any) => ({ class_group_id: o.class_group_id, class_name: o.class_groups?.name ?? "", subject: o.subjects?.name ?? "" }))
      .sort((a: any, b: any) => a.class_name.localeCompare(b.class_name) || a.subject.localeCompare(b.subject)),
    form_classes: formClasses ?? []
  };
}

/** Each child at a glance for their family: attendance this term, homework, fees. Read with the service client after the guardian is identified. */
export async function familyGlance(svc: any, tenantId: string, timeZone: string, kids: { id: string; class_group_id: string | null }[]): Promise<Record<string, ChildGlance & { next_homework: { title: string; subject: string | null; due_at: string } | null }>> {
  const out: Record<string, any> = {};
  if (!kids.length) return out;
  const now = new Date();
  const { date } = localParts(now, timeZone);
  const ids = kids.map(k => k.id);
  const classIds = [...new Set(kids.map(k => k.class_group_id).filter(Boolean))] as string[];
  const term = await termStart(svc, tenantId);
  const since = term.starts_on ?? new Date(now.getTime() - 90 * DAY).toISOString().slice(0, 10);
  const [{ data: marks }, { data: hw }, { data: subs }, { data: inv }] = await Promise.all([
    svc.from("class_attendance").select("student_id,status").eq("tenant_id", tenantId).in("student_id", ids).gte("date", since).limit(5000),
    classIds.length ? svc.from("homework").select("id,class_group_id,title,due_at,subjects(name)").eq("tenant_id", tenantId).in("class_group_id", classIds)
      .gte("due_at", new Date(now.getTime() - 21 * DAY).toISOString()).lte("due_at", new Date(now.getTime() + 21 * DAY).toISOString()).limit(1000) : { data: [] },
    svc.from("homework_submissions").select("homework_id,student_id,submitted_at,score,marked_at").eq("tenant_id", tenantId).in("student_id", ids).gte("submitted_at", new Date(now.getTime() - 60 * DAY).toISOString()).limit(5000),
    svc.from("fee_invoices").select("student_id,total,amount_paid,status,due_date").eq("tenant_id", tenantId).in("student_id", ids).limit(2000)
  ]);
  for (const k of kids) {
    const items = homeworkStatus(
      (hw ?? []).filter((h: any) => h.class_group_id === k.class_group_id).map((h: any) => ({ id: h.id, title: h.title, subject: h.subjects?.name ?? null, due_at: h.due_at })),
      (subs ?? []).filter((s: any) => s.student_id === k.id), now, timeZone);
    const next = items.find(h => h.state === "due_today" || h.state === "due");
    out[k.id] = {
      ...childGlance({
        marks: (marks ?? []).filter((m: any) => m.student_id === k.id),
        homework: items,
        fees: feeSummary((inv ?? []).filter((i: any) => i.student_id === k.id), date),
        now
      }),
      next_homework: next ? { title: next.title, subject: next.subject, due_at: next.due_at } : null
    };
  }
  return out;
}

/** The head's key numbers for today. Uses the service client; callers check the role first. */
export async function schoolKpis(svc: any, tenantId: string, timeZone: string): Promise<Kpis> {
  const now = new Date();
  const { date } = localParts(now, timeZone);
  const term = await termStart(svc, tenantId);
  const head = (t: string) => svc.from(t).select("tenant_id", { count: "exact", head: true }).eq("tenant_id", tenantId);
  const [students, staff, leave, classes, marks, termInv, overdue, library, stock, incidents, apps, admitted] = await Promise.all([
    head("students").eq("status", "active"),
    head("staff").neq("status", "exited"),
    head("leave_requests").eq("status", "approved").lte("starts_on", date).gte("ends_on", date),
    head("class_groups"),
    svc.from("class_attendance").select("class_group_id,status").eq("tenant_id", tenantId).eq("date", date).limit(20000),
    term.id ? svc.from("fee_invoices").select("total,amount_paid").eq("tenant_id", tenantId).eq("term_id", term.id).neq("status", "void").limit(20000) : { data: [] },
    svc.from("fee_invoices").select("total,amount_paid").eq("tenant_id", tenantId).in("status", ["issued", "part_paid"]).lt("due_date", date).limit(20000),
    head("library_loans").is("returned_at", null).lt("due_at", now.toISOString()),
    svc.from("inventory_items").select("quantity,reorder_level").eq("tenant_id", tenantId).gt("reorder_level", 0).limit(5000),
    head("behaviour_incidents").gte("occurred_at", new Date(now.getTime() - 7 * DAY).toISOString()),
    head("applications").in("status", ["new", "reviewing", "assessment", "interview", "offered"]),
    term.starts_on ? head("students").gte("admitted_on", term.starts_on) : { count: 0 }
  ]);
  const sum = (rows: any[] | null, k: string) => (rows ?? []).reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const od = (overdue.data ?? []) as any[];
  return kpis({
    students: students.count ?? 0, staff: staff.count ?? 0, staffOnLeave: leave.count ?? 0,
    classes: classes.count ?? 0,
    classesMarked: new Set((marks.data ?? []).map((m: any) => m.class_group_id).filter(Boolean)).size,
    marksToday: (marks.data ?? []) as { status: Mark }[],
    billed: sum(termInv.data, "total"), paid: sum(termInv.data, "amount_paid"),
    overdueInvoices: od.length, overdueAmount: od.reduce((a, r) => a + Math.max(0, Number(r.total) - Number(r.amount_paid)), 0),
    libraryOverdue: library.count ?? 0,
    lowStock: (stock.data ?? []).filter((s: any) => Number(s.quantity) <= Number(s.reorder_level)).length,
    incidentsWeek: incidents.count ?? 0, applicationsOpen: apps.count ?? 0, admittedThisTerm: admitted.count ?? 0
  });
}

/**
 * Keeps each school's numbers for the trend lines, once a day after school
 * (4pm local time by default) so the day's registers are in. Run from the
 * every-minute job; does a few schools per run. Returns how many were recorded.
 */
export async function snapshotKpis(svc: any, at = new Date(), afterMinutes = 16 * 60, perRun = 20): Promise<number> {
  const { data: tenants } = await svc.from("tenants").select("id,timezone,status").limit(5000);
  const due = (tenants ?? []).filter((t: any) => !t.status || t.status === "active")
    .map((t: any) => { const tz = t.timezone ?? "Africa/Lagos"; const p = localParts(at, tz); return { id: t.id as string, tz, day: p.date, minutes: p.minutes }; })
    .filter((t: { minutes: number }) => t.minutes >= afterMinutes);
  if (!due.length) return 0;
  const first = due.map((t: { day: string }) => t.day).sort()[0];
  const { data: have } = await svc.from("kpi_snapshots").select("tenant_id,day").in("tenant_id", due.map((t: { id: string }) => t.id)).gte("day", first).limit(10000);
  const done = new Set((have ?? []).map((h: any) => `${h.tenant_id}|${h.day}`));
  let n = 0;
  for (const t of due.filter((x: { id: string; day: string }) => !done.has(`${x.id}|${x.day}`)).slice(0, perRun)) {
    try {
      const metrics = await schoolKpis(svc, t.id, t.tz);
      await svc.from("kpi_snapshots").upsert({ tenant_id: t.id, day: t.day, metrics }, { onConflict: "tenant_id,day" });
      n++;
    } catch { /* one school failing does not stop the rest */ }
  }
  return n;
}
