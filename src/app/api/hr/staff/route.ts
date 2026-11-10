import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError, STAFF_ROLE_OPTIONS, denyUnless } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { grantStaffAccess } from "@/lib/staff-access-server";
import { subjectsByStaff, setStaffSubjects } from "@/lib/staff-onboarding-server";

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
  const subjects = await subjectsByStaff(ctx.sb, tid);
  return NextResponse.json((staff ?? []).map((s: any) => ({ ...s, leave_used: used[s.id] ?? 0, subject_ids: subjects.get(s.id) ?? [] })));
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
  leave_allowance: z.number().int().min(0).max(365).default(20),
  line_manager_id: z.string().uuid().nullish().or(z.literal("")),
  probation_ends_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().or(z.literal(""))
});

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), staff: StaffInput, subject_ids: z.array(z.string().uuid()).max(60).optional() }),
  // Create a login and set roles (primary + extra)
  // For someone without an account, how they get in: their sign-up code, an emailed invitation, or a one-time password.
  z.object({ action: z.literal("grant_access"), staff_id: z.string().uuid(), role: z.enum(ASSIGNABLE), extra_roles: z.array(z.enum(ASSIGNABLE)).default([]),
    method: z.enum(["code", "invite", "otp"]).default("code"), email: z.string().trim().max(254).nullish() }),
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
    if (id && s.line_manager_id === id) return jsonError("someone cannot be their own line manager");
    const row = { ...s, email: s.email || null, hire_date: s.hire_date || null, line_manager_id: s.line_manager_id || null, probation_ends_on: s.probation_ends_on || null, tenant_id: tid };
    const { data, error } = id
      ? await ctx.sb.from("staff").update(row).eq("tenant_id", tid).eq("id", id).select("id").single()
      : await ctx.sb.from("staff").insert(row).select("id").single();
    if (error) return jsonError(error.message.includes("duplicate") ? "staff number already exists" : error.message);
    if (b.subject_ids) {
      const r = await setStaffSubjects(ctx.sb, tid, data.id, b.subject_ids);
      if (r.error) return NextResponse.json({ ...data, warning: `Saved, but not the subjects: ${r.error}` });
    }
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

  { const denied = denyUnless(ctx, "staff.roles"); if (denied) return denied; }
  // The same way in as Staff onboarding (lib/staff-access-server).
  const r = await grantStaffAccess(ctx, svc, req, { staff: s, role: b.role, extra: b.extra_roles, method: b.method, email: b.email || s.email });
  if (!r.ok) return jsonError(r.error, r.status);
  if (r.rolesOnly) return NextResponse.json({ ok: true });
  return NextResponse.json({ ok: true, ...(r.code ? { code: r.code } : {}), ...(r.invited ? { invited: true, email: r.email } : {}), ...(r.otp ? { otp: r.otp } : {}) });
}