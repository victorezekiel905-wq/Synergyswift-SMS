import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { jsonError } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Applicant's private tracking link: status and next step only. */
export async function GET(_req: NextRequest, props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  if (!/^[0-9a-f]{24,64}$/i.test(token)) return jsonError("not found", 404);
  const svc = createServiceClient();
  const { data: a } = await svc.from("applications")
    .select("application_no,status,first_name,last_name,applying_for,assessment_at,interview_at,offer_expires_on,decision_note,fee_paid,created_at,tenant_id,tenants(name,status)")
    .eq("tracking_token", token).maybeSingle();
  if (!a || a.tenants?.status !== "active") return jsonError("not found", 404);
  const { data: s } = await svc.from("tenant_settings").select("school_name,logo_url,brand_color,phone,email,application_fee,currency").eq("tenant_id", a.tenant_id).maybeSingle();
  const { tenant_id: _t, tenants: _x, ...rest } = a;
  return NextResponse.json({ application: rest, school: { name: s?.school_name ?? a.tenants?.name, logo_url: s?.logo_url, brand_color: s?.brand_color, phone: s?.phone, email: s?.email },
    application_fee: Number(s?.application_fee ?? 0), currency: s?.currency ?? "NGN" }, { headers: { "Cache-Control": "no-store" } });
}
