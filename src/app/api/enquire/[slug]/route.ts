import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { readJson } from "@/lib/auth";
import { tenantForEnquiry } from "@/lib/admissions";
import { upsertLead } from "@/lib/admissions-crm";
import { detectSource } from "@/lib/crm";
import { appUrl } from "@/lib/school";

export const dynamic = "force-dynamic";

// Schools may post to this form from their own website, so it answers cross-origin requests.
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
export async function OPTIONS() { return new NextResponse(null, { status: 204, headers: CORS }); }

export async function GET(_req: NextRequest, props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  const svc = createServiceClient();
  const t = await tenantForEnquiry(svc, slug);
  if (!t) return NextResponse.json({ error: "This school's enquiry page is not available." }, { status: 404, headers: CORS });
  const { data: classes } = await svc.from("class_groups").select("level").eq("tenant_id", t.tenant.id);
  const s: any = t.settings;
  return NextResponse.json({
    school: { name: s.school_name ?? t.tenant.name, logo_url: s.logo_url ?? null, brand_color: s.brand_color ?? null, phone: s.phone ?? null, email: s.email ?? null, address: s.address ?? null },
    levels: [...new Set((classes ?? []).map((c: any) => c.level).filter(Boolean))].sort(), applications_open: Boolean(s.admissions_open),
    whatsapp: s.admissions_whatsapp ? String(s.admissions_whatsapp).replace(/[^\d]/g, "") : null
  }, { headers: CORS });
}

const Body = z.object({
  parent_name: z.string().trim().min(2).max(120), phone: z.string().trim().min(7).max(30), email: z.string().trim().email().nullish().or(z.literal("")),
  child_name: z.string().trim().max(120).nullish(), child_dob: z.string().date().nullish().or(z.literal("")), applying_for: z.string().trim().max(60).nullish(),
  intake: z.string().trim().max(60).nullish(), message: z.string().trim().max(2000).nullish(), how_heard: z.string().trim().max(40).nullish(),
  utm: z.record(z.string().max(120)).default({}), referrer: z.string().max(500).nullish(), ref: z.string().trim().max(20).nullish(),
  consent: z.literal(true, { errorMap: () => ({ message: "please agree to be contacted about admission" }) }),
  website: z.string().max(0).optional() // honeypot
});

const HEARD: Record<string, string> = { facebook: "facebook", instagram: "instagram", whatsapp: "whatsapp", friend: "referral", referral: "referral", walk: "walk_in", radio: "other", other: "other" };

export async function POST(req: NextRequest, props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  const svc = createServiceClient();
  const t = await tenantForEnquiry(svc, slug);
  if (!t) return NextResponse.json({ error: "This school's enquiry page is not available." }, { status: 404, headers: CORS });
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues.map(i => i.message).join("; ") }, { status: 400, headers: CORS });
  const b = parsed.data;
  // Abuse guard: at most 5 enquiries from one phone number a day.
  const { count } = await svc.from("admission_leads").select("id", { count: "exact", head: true }).eq("tenant_id", t.tenant.id).eq("phone", b.phone).gte("created_at", new Date(Date.now() - 86_400_000).toISOString());
  if ((count ?? 0) >= 5) return NextResponse.json({ error: "too many enquiries from this number today" }, { status: 429, headers: CORS });
  const utm = Object.fromEntries(Object.entries(b.utm).filter(([k]) => /^utm_(source|medium|campaign|content|term)$/.test(k)));
  let source = detectSource(utm, b.referrer, b.ref);
  if (source === "website" && b.how_heard && HEARD[b.how_heard]) source = HEARD[b.how_heard] as typeof source;
  try {
    const r = await upsertLead(svc, t.tenant.id, {
      parent_name: b.parent_name, phone: b.phone, email: b.email || null, child_name: b.child_name ?? null, child_dob: b.child_dob || null,
      applying_for: b.applying_for ?? null, intake: b.intake ?? null, source, utm, referral_code: b.ref ?? null, notes: b.message ?? null, consent: true
    }, null, appUrl(req));
    return NextResponse.json({ ok: true, merged: r.merged }, { status: 201, headers: CORS });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400, headers: CORS });
  }
}

