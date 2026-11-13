import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { readJson, jsonError } from "@/lib/auth";
import { clientIp } from "@/lib/net";
import { logMail, mailThrottled, mailable } from "@/lib/auth-mail";
import { checkPassword } from "@/lib/security";
import { passwordsMatch } from "@/lib/sign-up-codes";

export const dynamic = "force-dynamic";

const Body = z.object({
  full_name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().max(128),
  password2: z.string().max(128)
});

/**
 * A parent makes their own account: name, email and a password. No code and no one-time
 * password. The account belongs to no school yet and can see nothing; it joins a school
 * when the parent adds a child with that child's code (/api/parent/children).
 */
export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError("Type your full name, your email address and a password.");
  const b = parsed.data;
  if (!mailable(b.email)) return jsonError("Enter a real email address. It is what you sign in with.");
  const mismatch = passwordsMatch(b.password, b.password2);
  if (mismatch) return jsonError(mismatch);
  const problems = checkPassword(b.password, {}, { email: b.email, name: b.full_name });
  if (problems.length) return jsonError(`Please ${problems.join(", ")}.`);

  const svc = createServiceClient();
  const ip = clientIp(req.headers);
  // Counted like sign-up emails, so nobody makes accounts by the hundred.
  if (await mailThrottled(svc, b.email, ip)) return jsonError("Too many attempts. Please wait a few minutes and try again.", 429);
  await logMail(svc, b.email, ip, "confirm");

  const { data: made, error } = await svc.auth.admin.createUser({ email: b.email, password: b.password, email_confirm: true,
    user_metadata: { full_name: b.full_name, signup_as: "parent" } });
  if (error || !made?.user) {
    if (/already|exists|registered/i.test(error?.message ?? "")) return jsonError("This email already has an account. Sign in instead (use Forgot password if you need to).", 409);
    console.error("[parent-signup]", error?.message);
    return jsonError("We couldn't make the account just now. Please try again.", 502);
  }
  return NextResponse.json({ ok: true, email: b.email, next: "/parent" });
}
