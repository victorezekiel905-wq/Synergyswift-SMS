import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { recordGateEvent } from "@/lib/gate";
import { distanceMetres, startOfTodayIso } from "@/lib/school";

/** Staff: today's own sign-in state. */
export async function GET() {
  const ctx = await requireCtx(ROLES.staff, "gate");
  if (ctx instanceof NextResponse) return ctx;
  const { data: staff } = await ctx.sb.from("staff").select("id,full_name").eq("tenant_id", ctx.tenant.id).eq("user_id", ctx.userId).maybeSingle();
  if (!staff) return NextResponse.json({ staff: null, events: [] });
  const { data: events } = await ctx.sb.from("gate_events").select("direction,at,late,method")
    .eq("tenant_id", ctx.tenant.id).eq("staff_id", staff.id).gte("at", startOfTodayIso(ctx.tenant.timezone)).order("at");
  const { data: s } = await ctx.sb.from("tenant_settings").select("geofence_lat,geofence_lng,geofence_radius_m").eq("tenant_id", ctx.tenant.id).maybeSingle();
  return NextResponse.json({ staff, events: events ?? [], geofence: s?.geofence_radius_m ? s : null });
}

const Body = z.object({
  direction: z.enum(["in", "out"]),
  lat: z.number().min(-90).max(90).nullish(),
  lng: z.number().min(-180).max(180).nullish()
});

/** Staff self sign-in / sign-out from their phone, optionally geofenced to the school. */
export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "gate");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError("direction required");
  const { direction, lat, lng } = parsed.data;
  const svc = createServiceClient();
  const { data: staff } = await svc.from("staff").select("id,full_name,status").eq("tenant_id", ctx.tenant.id).eq("user_id", ctx.userId).maybeSingle();
  if (!staff || staff.status === "exited") return jsonError("no staff record is linked to your account; ask HR", 404);

  const { data: fence } = await svc.from("tenant_settings").select("geofence_lat,geofence_lng,geofence_radius_m").eq("tenant_id", ctx.tenant.id).maybeSingle();
  if (fence?.geofence_radius_m && fence.geofence_lat !== null && fence.geofence_lng !== null) {
    if (lat === null || lat === undefined || lng === null || lng === undefined) return jsonError("location permission is required to sign in");
    const d = distanceMetres(lat, lng, fence.geofence_lat, fence.geofence_lng);
    if (d > fence.geofence_radius_m) return jsonError(`you are about ${Math.round(d)} m from school; sign in when you arrive`, 403);
  }
  try {
    const r = await recordGateEvent(svc, {
      tenantId: ctx.tenant.id, timezone: ctx.tenant.timezone,
      person: { type: "staff", id: staff.id, name: staff.full_name, photo_url: null, class_name: null },
      direction, method: "self", recordedBy: ctx.userId, lat: lat ?? null, lng: lng ?? null
    });
    return NextResponse.json(r);
  } catch (e) {
    return jsonError((e as Error).message);
  }
}
