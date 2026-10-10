import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { jsonError, readJson } from "@/lib/auth";
import { normalizePhone } from "@/lib/crm";

export const dynamic = "force-dynamic";

const COLS = "full_name,graduation_year,last_class,email,phone,occupation,employer,further_study,city,country,linkedin,mentor,consent_contact";

async function find(token: string) {
  if (!/^[0-9a-f]{32}$/i.test(token)) return null;
  const svc = createServiceClient();
  const { data } = await svc.from("alumni").select(`id,tenant_id,status,${COLS},tenants(status)`).eq("update_token", token).maybeSingle();
  if (!data || data.tenants?.status !== "active" || data.status === "archived") return null;
  return { svc, a: data };
}

/** An alumnus keeps their own details up to date from a private link. */
export async function GET(_req: NextRequest, props: { params: Promise<{ token: string }> }) {
  const r = await find((await props.params).token);
  if (!r) return jsonError("This link is not valid.", 404);
  const { data: s } = await r.svc.from("tenant_settings").select("school_name,logo_url,brand_color").eq("tenant_id", r.a.tenant_id).maybeSingle();
  const { id: _i, tenant_id: _t, tenants: _x, status: _s, ...profile } = r.a;
  return NextResponse.json({ profile, school: { name: s?.school_name ?? "School", logo_url: s?.logo_url ?? null, brand_color: s?.brand_color ?? null } });
}

const Body = z.object({
  full_name: z.string().trim().min(2).max(160), graduation_year: z.number().int().min(1900).max(2200).nullish(), last_class: z.string().trim().max(60).nullish(),
  email: z.string().trim().email().max(200).nullish().or(z.literal("")), phone: z.string().trim().max(30).nullish(), occupation: z.string().trim().max(120).nullish(),
  employer: z.string().trim().max(120).nullish(), further_study: z.string().trim().max(200).nullish(), city: z.string().trim().max(80).nullish(), country: z.string().trim().max(80).nullish(),
  linkedin: z.string().trim().url().max(300).nullish().or(z.literal("")), mentor: z.boolean(), consent_contact: z.boolean()
});

export async function POST(req: NextRequest, props: { params: Promise<{ token: string }> }) {
  const r = await find((await props.params).token);
  if (!r) return jsonError("This link is not valid.", 404);
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => i.message).join("; "));
  const b = parsed.data;
  const { error } = await r.svc.from("alumni").update({ ...b, email: b.email || null, linkedin: b.linkedin || null, phone: b.phone ? normalizePhone(b.phone) : null, updated_at: new Date().toISOString() }).eq("id", r.a.id);
  return error ? jsonError(error.message) : NextResponse.json({ ok: true });
}
