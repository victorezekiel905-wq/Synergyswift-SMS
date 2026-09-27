/**
 * Admissions: public applications, status updates to the applicant's family,
 * and one-click enrolment (creates the student and guardian records).
 */
import { notifyContact } from "./notify";
import { admissionUpdate } from "./messaging/notices";

export async function tenantBySlug(svc: any, slug: string) {
  if (!/^[a-z0-9][a-z0-9-]{1,48}$/i.test(slug)) return null;
  const { data: t } = await svc.from("tenants").select("id,name,status,public_slug").ilike("public_slug", slug).maybeSingle();
  if (!t || t.status !== "active") return null;
  const { data: s } = await svc.from("tenant_settings").select("school_name,logo_url,brand_color,address,phone,email,admissions_open,application_fee,admissions_intro,currency").eq("tenant_id", t.id).maybeSingle();
  if (!s?.admissions_open) return null; // closed schools are not discoverable
  return { tenant: t, settings: s };
}

export async function notifyApplicant(svc: any, app: any, baseUrl: string, note?: string | null) {
  return notifyContact(svc, {
    tenantId: app.tenant_id, name: app.guardian_name, email: app.guardian_email, phone: app.guardian_phone, kind: "admission", refId: app.id,
    build: brand => admissionUpdate(brand, { guardianName: app.guardian_name, childName: `${app.first_name} ${app.last_name}`, applicationNo: app.application_no,
      status: app.status, note, link: `${baseUrl}/apply/track/${app.tracking_token}` })
  });
}

/** Turns an accepted application into a student with a guardian. Idempotent. */
export async function enrollApplication(svc: any, p: { tenantId: string; applicationId: string; admissionNo: string; classGroupId: string | null }) {
  const { data: app } = await svc.from("applications").select("*").eq("tenant_id", p.tenantId).eq("id", p.applicationId).maybeSingle();
  if (!app) throw new Error("application not found");
  if (app.student_id) return { student_id: app.student_id, already: true };
  const { data: st, error } = await svc.from("students").insert({
    tenant_id: p.tenantId, admission_no: p.admissionNo, first_name: app.first_name, last_name: app.last_name, other_names: app.other_names,
    gender: app.gender, date_of_birth: app.date_of_birth, class_group_id: p.classGroupId ?? app.class_group_id, address: app.address
  }).select("id").single();
  if (error) throw new Error(error.message.includes("duplicate") ? "that admission number is already used" : error.message);
  // Reuse a guardian with the same phone or email (siblings).
  const match = [app.guardian_phone ? `phone.eq.${String(app.guardian_phone).replace(/[,()]/g, "")}` : "", app.guardian_email ? `email.eq.${String(app.guardian_email).replace(/[,()]/g, "")}` : ""].filter(Boolean).join(",");
  let gid: string | null = null;
  if (match) {
    const { data: found } = await svc.from("guardians").select("id").eq("tenant_id", p.tenantId).or(match).limit(1);
    gid = found?.[0]?.id ?? null;
  }
  if (!gid) {
    const { data: g, error: gErr } = await svc.from("guardians").insert({ tenant_id: p.tenantId, full_name: app.guardian_name, email: app.guardian_email, phone: app.guardian_phone }).select("id").single();
    if (gErr) throw new Error(gErr.message);
    gid = g.id;
  }
  await svc.from("student_guardians").upsert({ tenant_id: p.tenantId, student_id: st.id, guardian_id: gid, relation: app.guardian_relation ?? "parent", is_primary: true, can_pickup: true },
    { onConflict: "student_id,guardian_id" });
  await svc.from("applications").update({ status: "enrolled", student_id: st.id, updated_at: new Date().toISOString() }).eq("tenant_id", p.tenantId).eq("id", app.id);
  return { student_id: st.id, guardian_id: gid, already: false };
}
