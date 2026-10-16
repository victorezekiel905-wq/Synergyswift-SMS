/**
 * Compliance on the server: reminders when policies are due for review or
 * certificates run out. Rules live in compliance.ts.
 */
import { localParts } from "./attendance";
import { documentAlerts } from "./compliance";
import { tellStaff } from "./hr-server";

const LEADERS = ["school_admin", "principal"];

/** Daily: tells each document's owner (or the school's leaders) about reviews and expiries, at most once a week per document. */
export async function remindDocuments(svc: any, baseUrl: string): Promise<number> {
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
  const { data: docs } = await svc.from("school_documents").select("id,tenant_id,title,category,status,review_due_on,expires_on,owner_id,reminded_at")
    .eq("status", "approved").or("review_due_on.not.is.null,expires_on.not.is.null").limit(5000);
  const byTenant = new Map<string, any[]>();
  for (const d of docs ?? []) if (!d.reminded_at || d.reminded_at < weekAgo) byTenant.set(d.tenant_id, [...(byTenant.get(d.tenant_id) ?? []), d]);
  let sent = 0;
  for (const [tid, list] of byTenant) {
    const { data: t } = await svc.from("tenants").select("timezone,status").eq("id", tid).maybeSingle();
    if (t?.status && t.status !== "active") continue;
    const alerts = documentAlerts(list, localParts(new Date(), t?.timezone ?? "Africa/Lagos").date);
    if (!alerts.length) continue;
    const { data: leaders } = await svc.from("users").select("id,role,extra_roles").eq("tenant_id", tid).eq("active", true);
    const leaderIds = (leaders ?? []).filter((u: any) => LEADERS.includes(u.role) || (u.extra_roles ?? []).some((r: string) => LEADERS.includes(r))).map((u: any) => u.id);
    for (const a of alerts) {
      const d = list.find(x => x.id === a.id)!;
      const what = a.kind === "review_overdue" ? `was due for review on ${a.date}` : a.kind === "review_soon" ? `is due for review on ${a.date}`
        : a.kind === "expired" ? `expired on ${a.date}` : `expires on ${a.date}`;
      await tellStaff(svc, tid, d.owner_id ? [d.owner_id] : leaderIds, "compliance_document", `${d.title}: ${a.kind.startsWith("review") ? "review" : "renewal"} needed`,
        `"${d.title}" ${what}. Upload the new version in the document library.`, `${baseUrl}/school/compliance`, d.id);
      await svc.from("school_documents").update({ reminded_at: new Date().toISOString() }).eq("id", d.id);
      sent++;
    }
  }
  return sent;
}
