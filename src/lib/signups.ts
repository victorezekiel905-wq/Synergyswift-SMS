/**
 * New accounts waiting to be confirmed (migration 8000), for the admins'
 * Sign-ups pages: the platform team sees every one, a school's admins only
 * the accounts joining their school. Confirming here does what clicking the
 * emailed link does, without anyone opening Supabase.
 */
import { authMailConfigured, linkFrom, logMail, sendAuthEmail } from "@/lib/auth-mail";

export type SignupRow = { user_id: string; tenant_id: string | null; email: string; full_name: string; kind: string; detail: string | null;
  created_at: string; last_sent_at: string | null; sent_count: number; confirmed_at: string | null; confirmed_how: string | null };
const COLS = "user_id,tenant_id,email,full_name,kind,detail,created_at,last_sent_at,sent_count,confirmed_at,confirmed_how";

/** Waiting accounts and the latest confirmed ones; tenantId null = every school (platform team). */
export async function listSignups(svc: any, tenantId: string | null) {
  const scope = (q: any) => (tenantId ? q.eq("tenant_id", tenantId) : q);
  const [{ data: waiting, error }, { data: done }] = await Promise.all([
    scope(svc.from("signup_requests").select(`${COLS},tenants(name)`).is("confirmed_at", null)).order("created_at", { ascending: false }).limit(500),
    scope(svc.from("signup_requests").select(`${COLS},tenants(name)`).not("confirmed_at", "is", null)).order("confirmed_at", { ascending: false }).limit(30)
  ]);
  if (error) throw new Error(error.message.includes("signup_requests") ? "Sign-ups need the database update (migration 20260101008000)." : error.message);
  const shape = (r: any) => ({ ...r, school: r.tenants?.name ?? null, tenants: undefined });
  return { email_ready: authMailConfigured(), waiting: (waiting ?? []).map(shape), confirmed: (done ?? []).map(shape) };
}

/** The confirmation link again, from Synergy Swift's email service. */
export async function sendConfirmation(svc: any, base: string, r: Pick<SignupRow, "user_id" | "email" | "full_name" | "sent_count">, ip: string | null = null) {
  if (!authMailConfigured()) return { ok: false as const, error: "No email service is set up yet (EMAIL_PROVIDER, SENDGRID_API_KEY, EMAIL_FROM). Confirm the account instead." };
  // For an account that is not confirmed yet, a sign-in link comes back as a confirmation link.
  const { data: link, error } = await svc.auth.admin.generateLink({ type: "magiclink", email: r.email, options: { redirectTo: `${base}/dashboard` } });
  const url = error ? null : linkFrom(base, link, "signup", "/dashboard");
  if (!url) return { ok: false as const, error: error?.message ?? "could not make the link" };
  const sent = await sendAuthEmail({ kind: "confirm", to: r.email, name: r.full_name, link: url });
  if (!sent.ok) return { ok: false as const, error: sent.error };
  await Promise.all([logMail(svc, r.email, ip, "confirm"),
    svc.from("signup_requests").update({ last_sent_at: new Date().toISOString(), sent_count: (r.sent_count ?? 0) + 1 }).eq("user_id", r.user_id)]);
  return { ok: true as const };
}

export type SignupAction = "confirm" | "resend" | "remove";

/** Confirm, send the link again, or remove a sign-up that is still waiting. */
export async function actOnSignup(svc: any, r: SignupRow, action: SignupAction, by: { userId: string; how: "platform" | "school_admin"; base: string }) {
  if (r.confirmed_at) return { ok: false as const, error: "This account is already confirmed." };
  if (action === "resend") return sendConfirmation(svc, by.base, r);
  if (action === "confirm") {
    const { error } = await svc.auth.admin.updateUserById(r.user_id, { email_confirm: true });
    if (error) return { ok: false as const, error: error.message };
    await svc.from("signup_requests").update({ confirmed_at: new Date().toISOString(), confirmed_by: by.userId, confirmed_how: by.how }).eq("user_id", r.user_id);
    return { ok: true as const };
  }
  // Remove: only an account that never got in (no profile in any school).
  const { data: profile } = await svc.from("users").select("id").eq("id", r.user_id).maybeSingle();
  if (profile) return { ok: false as const, error: "This account is already in use; deactivate it from the school's people pages instead." };
  const { error } = await svc.auth.admin.deleteUser(r.user_id);
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const };
}
