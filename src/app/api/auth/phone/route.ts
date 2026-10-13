import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { readJson, jsonError } from "@/lib/auth";
import { clientIp } from "@/lib/net";
import { sendSms, smsConfigured, normalizePhone } from "@/lib/messaging/providers";
import { accountsForPhone, newCode, codeHash, sameHash, CODE_TTL_MIN, MAX_ATTEMPTS } from "@/lib/phone-login";

export const dynamic = "force-dynamic";

const SENT = "If this number belongs to an account, a code is on its way by SMS.";

/** Is phone sign-in available on this deployment? */
export async function GET() {
  return NextResponse.json({ available: smsConfigured() });
}

/**
 * { action: "send", phone } texts a code; { action: "verify", phone, code }
 * signs in. Replies never reveal whether a number is registered.
 */
export async function POST(req: NextRequest) {
  if (!smsConfigured()) return jsonError("Phone sign-in is not available. Please use your email.", 503);
  const b = await readJson<{ action?: string; phone?: string; code?: string }>(req);
  const phone = normalizePhone(String(b.phone ?? ""));
  if (!phone) return jsonError("enter a valid phone number");
  const svc = createServiceClient();
  const ip = clientIp(req.headers);
  const since = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

  if (b.action === "send") {
    const [{ count: perPhone }, { count: perIp }] = await Promise.all([
      svc.from("phone_login_codes").select("id", { count: "exact", head: true }).eq("phone", phone).gte("created_at", since(15)),
      ip ? svc.from("phone_login_codes").select("id", { count: "exact", head: true }).eq("ip", ip).gte("created_at", since(60)) : { count: 0 }
    ]);
    if ((perPhone ?? 0) >= 3 || (perIp ?? 0) >= 10) return jsonError("Too many codes requested. Please wait a few minutes.", 429);
    const ids = await accountsForPhone(svc, phone);
    // One number, one account: shared numbers must use email so the right person signs in.
    if (ids.length !== 1) return NextResponse.json({ ok: true, message: SENT });
    const code = newCode();
    await svc.from("phone_login_codes").insert({ user_id: ids[0], phone, code_hash: codeHash(ids[0], phone, code), ip, expires_at: new Date(Date.now() + CODE_TTL_MIN * 60_000).toISOString() });
    await sendSms({ to: phone, text: `Your sign-in code is ${code}. It expires in ${CODE_TTL_MIN} minutes. Never share it.` });
    return NextResponse.json({ ok: true, message: SENT });
  }

  if (b.action === "verify") {
    const code = String(b.code ?? "").replace(/\D/g, "");
    if (code.length !== 6) return jsonError("enter the 6-digit code");
    const { data: row } = await svc.from("phone_login_codes").select("id,user_id,code_hash,attempts,expires_at,used_at").eq("phone", phone)
      .is("used_at", null).gte("expires_at", new Date().toISOString()).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!row || row.attempts >= MAX_ATTEMPTS) return jsonError("That code has expired. Ask for a new one.", 400);
    if (!sameHash(row.code_hash, codeHash(row.user_id, phone, code))) {
      await svc.from("phone_login_codes").update({ attempts: row.attempts + 1 }).eq("id", row.id);
      return jsonError(row.attempts + 1 >= MAX_ATTEMPTS ? "Too many wrong codes. Ask for a new one." : "That code is not right.", 400);
    }
    const { data: used } = await svc.from("phone_login_codes").update({ used_at: new Date().toISOString() }).eq("id", row.id).is("used_at", null).select("id");
    if (!used?.length) return jsonError("That code has already been used.", 400);
    // Open a session for the account: a one-time sign-in link, redeemed here on the server.
    const { data: u } = await svc.auth.admin.getUserById(row.user_id);
    const email = u?.user?.email;
    if (!email) return jsonError("This account has no email address; please ask the school to add one.", 400);
    const { data: link, error } = await svc.auth.admin.generateLink({ type: "magiclink", email });
    if (error || !link?.properties?.hashed_token) return jsonError(error?.message ?? "could not sign in", 500);
    const sb = await createClient();
    const { error: vErr } = await sb.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
    if (vErr) return jsonError(vErr.message, 400);
    return NextResponse.json({ ok: true });
  }
  return jsonError("unknown action");
}
