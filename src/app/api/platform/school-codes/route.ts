import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAdmin, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { codeStatus, SCHOOL_CODE_TTL_MIN } from "@/lib/school-codes";
import { makeSchoolCode } from "@/lib/school-codes-server";

export const dynamic = "force-dynamic";

/** One-time school codes: the platform team sees them; only the owner makes or revokes them. */
export async function GET() {
  const gate = await requirePlatformAdmin();
  if (gate instanceof NextResponse) return gate;
  const svc = createServiceClient();
  const list = (cols: string) => svc.from("school_signup_codes").select(cols).order("created_at", { ascending: false }).limit(500);
  let { data, error } = await list("id,hint,label,lead_id,plan_code,created_at,expires_at,used_at,revoked_at,tenant_id,for_tenant_id,school:tenants!school_signup_codes_tenant_id_fkey(name),for_school:tenants!school_signup_codes_for_tenant_id_fkey(name),sales_leads(school_name)");
  // Before migration 8900 codes have no for_tenant_id: list them as before.
  if (error && /for_tenant/.test(error.message)) ({ data, error } = await list("id,hint,label,lead_id,plan_code,created_at,expires_at,used_at,revoked_at,tenant_id,school:tenants(name),sales_leads(school_name)"));
  if (error) return jsonError(error.message.includes("school_signup_codes") || error.message.includes("for_tenant") ? "School codes need the database update (migration 20260101008900)." : error.message);
  return NextResponse.json({ owner: gate.role === "owner", codes: (data ?? []).map((c: any) => ({ ...c, status: codeStatus(c),
    school: c.school?.name ?? null, for_school: c.for_school?.name ?? null, lead: c.sales_leads?.school_name ?? null, sales_leads: undefined })) });
}

const Body = z.discriminatedUnion("action", [
  // For a school already created on the console (tenant_id), or for a new one (label: who it is for).
  z.object({ action: z.literal("create"), label: z.string().trim().min(2).max(200).nullish(), tenant_id: z.string().uuid().nullish(), lead_id: z.string().uuid().nullish(), plan_code: z.string().max(40).nullish() }),
  z.object({ action: z.literal("revoke"), id: z.string().uuid() })
]);

export async function POST(req: NextRequest) {
  const gate = await requirePlatformAdmin("owner");
  if (gate instanceof NextResponse) return gate;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const svc = createServiceClient();
  if (b.action === "revoke") {
    const { data, error } = await svc.from("school_signup_codes").update({ revoked_at: new Date().toISOString() }).eq("id", b.id).is("used_at", null).is("revoked_at", null).select("id");
    if (error) return jsonError(error.message);
    if (!data?.length) return jsonError("That code is already used or revoked.");
    return NextResponse.json({ ok: true });
  }
  let label = b.label ?? "";
  if (b.tenant_id) {
    const { data: school } = await svc.from("tenants").select("name").eq("id", b.tenant_id).maybeSingle();
    if (!school) return jsonError("That school was not found.", 404);
    label = school.name;
  }
  if (label.length < 2) return jsonError("Say which school the code is for.");
  let made: Awaited<ReturnType<typeof makeSchoolCode>>;
  try { made = await makeSchoolCode(svc, { label, createdBy: gate.userId, leadId: b.lead_id, planCode: b.plan_code, forTenantId: b.tenant_id }); }
  catch (e) { return jsonError((e as Error).message); }
  if (b.lead_id) await svc.from("sales_activities").insert({ lead_id: b.lead_id, kind: "system", body: `School code made (ends …${made.code.slice(-4)}), valid for ${SCHOOL_CODE_TTL_MIN} minutes.`, actor_id: gate.userId });
  if (b.tenant_id) await svc.from("platform_audit_logs").insert({ actor_id: gate.userId, action: "school_code.created", tenant_id: b.tenant_id, meta: { hint: made.code.slice(-4) } });
  // The plain code is returned this once and never stored.
  return NextResponse.json({ ok: true, ...made, label });
}
