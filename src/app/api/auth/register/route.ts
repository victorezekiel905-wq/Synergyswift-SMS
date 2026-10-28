import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { readJson, jsonError } from "@/lib/auth";
import { clientIp } from "@/lib/net";
import { appUrl } from "@/lib/school";
import { hashSchoolCode, isSchoolCodeShape } from "@/lib/school-codes";
import { authMailConfigured, linkFrom, logMail, mailThrottled, mailable, sendAuthEmail } from "@/lib/auth-mail";

export const dynamic = "force-dynamic";

const Common = { email: z.string().trim().toLowerCase().email().max(254), password: z.string().min(8).max(72), full_name: z.string().trim().min(1).max(120),
  terms_accepted_at: z.string().max(40).nullish() };
const Body = z.discriminatedUnion("as", [
  // Setting up a new school, with a one-time school code.
  z.object({ as: z.literal("school"), ...Common, school_name: z.string().trim().min(2).max(120), school_code: z.string().trim().min(1).max(30) }),
  // A student with a class code (the classic sign-up page).
  z.object({ as: z.literal("student"), ...Common, join_code: z.string().trim().min(4).max(12) })
]);
export type RegisterResult = { ok: true; status: "sent" | "waiting" | "confirmed"; email: string };

/**
 * Creates an account and emails the confirmation link from Synergy Swift
 * (SendGrid or Resend), not from Supabase. Until it is confirmed, by the
 * person or by an admin on the Sign-ups page, the account cannot sign in.
 * Without an email service it waits for an admin.
 */
export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) {
    const pw = parsed.error.issues.some(i => i.path[0] === "password");
    return jsonError(pw ? "Use a password of at least 8 characters." : "Check the form: " + parsed.error.issues.map(i => i.path.join(".")).join(", "));
  }
  const b = parsed.data;
  if (!mailable(b.email)) return jsonError("Enter a real email address.");
  const svc = createServiceClient();
  const ip = clientIp(req.headers);
  if (await mailThrottled(svc, b.email, ip)) return jsonError("Too many attempts. Please wait a few minutes and try again.", 429);

  // Check the code first, so nobody makes an account that can never be used.
  let tenantId: string | null = null;
  let meta: Record<string, unknown>;
  const next = "/dashboard";
  if (b.as === "school") {
    const hash = isSchoolCodeShape(b.school_code) ? hashSchoolCode(b.school_code) : null;
    const { data: open } = hash ? await svc.from("school_signup_codes").select("id").eq("code_hash", hash).is("used_at", null).is("revoked_at", null).gt("expires_at", new Date().toISOString()).maybeSingle() : { data: null };
    if (!open) { await logMail(svc, b.email, ip, "code_miss"); return jsonError("That school code isn't right, has been used, or has expired. Ask Synergy Swift for a new one.", 403); }
    meta = { full_name: b.full_name, signup_as: "school", school_name: b.school_name, school_code: b.school_code };
  } else {
    const code = b.join_code.toUpperCase();
    const { data: cls } = await svc.rpc("class_lookup_by_code", { p_code: code });
    const t = (cls?.[0] as { tenant_id: string } | undefined)?.tenant_id;
    const { data: school } = t ? await svc.from("tenants").select("status").eq("id", t).maybeSingle() : { data: null };
    if (!t || school?.status !== "active") { await logMail(svc, b.email, ip, "code_miss"); return jsonError("No class has that code. Check it with your teacher.", 404); }
    tenantId = t;
    meta = { full_name: b.full_name, signup_as: "student", join_code: code };
  }
  if (b.terms_accepted_at) meta.terms_accepted_at = b.terms_accepted_at;

  const base = appUrl(req);
  const { data: link, error } = await svc.auth.admin.generateLink({ type: "signup", email: b.email, password: b.password, options: { data: meta, redirectTo: `${base}${next}` } });
  if (error || !link?.user) {
    if (/already|exists|registered/i.test(error?.message ?? "")) return jsonError("An account with this email already exists. Sign in instead (use Forgot password if needed).", 409);
    console.error("[register]", error?.message);
    return jsonError("We couldn't create the account just now. Please try again.", 502);
  }
  const user = link.user;
  await svc.from("signup_requests").upsert({ user_id: user.id, tenant_id: tenantId, email: b.email, full_name: b.full_name, kind: b.as, detail: b.as === "school" ? b.school_name : null, ip }, { onConflict: "user_id" });
  const done = (status: RegisterResult["status"]) => NextResponse.json({ ok: true, status, email: b.email } satisfies RegisterResult);

  // The project confirms accounts by itself: nothing to send.
  if (user.email_confirmed_at) {
    await svc.from("signup_requests").update({ confirmed_at: new Date().toISOString(), confirmed_how: "email" }).eq("user_id", user.id);
    return done("confirmed");
  }
  const url = linkFrom(base, link, "signup", next);
  if (!authMailConfigured() || !url) return done("waiting");
  const sent = await sendAuthEmail({ kind: "confirm", to: b.email, name: b.full_name, link: url });
  if (!sent.ok) { console.error("[register] email:", sent.error); return done("waiting"); }
  await Promise.all([logMail(svc, b.email, ip, "confirm"),
    svc.from("signup_requests").update({ last_sent_at: new Date().toISOString(), sent_count: 1 }).eq("user_id", user.id)]);
  return done("sent");
}
