import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { beginRequest } from "@/lib/request-actor";
import { readJson, jsonError } from "@/lib/auth";
import { normalizePhone } from "@/lib/crm";

export const dynamic = "force-dynamic";

const COLS = "full_name,graduation_year,last_class,email,phone,occupation,employer,further_study,city,country,linkedin,mentor,consent_contact";

/** The signed-in alumnus. Alumni accounts see no school data, so everything here goes through the server. */
async function me() {
  const store = beginRequest();
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  store.actor = `user:${user.id}`;
  const svc = createServiceClient();
  const { data: u } = await svc.from("users").select("id,tenant_id,role,active,tenants(status,name)").eq("id", user.id).maybeSingle();
  if (!u || u.role !== "alumni" || !u.active || u.tenants?.status !== "active") return null;
  const { data: a } = await svc.from("alumni").select(`id,${COLS}`).eq("tenant_id", u.tenant_id).eq("user_id", user.id).maybeSingle();
  if (!a) return null;
  return { svc, tenantId: u.tenant_id as string, alumnus: a };
}

export async function GET() {
  const m = await me();
  if (!m) return jsonError("This page is for former students with an alumni account.", 403);
  const [{ data: s }, { data: news }] = await Promise.all([
    m.svc.from("tenant_settings").select("school_name,logo_url,brand_color,address,phone,email").eq("tenant_id", m.tenantId).maybeSingle(),
    m.svc.from("crm_campaigns").select("id,subject,body,blocks,sent_at").eq("tenant_id", m.tenantId).eq("status", "sent").eq("audience->>type", "alumni").order("sent_at", { ascending: false }).limit(10)
  ]);
  const { id: _id, ...profile } = m.alumnus;
  return NextResponse.json({ profile, school: s ?? null, news: news ?? [] });
}

const Body = z.object({
  full_name: z.string().trim().min(2).max(160), graduation_year: z.number().int().min(1900).max(2200).nullish(), last_class: z.string().trim().max(60).nullish(),
  email: z.string().trim().email().max(200).nullish().or(z.literal("")), phone: z.string().trim().max(30).nullish(), occupation: z.string().trim().max(120).nullish(),
  employer: z.string().trim().max(120).nullish(), further_study: z.string().trim().max(200).nullish(), city: z.string().trim().max(80).nullish(), country: z.string().trim().max(80).nullish(),
  linkedin: z.string().trim().url().max(300).nullish().or(z.literal("")), mentor: z.boolean(), consent_contact: z.boolean()
});

export async function POST(req: NextRequest) {
  const m = await me();
  if (!m) return jsonError("This page is for former students with an alumni account.", 403);
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => i.message).join("; "));
  const b = parsed.data;
  const { error } = await m.svc.from("alumni").update({ ...b, email: b.email || null, linkedin: b.linkedin || null, phone: b.phone ? normalizePhone(b.phone) : null, updated_at: new Date().toISOString() }).eq("id", m.alumnus.id);
  return error ? jsonError(error.message) : NextResponse.json({ ok: true });
}
