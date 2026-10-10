import { NextRequest, NextResponse } from "next/server";
import { requireCtx, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { appUrl } from "@/lib/school";

/** A parent's own referral link and how many families it has brought in. */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(["parent"]);
  if (ctx instanceof NextResponse) return ctx;
  const svc = createServiceClient();
  const [{ data: g }, { data: t }] = await Promise.all([
    svc.from("guardians").select("id,referral_code").eq("tenant_id", ctx.tenant.id).eq("user_id", ctx.userId).maybeSingle(),
    svc.from("tenants").select("public_slug").eq("id", ctx.tenant.id).maybeSingle()
  ]);
  if (!g) return jsonError("your login is not linked to a parent record", 404);
  if (!t?.public_slug) return NextResponse.json({ link: null });
  const { data: leads } = await svc.from("admission_leads").select("stage").eq("tenant_id", ctx.tenant.id).eq("referred_by", g.id);
  const base = appUrl(req);
  return NextResponse.json({
    code: g.referral_code, link: `${base}/enquire/${t.public_slug}?ref=${g.referral_code}`,
    referred: (leads ?? []).length, enrolled: (leads ?? []).filter((l: any) => l.stage === "enrolled").length
  });
}
