import { NextRequest, NextResponse } from "next/server";
import { requireCtx, ROLES } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { loadMarks } from "@/lib/attendance-server";
import { chronicAbsence, frequentLateness, dailyTrend, weekdayPattern, trendDirection, summarize, localParts, addDays, weekday } from "@/lib/attendance";
import { studentName } from "@/lib/school";

export const dynamic = "force-dynamic";

/**
 * Attendance analytics for a period (default the last 30 days): the school's
 * rate and trend, each class, days of the week, chronic absence (below the
 * school's threshold), frequent lateness, missed lessons, and today's registers still to take.
 */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "attendance");
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  const u = new URL(req.url).searchParams;
  const today = localParts(new Date(), ctx.tenant.timezone).date;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(u.get("to") ?? "") ? u.get("to")! : today;
  const from = /^\d{4}-\d{2}-\d{2}$/.test(u.get("from") ?? "") ? u.get("from")! : addDays(to, -30);
  const cg = u.get("class_group_id");
  // Reading through the service client after the staff check: analytics need every class.
  const svc = createServiceClient();
  const [marks, { data: settings }, { data: classes }, { data: students }, { data: lessons }, { data: todayMarks }] = await Promise.all([
    loadMarks(svc, tid, from, to, cg),
    svc.from("tenant_settings").select("chronic_absence_pct,school_weekdays").eq("tenant_id", tid).maybeSingle(),
    svc.from("class_groups").select("id,name,form_teacher_id,users:form_teacher_id(full_name)").eq("tenant_id", tid).order("name"),
    svc.from("students").select("id,first_name,last_name,other_names,admission_no,class_group_id").eq("tenant_id", tid).eq("status", "active"),
    svc.from("lesson_attendance").select("student_id,status").eq("tenant_id", tid).gte("date", from).lte("date", to).eq("status", "absent").limit(20000),
    svc.from("class_attendance").select("class_group_id").eq("tenant_id", tid).eq("date", today)
  ]);
  const threshold = settings?.chronic_absence_pct ?? 90;
  const byId = new Map((students ?? []).map((s: any) => [s.id, s]));
  const className = new Map((classes ?? []).map((c: any) => [c.id, c.name]));
  const who = (id: string) => { const s: any = byId.get(id); return s ? { name: studentName(s), admission_no: s.admission_no, class_name: className.get(s.class_group_id) ?? null } : { name: "Former student", admission_no: null, class_name: null }; };
  const trend = dailyTrend(marks);
  const perClass = (classes ?? []).filter((c: any) => !cg || c.id === cg).map((c: any) => ({ id: c.id, name: c.name, ...summarize(marks.filter(m => m.class_group_id === c.id)) }))
    .filter((c: any) => c.days > 0).sort((a: any, b: any) => (a.rate ?? 0) - (b.rate ?? 0));
  const missed = new Map<string, number>();
  for (const l of lessons ?? []) if (byId.has(l.student_id) && (!cg || (byId.get(l.student_id) as any).class_group_id === cg)) missed.set(l.student_id, (missed.get(l.student_id) ?? 0) + 1);
  const isSchoolDay = (settings?.school_weekdays ?? [1, 2, 3, 4, 5]).includes(weekday(today));
  const taken = new Set((todayMarks ?? []).map((m: any) => m.class_group_id));
  return NextResponse.json({
    from, to, threshold, overall: summarize(marks), trend, change: trendDirection(trend), weekdays: weekdayPattern(marks), classes: perClass,
    chronic: chronicAbsence(marks, { thresholdPct: threshold }).slice(0, 200).map(c => ({ ...c, ...who(c.student_id) })),
    lateness: frequentLateness(marks, 5).slice(0, 100).map(c => ({ ...c, ...who(c.student_id) })),
    missed_lessons: [...missed].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 100).map(([id, n]) => ({ student_id: id, lessons: n, ...who(id) })),
    unmarked_today: isSchoolDay ? (classes ?? []).filter((c: any) => !taken.has(c.id) && (students ?? []).some((s: any) => s.class_group_id === c.id))
      .map((c: any) => ({ id: c.id, name: c.name, form_teacher: c.users?.full_name ?? null })) : []
  });
}
