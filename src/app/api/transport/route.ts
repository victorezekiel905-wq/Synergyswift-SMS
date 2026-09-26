import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError, hasAny } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { resolvePerson } from "@/lib/gate";
import { notifyGuardians } from "@/lib/notify";
import { busEvent } from "@/lib/messaging/notices";
import { formatInZone } from "@/lib/messaging/outbox";
import { startOfTodayIso, studentName } from "@/lib/school";

/** Routes with riders; ?route_id= adds today's boarding log and who is on the bus now. */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "transport");
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  const routeId = new URL(req.url).searchParams.get("route_id");
  const { data: routes } = await ctx.sb.from("transport_routes").select("*,users!transport_routes_attendant_id_fkey(full_name),transport_assignments(count)").eq("tenant_id", tid).order("name");
  if (!routeId) return NextResponse.json({ routes: routes ?? [] });
  const [{ data: riders }, { data: events }] = await Promise.all([
    ctx.sb.from("transport_assignments").select("student_id,stop_name,direction,students(first_name,last_name,other_names,admission_no,photo_url,class_groups(name))").eq("tenant_id", tid).eq("route_id", routeId),
    ctx.sb.from("transport_events").select("student_id,kind,stop_name,at").eq("tenant_id", tid).eq("route_id", routeId).gte("at", startOfTodayIso(ctx.tenant.timezone)).order("at")
  ]);
  const last = new Map<string, any>();
  for (const e of events ?? []) last.set(e.student_id, e);
  return NextResponse.json({
    routes: routes ?? [],
    riders: (riders ?? []).map((r: any) => ({ ...r, name: studentName(r.students), on_bus: last.get(r.student_id)?.kind === "boarded", last_event: last.get(r.student_id) ?? null })),
    events: events ?? []
  });
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save_route"), id: z.string().uuid().optional(), name: z.string().trim().min(1).max(60), vehicle: z.string().trim().max(40).nullish(),
    driver_name: z.string().trim().max(80).nullish(), driver_phone: z.string().trim().max(30).nullish(), attendant_id: z.string().uuid().nullish(),
    capacity: z.number().int().positive().max(200).nullish(), stops: z.array(z.object({ name: z.string().trim().min(1).max(80), am: z.string().max(5).nullish(), pm: z.string().max(5).nullish() })).max(40) }),
  z.object({ action: z.literal("delete_route"), id: z.string().uuid() }),
  z.object({ action: z.literal("assign"), route_id: z.string().uuid(), student_ids: z.array(z.string().uuid()).min(1).max(200), stop_name: z.string().trim().max(80).nullish(),
    direction: z.enum(["both", "morning", "afternoon"]).default("both") }),
  z.object({ action: z.literal("unassign"), student_id: z.string().uuid() }),
  z.object({ action: z.literal("scan"), route_id: z.string().uuid(), code: z.string().trim().min(1).max(120), kind: z.enum(["boarded", "alighted"]),
    stop_name: z.string().trim().max(80).nullish(), lat: z.number().nullish(), lng: z.number().nullish() })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "transport");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  const sb = ctx.sb;

  if (b.action === "scan") {
    const svc = createServiceClient();
    const { data: route } = await svc.from("transport_routes").select("id,name,attendant_id").eq("tenant_id", tid).eq("id", b.route_id).maybeSingle();
    if (!route) return jsonError("route not found", 404);
    if (!hasAny(ctx, ROLES.transport) && route.attendant_id !== ctx.userId) return jsonError("only this bus's attendant or transport staff can scan", 403);
    const person = await resolvePerson(svc, tid, b.code);
    if (!person || person.type !== "student") return jsonError("No active student matches that card.", 404);
    const { data: assigned } = await svc.from("transport_assignments").select("route_id,stop_name").eq("student_id", person.id).maybeSingle();
    const { data: last } = await svc.from("transport_events").select("kind,at").eq("student_id", person.id).eq("route_id", route.id).order("at", { ascending: false }).limit(1);
    if (last?.[0] && last[0].kind === b.kind && Date.now() - new Date(last[0].at).getTime() < 120_000) {
      return NextResponse.json({ person, duplicate: true, kind: b.kind, wrong_route: assigned?.route_id !== route.id });
    }
    const stop = b.stop_name ?? assigned?.stop_name ?? null;
    const { data: ev, error } = await svc.from("transport_events").insert({ tenant_id: tid, route_id: route.id, student_id: person.id, kind: b.kind, stop_name: stop,
      recorded_by: ctx.userId, lat: b.lat ?? null, lng: b.lng ?? null }).select("id,at").single();
    if (error) return jsonError(error.message);
    const r = await notifyGuardians(svc, { tenantId: tid, studentIds: [person.id], kind: "bus", refId: ev.id, createdBy: ctx.userId,
      build: (brand, g) => busEvent(brand, { guardianName: g.full_name, studentName: person.name, kind: b.kind, route: route.name, stop,
        time: formatInZone(new Date(ev.at), ctx.tenant.timezone).time }) });
    return NextResponse.json({ person, kind: b.kind, at: ev.at, notified: r.queued, wrong_route: Boolean(assigned && assigned.route_id !== route.id), not_assigned: !assigned });
  }
  if (!hasAny(ctx, ROLES.transport)) return jsonError("only transport staff can change routes", 403);
  if (b.action === "save_route") {
    const { action: _a, id, ...row } = b;
    const { data, error } = id ? await sb.from("transport_routes").update(row).eq("tenant_id", tid).eq("id", id).select("id").single()
      : await sb.from("transport_routes").insert({ ...row, tenant_id: tid }).select("id").single();
    return error ? jsonError(error.message.includes("duplicate") ? "a route with that name exists" : error.message) : NextResponse.json(data);
  }
  if (b.action === "delete_route") {
    const { error } = await sb.from("transport_routes").delete().eq("tenant_id", tid).eq("id", b.id);
    return error ? jsonError(error.message) : NextResponse.json({ ok: true });
  }
  if (b.action === "assign") {
    const { data: route } = await sb.from("transport_routes").select("capacity,transport_assignments(count)").eq("tenant_id", tid).eq("id", b.route_id).maybeSingle();
    const used = route?.transport_assignments?.[0]?.count ?? 0;
    if (route?.capacity && used + b.student_ids.length > route.capacity) return jsonError(`this bus seats ${route.capacity}; ${used} already assigned`);
    const { error } = await sb.from("transport_assignments").upsert(b.student_ids.map(s => ({ student_id: s, tenant_id: tid, route_id: b.route_id, stop_name: b.stop_name ?? null, direction: b.direction })), { onConflict: "student_id" });
    return error ? jsonError(error.message) : NextResponse.json({ ok: true });
  }
  const { error } = await sb.from("transport_assignments").delete().eq("tenant_id", tid).eq("student_id", b.student_id);
  return error ? jsonError(error.message) : NextResponse.json({ ok: true });
}
