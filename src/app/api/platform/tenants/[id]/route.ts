import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAdmin, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { provisionUser } from "@/lib/provision";
import { appUrl } from "@/lib/school";

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const gate = await requirePlatformAdmin();
  if (gate instanceof NextResponse) return gate;
  const svc = createServiceClient();
  const { data: tenant } = await svc.from("tenants").select("*").eq("id", params.id).maybeSingle();
  if (!tenant) return jsonError("not found", 404);
  const [admins, settings, outbox, audit] = await Promise.all([
    svc.from("users").select("id,email,full_name,role,active,created_at").eq("tenant_id", params.id)
      .in("role", ["school_admin", "principal"]).order("created_at"),
    svc.from("tenant_settings").select("*").eq("tenant_id", params.id).maybeSingle(),
    svc.from("message_outbox").select("status,channel").eq("tenant_id", params.id)
      .gte("created_at", new Date(Date.now() - 7 * 86400_000).toISOString()).limit(5000),
    svc.from("platform_audit_logs").select("*").eq("tenant_id", params.id).order("ts", { ascending: false }).limit(50)
  ]);
  const delivery: Record<string, number> = {};
  for (const m of outbox.data ?? []) delivery[`${m.channel}:${m.status}`] = (delivery[`${m.channel}:${m.status}`] ?? 0) + 1;
  return NextResponse.json({ tenant, admins: admins.data ?? [], settings: settings.data, delivery_7d: delivery, audit: audit.data ?? [] });
}

const Patch = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  status: z.enum(["active", "suspended"]).optional(),
  modules: z.record(z.boolean()).optional(),
  student_limit: z.number().int().positive().nullable().optional(),
  timezone: z.string().trim().max(60).optional(),
  add_admin: z.object({ full_name: z.string().trim().min(2), email: z.string().trim().email() }).optional()
});

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const gate = await requirePlatformAdmin();
  if (gate instanceof NextResponse) return gate;
  const parsed = Patch.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => i.message).join("; "));
  const { add_admin, ...fields } = parsed.data;
  const svc = createServiceClient();
  if (Object.keys(fields).length) {
    const { error } = await svc.from("tenants").update(fields).eq("id", params.id);
    if (error) return jsonError(error.message);
  }
  if (add_admin) {
    try {
      await provisionUser(svc, {
        tenantId: params.id, email: add_admin.email, fullName: add_admin.full_name, role: "school_admin",
        redirectTo: `${appUrl(req)}/auth/welcome?next=/school`, createdBy: gate.userId
      });
    } catch (e) { return jsonError((e as Error).message); }
  }
  await svc.from("platform_audit_logs").insert({ actor_id: gate.userId, action: "tenant.updated", tenant_id: params.id, meta: { ...fields, add_admin: add_admin?.email } });
  return NextResponse.json({ ok: true });
}
