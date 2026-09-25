import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAdmin, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { DEFAULT_SCHEME } from "@/lib/grading";
import { provisionUser } from "@/lib/provision";
import { appUrl } from "@/lib/school";

/** Super-admin: list every tenant with usage counts. Tenants never see this. */
export async function GET() {
  const gate = await requirePlatformAdmin();
  if (gate instanceof NextResponse) return gate;
  const svc = createServiceClient();
  const { data: tenants, error } = await svc.from("tenants")
    .select("id,name,slug,status,modules,contact_email,country,timezone,student_limit,created_at")
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
  admin_name: z.string().trim().min(2).max(120),
  admin_email: z.string().trim().email(),
  modules: z.record(z.boolean()).optional()
});

/** Super-admin: provision a school, its settings, a default grading scheme and its first admin. */
export async function POST(req: NextRequest) {
  const gate = await requirePlatformAdmin();
  if (gate instanceof NextResponse) return gate;
  const parsed = CreateTenant.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => i.message).join("; "));
  const b = parsed.data;
  const svc = createServiceClient();

  const { data: tenant, error } = await svc.from("tenants").insert({
    name: b.name, slug: b.slug, country: b.country ?? null, timezone: b.timezone,
    contact_email: b.admin_email, student_limit: b.student_limit ?? null,
    ...(b.modules ? { modules: b.modules } : {})
  }).select("id,name,slug").single();
  if (error) return jsonError(error.message.includes("duplicate") ? "that slug is already taken" : error.message);

  try {
    await svc.from("tenant_settings").insert({ tenant_id: tenant.id, school_name: b.name, sender_name: b.name, email: b.admin_email });
    const { data: scheme, error: sErr } = await svc.from("grading_schemes").insert({
      tenant_id: tenant.id, name: DEFAULT_SCHEME.name, is_default: true, pass_mark: DEFAULT_SCHEME.pass_mark
    }).select("id").single();
    if (sErr) throw new Error(sErr.message);
    await svc.from("grading_components").insert(DEFAULT_SCHEME.components.map(c => ({ ...c, scheme_id: scheme.id })));
    await svc.from("grade_bands").insert(DEFAULT_SCHEME.bands.map(bd => ({ ...bd, scheme_id: scheme.id })));

    const { userId } = await provisionUser(svc, {
      tenantId: tenant.id, email: b.admin_email, fullName: b.admin_name, role: "school_admin",
      redirectTo: `${appUrl(req)}/auth/welcome?next=/school`, createdBy: gate.userId
    });
    await svc.from("staff").insert({ tenant_id: tenant.id, user_id: userId, staff_no: "ADMIN-001", full_name: b.admin_name, email: b.admin_email, position: "School administrator" });
  } catch (e) {
    // Roll back the half-created tenant so the slug can be reused.
    await svc.from("tenants").delete().eq("id", tenant.id);
    return jsonError(`tenant not created: ${(e as Error).message}`);
  }

  await svc.from("platform_audit_logs").insert({ actor_id: gate.userId, action: "tenant.created", tenant_id: tenant.id, meta: { slug: b.slug } });
  return NextResponse.json(tenant, { status: 201 });
}
