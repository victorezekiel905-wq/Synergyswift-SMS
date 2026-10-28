import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAdmin, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { newSchoolCode, hashSchoolCode, codeStatus, SCHOOL_CODE_TTL_MIN } from "@/lib/school-codes";

export const dynamic = "force-dynamic";

/** One-time school codes: the platform team sees them; only the owner makes or revokes them. */
export async function GET() {
  const gate = await requirePlatformAdmin();
  if (gate instanceof NextResponse) return gate;
  const svc = createServiceClient();
  const { data, error } = await svc.from("school_signup_codes").select("id,hint,label,lead_id,plan_code,created_at,expires_at,used_at,revoked_at,tenant_id,tenants(name),sales_leads(school_name)")
    .order("created_at", { ascending: false }).limit(500);
  if (error) return jsonError(error.message.includes("school_signup_codes") ? "School codes need the database update (migration 20260101007900)." : error.message);
  return NextResponse.json({ owner: gate.role === "owner", codes: (data ?? []).map((c: any) => ({ ...c, status: codeStatus(c), school: c.tenants?.name ?? null, lead: c.sales_leads?.school_name ?? null, tenants: undefined, sales_leads: undefined })) });
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), label: z.string().trim().min(2).max(200), lead_id: z.string().uuid().nullish(), plan_code: z.string().max(40).nullish() }),
  z.object({ action: z.literal("revoke"), id: z.string().uuid() })
]);

export async function POST(req: NextRequest) {
  const gate = await requirePlatformAdmin("owner");
  if (gate instanceof NextResponse) return gate;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const svc = createServiceClient();
  if (b.action === "revoke") {
    const { data, error } = await svc.from("school_signup_codes").update({ revoked_at: new Date().toISOString() }).eq("id", b.id).is("used_at", null).is("revoked_at", null).select("id");
    if (error) return jsonError(error.message);
    if (!data?.length) return jsonError("That code is already used or revoked.");
    return NextResponse.json({ ok: true });
  }
  const code = newSchoolCode();
  const expires = new Date(Date.now() + SCHOOL_CODE_TTL_MIN * 60_000).toISOString();
  const { data, error } = await svc.from("school_signup_codes").insert({ code_hash: hashSchoolCode(code), hint: code.slice(-4), label: b.label, lead_id: b.lead_id ?? null,
    plan_code: b.plan_code ?? null, created_by: gate.userId, expires_at: expires }).select("id").single();
  if (error) return jsonError(error.message);
  if (b.lead_id) await svc.from("sales_activities").insert({ lead_id: b.lead_id, kind: "system", body: `School code made (ends …${code.slice(-4)}), valid for ${SCHOOL_CODE_TTL_MIN} minutes.`, actor_id: gate.userId });
  // The plain code is returned this once and never stored.
  return NextResponse.json({ ok: true, id: data.id, code, expires_at: expires });
}
