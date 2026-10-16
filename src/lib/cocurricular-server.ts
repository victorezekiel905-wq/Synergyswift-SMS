import { tellStaff } from "@/lib/hr-server";
import { notifyGuardians } from "@/lib/notify";
import { communityNote } from "@/lib/messaging/notices";
import { formatInZone } from "@/lib/messaging/outbox";
import { studentName } from "@/lib/school";
import { tripLate } from "@/lib/cocurricular";

/** A club's fee goes onto a member's extras while they are in it (for the next invoices). */
export async function setClubFee(svc: any, tenantId: string, studentId: string, feeItemId: string | null, member: boolean) {
  if (!feeItemId) return;
  if (!member) { await svc.from("fee_optional_choices").delete().eq("tenant_id", tenantId).eq("student_id", studentId).eq("fee_item_id", feeItemId); return; }
  const { data: has } = await svc.from("fee_optional_choices").select("id").eq("tenant_id", tenantId).eq("student_id", studentId).eq("fee_item_id", feeItemId).limit(1);
  if (!has?.length) await svc.from("fee_optional_choices").insert({ tenant_id: tenantId, student_id: studentId, fee_item_id: feeItemId });
}

/** Trips where children are still out after the planned return: trip staff and admins hear once. Run from the frequent cron. */
export async function alertLateTrips(svc: any, baseUrl: string, now = new Date()) {
  const { data } = await svc.from("school_events").select("id,tenant_id,title,returns_at,late_alerted_at,staff_ids,trip_roster(status)").eq("kind", "trip")
    .is("late_alerted_at", null).lt("returns_at", now.toISOString()).gt("returns_at", new Date(now.getTime() - 2 * 86_400_000).toISOString()).limit(100);
  let n = 0;
  for (const e of data ?? []) {
    const out = tripLate(e, e.trip_roster ?? [], now);
    if (!out) continue;
    const { data: done } = await svc.from("school_events").update({ late_alerted_at: now.toISOString() }).eq("id", e.id).is("late_alerted_at", null).select("id");
    if (!done?.length) continue;
    const { data: users } = await svc.from("users").select("id,role,extra_roles").eq("tenant_id", e.tenant_id).eq("active", true);
    const heads = (users ?? []).filter((u: any) => ["principal", "school_admin"].some(r => u.role === r || (u.extra_roles ?? []).includes(r))).map((u: any) => u.id);
    await tellStaff(svc, e.tenant_id, [...new Set([...(e.staff_ids ?? []), ...heads])], "trip", `Trip not back: ${e.title}`,
      `${out} student${out === 1 ? " has" : "s have"} not been ticked back from "${e.title}". Check with the trip staff and update the roster.`, `${baseUrl}/school/activities?tab=trips&trip=${e.id}`, e.id);
    n++;
  }
  return n;
}

/** Parents hear when the coach leaves and when it is back. */
export async function tellTripParents(svc: any, tenantId: string, eventId: string, studentIds: string[], stage: "departed" | "returned", timezone: string) {
  if (!studentIds.length) return 0;
  const { data: e } = await svc.from("school_events").select("title,returns_at,meeting_point").eq("id", eventId).maybeSingle();
  const { data: studs } = await svc.from("students").select("id,first_name,last_name,other_names").in("id", studentIds);
  const names = new Map((studs ?? []).map((s: any) => [s.id, studentName(s)]));
  const back = e?.returns_at ? formatInZone(new Date(e.returns_at), timezone) : null;
  let n = 0;
  for (const sid of studentIds) {
    const r = await notifyGuardians(svc, { tenantId, studentIds: [sid], kind: "trip", refId: eventId, budgetMs: 1500,
      build: (brand, g) => communityNote(brand, { name: g.full_name, subject: `${e?.title ?? "Trip"}: ${stage === "departed" ? "on the way" : "back at school"}`,
        lines: [stage === "departed" ? `${names.get(sid) ?? "Your child"} has left on "${e?.title ?? "the trip"}".${back ? ` We expect to be back at ${back.time}${e?.meeting_point ? ` at ${e.meeting_point}` : ""}.` : ""}`
          : `${names.get(sid) ?? "Your child"} is back at school from "${e?.title ?? "the trip"}".`] }) });
    n += r.queued;
  }
  return n;
}
