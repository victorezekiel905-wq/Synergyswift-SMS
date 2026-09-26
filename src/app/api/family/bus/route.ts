import { NextRequest, NextResponse } from "next/server";
import { jsonError, sessionIdentity } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { identifyGuardian } from "@/lib/guardian";
import { isLive } from "@/lib/bus";

export const dynamic = "force-dynamic";

/** Where each child's bus is. Position is shared only while a trip is running. */
export async function GET(req: NextRequest) {
  const svc = createServiceClient();
  const who = await identifyGuardian(svc, new URL(req.url).searchParams.get("token"), sessionIdentity);
  if ("error" in who) return jsonError(who.error, who.status);
  const { data: kids } = await svc.from("student_guardians").select("student_id").eq("tenant_id", who.tenantId).eq("guardian_id", who.guardianId);
  const ids = (kids ?? []).map((k: { student_id: string }) => k.student_id);
  if (!ids.length) return NextResponse.json({ buses: [] });
  const { data: rides } = await svc.from("transport_assignments").select("student_id,stop_name,route_id,transport_routes(name,vehicle,driver_name,driver_phone,stops)")
    .eq("tenant_id", who.tenantId).in("student_id", ids);
  const routeIds = [...new Set((rides ?? []).map((r: any) => r.route_id))];
  const { data: live } = routeIds.length ? await svc.from("transport_live").select("route_id,trip,ended_at,lat,lng,updated_at").in("route_id", routeIds) : { data: [] };
  return NextResponse.json({
    buses: (rides ?? []).map((r: any) => {
      const l = (live ?? []).find((x: any) => x.route_id === r.route_id);
      const stop = (r.transport_routes?.stops ?? []).find((s: any) => s.name === r.stop_name);
      return {
        student_id: r.student_id, route: r.transport_routes?.name, vehicle: r.transport_routes?.vehicle, driver: r.transport_routes?.driver_name,
        driver_phone: r.transport_routes?.driver_phone, stop: r.stop_name, stop_lat: stop?.lat ?? null, stop_lng: stop?.lng ?? null,
        live: isLive(l), trip: l && !l.ended_at ? l.trip : null,
        position: l && !l.ended_at && l.lat != null ? { lat: l.lat, lng: l.lng, at: l.updated_at } : null
      };
    })
  }, { headers: { "Cache-Control": "no-store" } });
}
