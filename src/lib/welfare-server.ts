import { tellStaff } from "@/lib/hr-server";
import { escalationDue, needsFollowUp, CONCERN_CATEGORIES, type Severity } from "@/lib/welfare";

/** Who opened which confidential record. */
export async function logAccess(svc: any, tenantId: string, userId: string, kind: string, recordId: string, studentId: string | null) {
  await svc.from("sensitive_access_log").insert({ tenant_id: tenantId, user_id: userId, record_kind: kind, record_id: recordId, student_id: studentId });
}

const hasRole = (u: { role: string; extra_roles: string[] | null }, roles: string[]) => roles.includes(u.role) || (u.extra_roles ?? []).some(r => roles.includes(r));

/** The safeguarding team: counsellors, the principal and school admins. */
export async function safeguardingTeam(svc: any, tenantId: string, opts: { headsOnly?: boolean } = {}): Promise<string[]> {
  const { data } = await svc.from("users").select("id,role,extra_roles").eq("tenant_id", tenantId).eq("active", true);
  const roles = opts.headsOnly ? ["principal", "school_admin"] : ["counsellor", "principal", "school_admin"];
  return (data ?? []).filter((u: any) => hasRole(u, roles)).map((u: any) => u.id as string);
}

export async function counsellors(svc: any, tenantId: string): Promise<string[]> {
  const { data } = await svc.from("users").select("id,role,extra_roles").eq("tenant_id", tenantId).eq("active", true);
  return (data ?? []).filter((u: any) => hasRole(u, ["counsellor"])).map((u: any) => u.id as string);
}

/** A new concern goes to the whole team at once. The message names no details: they open the record. */
export async function alertNewConcern(svc: any, tenantId: string, c: { id: string; severity: Severity; category: string; reporter: string | null }, baseUrl: string) {
  const team = (await safeguardingTeam(svc, tenantId)).filter(id => id !== c.reporter);
  await tellStaff(svc, tenantId, team, "safeguarding", `${c.severity === "critical" ? "URGENT " : ""}Safeguarding concern`,
    `A ${c.severity} safeguarding concern (${CONCERN_CATEGORIES[c.category] ?? c.category}) has been reported. Please acknowledge it.`, `${baseUrl}/school/pastoral?concern=${c.id}`, c.id);
}

/** Concerns nobody has acknowledged in time go to the principal and admins, once. Run from the frequent cron. */
export async function escalateConcerns(svc: any, baseUrl: string, now = new Date()) {
  const { data } = await svc.from("safeguarding_concerns").select("id,tenant_id,severity,category,status,created_at,escalated_at").eq("status", "new").is("escalated_at", null).limit(200);
  if (!data?.length) return 0;
  const tenants = [...new Set(data.map((c: any) => c.tenant_id))] as string[];
  const { data: settings } = await svc.from("tenant_settings").select("tenant_id,safeguarding_escalate_hours").in("tenant_id", tenants);
  const hours = new Map<string, number>((settings ?? []).map((s: any) => [s.tenant_id, Number(s.safeguarding_escalate_hours ?? 4)]));
  let n = 0;
  for (const c of data) {
    if (!escalationDue(c, hours.get(c.tenant_id) ?? 4, now)) continue;
    const { data: done } = await svc.from("safeguarding_concerns").update({ escalated_at: now.toISOString() }).eq("id", c.id).is("escalated_at", null).select("id");
    if (!done?.length) continue;
    await svc.from("safeguarding_actions").insert({ tenant_id: c.tenant_id, concern_id: c.id, kind: "escalated", detail: "Not acknowledged in time; escalated to the principal and admins." });
    await tellStaff(svc, c.tenant_id, await safeguardingTeam(svc, c.tenant_id, { headsOnly: true }), "safeguarding", "Safeguarding concern not picked up",
      `A ${c.severity} safeguarding concern reported at ${new Date(c.created_at).toISOString().slice(11, 16)} UTC has not been acknowledged. Please act now.`, `${baseUrl}/school/pastoral?concern=${c.id}`, c.id);
    n++;
  }
  return n;
}

/** A check-in that needs a person: the form teacher and counsellors hear at once (no details in the message). */
export async function alertCheckin(svc: any, tenantId: string, c: { id: string; student_id: string | null; mood: number; feelings: string[]; wants_to_talk: boolean }, baseUrl: string) {
  const why = needsFollowUp(c);
  if (!why || !c.student_id) return false;
  const { data: s } = await svc.from("students").select("first_name,last_name,class_groups(form_teacher_id)").eq("id", c.student_id).maybeSingle();
  const to = [...await counsellors(svc, tenantId), s?.class_groups?.form_teacher_id].filter(Boolean) as string[];
  await tellStaff(svc, tenantId, to, "wellbeing", `Wellbeing check-in: ${s?.first_name ?? "a student"} ${s?.last_name ?? ""}`.trim(),
    `A student's check-in needs following up (${why}).`, `${baseUrl}/school/pastoral?tab=wellbeing`, c.id);
  return true;
}
