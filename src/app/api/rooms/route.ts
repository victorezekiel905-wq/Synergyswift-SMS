import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError, hasAny } from "@/lib/auth";
import { zonedToUtc, weekday, addDays, localParts } from "@/lib/attendance";
import { overlaps } from "@/lib/calendar";

export const dynamic = "force-dynamic";
const DATE = /^\d{4}-\d{2}-\d{2}$/, TIME = /^\d{2}:\d{2}$/;

/** Timetabled lessons in rooms on a date, as time ranges. */
async function lessonsInRooms(sb: any, tid: string, date: string, tz: string) {
  const { data } = await sb.from("timetable_entries").select("room_id,class_groups(name),subjects(name),timetable_periods(starts_at,ends_at)")
    .eq("tenant_id", tid).eq("day", weekday(date)).not("room_id", "is", null);
  return (data ?? []).map((e: any) => ({ room_id: e.room_id, title: `${e.class_groups?.name ?? ""} ${e.subjects?.name ?? ""}`.trim(),
    start: zonedToUtc(`${date} ${e.timetable_periods.starts_at.slice(0, 5)}`, tz)!.toISOString(), end: zonedToUtc(`${date} ${e.timetable_periods.ends_at.slice(0, 5)}`, tz)!.toISOString() }));
}

/** Rooms with the day's bookings and timetabled lessons; my upcoming bookings; bookings waiting for approval (admins). */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff);
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id, tz = ctx.tenant.timezone;
  const u = new URL(req.url).searchParams;
  const date = DATE.test(u.get("date") ?? "") ? u.get("date")! : localParts(new Date(), tz).date;
  const from = zonedToUtc(`${date} 00:00`, tz)!.toISOString(), to = zonedToUtc(`${addDays(date, 1)} 00:00`, tz)!.toISOString();
  const admin = hasAny(ctx, ROLES.admin);
  const [{ data: rooms }, { data: bookings }, lessons, { data: mine }, { data: pending }] = await Promise.all([
    ctx.sb.from("rooms").select("id,name,kind,capacity,bookable,needs_approval,notes").eq("tenant_id", tid).eq("active", true).order("name"),
    ctx.sb.from("room_bookings").select("id,room_id,title,starts_at,ends_at,status,booked_by,users:booked_by(full_name),class_groups(name)").eq("tenant_id", tid)
      .in("status", ["pending", "confirmed"]).lt("starts_at", to).gt("ends_at", from).order("starts_at"),
    lessonsInRooms(ctx.sb, tid, date, tz),
    ctx.sb.from("room_bookings").select("id,title,starts_at,ends_at,status,rooms(name)").eq("tenant_id", tid).eq("booked_by", ctx.userId).gte("ends_at", new Date().toISOString()).neq("status", "cancelled").order("starts_at").limit(50),
    admin ? ctx.sb.from("room_bookings").select("id,title,starts_at,ends_at,rooms(name),users:booked_by(full_name)").eq("tenant_id", tid).eq("status", "pending").order("starts_at").limit(100) : { data: [] }
  ]);
  return NextResponse.json({ date, rooms: rooms ?? [], bookings: bookings ?? [], lessons, mine: mine ?? [], pending: pending ?? [], admin, me: ctx.userId });
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("book"), room_id: z.string().uuid(), title: z.string().trim().min(2).max(160), date: z.string().regex(DATE), start: z.string().regex(TIME), end: z.string().regex(TIME),
    class_group_id: z.string().uuid().nullish(), note: z.string().trim().max(500).nullish(), repeat_weeks: z.number().int().min(0).max(14).default(0) }),
  z.object({ action: z.literal("cancel"), id: z.string().uuid() }),
  z.object({ action: z.literal("decide"), id: z.string().uuid(), approve: z.boolean() })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff);
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id, tz = ctx.tenant.timezone;
  const clean = (m: string) => m.replace(/^.*?: /, "");
  if (b.action === "cancel") {
    const { data, error } = await ctx.sb.from("room_bookings").update({ status: "cancelled" }).eq("tenant_id", tid).eq("id", b.id).in("status", ["pending", "confirmed"]).select("id").maybeSingle();
    return error || !data ? jsonError(error ? clean(error.message) : "only your own live bookings can be cancelled", 403) : NextResponse.json({ ok: true });
  }
  if (b.action === "decide") {
    if (!hasAny(ctx, ROLES.admin)) return jsonError("only admins approve bookings", 403);
    const { data, error } = await ctx.sb.from("room_bookings").update({ status: b.approve ? "confirmed" : "declined" }).eq("tenant_id", tid).eq("id", b.id).eq("status", "pending").select("id").maybeSingle();
    return error || !data ? jsonError(error ? clean(error.message) : "this booking is not waiting", 409) : NextResponse.json({ ok: true });
  }
  if (b.end <= b.start) return jsonError("the end time must be after the start time");
  const today = localParts(new Date(), tz).date;
  if (b.date < today) return jsonError("that date has passed");
  const made: string[] = [], failed: string[] = [];
  for (let w = 0; w <= b.repeat_weeks; w++) {
    const date = addDays(b.date, 7 * w);
    const start = zonedToUtc(`${date} ${b.start}`, tz)!.toISOString(), end = zonedToUtc(`${date} ${b.end}`, tz)!.toISOString();
    // A lesson timetabled in the room comes first.
    const clash = (await lessonsInRooms(ctx.sb, tid, date, tz)).find((l: any) => l.room_id === b.room_id && overlaps(l, { start, end }));
    if (clash) { failed.push(`${date}: ${clash.title} is timetabled there`); continue; }
    const { error } = await ctx.sb.from("room_bookings").insert({ tenant_id: tid, room_id: b.room_id, title: b.title, starts_at: start, ends_at: end, booked_by: ctx.userId,
      class_group_id: b.class_group_id ?? null, note: b.note ?? null });
    if (error) failed.push(`${date}: ${clean(error.message)}`); else made.push(date);
  }
  if (!made.length) return jsonError(failed.join("; ") || "could not book", 409);
  const { data: room } = await ctx.sb.from("rooms").select("needs_approval").eq("id", b.room_id).maybeSingle();
  return NextResponse.json({ ok: true, booked: made.length, failed, pending: Boolean(room?.needs_approval) && !hasAny(ctx, ROLES.admin) }, { status: 201 });
}
