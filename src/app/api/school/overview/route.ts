import { NextResponse } from "next/server";
import { requireCtx, ROLES } from "@/lib/auth";
import { currentTerm, startOfTodayIso } from "@/lib/school";

/** Numbers for the school operations dashboard. */
export async function GET() {
  const ctx = await requireCtx(ROLES.staff);
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  const sb = ctx.sb;
  const today = startOfTodayIso(ctx.tenant.timezone);
  const head = (t: string) => sb.from(t).select("id", { count: "exact", head: true }).eq("tenant_id", tid);
  const [students, staff, guardians, classes, gateToday, pendingReq, pendingLeave, openExams, published, outboxFailed, term] = await Promise.all([
    head("students").eq("status", "active"),
    head("staff").neq("status", "exited"),
    head("guardians"),
    head("class_groups"),
    sb.from("gate_events").select("person_type,direction,late,student_id,staff_id").eq("tenant_id", tid).gte("at", today).limit(20000),
    head("requisitions").eq("status", "submitted"),
    head("leave_requests").eq("status", "pending"),
    head("exams").eq("status", "published"),
    head("report_cards").eq("status", "published"),
    head("message_outbox").eq("status", "failed"),
    currentTerm(sb, tid)
  ]);
  const last = new Map<string, any>();
  for (const e of gateToday.data ?? []) last.set(`${e.person_type}:${e.student_id ?? e.staff_id}`, e);
  let studentsIn = 0, staffIn = 0;
  last.forEach((e, k) => { if (e.direction === "in") k.startsWith("student") ? studentsIn++ : staffIn++; });
  const { data: settings } = await sb.from("tenant_settings").select("school_name,logo_url").eq("tenant_id", tid).maybeSingle();
  return NextResponse.json({
    school: settings?.school_name ?? ctx.tenant.name,
    term: term ? `${term.name} ${term.academic_sessions?.name ?? ""}`.trim() : null,
    counts: {
      students: students.count ?? 0, staff: staff.count ?? 0, guardians: guardians.count ?? 0, class_groups: classes.count ?? 0,
      students_on_site: studentsIn, staff_on_site: staffIn,
      late_today: (gateToday.data ?? []).filter((e: any) => e.late).length,
      pending_requisitions: pendingReq.count ?? 0, pending_leave: pendingLeave.count ?? 0,
      open_exams: openExams.count ?? 0, published_report_cards: published.count ?? 0, failed_messages: outboxFailed.count ?? 0
    },
    roles: [...ctx.roles]
  });
}
