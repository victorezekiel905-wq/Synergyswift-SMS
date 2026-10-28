import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { beginRequest } from "@/lib/request-actor";
import { checkAccess } from "@/lib/access";
import { effectiveRoles, permitted, moduleBlockedForUser, platformAtLeast, type CustomRole, type Permission, type PlatformRole, type ModuleKey } from "@/lib/saas";
export type { ModuleKey } from "@/lib/saas";

export type Profile = {
  id: string;
  tenant_id: string;
  email: string;
  full_name: string;
  role: string;
  extra_roles: string[];
  custom_role_id?: string | null;
};

export type Tenant = { id: string; name: string; status: string; modules: Record<string, boolean>; timezone: string; allowed_roles?: string[] | null };

export type Ctx = {
  sb: any;
  userId: string;
  profile: Profile;
  tenant: Tenant;
  roles: Set<string>;
  /** The school's own custom role for this user, if any (extra roles, modules and actions taken away). */
  customRole: CustomRole | null;
};

/** Role groups used across the school-operations modules. */
export const ROLES = {
  admin: ["school_admin", "principal", "platform_admin"],
  staff: ["teacher", "school_admin", "it_admin", "platform_admin", "principal", "bursar",
          "librarian", "hr_manager", "qa_officer", "gate_officer", "transport_officer",
          "hostel_warden", "nurse", "admissions_officer", "cashier", "counsellor", "exam_officer"],
  sims: ["school_admin", "principal", "platform_admin", "it_admin"],
  gate: ["gate_officer", "school_admin", "principal", "platform_admin"],
  library: ["librarian", "school_admin", "principal", "platform_admin"],
  approver: ["school_admin", "principal", "bursar", "platform_admin"],
  hr: ["hr_manager", "school_admin", "principal", "platform_admin"],
  qa: ["qa_officer", "school_admin", "principal", "platform_admin"],
  messaging: ["school_admin", "principal", "it_admin", "platform_admin"],
  finance: ["bursar", "school_admin", "principal", "platform_admin"],
  payroll: ["hr_manager", "bursar", "school_admin", "principal", "platform_admin"],
  transport: ["transport_officer", "school_admin", "principal", "platform_admin"],
  hostel: ["hostel_warden", "school_admin", "principal", "platform_admin"],
  health: ["nurse", "hostel_warden", "school_admin", "principal", "platform_admin"],
  admissions: ["admissions_officer", "school_admin", "principal", "platform_admin"],
  reviewer: ["school_admin", "principal", "qa_officer", "platform_admin"],
  till: ["cashier", "bursar", "school_admin", "principal", "platform_admin"],
  cover: ["school_admin", "principal", "platform_admin"],
  /** The exams office: runs the planner, the hall board and exam requests (phase 14j). */
  examOffice: ["exam_officer", "school_admin", "principal", "platform_admin"]
} as const;

/** Every assignable staff role, in the order shown in HR. */
export const STAFF_ROLE_OPTIONS = ["teacher", "school_admin", "principal", "it_admin", "bursar", "librarian",
  "hr_manager", "qa_officer", "gate_officer", "transport_officer", "hostel_warden", "nurse", "admissions_officer", "cashier", "counsellor", "exam_officer"] as const;

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

// Why a signed-in account cannot use the school right now (from my_account_state()).
const STATE_ERRORS: Record<string, { error: string; status: number }> = {
  password_expired: { error: "Your password has expired. Choose a new one under Account security.", status: 403 },
  sso_required: { error: "Your school requires you to sign in with your school Google or Microsoft account.", status: 403 },
  session_expired: { error: "Your session has ended. Please sign in again.", status: 401 },
  access_restricted: { error: "Staff pages are restricted to the school's network or approved devices.", status: 403 },
  mfa_required: { error: "Your school requires two-factor sign-in. Set it up under Account security.", status: 403 },
  deactivated: { error: "Your account has been deactivated. Please contact your school.", status: 403 },
  alumni: { error: "Alumni accounts use the alumni page.", status: 403 },
  paused: { error: "this school is closed for now", status: 403 },
  suspended: { error: "this school account is suspended", status: 403 },
  no_profile: { error: "unauthenticated", status: 401 }
};

export type CtxError = { error: string; status: number; code?: string };

/**
 * Loads the signed-in user's profile and tenant, after the school's network
 * and device rules. Names the user as the actor for the change history.
 */
export async function resolveCtx(): Promise<Ctx | CtxError> {
  const store = beginRequest();
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { error: "unauthenticated", status: 401 };
  store.actor = `user:${user.id}`;
  // Synergy Swift support access (phase 14k) works only until its session ends.
  const supportUntil = (user.app_metadata as { support_until?: string } | undefined)?.support_until;
  if (supportUntil && Date.parse(supportUntil) <= Date.now()) return { error: "This support session has ended.", status: 403, code: "support_ended" };
  const { data: { session } } = await sb.auth.getSession();
  const access = await checkAccess(user.id, session?.access_token ?? null);
  if (!access.ok) return { error: access.message, status: 403, code: "access_restricted" };
  const { data: profile } = await sb.from("users")
    .select("id,tenant_id,email,full_name,role,extra_roles,custom_role_id").eq("id", user.id).maybeSingle();
  if (!profile) {
    const { data: st } = await sb.rpc("my_account_state");
    const e = STATE_ERRORS[st?.state as string];
    return e ? { ...e, code: st.state } : { error: "unauthenticated", status: 401 };
  }
  const { data: tenant } = await sb.from("tenants")
    .select("id,name,status,modules,timezone,allowed_roles").eq("id", profile.tenant_id).maybeSingle();
  if (!tenant) return { error: "unauthenticated", status: 401 };
  let customRole: CustomRole | null = null;
  if (profile.custom_role_id) {
    const { data: r } = await sb.from("tenant_roles").select("id,name,grants,deny_modules,deny_permissions").eq("id", profile.custom_role_id).maybeSingle();
    customRole = r ?? null;
  }
  // Own role and extra roles, plus a custom role's grants, within the roles the platform allows this school.
  const roles = effectiveRoles([profile.role, ...(profile.extra_roles ?? [])], customRole, tenant.allowed_roles ?? null);
  store.tenantId = tenant.id;
  store.userId = user.id;
  return { sb, userId: user.id, profile: { ...profile, extra_roles: profile.extra_roles ?? [] }, tenant, roles, customRole };
}

/** The signed-in user's context, or null when signed out, not provisioned or blocked. */
export async function getCtx(): Promise<Ctx | null> {
  const r = await resolveCtx();
  return "error" in r ? null : r;
}

export function hasAny(ctx: Ctx, roles: readonly string[]) {
  return roles.some(r => ctx.roles.has(r));
}

/**
 * Guard for API routes. Pass the allowed roles (omit for any signed-in tenant
 * member) and optionally the module that must be enabled for the tenant.
 */
export async function requireCtx(roles?: readonly string[], module?: ModuleKey): Promise<Ctx | NextResponse> {
  const ctx = await resolveCtx();
  if ("error" in ctx) return NextResponse.json({ error: ctx.error, code: ctx.code }, { status: ctx.status });
  if (ctx.tenant.status !== "active") return jsonError(ctx.tenant.status === "paused" ? "this school is closed for now" : "this school account is suspended", 403);
  if (module && ctx.tenant.modules?.[module] === false) return jsonError(`the ${module} module is not enabled for this school`, 403);
  if (module && moduleBlockedForUser(ctx.customRole, module)) return jsonError("your role in this school does not include this area", 403);
  if (roles && !hasAny(ctx, roles)) return jsonError("forbidden", 403);
  return ctx;
}

/** Whether the school has not taken this action away from the user's custom role. */
export function can(ctx: Ctx, perm: Permission): boolean {
  return permitted(ctx.customRole, perm);
}

/** For routes: a 403 response when the user's custom role does not allow the action, otherwise null. */
export function denyUnless(ctx: Ctx, perm: Permission): NextResponse | null {
  return can(ctx, perm) ? null : jsonError("your role in this school does not allow this action", 403);
}

/**
 * Platform (super) admins live outside every tenant; checked via a security-definer RPC.
 * `need`: support can look, admin can change, owner can also delete schools and manage platform admins.
 */
export async function requirePlatformAdmin(need: PlatformRole = "support"): Promise<{ sb: any; userId: string; role: PlatformRole } | NextResponse> {
  const store = beginRequest();
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return jsonError("unauthenticated", 401);
  store.actor = `user:${user.id}`;
  const { data: role } = await sb.rpc("platform_role");
  if (!role) return jsonError("not found", 404); // don't reveal the console exists
  if (!platformAtLeast(role, need)) return jsonError(need === "owner" ? "only the platform owner can do this" : "your platform role can only view", 403);
  store.userId = user.id;
  return { sb, userId: user.id, role };
}

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  try { return (await req.json()) as T; } catch { return {} as T; }
}

/** The signed-in user's school and time zone, for routes that also accept a parent link token. */
export async function sessionIdentity(): Promise<{ tenantId: string; userId: string; timezone: string } | null> {
  const ctx = await getCtx();
  if (!ctx || ctx.tenant.status !== "active") return null;
  return { tenantId: ctx.tenant.id, userId: ctx.userId, timezone: ctx.tenant.timezone };
}
