import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { jsonError, readJson } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Unsubscribe from campaigns and newsletters. Families keep getting essential
 * messages (results, attendance, fees, safety); alumni stop hearing from the school.
 */
async function find(token: string) {
  if (!/^[0-9a-f]{32}$/i.test(token)) return null;
  const svc = createServiceClient();
  const { data: g } = await svc.from("guardians").select("id,tenant_id,full_name,marketing_opt_out").eq("unsubscribe_token", token).maybeSingle();
  if (g) return { svc, kind: "guardian" as const, id: g.id, tenantId: g.tenant_id, name: g.full_name, out: g.marketing_opt_out };
  const { data: a } = await svc.from("alumni").select("id,tenant_id,full_name,consent_contact").eq("unsubscribe_token", token).maybeSingle();
  if (a) return { svc, kind: "alumni" as const, id: a.id, tenantId: a.tenant_id, name: a.full_name, out: !a.consent_contact };
  return null;
}

export async function GET(_req: NextRequest, props: { params: Promise<{ token: string }> }) {
  const r = await find((await props.params).token);
  if (!r) return jsonError("This link is not valid.", 404);
  const { data: s } = await r.svc.from("tenant_settings").select("school_name,brand_color").eq("tenant_id", r.tenantId).maybeSingle();
  return NextResponse.json({ name: r.name, kind: r.kind, unsubscribed: r.out, school: { name: s?.school_name ?? "the school", brand_color: s?.brand_color ?? null } });
}

export async function POST(req: NextRequest, props: { params: Promise<{ token: string }> }) {
  const r = await find((await props.params).token);
  if (!r) return jsonError("This link is not valid.", 404);
  const { subscribe } = await readJson<{ subscribe?: boolean }>(req);
  const out = !subscribe;
  const { error } = r.kind === "guardian"
    ? await r.svc.from("guardians").update({ marketing_opt_out: out }).eq("id", r.id)
    : await r.svc.from("alumni").update({ consent_contact: !out, updated_at: new Date().toISOString() }).eq("id", r.id);
  return error ? jsonError(error.message) : NextResponse.json({ ok: true, unsubscribed: out });
}
