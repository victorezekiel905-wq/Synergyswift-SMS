import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { beginRequest } from "@/lib/request-actor";
import { checkAccess } from "@/lib/access";

export type Profile = {
  id: string;
  tenant_id: string;
  email: string;
  full_name: string;
  role: string;
  extra_roles: string[];
};

export type Tenant = { id: string; name: string; status: string; modules: Record<string, boolean>; timezone: string };

export type Ctx = {
  sb: any;
  userId: string;
  profile: Profile;
  tenant: Tenant;
  roles: Set<string>;
};

/** Role groups used across the school-operations modules. */
export const ROLES = {
  admin: ["school_admin", "principal", "platform_admin"],
  staff: ["teacher", "school_admin", "it_admin", "platform_admin", "principal", "bursar",
          "librarian", "hr_manager", "qa_officer", "gate_officer", "transport_officer",
          "hostel_warden", "nurse", "admissions_officer", "cashier", "counsellor"],
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
  cover: ["school_admin", "principal", "platform_admin"]
} as const;

/** Every assignable staff role, in the order shown in HR. */
export const STAFF_ROLE_OPTIONS = ["teacher", "school_admin", "principal", "it_admin", "bursar", "librarian",
  "hr_manager", "qa_officer", "gate_officer", "transport_officer", "hostel_warden", "nurse", "admissions_officer", "cashier", "counsellor"] as const;

export type ModuleKey = "lms" | "sims" | "results" | "exams" | "gate" | "pickup" | "library"
  | "requisitions" | "hr" | "qa" | "messaging" | "fees" | "payroll" | "inventory" | "admissions"
  | "attendance" | "behaviour" | "homework" | "health" | "events" | "meetings" | "timetable"
  | "transport" | "hostel" | "visitors" | "lesson_notes" | "analytics" | "wallet" | "inbox" | "cover" | "community";

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
  const { data: { session } } = await sb.auth.getSession();
  const access = await checkAccess(user.id, session?.access_token ?? null);
  if (!access.ok) return { error: access.message, status: 403, code: "access_restricted" };
  const { data: profile } = await sb.from("users")
    .select("id,tenant_id,email,full_name,role,extra_roles").eq("id", user.id).maybeSingle();
  if (!profile) {
    const { data: st } = await sb.rpc("my_account_state");
    const e = STATE_ERRORS[st?.state as string];
    return e ? { ...e, code: st.state } : { error: "unauthenticated", status: 401 };
  }
  const { data: tenant } = await sb.from("tenants")
    .select("id,name,status,modules,timezone").eq("id", profile.tenant_id).maybeSingle();
  if (!tenant) return { error: "unauthenticated", status: 401 };
  const roles = new Set<string>([profile.role, ...(profile.extra_roles ?? [])]);
  return { sb, userId: user.id, profile: { ...profile, extra_roles: profile.extra_roles ?? [] }, tenant, roles };
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
  if (roles && !hasAny(ctx, roles)) return jsonError("forbidden", 403);
  return ctx;
}

/** Platform (super) admins live outside every tenant; checked via a security-definer RPC. */
export async function requirePlatformAdmin(): Promise<{ sb: any; userId: string } | NextResponse> {
  const store = beginRequest();
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return jsonError("unauthenticated", 401);
  store.actor = `user:${user.id}`;
  const { data: ok } = await sb.rpc("is_platform_admin");
  if (ok !== true) return jsonError("not found", 404); // don't reveal the console exists
  return { sb, userId: user.id };
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
