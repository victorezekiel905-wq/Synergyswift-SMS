/**
 * Sign-in emails sent by the app itself (SendGrid or Resend, whichever
 * EMAIL_PROVIDER names), not by Supabase: confirming a new account, resetting
 * a password, and invitations to the platform team (migration 8000).
 *
 * Links point at /auth/confirm on this site, which asks the person to press a
 * button before the one-time token is spent: mail scanners that open every
 * link would otherwise use it up before the person does.
 */
import { sendEmail, emailConfigured, type SendResult } from "@/lib/messaging/providers";
import { escapeHtml } from "@/lib/richtext";
import { isUsernameEmail } from "@/lib/login-name";

export type AuthMailKind = "confirm" | "reset" | "invite";
type LogKind = AuthMailKind | "code_miss";
export type OtpType = "signup" | "recovery" | "invite" | "magiclink" | "email_change";
export const OTP_TYPES: OtpType[] = ["signup", "recovery", "invite", "magiclink", "email_change"];

export const authMailConfigured = emailConfigured;

/** Emails a person can actually receive (student username logins have made-up addresses). */
export const mailable = (email: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) && !isUsernameEmail(email);

export function safeNext(value: string | null | undefined, fallback = "/dashboard"): string {
  return value && value.startsWith("/") && !value.startsWith("//") && !value.includes("\\") ? value : fallback;
}

/** The link in the email: our confirm page, carrying the hashed token Supabase made. */
export function confirmLink(base: string, tokenHash: string, type: OtpType, next: string): string {
  const q = new URLSearchParams({ token_hash: tokenHash, type, next: safeNext(next) });
  return `${base.replace(/\/+$/, "")}/auth/confirm?${q}`;
}

/** What generateLink gave back, as a link to our confirm page (null when it gave no token). */
export function linkFrom(base: string, data: any, asked: OtpType, next: string): string | null {
  const p = data?.properties;
  if (!p?.hashed_token) return null;
  // For an account that is not confirmed yet, Supabase turns a sign-in link into a confirmation one.
  const type = (OTP_TYPES as string[]).includes(p.verification_type) ? (p.verification_type as OtpType) : asked;
  return confirmLink(base, p.hashed_token, type, next);
}

const COPY: Record<AuthMailKind, { subject: (s: string) => string; lead: (s: string) => string; button: string; after: string }> = {
  confirm: {
    subject: s => `Confirm your email for ${s}`,
    lead: s => `Thanks for signing up to ${s}. Confirm this is your email address to finish setting up your account.`,
    button: "Confirm my email", after: "The link works once and expires in 24 hours. If you did not sign up, ignore this email."
  },
  reset: {
    subject: s => `Reset your ${s} password`,
    lead: () => "Someone asked to reset the password for this account. If it was you, choose a new password here.",
    button: "Choose a new password", after: "The link works once and expires in 1 hour. If you did not ask, ignore this email: your password stays the same."
  },
  invite: {
    subject: s => `You're invited to ${s}`,
    lead: s => `You have been given an account on ${s}. Set it up here.`,
    button: "Set up my account", after: "The link works once and expires in 24 hours."
  }
};

export async function sendAuthEmail(m: { kind: AuthMailKind; to: string; name?: string | null; link: string; brand?: string }): Promise<SendResult> {
  const brand = m.brand?.trim() || "Synergy Swift";
  const c = COPY[m.kind];
  const hello = m.name?.trim() ? `Hello ${m.name.trim()},` : "Hello,";
  const text = `${hello}\n\n${c.lead(brand)}\n\n${c.button}: ${m.link}\n\n${c.after}\n\n${brand}`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1e293b;max-width:520px">
<p>${escapeHtml(hello)}</p><p>${escapeHtml(c.lead(brand))}</p>
<p style="margin:24px 0"><a href="${escapeHtml(m.link)}" style="background:#1e3a5f;color:#ffffff;padding:11px 20px;border-radius:6px;text-decoration:none;font-weight:600">${escapeHtml(c.button)}</a></p>
<p style="font-size:13px;color:#64748b">If the button does not work, copy this link into your browser:<br><span style="word-break:break-all">${escapeHtml(m.link)}</span></p>
<p style="font-size:13px;color:#64748b">${escapeHtml(c.after)}</p></div>`;
  return sendEmail({ to: m.to, toName: m.name ?? null, subject: c.subject(brand), text, html, fromName: brand, noTracking: true });
}

/** Too many sign-in emails lately to this address or from this network? */
export async function mailThrottled(svc: any, email: string, ip: string | null): Promise<boolean> {
  const since = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
  const [{ count: perEmail }, { count: perIp }] = await Promise.all([
    svc.from("auth_mail_log").select("id", { count: "exact", head: true }).eq("email", email).gte("at", since(15)),
    ip ? svc.from("auth_mail_log").select("id", { count: "exact", head: true }).eq("ip", ip).gte("at", since(60)) : { count: 0 }
  ]);
  return (perEmail ?? 0) >= 3 || (perIp ?? 0) >= 20;
}
export const logMail = (svc: any, email: string, ip: string | null, kind: LogKind) =>
  svc.from("auth_mail_log").insert({ email, ip, kind }).then(() => undefined, () => undefined);
