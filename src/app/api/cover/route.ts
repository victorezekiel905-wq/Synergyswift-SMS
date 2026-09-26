import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, hasAny, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { isoDay, suggestCover, weekBounds } from "@/lib/cover";
import { enqueue, tryDispatch, staffRows } from "@/lib/messaging/outbox";
import { appUrl } from "@/lib/school";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const STAFF_ROLES = ["teacher", "school_admin", "principal", "it_admin", "librarian", "hr_manager", "qa_officer"];

function todayIn(tz: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/**
 * Cover for a day (?date=YYYY-MM-DD, default today): who is away, which of
 * their lessons need a teacher, suggested free staff, and covers already set.
 * Teachers who are not admins see only their own cover duties.
 */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "cover");
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  const q = new URL(req.url).searchParams.get("date");
  const date = q && DATE.test(q) ? q : todayIn(ctx.tenant.timezone);
  const day = isoDay(date);
  const isAdmin = hasAny(ctx, ROLES.cover);

  if (!isAdmin) {
    const until = new Date(new Date(`${date}T12:00:00Z`).getTime() + 7 * 86400_000).toISOString().slice(0, 10);
    const { data } = await ctx.sb.from("cover_assignments")
      .select("id,date,note,timetable_entries(room,class_groups(name),subjects(name)),timetable_periods(name,starts_at,ends_at),absent:users!cover_assignments_absent_user_id_fkey(full_name)")
      .eq("tenant_id", tid).eq("cover_user_id", ctx.userId).gte("date", date).lte("date", until).order("date");
    return NextResponse.json({ date, is_admin: false, my_cover: data ?? [] });
  }

  const svc = createServiceClient();
  const [{ data: adhoc }, { data: leave }, { data: assigned }, { data: periods }] = await Promise.all([
    ctx.sb.from("staff_absences").select("id,user_id,starts_on,ends_on,reason,users!staff_absences_user_id_fkey(full_name)").eq("tenant_id", tid).lte("starts_on", date).gte("ends_on", date),
    svc.from("leave_requests").select("id,leave_type,starts_on,ends_on,staff(user_id,full_name)").eq("tenant_id", tid).eq("status", "approved").lte("starts_on", date).gte("ends_on", date),
    ctx.sb.from("cover_assignments").select("id,timetable_entry_id,period_id,cover_user_id,note,users!cover_assignments_cover_user_id_fkey(full_name)").eq("tenant_id", tid).eq("date", date),
    ctx.sb.from("timetable_periods").select("id,name,starts_at,ends_at,position").eq("tenant_id", tid).order("position")
  ]);
  const absences = [
    ...(adhoc ?? []).map((a: any) => ({ id: a.id, user_id: a.user_id, name: a.users?.full_name, reason: a.reason, from: a.starts_on, to: a.ends_on, source: "absence" as const })),
    ...(leave ?? []).filter((l: any) => l.staff?.user_id).map((l: any) => ({ id: l.id, user_id: l.staff.user_id, name: l.staff.full_name, reason: `${l.leave_type} leave`, from: l.starts_on, to: l.ends_on, source: "leave" as const }))
  ];
  const absent = new Set(absences.map(a => a.user_id));

  const [{ data: dayEntries }, { data: staff }, { data: week }] = await Promise.all([
    ctx.sb.from("timetable_entries").select("id,teacher_id,period_id,room,class_groups(name),subjects(name)").eq("tenant_id", tid).eq("day", day),
    svc.from("users").select("id,full_name,role").eq("tenant_id", tid).eq("active", true).in("role", STAFF_ROLES).order("full_name"),
    ctx.sb.from("cover_assignments").select("cover_user_id").eq("tenant_id", tid).gte("date", weekBounds(date).from).lte("date", weekBounds(date).to)
  ]);
  const needing = (dayEntries ?? []).filter((e: any) => e.teacher_id && absent.has(e.teacher_id));
  const weekCounts = new Map<string, number>();
  for (const w of week ?? []) weekCounts.set(w.cover_user_id, (weekCounts.get(w.cover_user_id) ?? 0) + 1);
  const suggestions = suggestCover({
    lessons: needing.map((e: any) => ({ entryId: e.id, periodId: e.period_id, teacherId: e.teacher_id })),
    staff: (staff ?? []).map((s: any) => ({ id: s.id, name: s.full_name, role: s.role })),
    teachingThatDay: (dayEntries ?? []).filter((e: any) => e.teacher_id).map((e: any) => ({ teacherId: e.teacher_id, periodId: e.period_id })),
    absent,
    assigned: (assigned ?? []).map((a: any) => ({ coverUserId: a.cover_user_id, periodId: a.period_id, entryId: a.timetable_entry_id })),
    weekCounts
  });
  const period = new Map((periods ?? []).map((p: any) => [p.id, p]));
  const names = new Map((staff ?? []).map((s: any) => [s.id, s.full_name]));
  return NextResponse.json({
    date, day, is_admin: true, absences,
    staff: (staff ?? []).map((s: any) => ({ id: s.id, name: s.full_name })),
    lessons: needing.map((e: any) => {
      const a = (assigned ?? []).find((x: any) => x.timetable_entry_id === e.id);
      return {
        entry_id: e.id, period: period.get(e.period_id) ?? null, class_name: e.class_groups?.name, subject: e.subjects?.name ?? null, room: e.room,
        teacher: names.get(e.teacher_id) ?? "Absent teacher", teacher_id: e.teacher_id,
        cover: a ? { id: a.id, user_id: a.cover_user_id, name: a.users?.full_name, note: a.note } : null,
        suggestions: suggestions.get(e.id) ?? []
      };
    }).sort((x: any, y: any) => (x.period?.position ?? 0) - (y.period?.position ?? 0))
  });
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add_absence"), user_id: z.string().uuid(), starts_on: z.string().regex(DATE), ends_on: z.string().regex(DATE), reason: z.string().trim().max(200).nullish() }),
  z.object({ action: z.literal("delete_absence"), id: z.string().uuid() }),
  z.object({ action: z.literal("assign"), date: z.string().regex(DATE), timetable_entry_id: z.string().uuid(), cover_user_id: z.string().uuid(), note: z.string().trim().max(300).nullish() }),
  z.object({ action: z.literal("unassign"), id: z.string().uuid() })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.cover, "cover");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  const clean = (m: string) => m.replace(/^.*?: /, "");
  switch (b.action) {
    case "add_absence": {
      if (b.ends_on < b.starts_on) return jsonError("the end date is before the start date");
      const { error } = await ctx.sb.from("staff_absences").insert({ tenant_id: tid, user_id: b.user_id, starts_on: b.starts_on, ends_on: b.ends_on, reason: b.reason ?? null, recorded_by: ctx.userId });
      return error ? jsonError(clean(error.message)) : NextResponse.json({ ok: true }, { status: 201 });
    }
    case "delete_absence": {
      const { error } = await ctx.sb.from("staff_absences").delete().eq("tenant_id", tid).eq("id", b.id);
      return error ? jsonError(clean(error.message)) : NextResponse.json({ ok: true });
    }
    case "unassign": {
      const { error } = await ctx.sb.from("cover_assignments").delete().eq("tenant_id", tid).eq("id", b.id);
      return error ? jsonError(clean(error.message)) : NextResponse.json({ ok: true });
    }
    case "assign": {
      const { data: e } = await ctx.sb.from("timetable_entries").select("id,teacher_id,period_id,day,class_groups(name),subjects(name),timetable_periods(name,starts_at)").eq("tenant_id", tid).eq("id", b.timetable_entry_id).maybeSingle();
      if (!e) return jsonError("lesson not found", 404);
      if (e.day !== isoDay(b.date)) return jsonError("that lesson is not on this day");
      await ctx.sb.from("cover_assignments").delete().eq("tenant_id", tid).eq("date", b.date).eq("timetable_entry_id", e.id);
      const { data, error } = await ctx.sb.from("cover_assignments").insert({ tenant_id: tid, date: b.date, timetable_entry_id: e.id, period_id: e.period_id,
        absent_user_id: e.teacher_id, cover_user_id: b.cover_user_id, note: b.note ?? null, created_by: ctx.userId }).select("id").single();
      if (error) return jsonError(error.message.includes("cover_no_double_booking") ? "that person is already covering another lesson in this period" : clean(error.message));
      const svc = createServiceClient();
      const when = `${b.date}, ${e.timetable_periods?.name ?? "period"}${e.timetable_periods?.starts_at ? ` (${String(e.timetable_periods.starts_at).slice(0, 5)})` : ""}`;
      const rows = await staffRows(svc, { tenantId: tid, userIds: [b.cover_user_id], kind: "cover", refId: data.id, subject: "Cover lesson",
        text: `Please cover ${e.subjects?.name ?? "a lesson"} for ${e.class_groups?.name ?? "a class"} on ${when}.${b.note ? ` Note: ${b.note}` : ""}`, url: `${appUrl(req)}/school/cover` });
      if (rows.length) { await enqueue(svc, rows); await tryDispatch(svc, { budgetMs: 3000 }); }
      return NextResponse.json({ ok: true, id: data.id }, { status: 201 });
    }
  }
}
