import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError, hasAny } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { alertStops, isLive, stopsToAlert, type Stop } from "@/lib/bus";
import { vehicleBlocked, tripCheck } from "@/lib/boarding";
import { localParts } from "@/lib/attendance";
import { startOfTodayIso, studentName, appUrl } from "@/lib/school";
import { tellStaff } from "@/lib/hr-server";

/** Every bus currently on a trip (staff view). */
export async function GET() {
  const ctx = await requireCtx(ROLES.staff, "transport");
  if (ctx instanceof NextResponse) return ctx;
  const { data } = await ctx.sb.from("transport_live").select("route_id,trip,started_at,ended_at,lat,lng,accuracy,speed,updated_at,transport_routes(name,vehicle)").eq("tenant_id", ctx.tenant.id);
  return NextResponse.json({ buses: (data ?? []).map((b: any) => ({ ...b, live: isLive(b) })) });
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), route_id: z.string().uuid(), trip: z.enum(["morning", "afternoon"]) }),
  z.object({ action: z.literal("ping"), route_id: z.string().uuid(), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180),
    accuracy: z.number().min(0).max(100000).nullish(), speed: z.number().min(0).max(100).nullish() }),
  z.object({ action: z.literal("end"), route_id: z.string().uuid() })
]);

/** The attendant's phone: start a trip, send positions while it runs, end it. */
export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "transport");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  const svc = createServiceClient();
  const { data: route } = await svc.from("transport_routes").select("id,name,attendant_id,stops,vehicle_id,vehicles(status,insurance_expires,roadworthy_expires,reg_no)").eq("tenant_id", tid).eq("id", b.route_id).maybeSingle();
  if (!route) return jsonError("route not found", 404);
  if (!hasAny(ctx, ROLES.transport) && route.attendant_id !== ctx.userId) return jsonError("only this bus's attendant or transport staff can share its location", 403);

  if (b.action === "start") {
    // A bus with lapsed insurance or roadworthiness, or in for repair, does not carry children.
    const v: any = (route as any).vehicles;
    const blocked = v ? vehicleBlocked(v, localParts(new Date(), ctx.tenant.timezone).date) : null;
    if (blocked) return jsonError(`This bus (${v.reg_no}) cannot run: ${blocked}. Tell the transport officer.`, 409);
    const { error } = await svc.from("transport_live").upsert({ route_id: route.id, tenant_id: tid, trip: b.trip, started_at: new Date().toISOString(),
      ended_at: null, lat: null, lng: null, accuracy: null, speed: null, updated_at: null, notified_stops: [], started_by: ctx.userId }, { onConflict: "route_id" });
    return error ? jsonError(error.message) : NextResponse.json({ ok: true });
  }
  if (b.action === "end") {
    const { data: live } = await svc.from("transport_live").select("trip").eq("route_id", route.id).maybeSingle();
    await svc.from("transport_live").update({ ended_at: new Date().toISOString() }).eq("route_id", route.id).eq("tenant_id", tid);
    // Before the attendant leaves the bus: anyone who got on and was never seen getting off.
    const [{ data: riders }, { data: events }] = await Promise.all([
      svc.from("transport_assignments").select("student_id,direction,students(first_name,last_name,other_names)").eq("tenant_id", tid).eq("route_id", route.id),
      svc.from("transport_events").select("student_id,kind,at").eq("tenant_id", tid).eq("route_id", route.id).gte("at", startOfTodayIso(ctx.tenant.timezone))
    ]);
    const check = tripCheck((riders ?? []).map((r: any) => ({ student_id: r.student_id, name: studentName(r.students), direction: r.direction })), events ?? [], (live?.trip ?? "afternoon") as "morning" | "afternoon");
    if (check.still_on_bus.length) {
      const { data: users } = await svc.from("users").select("id,role,extra_roles").eq("tenant_id", tid).eq("active", true);
      const to = (users ?? []).filter((u: any) => ["transport_officer", "principal"].some(r => u.role === r || (u.extra_roles ?? []).includes(r))).map((u: any) => u.id).filter((id: string) => id !== ctx.userId);
      await tellStaff(svc, tid, to, "bus", `Check the bus: ${route.name}`, `The ${live?.trip ?? ""} trip ended with children not scanned off: ${check.still_on_bus.join(", ")}. Check the bus now.`, `${appUrl(req)}/school/transport`, route.id);
    }
    return NextResponse.json({ ok: true, ...check });
  }

  const { data: live } = await svc.from("transport_live").select("trip,started_at,ended_at,updated_at,notified_stops").eq("route_id", route.id).maybeSingle();
  if (!live || live.ended_at) return jsonError("start the trip first", 409);
  if (Date.now() - new Date(live.started_at).getTime() > 6 * 3600_000) return jsonError("this trip has run for over 6 hours; start a new one", 409);
  // A phone may send faster than we need; keep one update every 10 seconds.
  if (live.updated_at && Date.now() - new Date(live.updated_at).getTime() < 10_000) return NextResponse.json({ ok: true, throttled: true });
  const near = stopsToAlert({ lat: b.lat, lng: b.lng }, (route.stops ?? []) as Stop[], live.notified_stops ?? []);
  await svc.from("transport_live").update({ lat: b.lat, lng: b.lng, accuracy: b.accuracy ?? null, speed: b.speed ?? null, updated_at: new Date().toISOString(),
    notified_stops: [...(live.notified_stops ?? []), ...near] }).eq("route_id", route.id);
  const alerted = near.length ? await alertStops(svc, { tenantId: tid, timezone: ctx.tenant.timezone, routeId: route.id, routeName: route.name, trip: live.trip, stops: near }) : 0;
  return NextResponse.json({ ok: true, alerted_stops: near, messages: alerted });
}
