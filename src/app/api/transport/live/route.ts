import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError, hasAny } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { alertStops, isLive, stopsToAlert, type Stop } from "@/lib/bus";

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
  const { data: route } = await svc.from("transport_routes").select("id,name,attendant_id,stops").eq("tenant_id", tid).eq("id", b.route_id).maybeSingle();
  if (!route) return jsonError("route not found", 404);
  if (!hasAny(ctx, ROLES.transport) && route.attendant_id !== ctx.userId) return jsonError("only this bus's attendant or transport staff can share its location", 403);

  if (b.action === "start") {
    const { error } = await svc.from("transport_live").upsert({ route_id: route.id, tenant_id: tid, trip: b.trip, started_at: new Date().toISOString(),
      ended_at: null, lat: null, lng: null, accuracy: null, speed: null, updated_at: null, notified_stops: [], started_by: ctx.userId }, { onConflict: "route_id" });
    return error ? jsonError(error.message) : NextResponse.json({ ok: true });
  }
  if (b.action === "end") {
    await svc.from("transport_live").update({ ended_at: new Date().toISOString() }).eq("route_id", route.id).eq("tenant_id", tid);
    return NextResponse.json({ ok: true });
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
