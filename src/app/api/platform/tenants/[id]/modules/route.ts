import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAdmin, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { resolveModules, diffEffective, MODULE_KEYS, type Override } from "@/lib/saas";
import { OverrideBody } from "@/lib/saas-schemas";
import { loadSubscription, loadOverrides, subscriptionModules, refreshTenantModules, moduleList } from "@/lib/saas-server";

/** A school's modules: what its plan gives, the platform's overrides, and the effective result. */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const gate = await requirePlatformAdmin();
  if (gate instanceof NextResponse) return gate;
  const svc = createServiceClient();
  const [{ sub, plan }, overrides] = await Promise.all([loadSubscription(svc, params.id), loadOverrides(svc, params.id)]);
  const res = resolveModules(subscriptionModules(sub, plan), overrides);
  return NextResponse.json({ plan: plan ? { code: plan.code, name: plan.name } : null, add_on_groups: sub?.add_on_groups ?? [], rows: res.rows });
}

const Put = z.object({
  overrides: z.array(OverrideBody).max(MODULE_KEYS.length),
  preview: z.boolean().default(false)
});

/**
 * Saves overrides (INHERIT removes one). With preview: true, returns what
 * would change without saving, so the effective state is seen first.
 */
export async function PUT(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const gate = await requirePlatformAdmin("admin");
  if (gate instanceof NextResponse) return gate;
  const parsed = Put.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const svc = createServiceClient();
  const { data: tenant } = await svc.from("tenants").select("id,modules").eq("id", params.id).maybeSingle();
  if (!tenant) return jsonError("not found", 404);
  const now = new Date();
  for (const o of parsed.data.overrides) {
    if (o.mode !== "inherit" && o.expires_at && new Date(o.expires_at) <= now) return jsonError(`${o.module}: the end date must be in the future`);
  }
  const [{ sub, plan }, current] = await Promise.all([loadSubscription(svc, params.id), loadOverrides(svc, params.id)]);
  const merged = new Map(current.map(o => [o.module, o]));
  for (const o of parsed.data.overrides) {
    if (o.mode === "inherit") merged.delete(o.module);
    else merged.set(o.module, { module: o.module, mode: o.mode, expires_at: o.expires_at ?? null, note: o.note ?? null });
  }
  const after = resolveModules(subscriptionModules(sub, plan), [...merged.values()] as Override[], now);
  const before = resolveModules(subscriptionModules(sub, plan), current, now);
  const diff = diffEffective(before.effective, after.effective);
  if (parsed.data.preview) return NextResponse.json({ ...diff, rows: after.rows });

  for (const o of parsed.data.overrides) {
    if (o.mode === "inherit") await svc.from("tenant_module_overrides").delete().eq("tenant_id", params.id).eq("module", o.module);
    else {
      const { error } = await svc.from("tenant_module_overrides").upsert({ tenant_id: params.id, module: o.module, mode: o.mode, expires_at: o.expires_at ?? null, note: o.note ?? null, set_by: gate.userId, set_at: now.toISOString() });
      if (error) return jsonError(error.message);
    }
  }
  const res = await refreshTenantModules(svc, params.id, now);
  await svc.from("platform_audit_logs").insert({ actor_id: gate.userId, action: "tenant.modules", tenant_id: params.id,
    meta: { turned_on: diff.turnedOn, turned_off: diff.turnedOff, overrides: parsed.data.overrides, summary: [diff.turnedOn.length ? `on: ${moduleList(diff.turnedOn)}` : "", diff.turnedOff.length ? `off: ${moduleList(diff.turnedOff)}` : ""].filter(Boolean).join("; ") } });
  return NextResponse.json({ ...diff, rows: res.rows });
}
