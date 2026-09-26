import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { emailConfigured, whatsappConfigured, smsConfigured } from "@/lib/messaging/providers";
import { pushConfigured } from "@/lib/messaging/push";

export const dynamic = "force-dynamic";

/**
 * Health check for uptime monitors (UptimeRobot, Better Stack, Pingdom).
 * Public: { ok } only, 503 when the database is unreachable.
 * With "Authorization: Bearer $CRON_SECRET": message queue depth, oldest
 * waiting message and which providers are configured.
 */
export async function GET(req: NextRequest) {
  const started = Date.now();
  const svc = createServiceClient();
  const { error } = await svc.from("tenants").select("id", { head: true, count: "exact" }).limit(1);
  const ok = !error;
  const body: Record<string, unknown> = { ok, time: new Date().toISOString(), db_ms: Date.now() - started };
  const secret = process.env.CRON_SECRET;
  if (ok && secret && req.headers.get("authorization") === `Bearer ${secret}`) {
    const hourAgo = new Date(Date.now() - 3600_000).toISOString();
    const [{ count: queued }, { data: oldest }, { count: failed }] = await Promise.all([
      svc.from("message_outbox").select("id", { head: true, count: "exact" }).eq("status", "queued"),
      svc.from("message_outbox").select("created_at").eq("status", "queued").order("created_at").limit(1),
      svc.from("message_outbox").select("id", { head: true, count: "exact" }).eq("status", "failed").gte("created_at", hourAgo)
    ]);
    body.queue = {
      queued: queued ?? 0, failed_last_hour: failed ?? 0,
      oldest_queued_seconds: oldest?.[0] ? Math.round((Date.now() - new Date(oldest[0].created_at).getTime()) / 1000) : 0
    };
    body.providers = { email: emailConfigured(), whatsapp: whatsappConfigured(), sms: smsConfigured(), push: pushConfigured() };
  }
  return NextResponse.json(body, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
