import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { appUrl } from "@/lib/school";
import { OTP_TYPES, safeNext, type OtpType } from "@/lib/auth-mail";

export const dynamic = "force-dynamic";

/** The button on /auth/confirm: spends the one-time token, opens the session and sends the person on. */
export async function POST(req: NextRequest) {
  const base = appUrl(req);
  const go = (path: string) => NextResponse.redirect(new URL(path, base), 303);
  const f = await req.formData().catch(() => null);
  const tokenHash = String(f?.get("token_hash") ?? "");
  const type = String(f?.get("type") ?? "") as OtpType;
  const next = safeNext(String(f?.get("next") ?? ""));
  if (!tokenHash || !OTP_TYPES.includes(type)) return go("/login?error=" + encodeURIComponent("That link is not complete. Ask for a new one."));

  const sb = await createClient();
  const { data, error } = await sb.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error || !data.user) return go("/login?error=" + encodeURIComponent("That link has expired or was already used. Sign in, or ask for a new link."));

  if (data.user.email_confirmed_at) {
    await createServiceClient().from("signup_requests").update({ confirmed_at: new Date().toISOString(), confirmed_how: "email" })
      .eq("user_id", data.user.id).is("confirmed_at", null);
  }
  if (type === "recovery") return go(next);
  // Invited people choose their password first.
  if (type === "invite") return go(`/auth/welcome?next=${encodeURIComponent(next)}`);
  // The sign-in page finishes setting up (school, approval, second factor).
  return go(`/login?finish=1&next=${encodeURIComponent(next)}`);
}
