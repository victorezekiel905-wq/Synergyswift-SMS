import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";
import { generateTimetable, adjacentPeriods, type Placed, type Requirement } from "@/lib/timetable";

const ROOM_KINDS = ["classroom", "lab", "ict", "hall", "library", "sports", "music", "art", "other"] as const;

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
  const sel = "id,class_group_id,day,period_id,subject_id,teacher_id,room,room_id,locked,subjects(name),class_groups(name),users(full_name)";
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
  const [{ data: offerings }, { data: entries }, { data: rooms }, { data: unavailable }, { data: classes }] = await Promise.all([
    ctx.sb.from("subject_offerings").select("id,class_group_id,subject_id,teacher_id,periods_per_week,doubles,room_kind,subjects(name),class_groups(name),users(full_name)").eq("tenant_id", tid),
    ctx.sb.from("timetable_entries").select(sel).eq("tenant_id", tid),
    ctx.sb.from("rooms").select("id,name,kind,capacity,bookable,needs_approval,notes,active").eq("tenant_id", tid).order("name"),
    ctx.sb.from("teacher_unavailability").select("id,user_id,day,period_id,reason").eq("tenant_id", tid),
    ctx.sb.from("class_groups").select("id,name,home_room_id").eq("tenant_id", tid).order("name")
  ]);
  return NextResponse.json({ periods: periods ?? [], offerings: offerings ?? [], entries: entries ?? [], rooms: rooms ?? [], unavailable: unavailable ?? [], classes: classes ?? [] });
}

const time = z.string().regex(/^\d{2}:\d{2}$/);
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save_periods"), periods: z.array(z.object({ id: z.string().uuid().optional(), name: z.string().trim().min(1).max(30), starts_at: time, ends_at: time, is_break: z.boolean() })).max(20) }),
  z.object({ action: z.literal("set_load"), offering_id: z.string().uuid(), periods_per_week: z.number().int().min(0).max(20), doubles: z.number().int().min(0).max(5).optional(),
    room_kind: z.enum(ROOM_KINDS).nullish() }),
  z.object({ action: z.literal("save_room"), id: z.string().uuid().nullish(), name: z.string().trim().min(1).max(40), kind: z.enum(ROOM_KINDS), capacity: z.number().int().min(1).max(5000).nullish(),
    bookable: z.boolean().default(true), needs_approval: z.boolean().default(false), notes: z.string().trim().max(500).nullish(), active: z.boolean().default(true) }),
  z.object({ action: z.literal("delete_room"), id: z.string().uuid() }),
  z.object({ action: z.literal("home_room"), class_group_id: z.string().uuid(), room_id: z.string().uuid().nullable() }),
  z.object({ action: z.literal("availability"), user_id: z.string().uuid(), day: z.number().int().min(1).max(7), period_id: z.string().uuid(), unavailable: z.boolean(), reason: z.string().trim().max(120).nullish() }),
  z.object({ action: z.literal("set_cell"), class_group_id: z.string().uuid(), day: z.number().int().min(1).max(7), period_id: z.string().uuid(),
    subject_id: z.string().uuid().nullable(), teacher_id: z.string().uuid().nullish(), room: z.string().trim().max(30).nullish(), room_id: z.string().uuid().nullish(), locked: z.boolean().default(true) }),
  z.object({ action: z.literal("generate"), class_group_ids: z.array(z.string().uuid()).default([]), days: z.array(z.number().int().min(1).max(7)).min(1).max(7).default([1, 2, 3, 4, 5]), keep_locked: z.boolean().default(true) }),
  z.object({ action: z.literal("clear"), class_group_id: z.string().uuid(), keep_locked: z.boolean().default(true) })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "timetable");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  const sb = ctx.sb;
  // Teachers may mark their own unavailable periods; everything else is for admins.
  const isAdmin = ROLES.admin.some(r => ctx.roles.has(r));
  if (!isAdmin && !(b.action === "availability" && b.user_id === ctx.userId)) return jsonError("forbidden", 403);

  if (b.action === "save_room") {
    const { action: _a, id, ...row } = b;
    const { error } = id ? await sb.from("rooms").update(row).eq("tenant_id", tid).eq("id", id) : await sb.from("rooms").insert({ ...row, tenant_id: tid });
    return error ? jsonError(/duplicate|unique/.test(error.message) ? "there is already a room with that name" : error.message) : NextResponse.json({ ok: true });
  }
  if (b.action === "delete_room") {
    const { error } = await sb.from("rooms").delete().eq("tenant_id", tid).eq("id", b.id);
    return error ? jsonError(error.message) : NextResponse.json({ ok: true });
  }
  if (b.action === "home_room") {
    const { error } = await sb.from("class_groups").update({ home_room_id: b.room_id }).eq("tenant_id", tid).eq("id", b.class_group_id);
    return error ? jsonError(error.message) : NextResponse.json({ ok: true });
  }
  if (b.action === "availability") {
    const { error } = b.unavailable
      ? await sb.from("teacher_unavailability").upsert({ tenant_id: tid, user_id: b.user_id, day: b.day, period_id: b.period_id, reason: b.reason ?? null }, { onConflict: "user_id,day,period_id" })
      : await sb.from("teacher_unavailability").delete().eq("tenant_id", tid).eq("user_id", b.user_id).eq("day", b.day).eq("period_id", b.period_id);
    return error ? jsonError(error.message) : NextResponse.json({ ok: true });
  }

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
    const patch: Record<string, unknown> = { periods_per_week: b.periods_per_week };
    if (b.doubles !== undefined) patch.doubles = Math.min(b.doubles, Math.floor(b.periods_per_week / 2));
    if (b.room_kind !== undefined) patch.room_kind = b.room_kind;
    const { error } = await sb.from("subject_offerings").update(patch).eq("tenant_id", tid).eq("id", b.offering_id);
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
    let roomName = b.room || null;
    if (b.room_id) {
      const { data: rm } = await sb.from("rooms").select("name").eq("tenant_id", tid).eq("id", b.room_id).maybeSingle();
      if (!rm) return jsonError("room not found", 404);
      roomName = rm.name;
    }
    const { error } = await sb.from("timetable_entries").insert({ tenant_id: tid, class_group_id: b.class_group_id, day: b.day, period_id: b.period_id,
      subject_id: b.subject_id, teacher_id: teacher, room: roomName, room_id: b.room_id ?? null, locked: b.locked });
    if (error) {
      if (error.message.includes("timetable_teacher_clash")) return jsonError("that teacher is already teaching another class at this time", 409);
      if (error.message.includes("timetable_room_clash") || error.message.includes("timetable_room_id_clash")) return jsonError("that room is already in use at this time", 409);
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
  const [{ data: periods }, { data: offerings }, { data: entries }, { data: rooms }, { data: unavailable }, { data: classes }] = await Promise.all([
    sb.from("timetable_periods").select("id,is_break,position").eq("tenant_id", tid).order("position"),
    sb.from("subject_offerings").select("class_group_id,subject_id,teacher_id,periods_per_week,doubles,room_kind").eq("tenant_id", tid).gt("periods_per_week", 0),
    sb.from("timetable_entries").select("class_group_id,day,period_id,subject_id,teacher_id,locked,room_id").eq("tenant_id", tid),
    sb.from("rooms").select("id,name,kind").eq("tenant_id", tid).eq("active", true),
    sb.from("teacher_unavailability").select("user_id,day,period_id").eq("tenant_id", tid),
    sb.from("class_groups").select("id,home_room_id").eq("tenant_id", tid)
  ]);
  const periodIds = (periods ?? []).filter((p: any) => !p.is_break).map((p: any) => p.id);
  if (!periodIds.length) return jsonError("set up the school day's periods first");
  const targets = new Set(b.class_group_ids.length ? b.class_group_ids : [...new Set((offerings ?? []).map((o: any) => o.class_group_id as string))]);
  const requirements: Requirement[] = (offerings ?? []).filter((o: any) => targets.has(o.class_group_id))
    .map((o: any) => ({ classId: o.class_group_id, subjectId: o.subject_id, teacherId: o.teacher_id, perWeek: o.periods_per_week, doubles: o.doubles ?? 0, roomKind: o.room_kind ?? null }));
  if (!requirements.length) return jsonError("set how many periods a week each subject needs (Timetable → Weekly load) first");
  // Keep other classes' lessons and (optionally) locked cells in the target classes.
  const fixed: Placed[] = (entries ?? []).filter((e: any) => !targets.has(e.class_group_id) || (b.keep_locked && e.locked) )
    .filter((e: any) => e.subject_id && b.days.includes(e.day))
    .map((e: any) => ({ classId: e.class_group_id, day: e.day, periodId: e.period_id, subjectId: e.subject_id, teacherId: e.teacher_id, locked: e.locked, roomId: e.room_id }));
  const homeRooms = Object.fromEntries((classes ?? []).filter((c: any) => c.home_room_id).map((c: any) => [c.id, c.home_room_id]));
  const result = generateTimetable({ days: b.days, periodIds, requirements, fixed, attempts: 60, rooms: (rooms ?? []).map((r: any) => ({ id: r.id, kind: r.kind })), homeRooms,
    unavailable: (unavailable ?? []).filter((u: any) => b.days.includes(u.day)).map((u: any) => ({ teacherId: u.user_id, day: u.day, periodId: u.period_id })),
    adjacent: adjacentPeriods(periods ?? []) });
  const roomName = new Map((rooms ?? []).map((r: any) => [r.id, r.name]));

  for (const cg of targets) {
    let q = sb.from("timetable_entries").delete().eq("tenant_id", tid).eq("class_group_id", cg);
    if (b.keep_locked) q = q.eq("locked", false);
    await q;
  }
  const rows = result.placed.map(p => ({ tenant_id: tid, class_group_id: p.classId, day: p.day, period_id: p.periodId, subject_id: p.subjectId, teacher_id: p.teacherId, locked: false,
    room_id: p.roomId ?? null, room: p.roomId ? roomName.get(p.roomId) ?? null : null }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from("timetable_entries").insert(rows.slice(i, i + 500));
    if (error) return jsonError(`could not save the generated timetable: ${error.message}`);
  }
  const { data: names } = await sb.from("subjects").select("id,name").eq("tenant_id", tid);
  const nm = new Map((names ?? []).map((s: any) => [s.id, s.name]));
  await sb.from("audit_logs").insert({ tenant_id: tid, actor_id: ctx.userId, action: "timetable.generated", meta: { classes: targets.size, placed: rows.length, unplaced: result.unplaced.length } });
  return NextResponse.json({ placed: rows.length, unplaced: result.unplaced.map(u => ({ ...u, subject: nm.get(u.subjectId) ?? u.subjectId })) });
}
