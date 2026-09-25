import { NextRequest, NextResponse } from "next/server";
import { requireCtx, jsonError } from "@/lib/auth";
import { startOfTodayIso, studentName, toCsv } from "@/lib/school";

const VIEW = ["gate_officer", "school_admin", "principal", "platform_admin", "hr_manager", "teacher", "qa_officer"];

/** Gate log for a day (default today, school timezone) with presence summary. ?format=csv to export. */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(VIEW, "gate");
  if (ctx instanceof NextResponse) return ctx;
  const u = new URL(req.url);
  const day = u.searchParams.get("date");
  const tz = ctx.tenant.timezone;
  let from: string, to: string;
  if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
    const probe = new Date(`${day}T12:00:00Z`);
    from = startOfTodayIso(tz, probe);
    to = new Date(new Date(from).getTime() + 86400_000).toISOString();
  } else {
    from = startOfTodayIso(tz);
    to = new Date(new Date(from).getTime() + 86400_000).toISOString();
  }
  let q = ctx.sb.from("gate_events")
    .select("id,person_type,direction,method,late,at,note,students(id,first_name,last_name,other_names,admission_no,class_groups(name)),staff(id,full_name,staff_no)")
    .eq("tenant_id", ctx.tenant.id).gte("at", from).lt("at", to).order("at", { ascending: false }).limit(5000);
  const type = u.searchParams.get("type");
  if (type === "student" || type === "staff") q = q.eq("person_type", type);
  const { data, error } = await q;
  if (error) return jsonError(error.message);

  const events = (data ?? []).map((e: any) => ({
    id: e.id, person_type: e.person_type, direction: e.direction, method: e.method, late: e.late, at: e.at, note: e.note,
    name: e.person_type === "student" ? studentName(e.students) : e.staff?.full_name,
    ref: e.person_type === "student" ? e.students?.admission_no : e.staff?.staff_no,
    class_name: e.students?.class_groups?.name ?? null,
    person_id: e.students?.id ?? e.staff?.id
  }));

  // Presence = last event per person is "in".
  const last = new Map<string, any>();
  for (const e of [...events].reverse()) last.set(`${e.person_type}:${e.person_id}`, e);
  const summary = { students_on_site: 0, staff_on_site: 0, students_late: 0, staff_late: 0 };
  last.forEach(e => { if (e.direction === "in") summary[e.person_type === "student" ? "students_on_site" : "staff_on_site"]++; });
  for (const e of events) if (e.late) summary[e.person_type === "student" ? "students_late" : "staff_late"]++;

  if (u.searchParams.get("format") === "csv") {
    const rows = [["Time", "Type", "Name", "Number", "Class/Position", "Direction", "Method", "Late", "Note"],
      ...events.map((e: any) => [e.at, e.person_type, e.name, e.ref, e.class_name, e.direction, e.method, e.late ? "yes" : "", e.note])];
    return new NextResponse("﻿" + toCsv(rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="gate-${day ?? "today"}.csv"` } });
  }
  return NextResponse.json({ events, summary });
}
