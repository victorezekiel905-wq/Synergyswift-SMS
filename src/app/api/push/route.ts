import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readJson, jsonError, getCtx, sessionIdentity } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { identifyGuardian } from "@/lib/guardian";
import { pushConfigured } from "@/lib/messaging/push";

export const dynamic = "force-dynamic";

/** The public key the browser needs to subscribe. */
export async function GET() {
  return NextResponse.json({ configured: pushConfigured(), public_key: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null });
}

const Subscription = z.object({
  endpoint: z.string().url().max(1000).refine(u => u.startsWith("https://"), "endpoint must be https"),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) })
});
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("subscribe"), token: z.string().optional(), subscription: Subscription }),
  z.object({ action: z.literal("unsubscribe"), endpoint: z.string().url().max(1000) })
]);

const MAX_DEVICES = 10;

/**
 * Registers this device for notifications. A parent is identified by their
 * link token or session; staff by their session.
 */
export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const svc = createServiceClient();
  if (b.action === "unsubscribe") {
    await svc.from("push_subscriptions").delete().eq("endpoint", b.endpoint);
    return NextResponse.json({ ok: true });
  }

  let tenantId: string, userId: string | null = null, guardianId: string | null = null;
  if (b.token) {
    const who = await identifyGuardian(svc, b.token, async () => null);
    if ("error" in who) return jsonError(who.error, who.status);
    tenantId = who.tenantId; guardianId = who.guardianId;
  } else {
    const ctx = await getCtx();
    if (!ctx || ctx.tenant.status !== "active") return jsonError("unauthenticated", 401);
    tenantId = ctx.tenant.id; userId = ctx.userId;
    const who = await identifyGuardian(svc, null, sessionIdentity);
    if (!("error" in who)) guardianId = who.guardianId;
  }

  const { error } = await svc.from("push_subscriptions").upsert({
    tenant_id: tenantId, user_id: userId, guardian_id: guardianId, endpoint: b.subscription.endpoint,
    p256dh: b.subscription.keys.p256dh, auth: b.subscription.keys.auth, user_agent: req.headers.get("user-agent")?.slice(0, 200) ?? null
  }, { onConflict: "endpoint" });
  if (error) return jsonError(error.message);

  // Keep the newest few devices per person.
  const owner = guardianId ? ["guardian_id", guardianId] : ["user_id", userId!];
  const { data: subs } = await svc.from("push_subscriptions").select("id").eq(owner[0], owner[1]).order("created_at", { ascending: false });
  const extra = (subs ?? []).slice(MAX_DEVICES).map((s: { id: string }) => s.id);
  if (extra.length) await svc.from("push_subscriptions").delete().in("id", extra);
  return NextResponse.json({ ok: true }, { status: 201 });
}
