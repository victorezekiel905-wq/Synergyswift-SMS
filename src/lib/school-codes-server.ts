import { newSchoolCode, hashSchoolCode, SCHOOL_CODE_TTL_MIN } from "@/lib/school-codes";

/**
 * Makes a one-time onboarding code (migration 7900). With forTenantId, whoever
 * signs up with it becomes that school's admin (migration 8900); without, it
 * creates a new school. The plain code is returned this once and never stored.
 */
export async function makeSchoolCode(svc: any, p: { label: string; createdBy: string; leadId?: string | null; planCode?: string | null; forTenantId?: string | null }) {
  const code = newSchoolCode();
  const expires_at = new Date(Date.now() + SCHOOL_CODE_TTL_MIN * 60_000).toISOString();
  const { data, error } = await svc.from("school_signup_codes").insert({
    code_hash: hashSchoolCode(code), hint: code.slice(-4), label: p.label, lead_id: p.leadId ?? null, plan_code: p.planCode ?? null,
    // Only codes for an existing school name it, so codes for new schools work before migration 8900 too.
    ...(p.forTenantId ? { for_tenant_id: p.forTenantId } : {}), created_by: p.createdBy, expires_at
  }).select("id").single();
  if (error) throw new Error(/for_tenant_id/.test(error.message) ? "Codes for a school need the database update (migration 20260101008900)." : error.message);
  return { id: data.id as string, code, expires_at };
}
