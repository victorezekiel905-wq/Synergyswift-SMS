import { notifyGuardians } from "@/lib/notify";
import { communityNote } from "@/lib/messaging/notices";
import { formatInZone } from "@/lib/messaging/outbox";
import { studentName } from "@/lib/school";
import { tellStaff } from "@/lib/hr-server";
import { exeatOverdue } from "@/lib/boarding";

const KIND: Record<string, string> = { weekend: "a weekend exeat", day: "a day out", medical: "a medical appointment", holiday: "holiday leave", family: "a family event", other: "an exeat" };

/** Asks the parents to agree an exeat that staff or the student asked for; the link opens their portal. */
export async function askParentsForExeat(svc: any, tenantId: string, exeatId: string, timezone: string, baseUrl: string, by: string | null) {
  const { data: e } = await svc.from("exeat_requests").select("student_id,kind,reason,leave_at,return_by,requested_by,collector_name,students(first_name,last_name,other_names)").eq("id", exeatId).maybeSingle();
  if (!e) return 0;
  const f = (d: string) => { const x = formatInZone(new Date(d), timezone); return `${x.date} ${x.time}`; };
  const who = e.requested_by === "student" ? `${studentName(e.students)} has asked for` : "The boarding house has arranged";
  const r = await notifyGuardians(svc, { tenantId, studentIds: [e.student_id], kind: "exeat", refId: exeatId, createdBy: by,
    build: (brand, g) => communityNote(brand, { name: g.full_name, subject: `Please agree: exeat for ${studentName(e.students)}`,
      lines: [`${who} ${KIND[e.kind] ?? "an exeat"} from ${f(e.leave_at)} to ${f(e.return_by)}: ${e.reason}.${e.collector_name ? ` Collected by ${e.collector_name}.` : ""}`,
        "Please agree or decline in your parent portal (Boarding)."],
      link: g.user_id ? `${baseUrl}/parent?tab=boarding` : g.portal_token ? `${baseUrl}/g/${g.portal_token}?tab=boarding` : `${baseUrl}/parent`, linkLabel: "Agree or decline" }) });
  return r.queued;
}

/** Students out on exeat and not back on time: house staff and parents hear once. Run from the frequent cron. */
export async function alertLateReturns(svc: any, baseUrl: string, now = new Date()) {
  const { data } = await svc.from("exeat_requests").select("id,tenant_id,student_id,return_by,status,overdue_alerted_at,students(first_name,last_name,other_names)").eq("status", "out").is("overdue_alerted_at", null)
    .lt("return_by", now.toISOString()).limit(200);
  let n = 0;
  for (const e of data ?? []) {
    if (!exeatOverdue(e, now)) continue;
    const { data: done } = await svc.from("exeat_requests").update({ overdue_alerted_at: now.toISOString() }).eq("id", e.id).is("overdue_alerted_at", null).select("id");
    if (!done?.length) continue;
    const { data: t } = await svc.from("tenants").select("timezone").eq("id", e.tenant_id).maybeSingle();
    const due = formatInZone(new Date(e.return_by), t?.timezone ?? "Africa/Lagos");
    const { data: users } = await svc.from("users").select("id,role,extra_roles").eq("tenant_id", e.tenant_id).eq("active", true);
    const staff = (users ?? []).filter((u: any) => ["hostel_warden", "principal"].some(r => u.role === r || (u.extra_roles ?? []).includes(r))).map((u: any) => u.id);
    await tellStaff(svc, e.tenant_id, staff, "exeat", `Not back from exeat: ${studentName(e.students)}`, `${studentName(e.students)} was due back at ${due.time} on ${due.date} and has not been signed in.`, `${baseUrl}/school/hostel`, e.id);
    await notifyGuardians(svc, { tenantId: e.tenant_id, studentIds: [e.student_id], kind: "exeat", refId: e.id,
      build: (brand, g) => communityNote(brand, { name: g.full_name, subject: `${studentName(e.students)} is not back yet`,
        lines: [`${studentName(e.students)} was due back at school by ${due.time} on ${due.date} and has not been signed in. Please call the boarding house.`] }) });
    n++;
  }
  return n;
}

/** Putting a child on a bus route adds the route's bus fee to their extras (and taking them off removes it), for the next invoices. */
export async function syncTransportFee(svc: any, tenantId: string, studentIds: string[], routeId: string | null, previous: Map<string, string | null>) {
  const routeIds = [...new Set([routeId, ...previous.values()].filter(Boolean))] as string[];
  if (!routeIds.length) return;
  const { data: routes } = await svc.from("transport_routes").select("id,fee_item_id").in("id", routeIds);
  const fee = new Map((routes ?? []).map((r: any) => [r.id, r.fee_item_id]));
  for (const sid of studentIds) {
    const old = previous.get(sid) ? fee.get(previous.get(sid)!) : null, now = routeId ? fee.get(routeId) : null;
    if (old && old !== now) await svc.from("fee_optional_choices").delete().eq("tenant_id", tenantId).eq("student_id", sid).eq("fee_item_id", old);
    if (now && now !== old) {
      const { data: has } = await svc.from("fee_optional_choices").select("id").eq("tenant_id", tenantId).eq("student_id", sid).eq("fee_item_id", now).limit(1);
      if (!has?.length) await svc.from("fee_optional_choices").insert({ tenant_id: tenantId, student_id: sid, fee_item_id: now });
    }
  }
}
