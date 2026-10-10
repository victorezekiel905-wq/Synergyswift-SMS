import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { upsertLead } from "@/lib/admissions-crm";
import { detectSource, SOURCES, type Source } from "@/lib/crm";
import { appUrl } from "@/lib/school";

export const dynamic = "force-dynamic";

/**
 * Lead webhook for outside tools: Facebook / Instagram lead ads (through
 * Zapier, Make or Meta's own integrations), website builders, chat widgets.
 * POST JSON to /api/crm/webhook/<key> (the key is in Admissions → Setup).
 * Accepts flat fields (name, email, phone, child_name, class, source,
 * utm_campaign …) or Meta's field_data list [{ name, values: [...] }].
 */
export async function POST(req: NextRequest, props: { params: Promise<{ key: string }> }) {
  const { key } = await props.params;
  if (!/^[0-9a-f]{24,64}$/i.test(key)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const svc = createServiceClient();
  const { data: s } = await svc.from("tenant_settings").select("tenant_id,tenants(status)").eq("lead_webhook_key", key).maybeSingle();
  if (!s || (s as any).tenants?.status !== "active") return NextResponse.json({ error: "not found" }, { status: 404 });
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "send JSON" }, { status: 400 }); }
  const items: any[] = Array.isArray(body) ? body.slice(0, 50) : [body];
  const results: { ok: boolean; id?: string; error?: string }[] = [];
  for (const item of items) {
    const f = flatten(item);
    const pick = (...keys: string[]) => keys.map(k => f[k]).find(v => v && String(v).trim()) as string | undefined;
    const parent = pick("parent_name", "full_name", "name", "first_name") ?? "";
    const phone = pick("phone", "phone_number", "mobile", "whatsapp");
    const email = pick("email", "email_address");
    if (parent.length < 2 || (!phone && !email)) { results.push({ ok: false, error: "name and a phone number or email are required" }); continue; }
    const utm = Object.fromEntries(["utm_source", "utm_medium", "utm_campaign", "utm_content"].filter(k => f[k]).map(k => [k, String(f[k]).slice(0, 120)]));
    const given = String(pick("source", "platform") ?? "").toLowerCase();
    const source: Source = (SOURCES as readonly string[]).includes(given) ? given as Source : given === "fb" ? "facebook" : given === "ig" ? "instagram" : detectSource(utm, null, pick("ref", "referral_code"));
    try {
      const r = await upsertLead(svc, s.tenant_id, {
        parent_name: parent.slice(0, 120), phone: phone ?? null, email: email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : null,
        child_name: pick("child_name", "child", "student_name")?.slice(0, 120) ?? null, applying_for: pick("class", "applying_for", "grade", "level")?.slice(0, 60) ?? null,
        intake: pick("intake", "start_date")?.slice(0, 60) ?? null, notes: pick("message", "notes", "comments")?.slice(0, 2000) ?? null,
        source, utm, referral_code: pick("ref", "referral_code") ?? null, consent: true
      }, null, appUrl(req));
      results.push({ ok: true, id: r.id });
    } catch (e) { results.push({ ok: false, error: (e as Error).message }); }
  }
  return NextResponse.json(Array.isArray(body) ? { results } : results[0], { status: results.every(r => r.ok) ? 201 : 207 });
}

/** Meta lead-ad payloads list answers as field_data: [{ name, values }]. */
function flatten(o: any): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(o ?? {})) if (typeof v === "string" || typeof v === "number") out[k.toLowerCase()] = String(v);
  for (const fd of Array.isArray(o?.field_data) ? o.field_data : []) if (fd?.name) out[String(fd.name).toLowerCase()] = String(fd.values?.[0] ?? "");
  return out;
}
