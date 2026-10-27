import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { recordGateEvent } from "@/lib/gate";
import { distanceMetres, startOfTodayIso } from "@/lib/school";
import { clockKey, readClockToken } from "@/lib/clock-qr";

/** How staff may clock in from a phone (phase 14i): the entrance code, the school's geofence, or both. */
type ClockMode = "auto" | "qr" | "geofence" | "qr_or_geofence" | "qr_and_geofence";

/** Staff: today's own sign-in state. */
export async function GET() {
  const ctx = await requireCtx(ROLES.staff, "gate");
  if (ctx instanceof NextResponse) return ctx;
  const { data: staff } = await ctx.sb.from("staff").select("id,full_name").eq("tenant_id", ctx.tenant.id).eq("user_id", ctx.userId).maybeSingle();
  if (!staff) return NextResponse.json({ staff: null, events: [] });
  const { data: events } = await ctx.sb.from("gate_events").select("direction,at,late,method")
    .eq("tenant_id", ctx.tenant.id).eq("staff_id", staff.id).gte("at", startOfTodayIso(ctx.tenant.timezone)).order("at");
  const { data: s } = await ctx.sb.from("tenant_settings").select("*").eq("tenant_id", ctx.tenant.id).maybeSingle();
  return NextResponse.json({ staff, events: events ?? [], geofence: s?.geofence_radius_m ? { geofence_lat: s.geofence_lat, geofence_lng: s.geofence_lng, geofence_radius_m: s.geofence_radius_m } : null,
    mode: (s?.staff_self_clock ?? "auto") as ClockMode });
}

const Body = z.object({
  direction: z.enum(["in", "out", "auto"]),
  lat: z.number().min(-90).max(90).nullish(),
  lng: z.number().min(-180).max(180).nullish(),
  /** The code scanned at the entrance. */
  qr: z.string().max(200).nullish()
});

/** Staff self sign-in / sign-out from their phone: by the entrance code and/or inside the school's geofence. */
export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "gate");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError("direction required");
  const { direction, lat, lng } = parsed.data;
  const svc = createServiceClient();
  const { data: staff } = await svc.from("staff").select("id,full_name,status").eq("tenant_id", ctx.tenant.id).eq("user_id", ctx.userId).maybeSingle();
  if (!staff || staff.status === "exited") return jsonError("no staff record is linked to your account; ask HR", 404);

  const { data: s } = await svc.from("tenant_settings").select("*").eq("tenant_id", ctx.tenant.id).maybeSingle();
  const mode = (s?.staff_self_clock ?? "auto") as ClockMode;
  const qr = parsed.data.qr ? readClockToken(parsed.data.qr, ctx.tenant.id, clockKey()) : null;
  if (parsed.data.qr && !qr) return jsonError("That code has expired. Scan the code at the entrance again.", 400);
  const hasFence = Boolean(s?.geofence_radius_m && s.geofence_lat !== null && s.geofence_lng !== null);
  const fenceError = (): string | null => {
    if (lat === null || lat === undefined || lng === null || lng === undefined) return "location permission is required to sign in";
    const d = distanceMetres(lat, lng, s.geofence_lat, s.geofence_lng);
    return d > s.geofence_radius_m ? `you are about ${Math.round(d)} m from school; sign in when you arrive` : null;
  };
  let problem: string | null = null;
  if (mode === "qr" && !qr) problem = "Scan the clock-in code at the school entrance to sign in or out.";
  else if (mode === "qr_and_geofence") problem = !qr ? "Scan the clock-in code at the school entrance to sign in or out." : hasFence ? fenceError() : null;
  else if (mode === "qr_or_geofence" && !qr) problem = hasFence ? fenceError() : "Scan the clock-in code at the school entrance to sign in or out.";
  else if ((mode === "geofence" || mode === "auto") && !qr && hasFence) problem = fenceError();
  if (problem) return jsonError(problem, 403);

  try {
    const r = await recordGateEvent(svc, {
      tenantId: ctx.tenant.id, timezone: ctx.tenant.timezone,
      person: { type: "staff", id: staff.id, name: staff.full_name, photo_url: null, class_name: null },
      direction, method: "self", recordedBy: ctx.userId, lat: lat ?? null, lng: lng ?? null,
      note: qr ? "Scanned the entrance code" : null, campus: qr?.campus ?? null
    });
    return NextResponse.json(r);
  } catch (e) {
    return jsonError((e as Error).message);
  }
}
