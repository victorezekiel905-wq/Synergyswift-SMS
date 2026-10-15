import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { splitIntoRooms } from "@/lib/learning";

export const dynamic = "force-dynamic";

type Room = { id: string; session_id: string; tenant_id: string; kind: string; state: string; notice: string | null };

/** The main room (readable only by people in the session) and whether this user hosts it. */
async function mainRoom(sb: any, id: string): Promise<{ room: Room; host: boolean } | null> {
  const { data: room } = await sb.from("rtc_rooms").select("id,session_id,tenant_id,kind,state,notice").eq("id", id).maybeSingle();
  if (!room || room.kind !== "main") return null;
  const { data: host } = await sb.rpc("hosts_session", { p_session: room.session_id });
  return { room, host: Boolean(host) };
}

/** Breakout rooms of a live room, their members, and which one this user belongs in. */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(undefined, "lms");
  if (ctx instanceof NextResponse) return ctx;
  const id = new URL(req.url).searchParams.get("room_id") ?? "";
  const m = /^[0-9a-f-]{36}$/i.test(id) ? await mainRoom(ctx.sb, id) : null;
  if (!m) return jsonError("not found", 404);
  const now = new Date().toISOString();
  const { data: rooms } = await ctx.sb.from("rtc_rooms").select("id,name,state,closes_at,created_at,host_user_id,session_id,kind").eq("parent_room_id", id).eq("state", "open").order("name");
  const live = (rooms ?? []).filter((r: any) => !r.closes_at || r.closes_at > now);
  const { data: members } = live.length ? await ctx.sb.from("breakout_members").select("room_id,user_id").in("room_id", live.map((r: any) => r.id)) : { data: [] };
  const ids = [...new Set((members ?? []).map((x: any) => x.user_id))];
  const { data: names } = ids.length ? await createServiceClient().from("users").select("id,full_name").in("id", ids) : { data: [] };
  const nameOf = new Map((names ?? []).map((u: any) => [u.id, u.full_name]));
  const mine = (members ?? []).find((x: any) => x.user_id === ctx.userId)?.room_id ?? null;
  return NextResponse.json({
    host: m.host, notice: m.room.notice, mine: mine ? live.find((r: any) => r.id === mine) ?? null : null,
    rooms: live.map((r: any) => ({ ...r, members: (members ?? []).filter((x: any) => x.room_id === r.id).map((x: any) => ({ user_id: x.user_id, name: nameOf.get(x.user_id) ?? "Student" })) }))
  });
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("open"), room_id: z.string().uuid(), count: z.number().int().min(1).max(30), minutes: z.number().int().min(1).max(180).nullish(), shuffle: z.boolean().default(true) }),
  z.object({ action: z.literal("move"), room_id: z.string().uuid(), user_id: z.string().uuid(), to: z.string().uuid().nullable() }),
  z.object({ action: z.literal("close"), room_id: z.string().uuid() }),
  z.object({ action: z.literal("notice"), room_id: z.string().uuid(), text: z.string().trim().max(300).nullable() })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(undefined, "lms");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const m = await mainRoom(ctx.sb, b.room_id);
  if (!m) return jsonError("not found", 404);
  if (!m.host) return jsonError("only the teacher can manage breakout rooms", 403);
  const sb = ctx.sb;
  const closeAll = () => sb.from("rtc_rooms").delete().eq("parent_room_id", b.room_id).eq("kind", "breakout");

  if (b.action === "close") {
    const { error } = await closeAll();
    await sb.from("rtc_rooms").update({ notice: null }).eq("id", b.room_id);
    return error ? jsonError(error.message) : NextResponse.json({ ok: true });
  }
  if (b.action === "notice") {
    const { error } = await sb.from("rtc_rooms").update({ notice: b.text || null }).eq("id", b.room_id);
    return error ? jsonError(error.message) : NextResponse.json({ ok: true });
  }
  if (b.action === "open") {
    // Everyone in the main room now, except people who can host.
    const since = new Date(Date.now() - 60_000).toISOString();
    const { data: peers } = await sb.from("rtc_peers").select("user_id,role").eq("room_id", b.room_id).eq("state", "joined").gte("last_seen_at", since);
    const students = [...new Set((peers ?? []).filter((p: any) => p.user_id !== ctx.userId && p.role === "student").map((p: any) => p.user_id as string))];
    const { error: e1 } = await closeAll();
    if (e1) return jsonError(e1.message);
    const groups = splitIntoRooms(students, Math.min(b.count, Math.max(1, students.length || b.count)), b.shuffle);
    const count = students.length ? groups.length : b.count;
    const closes_at = b.minutes ? new Date(Date.now() + b.minutes * 60_000).toISOString() : null;
    const { data: rooms, error } = await sb.from("rtc_rooms").insert(Array.from({ length: count }, (_, i) => ({
      tenant_id: m.room.tenant_id, session_id: m.room.session_id, host_user_id: ctx.userId, state: "open", kind: "breakout", parent_room_id: b.room_id, name: `Room ${i + 1}`, closes_at
    }))).select("id,name").order("name");
    if (error) return jsonError(error.message);
    const byName = [...(rooms ?? [])].sort((x: any, y: any) => x.name.localeCompare(y.name, undefined, { numeric: true }));
    const rows = groups.flatMap((g, i) => byName[i] ? g.map(u => ({ room_id: byName[i].id, user_id: u, tenant_id: m.room.tenant_id })) : []);
    if (rows.length) { const { error: e2 } = await sb.from("breakout_members").insert(rows); if (e2) return jsonError(e2.message); }
    return NextResponse.json({ ok: true, rooms: byName.length, placed: rows.length });
  }
  // move
  const { data: siblings } = await sb.from("rtc_rooms").select("id").eq("parent_room_id", b.room_id);
  const sib = (siblings ?? []).map((r: any) => r.id);
  if (b.to && !sib.includes(b.to)) return jsonError("that room is not part of this class");
  if (sib.length) await sb.from("breakout_members").delete().eq("user_id", b.user_id).in("room_id", sib);
  if (b.to) {
    const { error } = await sb.from("breakout_members").insert({ room_id: b.to, user_id: b.user_id, tenant_id: m.room.tenant_id });
    if (error) return jsonError(error.message);
  }
  return NextResponse.json({ ok: true });
}
