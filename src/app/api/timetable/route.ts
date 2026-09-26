import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";
import { generateTimetable, type Placed, type Requirement } from "@/lib/timetable";

/**
 * GET ?class_group_id=  one class's week     GET ?teacher_id=me  a teacher's week
 * GET (no params)       periods, offerings with weekly counts, and every entry
 */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(undefined, "timetable");
  if (ctx instanceof NextResponse) return ctx;
  const u = new URL(req.url);
  const tid = ctx.tenant.id;
  const { data: periods } = await ctx.sb.from("timetable_periods").select("*").eq("tenant_id", tid).order("position");
  const sel = "id,class_group_id,day,period_id,subject_id,teacher_id,room,locked,subjects(name),class_groups(name),users(full_name)";
  let cg = u.searchParams.get("class_group_id");
  let teacher = u.searchParams.get("teacher_id");
  if (teacher === "me") teacher = ctx.userId;
  if (!cg && !teacher && (ctx.roles.has("student"))) {
    const { data: me } = await ctx.sb.from("students").select("class_group_id").eq("tenant_id", tid).eq("user_id", ctx.userId).maybeSingle();
    cg = me?.class_group_id ?? null;
  }
  if (cg || teacher) {
    let q = ctx.sb.from("timetable_entries").select(sel).eq("tenant_id", tid);
    q = cg ? q.eq("class_group_id", cg) : q.eq("teacher_id", teacher);
    const { data } = await q;
    return NextResponse.json({ periods: periods ?? [], entries: data ?? [] });
  }
  if (!ROLES.staff.some(r => ctx.roles.has(r))) return jsonError("forbidden", 403);
  const [{ data: offerings }, { data: entries }] = await Promise.all([
    ctx.sb.from("subject_offerings").select("id,class_group_id,subject_id,teacher_id,periods_per_week,subjects(name),class_groups(name),users(full_name)").eq("tenant_id", tid),
    ctx.sb.from("timetable_entries").select(sel).eq("tenant_id", tid)
  ]);
  return NextResponse.json({ periods: periods ?? [], offerings: offerings ?? [], entries: entries ?? [] });
}

const time = z.string().regex(/^\d{2}:\d{2}$/);
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save_periods"), periods: z.array(z.object({ id: z.string().uuid().optional(), name: z.string().trim().min(1).max(30), starts_at: time, ends_at: time, is_break: z.boolean() })).max(20) }),
  z.object({ action: z.literal("set_load"), offering_id: z.string().uuid(), periods_per_week: z.number().int().min(0).max(20) }),
  z.object({ action: z.literal("set_cell"), class_group_id: z.string().uuid(), day: z.number().int().min(1).max(7), period_id: z.string().uuid(),
    subject_id: z.string().uuid().nullable(), teacher_id: z.string().uuid().nullish(), room: z.string().trim().max(30).nullish(), locked: z.boolean().default(true) }),
  z.object({ action: z.literal("generate"), class_group_ids: z.array(z.string().uuid()).default([]), days: z.array(z.number().int().min(1).max(7)).min(1).max(7).default([1, 2, 3, 4, 5]), keep_locked: z.boolean().default(true) }),
  z.object({ action: z.literal("clear"), class_group_id: z.string().uuid(), keep_locked: z.boolean().default(true) })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.admin, "timetable");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  const sb = ctx.sb;

  if (b.action === "save_periods") {
    for (const p of b.periods) if (p.ends_at <= p.starts_at) return jsonError(`${p.name}: end time must be after start time`);
    const keep = b.periods.filter(p => p.id).map(p => p.id!);
    const { data: existing } = await sb.from("timetable_periods").select("id").eq("tenant_id", tid);
    for (const e of existing ?? []) if (!keep.includes(e.id)) await sb.from("timetable_periods").delete().eq("id", e.id);
    for (let i = 0; i < b.periods.length; i++) {
      const p = b.periods[i];
      const row = { tenant_id: tid, name: p.name, starts_at: p.starts_at, ends_at: p.ends_at, is_break: p.is_break, position: i + 1 };
      const { error } = p.id ? await sb.from("timetable_periods").update(row).eq("id", p.id) : await sb.from("timetable_periods").insert(row);
      if (error) return jsonError(error.message);
    }
    return NextResponse.json({ ok: true });
  }
  if (b.action === "set_load") {
    const { error } = await sb.from("subject_offerings").update({ periods_per_week: b.periods_per_week }).eq("tenant_id", tid).eq("id", b.offering_id);
    return error ? jsonError(error.message) : NextResponse.json({ ok: true });
  }
  if (b.action === "set_cell") {
    await sb.from("timetable_entries").delete().eq("tenant_id", tid).eq("class_group_id", b.class_group_id).eq("day", b.day).eq("period_id", b.period_id);
    if (!b.subject_id) return NextResponse.json({ ok: true });
    let teacher = b.teacher_id ?? null;
    if (teacher === null) {
      const { data: o } = await sb.from("subject_offerings").select("teacher_id").eq("tenant_id", tid).eq("class_group_id", b.class_group_id).eq("subject_id", b.subject_id).maybeSingle();
      teacher = o?.teacher_id ?? null;
    }
    const { error } = await sb.from("timetable_entries").insert({ tenant_id: tid, class_group_id: b.class_group_id, day: b.day, period_id: b.period_id,
      subject_id: b.subject_id, teacher_id: teacher, room: b.room || null, locked: b.locked });
    if (error) {
      if (error.message.includes("timetable_teacher_clash")) return jsonError("that teacher is already teaching another class at this time", 409);
      if (error.message.includes("timetable_room_clash")) return jsonError("that room is already in use at this time", 409);
      return jsonError(error.message);
    }
    return NextResponse.json({ ok: true });
  }
  if (b.action === "clear") {
    let q = sb.from("timetable_entries").delete().eq("tenant_id", tid).eq("class_group_id", b.class_group_id);
    if (b.keep_locked) q = q.eq("locked", false);
    const { error } = await q;
    return error ? jsonError(error.message) : NextResponse.json({ ok: true });
  }

  // generate
  const [{ data: periods }, { data: offerings }, { data: entries }] = await Promise.all([
    sb.from("timetable_periods").select("id,is_break,position").eq("tenant_id", tid).order("position"),
    sb.from("subject_offerings").select("class_group_id,subject_id,teacher_id,periods_per_week").eq("tenant_id", tid).gt("periods_per_week", 0),
    sb.from("timetable_entries").select("class_group_id,day,period_id,subject_id,teacher_id,locked").eq("tenant_id", tid)
  ]);
  const periodIds = (periods ?? []).filter((p: any) => !p.is_break).map((p: any) => p.id);
  if (!periodIds.length) return jsonError("set up the school day's periods first");
  const targets = new Set(b.class_group_ids.length ? b.class_group_ids : [...new Set((offerings ?? []).map((o: any) => o.class_group_id as string))]);
  const requirements: Requirement[] = (offerings ?? []).filter((o: any) => targets.has(o.class_group_id))
    .map((o: any) => ({ classId: o.class_group_id, subjectId: o.subject_id, teacherId: o.teacher_id, perWeek: o.periods_per_week }));
  if (!requirements.length) return jsonError("set how many periods a week each subject needs (Timetable → Weekly load) first");
  // Keep other classes' lessons and (optionally) locked cells in the target classes.
  const fixed: Placed[] = (entries ?? []).filter((e: any) => !targets.has(e.class_group_id) || (b.keep_locked && e.locked) )
    .filter((e: any) => e.subject_id && b.days.includes(e.day))
    .map((e: any) => ({ classId: e.class_group_id, day: e.day, periodId: e.period_id, subjectId: e.subject_id, teacherId: e.teacher_id, locked: e.locked }));
  const result = generateTimetable({ days: b.days, periodIds, requirements, fixed, attempts: 60 });

  for (const cg of targets) {
    let q = sb.from("timetable_entries").delete().eq("tenant_id", tid).eq("class_group_id", cg);
    if (b.keep_locked) q = q.eq("locked", false);
    await q;
  }
  const rows = result.placed.map(p => ({ tenant_id: tid, class_group_id: p.classId, day: p.day, period_id: p.periodId, subject_id: p.subjectId, teacher_id: p.teacherId, locked: false }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from("timetable_entries").insert(rows.slice(i, i + 500));
    if (error) return jsonError(`could not save the generated timetable: ${error.message}`);
  }
  const { data: names } = await sb.from("subjects").select("id,name").eq("tenant_id", tid);
  const nm = new Map((names ?? []).map((s: any) => [s.id, s.name]));
  await sb.from("audit_logs").insert({ tenant_id: tid, actor_id: ctx.userId, action: "timetable.generated", meta: { classes: targets.size, placed: rows.length, unplaced: result.unplaced.length } });
  return NextResponse.json({ placed: rows.length, unplaced: result.unplaced.map(u => ({ ...u, subject: nm.get(u.subjectId) ?? u.subjectId })) });
}
