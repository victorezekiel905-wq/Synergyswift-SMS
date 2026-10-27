/**
 * The scheduler's bus check (phase 14i-2), every five minutes: raises bus exceptions,
 * tells transport staff, the heads and the bus attendant at once, and closes
 * exceptions that have settled (the child signed in, or was scanned off).
 */
import { fetchAll } from "@/lib/results";
import { tellStaff } from "@/lib/hr-server";
import { localParts } from "@/lib/attendance";
import { startOfTodayIso, studentName } from "@/lib/school";
import { formatInZone } from "@/lib/messaging/outbox";
import { busExceptions, settled, EXCEPTION_WORDS, type BusEvent, type Presence } from "@/lib/bus-checks";

const chunks = <T>(xs: T[], n = 200) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

async function presenceFor(svc: any, tenantId: string, timeZone: string, today: string, ids: string[], now: Date): Promise<Presence> {
  const inSchool = new Set<string>(), marked = new Set<string>();
  const since = startOfTodayIso(timeZone, now);
  for (const part of chunks(ids)) {
    const [{ data: gate }, { data: daily }, { data: lessons }] = await Promise.all([
      svc.from("gate_events").select("student_id").eq("tenant_id", tenantId).eq("person_type", "student").eq("direction", "in").gte("at", since).in("student_id", part),
      svc.from("class_attendance").select("student_id,status").eq("tenant_id", tenantId).eq("date", today).in("student_id", part),
      svc.from("lesson_attendance").select("student_id,status").eq("tenant_id", tenantId).eq("date", today).in("student_id", part)
    ]);
    for (const g of gate ?? []) inSchool.add(g.student_id);
    for (const m of [...(daily ?? []), ...(lessons ?? [])]) { marked.add(m.student_id); if (m.status === "present" || m.status === "late") inSchool.add(m.student_id); }
  }
  const { count } = await svc.from("gate_events").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("person_type", "student").eq("direction", "in").gte("at", since);
  return { inSchool, marked, gateUsed: (count ?? 0) > 0 };
}

export async function runBusChecks(svc: any, baseUrl: string, now = new Date(), opts: { force?: boolean } = {}) {
  if (!opts.force && now.getUTCMinutes() % 5 !== 0) return null;
  const since = new Date(now.getTime() - 12 * 3600_000).toISOString();
  const events = await fetchAll<BusEvent & { tenant_id: string }>(() => svc.from("transport_events").select("id,tenant_id,student_id,route_id,kind,at").gte("at", since).order("at").order("id"));
  const { data: openRows, error } = await svc.from("bus_exceptions").select("id,tenant_id,student_id,kind,boarded_at,date").is("resolved_at", null)
    .gte("detected_at", new Date(now.getTime() - 36 * 3600_000).toISOString()).limit(2000);
  if (error) return null;   // before migration 6900
  const tenants = [...new Set([...events.map(e => e.tenant_id), ...(openRows ?? []).map((o: any) => o.tenant_id)])];
  if (!tenants.length) return { raised: 0, settled: 0 };
  const { data: zones } = await svc.from("tenants").select("id,timezone,status,modules").in("id", tenants);
  let raised = 0, closed = 0;
  for (const t of zones ?? []) {
    if (t.status !== "active" || t.modules?.transport === false) continue;
    const tz = t.timezone || "Africa/Lagos";
    const today = localParts(now, tz).date;
    const evs = events.filter(e => e.tenant_id === t.id);
    const open = (openRows ?? []).filter((o: any) => o.tenant_id === t.id);
    const ids = [...new Set([...evs.map(e => e.student_id), ...open.map((o: any) => o.student_id)])];
    if (!ids.length) continue;
    const presence = await presenceFor(svc, t.id, tz, today, ids, now);
    // Close what has settled.
    for (const o of open) {
      const why = settled(o, evs, presence);
      if (!why) continue;
      const { data: done } = await svc.from("bus_exceptions").update({ resolved_at: now.toISOString(), resolution_note: why }).eq("id", o.id).is("resolved_at", null).select("id");
      closed += done?.length ?? 0;
    }
    const { data: trips } = await svc.from("transport_live").select("route_id,trip,ended_at").eq("tenant_id", t.id).eq("trip", "afternoon").not("ended_at", "is", null);
    const found = busExceptions({ events: evs, presence, tripEnded: new Map((trips ?? []).map((r: any) => [r.route_id, r.ended_at])), timeZone: tz, now });
    if (!found.length) continue;
    const { data: fresh } = await svc.from("bus_exceptions").upsert(found.map(f => ({ tenant_id: t.id, date: today, ...f })),
      { onConflict: "tenant_id,date,student_id,kind", ignoreDuplicates: true }).select("id,student_id,route_id,kind,boarded_at");
    if (!fresh?.length) continue;
    raised += fresh.length;
    const [{ data: studs }, { data: routes }, { data: users }] = await Promise.all([
      svc.from("students").select("id,first_name,last_name,other_names,class_groups(name)").in("id", fresh.map((f: any) => f.student_id)),
      svc.from("transport_routes").select("id,name,attendant_id").eq("tenant_id", t.id),
      svc.from("users").select("id,role,extra_roles").eq("tenant_id", t.id).eq("active", true)
    ]);
    const watchers = (users ?? []).filter((u: any) => ["transport_officer", "principal", "school_admin"].some(r => u.role === r || (u.extra_roles ?? []).includes(r))).map((u: any) => u.id);
    for (const f of fresh) {
      const s: any = (studs ?? []).find((x: any) => x.id === f.student_id);
      const r: any = (routes ?? []).find((x: any) => x.id === f.route_id);
      const name = s ? studentName(s) : "A child";
      const time = f.boarded_at ? formatInZone(new Date(f.boarded_at), tz).time : "";
      await tellStaff(svc, t.id, [...watchers, ...(r?.attendant_id ? [r.attendant_id] : [])], "bus_exception",
        `Bus check: ${name} ${EXCEPTION_WORDS[f.kind as keyof typeof EXCEPTION_WORDS]}`,
        `${name}${s?.class_groups?.name ? ` (${s.class_groups.name})` : ""} boarded ${r?.name ?? "a bus"}${time ? ` at ${time}` : ""}. ${f.kind === "not_dropped_off" ? "Check the bus and call the family now." : "Find the child and check the register."} Close it on the Transport page when settled.`,
        `${baseUrl}/school/transport?tab=checks`, f.id).catch(() => null);
    }
  }
  return { raised, settled: closed };
}
