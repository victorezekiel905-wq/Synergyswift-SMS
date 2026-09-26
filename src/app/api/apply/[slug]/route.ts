import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { jsonError, readJson } from "@/lib/auth";
import { tenantBySlug, notifyApplicant } from "@/lib/admissions";
import { appUrl } from "@/lib/school";

export const dynamic = "force-dynamic";

/** Public admissions page data. Only schools with admissions open are visible. */
export async function GET(_req: NextRequest, props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  const svc = createServiceClient();
  const t = await tenantBySlug(svc, slug);
  if (!t) return jsonError("Admissions are not open for this school.", 404);
  const { data: classes } = await svc.from("class_groups").select("level").eq("tenant_id", t.tenant.id);
  const levels = [...new Set((classes ?? []).map((c: any) => c.level).filter(Boolean))].sort();
  const s = t.settings;
  return NextResponse.json({ school: { name: s.school_name ?? t.tenant.name, logo_url: s.logo_url, brand_color: s.brand_color, address: s.address, phone: s.phone, email: s.email },
    intro: s.admissions_intro, application_fee: Number(s.application_fee ?? 0), currency: s.currency ?? "NGN", levels });
}

const Body = z.object({
  first_name: z.string().trim().min(1).max(60), last_name: z.string().trim().min(1).max(60), other_names: z.string().trim().max(80).nullish(),
  gender: z.enum(["male", "female", "other"]).nullish(), date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().or(z.literal("")),
  applying_for: z.string().trim().min(1).max(60), previous_school: z.string().trim().max(120).nullish(),
  guardian_name: z.string().trim().min(2).max(120), guardian_phone: z.string().trim().min(7).max(30), guardian_email: z.string().trim().email().nullish().or(z.literal("")),
  guardian_relation: z.string().trim().max(30).default("parent"), address: z.string().trim().max(300).nullish(), notes: z.string().trim().max(1000).nullish(),
  consent: z.literal(true, { errorMap: () => ({ message: "please confirm the information is correct and agree to the privacy notice" }) }),
  website: z.string().max(0).optional() // honeypot: real people leave this empty
});

export async function POST(req: NextRequest, props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  const svc = createServiceClient();
  const t = await tenantBySlug(svc, slug);
  if (!t) return jsonError("Admissions are not open for this school.", 404);
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => i.message).join("; "));
  const b = parsed.data;
  // Simple abuse guard: at most 5 applications from the same phone per day.
  const { count } = await svc.from("applications").select("id", { count: "exact", head: true }).eq("tenant_id", t.tenant.id)
    .eq("guardian_phone", b.guardian_phone).gte("created_at", new Date(Date.now() - 86400_000).toISOString());
  if ((count ?? 0) >= 5) return jsonError("too many applications from this phone number today", 429);
  const { data: no } = await svc.rpc("next_doc_no", { p_tenant: t.tenant.id, p_kind: "app" });
  const { consent: _c, website: _w, ...row } = b;
  const { data: app, error } = await svc.from("applications").insert({ ...row, date_of_birth: row.date_of_birth || null, guardian_email: row.guardian_email || null,
    tenant_id: t.tenant.id, application_no: no, source: "online" }).select("*").single();
  if (error) return jsonError(error.message);
  await notifyApplicant(svc, app, appUrl(req));
  return NextResponse.json({ application_no: app.application_no, tracking_token: app.tracking_token }, { status: 201 });
}
