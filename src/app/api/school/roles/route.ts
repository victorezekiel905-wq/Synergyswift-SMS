import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, readJson, jsonError, ROLES, STAFF_ROLE_OPTIONS, denyUnless } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { PERMISSIONS, MODULE_KEYS, ALWAYS_ALLOWED_ROLES } from "@/lib/saas";

/**
 * Custom roles inside a school: a name, built-in roles it adds, and modules
 * and actions it takes away. School admins manage them for their own school,
 * within the roles Synergy Swift allows the school.
 */
export async function GET() {
  const ctx = await requireCtx(ROLES.admin);
  if (ctx instanceof NextResponse) return ctx;
  const [{ data: roles }, { data: staff }] = await Promise.all([
    ctx.sb.from("tenant_roles").select("*").eq("tenant_id", ctx.tenant.id).order("name"),
    ctx.sb.from("users").select("id,full_name,email,role,extra_roles,custom_role_id,active").eq("tenant_id", ctx.tenant.id).not("role", "in", "(student,parent)").order("full_name").limit(2000)
  ]);
  const allowed = ctx.tenant.allowed_roles ?? null;
  return NextResponse.json({
    roles: roles ?? [], staff: staff ?? [],
    assignable_roles: STAFF_ROLE_OPTIONS.filter(r => !allowed || ALWAYS_ALLOWED_ROLES.includes(r) || allowed.includes(r)),
    modules: Object.entries(ctx.tenant.modules ?? {}).filter(([, on]) => on !== false).map(([k]) => k),
    permissions: PERMISSIONS
  });
}

const Role = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(300).nullish(),
  grants: z.array(z.enum(STAFF_ROLE_OPTIONS)).max(15).default([]),
  deny_modules: z.array(z.enum(MODULE_KEYS as [string, ...string[]])).max(60).default([]),
  deny_permissions: z.array(z.enum(PERMISSIONS.map(p => p.key) as [string, ...string[]])).max(20).default([])
});

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.admin);
  if (ctx instanceof NextResponse) return ctx;
  const denied = denyUnless(ctx, "staff.roles");
  if (denied) return denied;
  const parsed = Role.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const allowed = ctx.tenant.allowed_roles ?? null;
  const bad = b.grants.filter(r => allowed && !ALWAYS_ALLOWED_ROLES.includes(r) && !allowed.includes(r));
  if (bad.length) return jsonError(`your school's plan does not include these roles: ${bad.join(", ")}`);
  const row = { tenant_id: ctx.tenant.id, name: b.name, description: b.description ?? null, grants: b.grants, deny_modules: b.deny_modules, deny_permissions: b.deny_permissions, updated_at: new Date().toISOString() };
  const q = b.id
    ? ctx.sb.from("tenant_roles").update(row).eq("tenant_id", ctx.tenant.id).eq("id", b.id).select("*").single()
    : ctx.sb.from("tenant_roles").insert({ ...row, created_by: ctx.userId }).select("*").single();
  const { data, error } = await q;
  if (error) return jsonError(error.message.includes("duplicate") ? "a role with that name already exists" : error.message);
  return NextResponse.json(data, { status: b.id ? 200 : 201 });
}

const Assign = z.object({ user_id: z.string().uuid(), custom_role_id: z.string().uuid().nullable() });

/** Give a member of staff a custom role (or take it away). */
export async function PATCH(req: NextRequest) {
  const ctx = await requireCtx(ROLES.admin);
  if (ctx instanceof NextResponse) return ctx;
  const denied = denyUnless(ctx, "staff.roles");
  if (denied) return denied;
  const parsed = Assign.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => i.message).join("; "));
  const b = parsed.data;
  if (b.user_id === ctx.userId) return jsonError("you cannot change your own role");
  const { data: target } = await ctx.sb.from("users").select("id,role").eq("tenant_id", ctx.tenant.id).eq("id", b.user_id).maybeSingle();
  if (!target) return jsonError("not found", 404);
  if (["student", "parent"].includes(target.role)) return jsonError("custom roles are for staff");
  const { error } = await ctx.sb.from("users").update({ custom_role_id: b.custom_role_id }).eq("tenant_id", ctx.tenant.id).eq("id", b.user_id);
  if (error) return jsonError(error.message);
  await createServiceClient().from("audit_logs").insert({ tenant_id: ctx.tenant.id, actor_id: ctx.userId, action: "staff.custom_role", target: b.user_id, meta: { custom_role_id: b.custom_role_id } });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const ctx = await requireCtx(ROLES.admin);
  if (ctx instanceof NextResponse) return ctx;
  const denied = denyUnless(ctx, "staff.roles");
  if (denied) return denied;
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/.test(id)) return jsonError("id required");
  const { error } = await ctx.sb.from("tenant_roles").delete().eq("tenant_id", ctx.tenant.id).eq("id", id);
  if (error) return jsonError(error.message);
  return NextResponse.json({ ok: true });
}
