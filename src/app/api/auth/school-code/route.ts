import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { readJson, jsonError } from "@/lib/auth";
import { clientIp } from "@/lib/net";
import { hashSchoolCode, isSchoolCodeShape } from "@/lib/school-codes";
import { logMail } from "@/lib/auth-mail";

export const dynamic = "force-dynamic";

const WRONG = "That code isn't right, has been used, or has expired. Codes work once, for 20 minutes. Ask Synergy Swift for a new one.";

/**
 * The first step of onboarding a school: is this one-time code still good?
 * It is only checked here; it is used up when the account is made.
 * Wrong guesses are counted per network.
 */
export async function POST(req: NextRequest) {
  const b = await readJson<{ code?: string }>(req);
  const code = String(b.code ?? "").trim();
  const svc = createServiceClient();
  const ip = clientIp(req.headers);
  if (ip) {
    const since = new Date(Date.now() - 15 * 60_000).toISOString();
    const { count } = await svc.from("auth_mail_log").select("id", { count: "exact", head: true }).eq("ip", ip).eq("kind", "code_miss").gte("at", since);
    if ((count ?? 0) >= 10) return jsonError("Too many wrong codes. Please wait 15 minutes and try again.", 429);
  }
  const open = (cols: string): PromiseLike<{ data: unknown; error: { message: string } | null }> => svc.from("school_signup_codes").select(cols).eq("code_hash", hashSchoolCode(code)).is("used_at", null).is("revoked_at", null).gt("expires_at", new Date().toISOString()).maybeSingle();
  type OpenCode = { label: string; expires_at: string; for_tenant_id?: string | null };
  let row: OpenCode | null = null;
  if (isSchoolCodeShape(code)) {
    const r = await open("label,expires_at,for_tenant_id");
    // Before migration 8900 there is no for_tenant_id: every code makes a new school.
    row = (r.error ? (await open("label,expires_at")).data : r.data) as OpenCode | null;
  }
  if (!row) { await logMail(svc, "-", ip, "code_miss"); return jsonError(WRONG, 404); }
  // fixed: the code is for a school already set up, so its name is not asked for.
  return NextResponse.json({ ok: true, school: row.label, expires_at: row.expires_at, fixed: Boolean(row.for_tenant_id) });
}
