import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAdmin, readJson, jsonError, STAFF_ROLE_OPTIONS } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { provisionUser } from "@/lib/provision";
import { TenantSettingsInput } from "@/lib/validators";
import { appUrl } from "@/lib/school";

const ADMIN_ROLES = ["school_admin", "principal"];

/** One school as the platform sees it: status, settings, staff accounts, delivery and history. */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const gate = await requirePlatformAdmin();
  if (gate instanceof NextResponse) return gate;
  const svc = createServiceClient();
  const { data: tenant } = await svc.from("tenants").select("*").eq("id", params.id).maybeSingle();
  if (!tenant) return jsonError("not found", 404);
  const [staff, families, settings, outbox, audit] = await Promise.all([
    svc.from("users").select("id,email,full_name,role,extra_roles,active,created_at").eq("tenant_id", params.id)
      .not("role", "in", "(student,parent)").order("role").order("full_name").limit(2000),
    svc.from("users").select("role").eq("tenant_id", params.id).in("role", ["student", "parent"]).limit(100000),
    svc.from("tenant_settings").select("*").eq("tenant_id", params.id).maybeSingle(),
    svc.from("message_outbox").select("status,channel").eq("tenant_id", params.id)
      .gte("created_at", new Date(Date.now() - 7 * 86400_000).toISOString()).limit(5000),
    svc.from("platform_audit_logs").select("*").eq("tenant_id", params.id).order("ts", { ascending: false }).limit(50)
  ]);
  const delivery: Record<string, number> = {};
  for (const m of outbox.data ?? []) delivery[`${m.channel}:${m.status}`] = (delivery[`${m.channel}:${m.status}`] ?? 0) + 1;
  const accounts = staff.data ?? [];
  return NextResponse.json({
    tenant, settings: settings.data ?? {},
    admins: accounts.filter((u: { role: string }) => ADMIN_ROLES.includes(u.role)),
    staff: accounts,
    family_logins: { students: (families.data ?? []).filter((u: { role: string }) => u.role === "student").length, parents: (families.data ?? []).filter((u: { role: string }) => u.role === "parent").length },
    delivery_7d: delivery, audit: audit.data ?? []
  });
}

const StaffRole = z.enum(STAFF_ROLE_OPTIONS);
const Patch = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  status: z.enum(["active", "paused", "suspended"]).optional(),
  status_message: z.string().trim().max(300).nullish(),
  modules: z.record(z.boolean()).optional(),
  student_limit: z.number().int().positive().nullable().optional(),
  timezone: z.string().trim().max(60).optional(),
  country: z.string().trim().max(60).nullish(),
  contact_email: z.string().trim().email().or(z.literal("")).nullish(),
  public_slug: z.string().trim().regex(/^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])?$/, "use lowercase letters, numbers and hyphens").nullish(),
  settings: TenantSettingsInput.optional(),
  add_admin: z.object({ full_name: z.string().trim().min(2), email: z.string().trim().email(), role: z.enum(["school_admin", "principal"]).default("school_admin") }).optional(),
  user: z.object({ id: z.string().uuid(), role: StaffRole.optional(), extra_roles: z.array(StaffRole).max(8).optional(), active: z.boolean().optional() }).optional()
});

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const gate = await requirePlatformAdmin();
  if (gate instanceof NextResponse) return gate;
  const parsed = Patch.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const { add_admin, user, settings, ...fields } = parsed.data;
  const svc = createServiceClient();
  const { data: tenant } = await svc.from("tenants").select("id,name,status").eq("id", params.id).maybeSingle();
  if (!tenant) return jsonError("not found", 404);

  if (Object.keys(fields).length) {
    const row: Record<string, unknown> = { ...fields };
    if (row.contact_email === "") row.contact_email = null;
    // A message only makes sense while the school is closed.
    if (fields.status === "active") row.status_message = null;
    const { error } = await svc.from("tenants").update(row).eq("id", params.id);
    if (error) return jsonError(error.message.includes("duplicate") ? "that web address is already used by another school" : error.message);
  }

  if (settings && Object.keys(settings).length) {
    const clean = Object.fromEntries(Object.entries(settings).map(([k, v]) => [k, v === "" ? null : v]));
    const { error } = await svc.from("tenant_settings").upsert({ ...clean, tenant_id: params.id, updated_at: new Date().toISOString() }, { onConflict: "tenant_id" });
    if (error) return jsonError(error.message);
  }

  if (user) {
    const { data: target } = await svc.from("users").select("id,role,active").eq("tenant_id", params.id).eq("id", user.id).maybeSingle();
    if (!target) return jsonError("account not found in this school", 404);
    if (["student", "parent"].includes(target.role)) return jsonError("student and parent accounts are managed by the school");
    // Never leave a school without an active admin.
    const losingAdmin = ADMIN_ROLES.includes(target.role) && target.active
      && ((user.role && !ADMIN_ROLES.includes(user.role)) || user.active === false);
    if (losingAdmin) {
      const { count } = await svc.from("users").select("id", { count: "exact", head: true }).eq("tenant_id", params.id)
        .in("role", ADMIN_ROLES).eq("active", true).neq("id", user.id);
      if (!count) return jsonError("this is the school's only active admin; add another admin first");
    }
    const row: Record<string, unknown> = {};
    if (user.role) row.role = user.role;
    if (user.extra_roles) row.extra_roles = user.extra_roles.filter(r => r !== user.role);
    if (user.active !== undefined) row.active = user.active;
    const { error } = await svc.from("users").update(row).eq("tenant_id", params.id).eq("id", user.id);
    if (error) return jsonError(error.message);
  }

  if (add_admin) {
    try {
      await provisionUser(svc, {
        tenantId: params.id, email: add_admin.email, fullName: add_admin.full_name, role: add_admin.role,
        redirectTo: `${appUrl(req)}/auth/welcome?next=/school`, createdBy: gate.userId
      });
    } catch (e) { return jsonError((e as Error).message); }
  }

  const action = fields.status && fields.status !== tenant.status ? `tenant.${fields.status === "active" ? "restarted" : fields.status}` : "tenant.updated";
  await svc.from("platform_audit_logs").insert({ actor_id: gate.userId, action, tenant_id: params.id,
    meta: { ...fields, settings: settings ? Object.keys(settings) : undefined, user: user ? { id: user.id, role: user.role, active: user.active } : undefined, add_admin: add_admin?.email } });
  return NextResponse.json({ ok: true });
}

/**
 * Deletes a school and everything in it, including its staff, parent and
 * student sign-ins. Irreversible: the caller must type the school's name.
 */
export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const gate = await requirePlatformAdmin();
  if (gate instanceof NextResponse) return gate;
  const body = await readJson<{ confirm_name?: string }>(req);
  const svc = createServiceClient();
  const { data: tenant } = await svc.from("tenants").select("id,name,status").eq("id", params.id).maybeSingle();
  if (!tenant) return jsonError("not found", 404);
  if ((body.confirm_name ?? "").trim().toLowerCase() !== tenant.name.trim().toLowerCase()) {
    return jsonError("type the school's name exactly to confirm");
  }
  if (tenant.status === "active") return jsonError("pause or suspend the school before deleting it");

  const { data, error } = await svc.rpc("platform_delete_tenant", { p_tenant: params.id });
  if (error) return jsonError(error.message, 500);

  // Remove the sign-in records too, so the emails can be used again. Platform admins are never touched.
  const ids: string[] = data?.users ?? [];
  const { data: platform } = ids.length ? await svc.from("platform_admins").select("user_id").in("user_id", ids) : { data: [] };
  const keep = new Set((platform ?? []).map((p: { user_id: string }) => p.user_id));
  let removed = 0;
  for (const id of ids.filter(i => !keep.has(i))) {
    const { error: e } = await svc.auth.admin.deleteUser(id);
    if (!e) removed++;
  }
  await svc.from("platform_audit_logs").insert({ actor_id: gate.userId, action: "tenant.deleted", tenant_id: params.id,
    meta: { name: tenant.name, accounts_removed: removed } });
  return NextResponse.json({ ok: true, accounts_removed: removed });
}
