/**
 * Consent records: database work shared by the admin page and both parent
 * portals. Callers must have authorised the action for this tenant.
 */
import { fetchAll } from "./results";
import { studentName } from "./school";
import { DEFAULT_PURPOSES, stateFor, type ConsentRecord, type Purpose } from "./consent";

/** The school's purposes, created from the defaults the first time. */
export async function ensurePurposes(svc: any, tenantId: string): Promise<Purpose[]> {
  const { data } = await svc.from("consent_purposes").select("id,key,title,description,per_child,required,version,active,position").eq("tenant_id", tenantId).order("position");
  if (data?.length) return data;
  const { data: made } = await svc.from("consent_purposes").upsert(DEFAULT_PURPOSES.map(p => ({ ...p, tenant_id: tenantId })), { onConflict: "tenant_id,key", ignoreDuplicates: true })
    .select("id,key,title,description,per_child,required,version,active,position");
  return (made ?? []).sort((a: Purpose, b: Purpose) => a.position - b.position);
}

/** What a family is asked, and how they have answered, for each child. */
export async function familyConsent(svc: any, tenantId: string, guardianId: string) {
  const purposes = (await ensurePurposes(svc, tenantId)).filter(p => p.active);
  const [{ data: links }, { data: s }] = await Promise.all([
    svc.from("student_guardians").select("students(id,first_name,last_name,other_names,status)").eq("tenant_id", tenantId).eq("guardian_id", guardianId),
    svc.from("tenant_settings").select("privacy_notice,privacy_notice_version,school_name").eq("tenant_id", tenantId).maybeSingle()
  ]);
  const kids = (links ?? []).map((l: any) => l.students).filter((x: any) => x && x.status === "active");
  const ids = kids.map((k: any) => k.id);
  const { data: recs } = await svc.from("consent_records").select("purpose_id,version,guardian_id,student_id,granted,method,created_at").eq("tenant_id", tenantId)
    .or(`guardian_id.eq.${guardianId}${ids.length ? `,student_id.in.(${ids.join(",")})` : ""}`).order("created_at");
  const records = (recs ?? []) as ConsentRecord[];
  const items = purposes.flatMap(p => p.per_child
    ? kids.map((k: any) => ({ purpose_id: p.id, student_id: k.id, child: studentName(k), ...stateFor(p, records, { studentId: k.id }) }))
    : [{ purpose_id: p.id, student_id: null, child: null, ...stateFor(p, records, { guardianId }) }]);
  return {
    purposes, privacy_notice: s?.privacy_notice ?? null, school: s?.school_name ?? null,
    items: items.map(i => ({ purpose_id: i.purpose_id, student_id: i.student_id, child: i.child, state: i.state, answered_at: i.record?.created_at ?? null })),
    pending: items.filter(i => i.state === "missing" || i.state === "outdated").length
  };
}

export async function recordConsent(svc: any, p: { tenantId: string; guardianId: string | null; purposeId: string; studentId: string | null; granted: boolean;
  method: "portal" | "link" | "paper" | "staff" | "email"; recordedBy?: string | null; note?: string | null; ip?: string | null; userAgent?: string | null }) {
  const { data: purpose } = await svc.from("consent_purposes").select("id,key,per_child,version,active").eq("tenant_id", p.tenantId).eq("id", p.purposeId).maybeSingle();
  if (!purpose || !purpose.active) throw new Error("that permission is not asked for");
  if (purpose.per_child && !p.studentId) throw new Error("choose the child");
  if (p.studentId) {
    if (p.guardianId) {
      const { data: link } = await svc.from("student_guardians").select("student_id").eq("tenant_id", p.tenantId).eq("guardian_id", p.guardianId).eq("student_id", p.studentId).maybeSingle();
      if (!link) throw new Error("you are not linked to this child");
    } else {
      const { data: st } = await svc.from("students").select("id").eq("tenant_id", p.tenantId).eq("id", p.studentId).maybeSingle();
      if (!st) throw new Error("student not found");
    }
  }
  if (!purpose.per_child && !p.guardianId) throw new Error("choose the family");
  const { error } = await svc.from("consent_records").insert({
    tenant_id: p.tenantId, purpose_id: purpose.id, version: purpose.version, guardian_id: p.guardianId, student_id: purpose.per_child ? p.studentId : null,
    granted: p.granted, method: p.method, recorded_by: p.recordedBy ?? null, note: p.note ?? null, ip: p.ip ?? null, user_agent: p.userAgent?.slice(0, 300) ?? null
  });
  if (error) throw new Error(error.message);
  // The newsletter permission and the campaign opt-out are the same choice.
  if (purpose.key === "marketing" && p.guardianId) await svc.from("guardians").update({ marketing_opt_out: !p.granted }).eq("tenant_id", p.tenantId).eq("id", p.guardianId);
  return { ok: true };
}

/** Every active child and family with their consent states, for the admin coverage view. */
export async function consentRegister(svc: any, tenantId: string) {
  const purposes = await ensurePurposes(svc, tenantId);
  const [students, links, records] = await Promise.all([
    fetchAll<any>(() => svc.from("students").select("id,first_name,last_name,other_names,admission_no,class_groups(name)").eq("tenant_id", tenantId).eq("status", "active").order("id")),
    fetchAll<any>(() => svc.from("student_guardians").select("guardian_id,student_id,students!inner(status)").eq("tenant_id", tenantId).eq("students.status", "active").order("student_id")),
    fetchAll<ConsentRecord>(() => svc.from("consent_records").select("purpose_id,version,guardian_id,student_id,granted,method,created_at").eq("tenant_id", tenantId).order("created_at"))
  ]);
  return { purposes, students, guardianIds: [...new Set(links.map(l => l.guardian_id))] as string[], records };
}
