import type { NextRequest } from "next/server";
import type { Ctx } from "@/lib/auth";
import { ALWAYS_ALLOWED_ROLES } from "@/lib/saas";
import { provisionUser } from "@/lib/provision";
import { appUrl } from "@/lib/school";
import { formatCode } from "@/lib/sign-up-codes";
import { inviteByEmail, createOneTimeLogin } from "@/lib/sign-up-codes-server";

export type StaffMethod = "code" | "invite" | "otp";
export type AccessResult =
  | { ok: true; code?: string; invited?: boolean; email?: string | null; link?: string | null; otp?: { username: string; password: string }; rolesOnly?: boolean }
  | { ok: false; error: string; status?: number };

/** Roles outside what Synergy Swift allows this school (its plan). */
export function rolesOutsidePlan(ctx: Ctx, roles: string[]): string[] {
  const ceiling = ctx.tenant.allowed_roles;
  return ceiling ? roles.filter(r => !ALWAYS_ALLOWED_ROLES.includes(r) && !ceiling.includes(r)) : [];
}

/**
 * Give a member of staff their way in, with these roles. Someone with an account gets the
 * roles changed; someone without gets a sign-up code carrying the roles, and then (if chosen)
 * an emailed invitation link or a one-time password. Shared by HR and Staff onboarding.
 */
export async function grantStaffAccess(ctx: Ctx, svc: any, req: NextRequest, p: {
  staff: { id: string; full_name: string; email: string | null; user_id: string | null };
  role: string; extra: string[]; method: StaffMethod; email?: string | null;
}): Promise<AccessResult> {
  const tid = ctx.tenant.id, s = p.staff;
  const extra = p.extra.filter(r => r !== p.role);
  const outside = rolesOutsidePlan(ctx, [p.role, ...extra]);
  if (outside.length) return { ok: false, error: `your school's plan does not include: ${outside.join(", ")}` };
  if (s.user_id) {
    if (s.user_id === ctx.userId) return { ok: false, error: "you cannot change your own roles" };
    const { error } = await ctx.sb.from("users").update({ role: p.role, extra_roles: extra }).eq("tenant_id", tid).eq("id", s.user_id);
    if (error) return { ok: false, error: error.message };
    await ctx.sb.from("audit_logs").insert({ tenant_id: tid, actor_id: ctx.userId, action: "staff.roles_changed", target: s.user_id, meta: { role: p.role, extra } });
    return { ok: true, rolesOnly: true };
  }
  // No account yet: the roles go on their sign-up code, so the account they make has them (9600).
  const { data: code, error: cErr } = await svc.rpc("issue_account_code", { p_kind: "staff", p_id: s.id, p_by: ctx.userId, p_role: p.role, p_extra: extra });
  if (cErr) {
    // Before the database update: the old email invitation.
    try {
      const { userId, actionLink } = await provisionUser(svc, { tenantId: tid, email: String(p.email || s.email || ""), fullName: s.full_name, role: p.role, extraRoles: extra,
        redirectTo: `${appUrl(req)}/auth/welcome?next=/dashboard`, createdBy: ctx.userId });
      await svc.from("staff").update({ user_id: userId }).eq("tenant_id", tid).eq("id", s.id);
      await ctx.sb.from("audit_logs").insert({ tenant_id: tid, actor_id: ctx.userId, action: "staff.login_created", target: userId, meta: { role: p.role, extra } });
      return { ok: true, invited: true, email: p.email || s.email, link: actionLink };
    } catch (e) { return { ok: false, error: (e as Error).message }; }
  }
  await ctx.sb.from("audit_logs").insert({ tenant_id: tid, actor_id: ctx.userId, action: "account.code_role_set", target: s.id, meta: { role: p.role, extra } });
  try {
    if (p.method === "invite") {
      const r = await inviteByEmail(svc, { tenantId: tid, kind: "staff", id: s.id, email: p.email || s.email, actor: ctx.userId, baseUrl: appUrl(req) });
      return { ok: true, invited: true, email: r.email, link: r.link };
    }
    if (p.method === "otp") {
      const r = await createOneTimeLogin(svc, { tenantId: tid, kind: "staff", id: s.id, email: String(p.email || s.email || ""), actor: ctx.userId, baseUrl: appUrl(req) });
      return { ok: true, otp: r };
    }
  } catch (e) { return { ok: false, error: (e as Error).message }; }
  return { ok: true, code: formatCode(code as string) };
}
