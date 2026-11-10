import { NextResponse } from "next/server";
import { requireCtx, ROLES } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { fetchAll } from "@/lib/results";
import { attendanceByDay, attendanceRate, countBy, dayIn, feeSummary, highlights, lastDays, lastMonths, pct, sumByMonth } from "@/lib/analysis";
import { activitySummary } from "@/lib/analysis-staff";

export const dynamic = "force-dynamic";

/**
 * The analysis dashboard: the whole school in one view, for school admins and principals.
 * Every figure is for this school only (tenant_id on every query). A part whose module is
 * switched off is left out; a part that fails to load is shown as unavailable instead of
 * breaking the page.
 */
export async function GET() {
  const ctx = await requireCtx(ROLES.admin);
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  const tz = ctx.tenant.timezone || "Africa/Lagos";
  const svc = createServiceClient();
  const on = (m: string) => ctx.tenant.modules?.[m] !== false;

  const today = dayIn(new Date(), tz);
  const days = lastDays(today, 30);
  const months = lastMonths(today, 6);
  const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const since6m = new Date(Date.parse(`${months[0]}-01T00:00:00Z`) - 86_400_000).toISOString();
  const failed: string[] = [];

  /** One part of the dashboard; on any error it is reported as unavailable, never thrown. */
  async function part<T>(name: string, run: () => Promise<T>): Promise<T | null> {
    try { return await run(); } catch { failed.push(name); return null; }
  }
  /** A row count, without fetching the rows. */
  async function count(table: string, where: (q: any) => any, schema?: string): Promise<number> {
    const base = (schema ? (svc as any).schema(schema) : svc).from(table).select("id", { count: "exact", head: true }).eq("tenant_id", tid);
    const { count: n, error } = await where(base);
    if (error) throw new Error(error.message);
    return n ?? 0;
  }

  const { data: term } = await svc.from("terms").select("id,name,starts_on,ends_on").eq("tenant_id", tid).eq("is_current", true).maybeSingle();

  const [people, attendance, fees, academics, admissions, welfare, library, engagement, activity, shop, learning, boarding] = await Promise.all([
    part("people", async () => {
      const [students, classes, staff, guardians] = await Promise.all([
        fetchAll<{ id: string; gender: string | null; class_group_id: string | null; created_at: string }>(() =>
          svc.from("students").select("id,gender,class_group_id,created_at").eq("tenant_id", tid).eq("status", "active").order("id")),
        svc.from("class_groups").select("id,name,level").eq("tenant_id", tid).then((r: any) => r.data ?? []),
        fetchAll<{ status: string; department: string | null }>(() => svc.from("staff").select("id,status,department").eq("tenant_id", tid).order("id")),
        count("guardians", q => q)
      ]);
      const className = new Map<string, string>(classes.map((c: { id: string; name: string }) => [c.id, c.name]));
      const gender = countBy(students, s => (s.gender ?? "").toLowerCase().startsWith("f") ? "Female" : (s.gender ?? "").toLowerCase().startsWith("m") ? "Male" : null);
      return {
        students: students.length,
        new_30: students.filter(s => s.created_at >= since30).length,
        gender,
        by_class: countBy(students, s => s.class_group_id ? className.get(s.class_group_id) ?? null : null),
        classes: classes.length,
        staff: staff.filter(s => s.status !== "exited").length,
        staff_on_leave: staff.filter(s => s.status === "on_leave").length,
        by_department: countBy(staff.filter(s => s.status !== "exited"), s => s.department),
        parents: guardians,
        ratio: staff.length ? Math.round((students.length / Math.max(1, staff.filter(s => s.status === "active").length)) * 10) / 10 : null
      };
    }),
    on("attendance") ? part("attendance", async () => {
      const marks = await fetchAll<{ date: string; status: string }>(() =>
        svc.from("class_attendance").select("id,date,status").eq("tenant_id", tid).gte("date", days[0]).lte("date", today).order("id"));
      const daily = attendanceByDay(marks, days);
      return { today: daily[daily.length - 1]!, rate_30: attendanceRate(marks), daily,
        absent_today: marks.filter(m => m.date === today && m.status === "absent").length,
        late_today: marks.filter(m => m.date === today && m.status === "late").length };
    }) : null,
    on("fees") ? part("fees", async () => {
      const [invoices, payments, expenses] = await Promise.all([
        term ? fetchAll<{ total: number; amount_paid: number; status: string; due_date: string | null }>(() =>
          svc.from("fee_invoices").select("id,total,amount_paid,status,due_date").eq("tenant_id", tid).eq("term_id", term.id).order("id")) : Promise.resolve([]),
        fetchAll<{ amount: number; paid_at: string | null; method: string | null }>(() =>
          svc.from("fee_payments").select("id,amount,paid_at,method").eq("tenant_id", tid).eq("status", "success").gte("paid_at", since6m).order("id")),
        fetchAll<{ amount: number; spent_on: string | null; category: string | null }>(() =>
          svc.from("expenses").select("id,amount,spent_on,category").eq("tenant_id", tid).gte("spent_on", days[0]).order("id")).catch(() => [])
      ]);
      const by_month = sumByMonth(payments.map(p => ({ at: p.paid_at, amount: p.amount })), months, tz);
      const collected_30 = payments.filter(p => p.paid_at && p.paid_at >= since30).reduce((s, p) => s + (Number(p.amount) || 0), 0);
      return { term: feeSummary(invoices, today), by_month, collected_30: Math.round(collected_30 * 100) / 100,
        by_method: countBy(payments.filter(p => p.paid_at && p.paid_at >= since30), p => p.method),
        expenses_30: Math.round(expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0) * 100) / 100 };
    }) : null,
    part("academics", async () => {
      const [cards, examsOpen, attempts30, homework30, submissions30] = await Promise.all([
        on("results") && term ? fetchAll<{ status: string; average: number | null }>(() =>
          svc.from("report_cards").select("id,status,average").eq("tenant_id", tid).eq("term_id", term.id).order("id")) : Promise.resolve(null),
        on("exams") ? count("exams", q => q.eq("status", "published")) : Promise.resolve(null),
        on("exams") ? count("exam_attempts", q => q.gte("submitted_at", since30)) : Promise.resolve(null),
        on("homework") ? count("homework", q => q.gte("created_at", since30)) : Promise.resolve(null),
        on("homework") ? count("homework_submissions", q => q.gte("submitted_at", since30)) : Promise.resolve(null)
      ]);
      const avgs = (cards ?? []).map(c => Number(c.average)).filter(Number.isFinite);
      return {
        report_cards: cards ? { total: cards.length, published: cards.filter(c => c.status === "published").length,
          not_published: cards.filter(c => c.status !== "published").length,
          average: avgs.length ? Math.round((avgs.reduce((a, b) => a + b, 0) / avgs.length) * 10) / 10 : null,
          bands: countBy(avgs, a => a >= 70 ? "70 and above" : a >= 50 ? "50 to 69" : a >= 40 ? "40 to 49" : "Below 40") } : null,
        exams_open: examsOpen, exam_attempts_30: attempts30, homework_30: homework30, homework_submissions_30: submissions30
      };
    }),
    on("admissions") ? part("admissions", async () => {
      const [leads, applications30, enrolled30] = await Promise.all([
        fetchAll<{ stage: string; next_follow_up_at: string | null; source: string | null }>(() =>
          svc.from("admission_leads").select("id,stage,next_follow_up_at,source").eq("tenant_id", tid).not("stage", "in", "(enrolled,lost)").order("id")),
        count("applications", q => q.gte("created_at", since30)),
        count("applications", q => q.eq("status", "enrolled").gte("updated_at", since30))
      ]);
      return { open_leads: leads.length, by_stage: countBy(leads, l => l.stage), by_source: countBy(leads, l => l.source),
        no_follow_up: leads.filter(l => !l.next_follow_up_at).length, applications_30: applications30, enrolled_30: enrolled30 };
    }) : null,
    part("welfare", async () => {
      const [behaviour30, sickbay30, ticketsOpen] = await Promise.all([
        on("behaviour") ? count("behaviour_incidents", q => q.gte("occurred_at", since30)) : Promise.resolve(null),
        on("health") ? count("sickbay_visits", q => q.gte("at", since30)) : Promise.resolve(null),
        on("community") ? count("tickets", q => q.not("status", "in", "(resolved,closed)")) : Promise.resolve(null)
      ]);
      return { behaviour_30: behaviour30, sickbay_30: sickbay30, tickets_open: ticketsOpen };
    }),
    on("library") ? part("library", async () => {
      const loans = await fetchAll<{ due_at: string | null }>(() => svc.from("library_loans").select("id,due_at").eq("tenant_id", tid).is("returned_at", null).order("id"));
      const now = new Date().toISOString();
      return { on_loan: loans.length, overdue: loans.filter(l => l.due_at && l.due_at < now).length };
    }) : null,
    part("engagement", async () => {
      const [notices30, lessons30, signins30] = await Promise.all([
        count("notices", q => q.not("sent_at", "is", null).gte("sent_at", since30)),
        on("live") ? count("class_sessions", q => q.gte("started_at", since30), "live") : Promise.resolve(null),
        on("gate") ? count("gate_events", q => q.eq("direction", "in").gte("at", since30)) : Promise.resolve(null)
      ]);
      return { notices_30: notices30, live_lessons_30: lessons30, gate_signins_30: signins30 };
    }),
    // Everything done in the school in 30 days (the change history), by area, by role and by day.
    part("activity", async () => {
      const [logs, users] = await Promise.all([
        fetchAll<{ action: string; actor_id: string | null; ts: string }>(() => svc.from("audit_logs").select("id,action,actor_id,ts").eq("tenant_id", tid).gte("ts", since30).order("id"), 100_000),
        fetchAll<{ id: string; role: string; active: boolean }>(() => svc.from("users").select("id,role,active").eq("tenant_id", tid).order("id"))
      ]);
      const roleOf = new Map(users.map(u => [u.id, u.role]));
      const sum = activitySummary(logs, roleOf, days, ts => dayIn(ts, tz));
      const activeBy = new Map<string, Set<string>>();
      for (const l of logs) if (l.actor_id && roleOf.has(l.actor_id)) { const r = roleOf.get(l.actor_id)!; activeBy.set(r, (activeBy.get(r) ?? new Set()).add(l.actor_id)); }
      const accounts = countBy(users.filter(u => u.active !== false), u => u.role);
      return { ...sum, accounts: accounts.map(a => ({ role: a.key.replace(/_/g, " "), accounts: a.count, active_30: activeBy.get(a.key)?.size ?? 0 })) };
    }),
    on("wallet") ? part("shop", async () => {
      const ev = await fetchAll<{ kind: string; amount: number | null; student_id: string | null }>(() =>
        svc.from("shop_events").select("id,kind,amount,student_id").eq("tenant_id", tid).gte("created_at", since30).in("kind", ["purchase", "refused", "topup", "exhausted"]).order("id"));
      const sales = ev.filter(e => e.kind === "purchase");
      return { sales_30: sales.length, takings_30: Math.round(sales.reduce((a, e) => a + (Number(e.amount) || 0), 0) * 100) / 100,
        buyers_30: new Set(sales.map(e => e.student_id)).size, refused_30: ev.filter(e => e.kind === "refused").length,
        topups_30: Math.round(ev.filter(e => e.kind === "topup").reduce((a, e) => a + (Number(e.amount) || 0), 0) * 100) / 100,
        emptied_30: ev.filter(e => e.kind === "exhausted").length };
    }) : null,
    on("lms") ? part("learning", async () => {
      const [act, done, joins] = await Promise.all([
        fetchAll<{ student_id: string }>(() => svc.from("learning_activity").select("id,student_id").eq("tenant_id", tid).gte("on_date", days[0]).order("id")).catch(() => []),
        count("content_attempts", q => q.in("status", ["completed", "passed"]).gte("completed_at", since30)).catch(() => null),
        // (this table has no id column: count on its own key)
        svc.from("online_lesson_joins").select("lesson_id", { count: "exact", head: true }).eq("tenant_id", tid).gte("joined_at", since30).then((r: any) => (r.error ? null : r.count ?? 0))
      ]);
      return { active_students_30: new Set(act.map(a => a.student_id)).size, lessons_completed_30: done, online_joins_30: joins };
    }) : null,
    part("boarding", async () => {
      const [boarders, out, clubs, members] = await Promise.all([
        on("hostel") ? count("hostel_allocations", q => q.is("ended_at", null)).catch(() => null) : Promise.resolve(null),
        on("hostel") ? count("exeat_requests", q => q.eq("status", "out")).catch(() => null) : Promise.resolve(null),
        on("events") ? count("cc_groups", q => q.eq("active", true)).catch(() => null) : Promise.resolve(null),
        on("events") ? fetchAll<{ student_id: string }>(() => svc.from("cc_members").select("group_id,student_id").eq("tenant_id", tid).eq("status", "active").order("group_id").order("student_id")).catch(() => []) : Promise.resolve([])
      ]);
      return { boarders, out_on_exeat: out, clubs, students_in_clubs: new Set(members.map(m => m.student_id)).size };
    })
  ]);

  return NextResponse.json({
    school: ctx.tenant.name, generated_at: new Date().toISOString(), today, timezone: tz,
    term: term ? { id: term.id, name: term.name, starts_on: term.starts_on, ends_on: term.ends_on } : null,
    people, attendance, fees, academics, admissions, welfare, library, engagement, activity, shop, learning, boarding,
    unavailable: failed,
    highlights: highlights({
      attendance_today: attendance?.today.rate ?? null, attendance_30: attendance?.rate_30 ?? null,
      fee_rate: fees?.term.rate ?? null, overdue_invoices: fees?.term.overdue_invoices ?? 0,
      open_tickets: welfare?.tickets_open ?? 0, overdue_books: library?.overdue ?? 0,
      unpublished_cards: academics?.report_cards?.not_published ?? 0, leads_waiting: admissions?.no_follow_up ?? 0
    }),
    ratio_note: people?.ratio ? `${people.ratio} students per member of staff` : null,
    share_female: people ? pct(people.gender.find(g => g.key === "Female")?.count ?? 0, people.students) : null
  });
}
