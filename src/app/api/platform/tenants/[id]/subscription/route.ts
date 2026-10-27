import { NextRequest, NextResponse } from "next/server";
import { requirePlatformAdmin, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { bandFor } from "@/lib/saas";
import { SubscriptionBody } from "@/lib/saas-schemas";
import { loadSubscription, priceFor, saveSubscription } from "@/lib/saas-server";

/** A school's plan, size band, add-ons, billing period, price and invoices. */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const gate = await requirePlatformAdmin();
  if (gate instanceof NextResponse) return gate;
  const svc = createServiceClient();
  const { sub, plan } = await loadSubscription(svc, params.id);
  const [{ data: invoices }, { count: students }] = await Promise.all([
    svc.from("invoices").select("*").eq("tenant_id", params.id).order("created_at", { ascending: false }).limit(50),
    svc.from("students").select("id", { count: "exact", head: true }).eq("tenant_id", params.id).eq("status", "active")
  ]);
  const price = sub && plan ? await priceFor(svc, sub, plan) : null;
  return NextResponse.json({ subscription: sub, plan, price, invoices: invoices ?? [], students: students ?? 0, suggested_band: bandFor(students ?? 0) });
}

/** Creates or changes the subscription, rebuilds the school's modules and can issue the first invoice. */
export async function PUT(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const gate = await requirePlatformAdmin("admin");
  if (gate instanceof NextResponse) return gate;
  const parsed = SubscriptionBody.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const svc = createServiceClient();
  const { data: tenant } = await svc.from("tenants").select("id").eq("id", params.id).maybeSingle();
  if (!tenant) return jsonError("not found", 404);
  try { return NextResponse.json(await saveSubscription(svc, params.id, parsed.data, gate.userId)); }
  catch (e) { return jsonError((e as Error).message); }
}
