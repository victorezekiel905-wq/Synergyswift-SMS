/**
 * Creates (or links) a login for a person inside ONE tenant.
 *
 * Uses the service role to generate a Supabase invite/magic link and a
 * public.users profile row. The link is delivered through the school's own
 * outbox (branded email), so the school's name is on it, never the platform's.
 * An account can only ever belong to one tenant.
 */
import { enqueue, loadBrand, dispatchDue } from "./messaging/outbox";
import { escapeHtml } from "./messaging/templates";

export type ProvisionInput = {
  tenantId: string;
  email: string;
  fullName: string;
  role: string;
  extraRoles?: string[];
  redirectTo: string;
  createdBy?: string | null;
  sendEmail?: boolean;
};

export async function provisionUser(svc: any, p: ProvisionInput): Promise<{ userId: string; actionLink: string | null }> {
  const email = p.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("a valid email is required to create a login");

  const { data: profiles } = await svc.from("users").select("id,tenant_id").eq("email", email).limit(1);
  const existingProfile = profiles?.[0] as { id: string; tenant_id: string } | undefined;
  if (existingProfile && existingProfile.tenant_id !== p.tenantId) {
    // Do not reveal which school; just refuse.
    throw new Error("this email is already registered to another account; use a different email");
  }

  let link = await svc.auth.admin.generateLink({ type: "invite", email, options: { redirectTo: p.redirectTo, data: { full_name: p.fullName } } });
  if (link.error) {
    // Already registered in auth → send a sign-in (magic) link instead.
    link = await svc.auth.admin.generateLink({ type: "magiclink", email, options: { redirectTo: p.redirectTo } });
    if (link.error) throw new Error(link.error.message);
  }
  const user = link.data?.user;
  if (!user?.id) throw new Error("could not create the login");
  const actionLink: string | null = link.data?.properties?.action_link ?? null;

  if (existingProfile) {
    const { error } = await svc.from("users").update({ full_name: p.fullName, role: p.role, extra_roles: p.extraRoles ?? [], active: true }).eq("id", user.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await svc.from("users").insert({
      id: user.id, tenant_id: p.tenantId, email, full_name: p.fullName, role: p.role, extra_roles: p.extraRoles ?? []
    });
    if (error) throw new Error(error.message);
  }

  if (p.sendEmail !== false && actionLink) {
    const brand = await loadBrand(svc, p.tenantId);
    await enqueue(svc, [{
      tenant_id: p.tenantId, channel: "email", to_address: email, to_name: p.fullName, kind: "invite",
      subject: `Your ${brand.schoolName} account`,
      body_text: `Hello ${p.fullName},\n\nAn account has been created for you at ${brand.schoolName}. Set it up here:\n${actionLink}\n\nThe link expires in 24 hours.`,
      body_html: `<p>Hello ${escapeHtml(p.fullName)},</p><p>An account has been created for you at <b>${escapeHtml(brand.schoolName)}</b>.</p><p><a href="${escapeHtml(actionLink)}">Set up your account</a> (expires in 24 hours).</p>`,
      created_by: p.createdBy ?? null
    }]);
    await dispatchDue(svc, { budgetMs: 8000 }).catch(() => null);
  }
  return { userId: user.id, actionLink };
}
