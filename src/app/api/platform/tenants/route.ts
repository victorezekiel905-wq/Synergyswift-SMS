import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAdmin, readJson, jsonError, STAFF_ROLE_OPTIONS } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { DEFAULT_SCHEME } from "@/lib/grading";
import { provisionUser } from "@/lib/provision";
import { appUrl } from "@/lib/school";
import { SubscriptionBody, OverrideBody } from "@/lib/saas-schemas";
import { saveSubscription, refreshTenantModules } from "@/lib/saas-server";
import { makeSchoolCode } from "@/lib/school-codes-server";

/** Super-admin: list every tenant with usage counts. Tenants never see this. */
export async function GET() {
  const gate = await requirePlatformAdmin();
  if (gate instanceof NextResponse) return gate;
  const svc = createServiceClient();
  const { data: tenants, error } = await svc.from("tenants")
    .select("id,name,slug,status,billing_hold,modules,contact_email,country,timezone,student_limit,created_at,subscriptions(status,period_end,cycle,plans(name,code))")
    .order("created_at", { ascending: false });
  if (error) return jsonError(error.message);

  const count = async (table: string, tenantId: string, extra?: (q: any) => any) => {
    let q = svc.from(table).select("id", { count: "exact", head: true }).eq("tenant_id", tenantId);
    if (extra) q = extra(q);
    const { count: c } = await q;
    return c ?? 0;
  };
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const rows = await Promise.all((tenants ?? []).map(async (t: any) => ({
    ...t,
    stats: {
      users: await count("users", t.id),
      students: await count("students", t.id, q => q.eq("status", "active")),
      staff: await count("staff", t.id, q => q.neq("status", "exited")),
      messages_30d: await count("message_outbox", t.id, q => q.eq("status", "sent").gte("created_at", since)),
      exams: await count("exams", t.id)
    }
  })));
  return NextResponse.json(rows);
}

const CreateTenant = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,48}$/, "slug: lowercase letters, numbers and dashes"),
  country: z.string().trim().max(60).optional(),
  timezone: z.string().trim().max(60).default("Africa/Lagos"),
  student_limit: z.number().int().positive().nullable().optional(),
  /** The first admin, invited by email. Leave both out to get an onboarding code for the school instead. */
  admin_name: z.string().trim().min(2).max(120).optional(),
  admin_email: z.string().trim().email().optional(),
  /** The plan the school has paid for; without it every module stays on (as for older schools). */
  subscription: SubscriptionBody.optional(),
  overrides: z.array(OverrideBody).max(60).default([]),
  allowed_roles: z.array(z.enum(STAFF_ROLE_OPTIONS)).max(20).nullable().optional(),
  /** The sales lead this school came from (marked won and linked). */
  lead_id: z.string().uuid().optional()
});

/**
 * Super-admin onboarding: the school, its settings, a default grading scheme,
 * its first admin (invited by email), its plan and paid modules, any module
 * overrides, and (optionally) its first invoice, in one step.
 */
export async function POST(req: NextRequest) {
  // Only the platform owner (the super admin) creates schools; prospects use a one-time school code instead.
  const gate = await requirePlatformAdmin("owner");
  if (gate instanceof NextResponse) return gate;
  const parsed = CreateTenant.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => i.message).join("; "));
  const b = parsed.data;
  if (Boolean(b.admin_name) !== Boolean(b.admin_email)) return jsonError("Give the first admin's name and email, or neither (the school then gets an onboarding code).");
  // Plans are priced by students, so every school has a student limit; only the Custom plan may go without.
  if (!b.student_limit && b.subscription?.plan_code !== "custom") return jsonError("Enter the student limit. Only the Custom plan may go without one.");
  const svc = createServiceClient();
  let invoice: { number: string } | null = null;

  const { data: tenant, error } = await svc.from("tenants").insert({
    name: b.name, slug: b.slug, country: b.country ?? null, timezone: b.timezone,
    contact_email: b.admin_email ?? null, student_limit: b.student_limit ?? null, allowed_roles: b.allowed_roles ?? null
  }).select("id,name,slug").single();
  if (error) return jsonError(error.message.includes("duplicate") ? "that slug is already taken" : error.message);

  try {
    await svc.from("tenant_settings").insert({ tenant_id: tenant.id, school_name: b.name, sender_name: b.name, email: b.admin_email ?? null });
    const { data: scheme, error: sErr } = await svc.from("grading_schemes").insert({
      tenant_id: tenant.id, name: DEFAULT_SCHEME.name, is_default: true, pass_mark: DEFAULT_SCHEME.pass_mark
    }).select("id").single();
    if (sErr) throw new Error(sErr.message);
    await svc.from("grading_components").insert(DEFAULT_SCHEME.components.map(c => ({ ...c, scheme_id: scheme.id })));
    await svc.from("grade_bands").insert(DEFAULT_SCHEME.bands.map(bd => ({ ...bd, scheme_id: scheme.id })));

    if (b.admin_name && b.admin_email) {
      const { userId } = await provisionUser(svc, {
        tenantId: tenant.id, email: b.admin_email, fullName: b.admin_name, role: "school_admin",
        redirectTo: `${appUrl(req)}/auth/welcome?next=/school`, createdBy: gate.userId
      });
      await svc.from("staff").insert({ tenant_id: tenant.id, user_id: userId, staff_no: "ADMIN-001", full_name: b.admin_name, email: b.admin_email, position: "School administrator" });
    }

    const overrides = b.overrides.filter(o => o.mode !== "inherit");
    if (overrides.length) {
      const { error: oErr } = await svc.from("tenant_module_overrides").insert(overrides.map(o => ({ tenant_id: tenant.id, module: o.module, mode: o.mode, expires_at: o.expires_at ?? null, note: o.note ?? null, set_by: gate.userId })));
      if (oErr) throw new Error(oErr.message);
    }
    if (b.subscription) invoice = (await saveSubscription(svc, tenant.id, b.subscription, gate.userId)).invoice;
    else await refreshTenantModules(svc, tenant.id);
  } catch (e) {
    // Roll back the half-created tenant so the slug can be reused.
    await svc.from("tenants").delete().eq("id", tenant.id);
    return jsonError(`tenant not created: ${(e as Error).message}`);
  }

  await svc.from("platform_audit_logs").insert({ actor_id: gate.userId, action: "tenant.created", tenant_id: tenant.id,
    meta: { slug: b.slug, plan: b.subscription?.plan_code ?? null, overrides: b.overrides.length, invoice: invoice?.number ?? null } });
  // Onboarding starts (sales CRM, migration 6400; skipped quietly before it is applied).
  await svc.from("tenant_onboarding").upsert({ tenant_id: tenant.id, step: "school_created", done_by: gate.userId, auto: true }, { onConflict: "tenant_id,step" });
  if (b.lead_id) {
    const now = new Date().toISOString();
    await svc.from("sales_leads").update({ tenant_id: tenant.id, stage: "won", score: 100, stage_changed_at: now, updated_at: now }).eq("id", b.lead_id);
    await svc.from("sales_activities").insert({ lead_id: b.lead_id, kind: "system", body: `School created: ${b.name}.`, actor_id: gate.userId });
  }
  // No admin given: a one-time code makes whoever signs up with it this school's administrator.
  let code: { code: string; expires_at: string } | null = null;
  if (!b.admin_email) {
    try { const made = await makeSchoolCode(svc, { label: tenant.name, createdBy: gate.userId, forTenantId: tenant.id, leadId: b.lead_id ?? null }); code = { code: made.code, expires_at: made.expires_at }; }
    catch { /* the school stands; a code can be made on its page */ }
  }
  return NextResponse.json({ ...tenant, invoice, code }, { status: 201 });
}
