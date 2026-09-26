/**
 * Live school-bus location.
 *
 * The attendant's phone shares its position only while a trip is running.
 * Parents of children on that route see where the bus is, and get one alert
 * per stop when the bus is about five minutes away.
 */
import { distanceMetres, startOfTodayIso, studentName } from "./school";
import { notifyGuardians } from "./notify";
import { busApproaching } from "./messaging/notices";

/** Roughly five minutes out for a school bus in town traffic. */
export const APPROACH_RADIUS_M = 1200;
/** A position older than this is shown as "last seen", not live. */
export const LIVE_FOR_MS = 10 * 60_000;

export type Stop = { name: string; lat?: number | null; lng?: number | null };

/** Pure: stops with coordinates the bus is now close to, not alerted yet on this trip. */
export function stopsToAlert(pos: { lat: number; lng: number }, stops: Stop[], alreadyAlerted: string[], radius = APPROACH_RADIUS_M): string[] {
  const done = new Set(alreadyAlerted);
  return stops
    .filter(s => typeof s.lat === "number" && typeof s.lng === "number" && !done.has(s.name))
    .filter(s => distanceMetres(pos.lat, pos.lng, s.lat!, s.lng!) <= radius)
    .map(s => s.name);
}

/** Pure: is a live row fresh enough to show as moving? */
export function isLive(row: { ended_at: string | null; updated_at: string | null } | null | undefined, now = Date.now()): boolean {
  return Boolean(row && !row.ended_at && row.updated_at && now - new Date(row.updated_at).getTime() <= LIVE_FOR_MS);
}

/**
 * Tells parents whose child uses a stop that the bus is nearly there.
 * Morning: children at that stop who have not boarded yet today.
 * Afternoon: children on the bus whose stop it is.
 */
export async function alertStops(svc: any, p: { tenantId: string; timezone: string; routeId: string; routeName: string; trip: "morning" | "afternoon"; stops: string[] }) {
  if (!p.stops.length) return 0;
  const { data: riders } = await svc.from("transport_assignments").select("student_id,stop_name,direction,students(first_name,last_name,other_names,status)")
    .eq("tenant_id", p.tenantId).eq("route_id", p.routeId).in("stop_name", p.stops);
  const wanted = (riders ?? []).filter((r: any) => r.students?.status === "active" && (r.direction === "both" || r.direction === p.trip));
  if (!wanted.length) return 0;
  const { data: events } = await svc.from("transport_events").select("student_id,kind,at").eq("tenant_id", p.tenantId).eq("route_id", p.routeId)
    .gte("at", startOfTodayIso(p.timezone)).in("student_id", wanted.map((r: any) => r.student_id)).order("at");
  const last = new Map<string, string>();
  for (const e of events ?? []) last.set(e.student_id, e.kind);
  const targets = wanted.filter((r: any) => p.trip === "morning" ? !last.has(r.student_id) : last.get(r.student_id) === "boarded");
  let queued = 0;
  for (const r of targets) {
    const res = await notifyGuardians(svc, { tenantId: p.tenantId, studentIds: [r.student_id], kind: "bus_near", refId: p.routeId, budgetMs: 1500,
      build: (brand, g) => busApproaching(brand, { guardianName: g.full_name, studentName: studentName(r.students), route: p.routeName, stop: r.stop_name, trip: p.trip }) });
    queued += res.queued;
  }
  return queued;
}
