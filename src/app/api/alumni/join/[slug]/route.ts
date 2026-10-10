import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { jsonError, readJson } from "@/lib/auth";
import { tenantForEnquiry } from "@/lib/admissions";
import { normalizePhone } from "@/lib/crm";

export const dynamic = "force-dynamic";

/** Public alumni sign-up. New entries wait for the school to confirm them. */
export async function GET(_req: NextRequest, props: { params: Promise<{ slug: string }> }) {
  const t = await tenantForEnquiry(createServiceClient(), (await props.params).slug);
  if (!t) return jsonError("This page is not available.", 404);
  const s: any = t.settings;
  return NextResponse.json({ school: { name: s.school_name ?? t.tenant.name, logo_url: s.logo_url ?? null, brand_color: s.brand_color ?? null } });
}

const Body = z.object({
  full_name: z.string().trim().min(2).max(160), graduation_year: z.number().int().min(1900).max(new Date().getFullYear() + 1), last_class: z.string().trim().max(60).nullish(),
  email: z.string().trim().email().max(200), phone: z.string().trim().max(30).nullish(), occupation: z.string().trim().max(120).nullish(), employer: z.string().trim().max(120).nullish(),
  further_study: z.string().trim().max(200).nullish(), city: z.string().trim().max(80).nullish(), country: z.string().trim().max(80).nullish(),
  linkedin: z.string().trim().url().max(300).nullish().or(z.literal("")), mentor: z.boolean().default(false),
  consent: z.literal(true, { errorMap: () => ({ message: "please agree to hear from the school" }) }), website: z.string().max(0).optional()   // honeypot
});

export async function POST(req: NextRequest, props: { params: Promise<{ slug: string }> }) {
  const svc = createServiceClient();
  const t = await tenantForEnquiry(svc, (await props.params).slug);
  if (!t) return jsonError("This page is not available.", 404);
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => i.message).join("; "));
  const { consent: _c, website: _w, ...b } = parsed.data;
  const email = b.email.toLowerCase();
  const { data: dup } = await svc.from("alumni").select("id").eq("tenant_id", t.tenant.id).ilike("email", email.replace(/[%_\\]/g, m => "\\" + m)).maybeSingle();
  if (dup) return NextResponse.json({ ok: true, existing: true });
  const { count } = await svc.from("alumni").select("id", { count: "exact", head: true }).eq("tenant_id", t.tenant.id).eq("status", "pending").gte("created_at", new Date(Date.now() - 3600_000).toISOString());
  if ((count ?? 0) >= 50) return jsonError("too many sign-ups right now; please try again later", 429);
  const { error } = await svc.from("alumni").insert({ ...b, email, phone: b.phone ? normalizePhone(b.phone) : null, linkedin: b.linkedin || null,
    tenant_id: t.tenant.id, status: "pending", source: "self", consent_contact: true });
  return error ? jsonError(error.message) : NextResponse.json({ ok: true }, { status: 201 });
}
