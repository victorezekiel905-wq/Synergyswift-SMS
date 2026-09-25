import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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
          "librarian", "hr_manager", "qa_officer", "gate_officer"],
  sims: ["school_admin", "principal", "platform_admin", "it_admin"],
  gate: ["gate_officer", "school_admin", "principal", "platform_admin"],
  library: ["librarian", "school_admin", "principal", "platform_admin"],
  approver: ["school_admin", "principal", "bursar", "platform_admin"],
  hr: ["hr_manager", "school_admin", "principal", "platform_admin"],
  qa: ["qa_officer", "school_admin", "principal", "platform_admin"],
  messaging: ["school_admin", "principal", "it_admin", "platform_admin"]
} as const;

export type ModuleKey = "lms" | "sims" | "results" | "exams" | "gate" | "pickup" | "library"
  | "requisitions" | "hr" | "qa" | "messaging";

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/** Loads the signed-in user's profile and tenant. Returns null when signed out or not provisioned. */
export async function getCtx(): Promise<Ctx | null> {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data: profile } = await sb.from("users")
    .select("id,tenant_id,email,full_name,role,extra_roles").eq("id", user.id).maybeSingle();
  if (!profile) return null;
  const { data: tenant } = await sb.from("tenants")
    .select("id,name,status,modules,timezone").eq("id", profile.tenant_id).maybeSingle();
  if (!tenant) return null;
  const roles = new Set<string>([profile.role, ...(profile.extra_roles ?? [])]);
  return { sb, userId: user.id, profile: { ...profile, extra_roles: profile.extra_roles ?? [] }, tenant, roles };
}

export function hasAny(ctx: Ctx, roles: readonly string[]) {
  return roles.some(r => ctx.roles.has(r));
}

/**
 * Guard for API routes. Pass the allowed roles (omit for any signed-in tenant
 * member) and optionally the module that must be enabled for the tenant.
 */
export async function requireCtx(roles?: readonly string[], module?: ModuleKey): Promise<Ctx | NextResponse> {
  const ctx = await getCtx();
  if (!ctx) return jsonError("unauthenticated", 401);
  if (ctx.tenant.status !== "active") return jsonError("this school account is suspended", 403);
  if (module && ctx.tenant.modules?.[module] === false) return jsonError(`the ${module} module is not enabled for this school`, 403);
  if (roles && !hasAny(ctx, roles)) return jsonError("forbidden", 403);
  return ctx;
}

/** Platform (super) admins live outside every tenant; checked via a security-definer RPC. */
export async function requirePlatformAdmin(): Promise<{ sb: any; userId: string } | NextResponse> {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return jsonError("unauthenticated", 401);
  const { data: ok } = await sb.rpc("is_platform_admin");
  if (ok !== true) return jsonError("not found", 404); // don't reveal the console exists
  return { sb, userId: user.id };
}

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  try { return (await req.json()) as T; } catch { return {} as T; }
}
