import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { tenantForEnquiry } from "@/lib/admissions";
import { localParts } from "@/lib/attendance";

export const dynamic = "force-dynamic";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" };
export async function OPTIONS() { return new NextResponse(null, { status: 204, headers: CORS }); }

/** The school's open jobs, for its careers page (also usable from the school's own website). */
export async function GET(_req: NextRequest, props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  const svc = createServiceClient();
  const t = await tenantForEnquiry(svc, slug);
  if (!t) return NextResponse.json({ error: "This school's careers page is not available." }, { status: 404, headers: CORS });
  const { data: tz } = await svc.from("tenants").select("timezone").eq("id", t.tenant.id).maybeSingle();
  const today = localParts(new Date(), tz?.timezone ?? "Africa/Lagos").date;
  const { data } = await svc.from("job_postings").select("title,department,employment_type,location,salary_range,closes_on,token,published_at")
    .eq("tenant_id", t.tenant.id).eq("status", "open").eq("internal_only", false).or(`closes_on.is.null,closes_on.gte.${today}`).order("published_at", { ascending: false });
  const s: any = t.settings;
  return NextResponse.json({ school: { name: s.school_name ?? t.tenant.name, logo_url: s.logo_url ?? null, brand_color: s.brand_color ?? null, address: s.address ?? null, email: s.email ?? null }, jobs: data ?? [] },
    { headers: CORS });
}
