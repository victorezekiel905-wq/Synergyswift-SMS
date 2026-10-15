import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError, hasAny } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { weekday, localParts } from "@/lib/attendance";
import { alertMissedLessons } from "@/lib/attendance-server";

export const dynamic = "force-dynamic";
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Lesson registers. GET ?date= this teacher's lessons that day (their own and
 * any they cover; admins add ?class_group_id=). GET ?entry_id=&date= one lesson's register.
 */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "attendance");
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  const u = new URL(req.url).searchParams;
  const date = DATE.test(u.get("date") ?? "") ? u.get("date")! : localParts(new Date(), ctx.tenant.timezone).date;
  const entryId = u.get("entry_id");
  if (entryId) {
    const { data: e } = await ctx.sb.from("timetable_entries").select("id,class_group_id,subject_id,period_id,teacher_id,day,subjects(name),class_groups(name),timetable_periods(name,starts_at,ends_at)")
      .eq("tenant_id", tid).eq("id", entryId).maybeSingle();
    if (!e) return jsonError("not found", 404);
    const { data: can } = await ctx.sb.rpc("can_mark_lesson", { p_entry: e.id, p_date: date });
    const { data: students } = await ctx.sb.from("students").select("id,admission_no,first_name,last_name,photo_url").eq("tenant_id", tid).eq("class_group_id", e.class_group_id).eq("status", "active").order("last_name").order("first_name");
    const ids = (students ?? []).map((s: any) => s.id);
    const [{ data: marks }, { data: daily }, { data: leave }] = await Promise.all([
      ids.length ? ctx.sb.from("lesson_attendance").select("student_id,status,note").eq("date", date).eq("period_id", e.period_id).in("student_id", ids) : { data: [] },
      ids.length ? ctx.sb.from("class_attendance").select("student_id,status").eq("date", date).in("student_id", ids) : { data: [] },
      ids.length ? ctx.sb.from("student_absence_requests").select("student_id,kind").eq("status", "approved").lte("starts_on", date).gte("ends_on", date).in("student_id", ids) : { data: [] }
    ]);
    const m = new Map((marks ?? []).map((x: any) => [x.student_id, x])), d = new Map((daily ?? []).map((x: any) => [x.student_id, x.status])), l = new Map((leave ?? []).map((x: any) => [x.student_id, x.kind]));
    return NextResponse.json({ lesson: e, date, can_mark: Boolean(can), taken: (marks ?? []).length > 0,
      students: (students ?? []).map((s: any) => ({ ...s, mark: m.get(s.id) ?? null, morning: d.get(s.id) ?? null, leave: l.get(s.id) ?? null })) });
  }
  const day = weekday(date);
  const sel = "id,class_group_id,subject_id,period_id,teacher_id,room,subjects(name),class_groups(name),timetable_periods(name,starts_at,ends_at,position)";
  const cg = u.get("class_group_id");
  const [{ data: mine }, { data: covers }] = await Promise.all([
    cg && hasAny(ctx, ROLES.admin) ? ctx.sb.from("timetable_entries").select(sel).eq("tenant_id", tid).eq("class_group_id", cg).eq("day", day)
      : ctx.sb.from("timetable_entries").select(sel).eq("tenant_id", tid).eq("teacher_id", ctx.userId).eq("day", day),
    ctx.sb.from("cover_assignments").select(`timetable_entry_id,timetable_entries(${sel})`).eq("tenant_id", tid).eq("date", date).eq("cover_user_id", ctx.userId)
  ]);
  const lessons = [...(mine ?? []).map((e: any) => ({ ...e, cover: false })), ...(covers ?? []).map((c: any) => c.timetable_entries && ({ ...c.timetable_entries, cover: true })).filter(Boolean)];
  const periods = [...new Set(lessons.map((l: any) => l.period_id))];
  const { data: taken } = periods.length ? await ctx.sb.from("lesson_attendance").select("period_id,class_group_id").eq("tenant_id", tid).eq("date", date).in("period_id", periods) : { data: [] };
  const done = new Set((taken ?? []).map((t: any) => `${t.period_id}|${t.class_group_id}`));
  return NextResponse.json({ date, lessons: lessons.sort((a: any, b: any) => (a.timetable_periods?.position ?? 0) - (b.timetable_periods?.position ?? 0))
    .map((l: any) => ({ ...l, taken: done.has(`${l.period_id}|${l.class_group_id}`) })) });
}

const Body = z.object({
  entry_id: z.string().uuid(), date: z.string().regex(DATE),
  entries: z.array(z.object({ student_id: z.string().uuid(), status: z.enum(["present", "absent", "late", "excused"]), note: z.string().trim().max(200).nullish() })).max(200)
});

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "attendance");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => i.message).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  const today = localParts(new Date(), ctx.tenant.timezone).date;
  if (b.date > today) return jsonError("you cannot mark a lesson in the future");
  const { data: e } = await ctx.sb.from("timetable_entries").select("id,class_group_id,subject_id,period_id,day,subjects(name)").eq("tenant_id", tid).eq("id", b.entry_id).maybeSingle();
  if (!e) return jsonError("not found", 404);
  if (weekday(b.date) !== e.day) return jsonError("this lesson is not on that day");
  const now = new Date().toISOString();
  const rows = b.entries.map(x => ({ tenant_id: tid, student_id: x.student_id, date: b.date, timetable_entry_id: e.id, period_id: e.period_id, class_group_id: e.class_group_id,
    subject_id: e.subject_id, status: x.status, note: x.note ?? null, marked_by: ctx.userId, marked_at: now }));
  const { error } = await ctx.sb.from("lesson_attendance").upsert(rows, { onConflict: "student_id,date,period_id" });
  if (error) return jsonError(/row-level/.test(error.message) ? "only this lesson's teacher, its cover teacher, the form teacher or an admin can mark it" : error.message, 403);
  const alerted = b.date === today ? await alertMissedLessons(createServiceClient(), { tenantId: tid, timezone: ctx.tenant.timezone, date: b.date, periodId: e.period_id,
    studentIds: b.entries.filter(x => x.status === "absent").map(x => x.student_id), subject: (e as any).subjects?.name ?? null, userId: ctx.userId }) : 0;
  return NextResponse.json({ saved: rows.length, parents_told: alerted });
}
