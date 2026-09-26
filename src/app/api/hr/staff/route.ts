import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError, STAFF_ROLE_OPTIONS } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { provisionUser } from "@/lib/provision";
import { appUrl } from "@/lib/school";

const ASSIGNABLE = STAFF_ROLE_OPTIONS;

/** Staff directory with login + role info and leave taken this year. */
export async function GET() {
  const ctx = await requireCtx(ROLES.staff, "hr");
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  const yearStart = `${new Date().getUTCFullYear()}-01-01`;
  const [{ data: staff, error }, { data: leave }] = await Promise.all([
    ctx.sb.from("staff").select("*,users(id,role,extra_roles,active,email)").eq("tenant_id", tid).order("full_name"),
    ctx.sb.from("leave_requests").select("staff_id,days").eq("tenant_id", tid).eq("status", "approved").gte("starts_on", yearStart)
  ]);
  if (error) return jsonError(error.message);
  const used: Record<string, number> = {};
  for (const l of leave ?? []) used[l.staff_id] = (used[l.staff_id] ?? 0) + l.days;
  return NextResponse.json((staff ?? []).map((s: any) => ({ ...s, leave_used: used[s.id] ?? 0 })));
}

const StaffInput = z.object({
  id: z.string().uuid().optional(),
  staff_no: z.string().trim().min(1).max(40),
  full_name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().or(z.literal("")).nullish(),
  phone: z.string().trim().max(30).nullish(),
  department: z.string().trim().max(80).nullish(),
  position: z.string().trim().max(80).nullish(),
  employment_type: z.enum(["full_time", "part_time", "contract", "volunteer"]).default("full_time"),
  hire_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().or(z.literal("")),
  status: z.enum(["active", "on_leave", "exited"]).default("active"),
  leave_allowance: z.number().int().min(0).max(365).default(20)
});

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), staff: StaffInput }),
  // Create a login and set roles (primary + extra)
  z.object({ action: z.literal("grant_access"), staff_id: z.string().uuid(), role: z.enum(ASSIGNABLE), extra_roles: z.array(z.enum(ASSIGNABLE)).default([]) }),
  z.object({ action: z.literal("set_active"), staff_id: z.string().uuid(), active: z.boolean() })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.hr, "hr");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;

  if (b.action === "save") {
    const { id, ...s } = b.staff;
    const row = { ...s, email: s.email || null, hire_date: s.hire_date || null, tenant_id: tid };
    const { data, error } = id
      ? await ctx.sb.from("staff").update(row).eq("tenant_id", tid).eq("id", id).select("id").single()
      : await ctx.sb.from("staff").insert(row).select("id").single();
    if (error) return jsonError(error.message.includes("duplicate") ? "staff number already exists" : error.message);
    return NextResponse.json(data);
  }

  // Role changes are admin-only (HR managers maintain records but cannot mint admins).
  if (!ROLES.admin.some(r => ctx.roles.has(r))) return jsonError("only school admins can grant or remove access", 403);
  const svc = createServiceClient();
  const { data: s } = await svc.from("staff").select("id,full_name,email,user_id").eq("tenant_id", tid).eq("id", b.staff_id).maybeSingle();
  if (!s) return jsonError("staff not found", 404);

  if (b.action === "set_active") {
    if (!s.user_id) return jsonError("this staff member has no login");
    if (s.user_id === ctx.userId) return jsonError("you cannot deactivate yourself");
    const { error } = await ctx.sb.from("users").update({ active: b.active }).eq("tenant_id", tid).eq("id", s.user_id);
    return error ? jsonError(error.message) : NextResponse.json({ ok: true });
  }

  const extra = b.extra_roles.filter(r => r !== b.role);
  if (s.user_id) {
    if (s.user_id === ctx.userId) return jsonError("you cannot change your own roles");
    const { error } = await ctx.sb.from("users").update({ role: b.role, extra_roles: extra }).eq("tenant_id", tid).eq("id", s.user_id);
    if (error) return jsonError(error.message);
    await ctx.sb.from("audit_logs").insert({ tenant_id: tid, actor_id: ctx.userId, action: "staff.roles_changed", target: s.user_id, meta: { role: b.role, extra } });
    return NextResponse.json({ ok: true });
  }
  try {
    const { userId } = await provisionUser(svc, { tenantId: tid, email: String(s.email ?? ""), fullName: s.full_name, role: b.role, extraRoles: extra,
      redirectTo: `${appUrl(req)}/auth/welcome?next=/dashboard`, createdBy: ctx.userId });
    await svc.from("staff").update({ user_id: userId }).eq("tenant_id", tid).eq("id", s.id);
    await ctx.sb.from("audit_logs").insert({ tenant_id: tid, actor_id: ctx.userId, action: "staff.login_created", target: userId, meta: { role: b.role, extra } });
    return NextResponse.json({ ok: true, invited: true });
  } catch (e) { return jsonError((e as Error).message); }
}
