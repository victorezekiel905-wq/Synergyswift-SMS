import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAdmin, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { MODULE_GROUPS } from "@/lib/saas";
import { groupPrices, platformSetting } from "@/lib/saas-server";

/** Plans, add-on group prices and the billing details shown on invoices. */
export async function GET() {
  const gate = await requirePlatformAdmin();
  if (gate instanceof NextResponse) return gate;
  const svc = createServiceClient();
  const { data: plans } = await svc.from("plans").select("id,code,name,groups,prices,blurb,active,sort").not("code", "is", null).order("sort");
  return NextResponse.json({
    plans: plans ?? [], group_prices: await groupPrices(svc),
    billing: await platformSetting(svc, "billing", { company: "Synergy Swift Technologies Limited", bank_details: "", grace_days: 14 }),
    role: gate.role
  });
}

const GROUPS = MODULE_GROUPS.map(g => g.key) as [string, ...string[]];
const Prices = z.array(z.number().int().min(0).max(10_000_000_000)).length(5);
const Patch = z.object({
  plans: z.array(z.object({
    code: z.string().min(2).max(40), name: z.string().trim().min(2).max(60), blurb: z.string().trim().max(300).nullish(),
    groups: z.array(z.enum(GROUPS)).min(1), prices: Prices.nullable(), active: z.boolean()
  })).max(20).optional(),
  group_prices: z.record(z.enum(GROUPS), Prices).optional(),
  billing: z.object({ company: z.string().trim().min(2).max(120), bank_details: z.string().trim().max(1000), grace_days: z.number().int().min(0).max(90) }).optional()
});

/** Change prices and plan contents. Existing subscriptions pick them up at their next invoice. */
export async function PATCH(req: NextRequest) {
  const gate = await requirePlatformAdmin("admin");
  if (gate instanceof NextResponse) return gate;
  const parsed = Patch.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const svc = createServiceClient();
  const b = parsed.data;
  for (const p of b.plans ?? []) {
    if (!p.groups.includes("core")) return jsonError(`${p.name}: every plan includes Core`);
    const { error } = await svc.from("plans").update({ name: p.name, blurb: p.blurb ?? null, groups: p.groups, prices: p.prices, active: p.active }).eq("code", p.code);
    if (error) return jsonError(error.message);
  }
  if (b.group_prices) await svc.from("platform_settings").upsert({ key: "group_prices", value: { ...(await groupPrices(svc)), ...b.group_prices }, updated_at: new Date().toISOString() });
  if (b.billing) await svc.from("platform_settings").upsert({ key: "billing", value: b.billing, updated_at: new Date().toISOString() });
  await svc.from("platform_audit_logs").insert({ actor_id: gate.userId, action: "plans.updated", tenant_id: null, meta: { plans: (b.plans ?? []).map(p => p.code), group_prices: Boolean(b.group_prices), billing: Boolean(b.billing) } });
  return NextResponse.json({ ok: true });
}
