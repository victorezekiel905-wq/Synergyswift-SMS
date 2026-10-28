import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { readJson, jsonError } from "@/lib/auth";
import { clientIp } from "@/lib/net";
import { appUrl } from "@/lib/school";
import { authMailConfigured, linkFrom, logMail, mailThrottled, mailable, sendAuthEmail } from "@/lib/auth-mail";
import { sendConfirmation } from "@/lib/signups";

export const dynamic = "force-dynamic";

const Body = z.object({ action: z.enum(["resend", "reset"]), email: z.string().trim().toLowerCase().email().max(254) });
const RESENT = "If this email has an account waiting to be confirmed, a new link is on its way.";
const RESET = "If this email has an account, a link to choose a new password is on its way.";

/**
 * Sign-in emails from Synergy Swift: the confirmation link again ("resend"),
 * or a password reset link ("reset"). Replies never say whether an email is
 * registered.
 */
export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError("Enter your email address.");
  const { action, email } = parsed.data;
  const svc = createServiceClient();
  const ip = clientIp(req.headers);
  const base = appUrl(req);
  if (await mailThrottled(svc, email, ip)) return jsonError("Too many emails asked for. Please wait a few minutes and try again.", 429);

  if (action === "resend") {
    if (!authMailConfigured()) return NextResponse.json({ ok: true, message: "New accounts are confirmed by an administrator. You can sign in once yours is confirmed." });
    const { data: r } = await svc.from("signup_requests").select("user_id,full_name,sent_count").eq("email", email).is("confirmed_at", null).maybeSingle();
    if (!r) return NextResponse.json({ ok: true, message: RESENT });
    const sent = await sendConfirmation(svc, base, { ...r, email }, ip);
    if (!sent.ok) console.error("[auth email] resend:", sent.error);
    return NextResponse.json({ ok: true, message: RESENT });
  }

  // Password reset. Student usernames have no real inbox: their teacher resets them.
  if (!mailable(email)) return NextResponse.json({ ok: true, message: RESET });
  const next = "/account/security?reset=1";
  if (!authMailConfigured()) {
    // No email service of our own yet: Supabase sends it.
    const sb = await createClient();
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: `${base}/auth/callback?next=${encodeURIComponent(next)}` });
    if (error && /rate|limit/i.test(error.message)) return jsonError("Too many emails asked for. Please wait a few minutes and try again.", 429);
    return NextResponse.json({ ok: true, message: RESET });
  }
  const { data: link, error } = await svc.auth.admin.generateLink({ type: "recovery", email, options: { redirectTo: `${base}${next}` } });
  const url = error ? null : linkFrom(base, link, "recovery", next);
  if (url) {
    const sent = await sendAuthEmail({ kind: "reset", to: email, name: link?.user?.user_metadata?.full_name ?? null, link: url });
    if (sent.ok) await logMail(svc, email, ip, "reset");
    else console.error("[auth email] reset:", sent.error);
  }
  return NextResponse.json({ ok: true, message: RESET });
}
