import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { dispatchDue, requeueStale } from "@/lib/messaging/outbox";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Outbox worker. Call every minute from a scheduler (Vercel Cron, GitHub
 * Actions, cron + curl, Supabase pg_cron + pg_net) with:
 *   Authorization: Bearer $CRON_SECRET
 */
async function run(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const svc = createServiceClient();
  await requeueStale(svc);
  const stats = await dispatchDue(svc, { budgetMs: 45_000, limit: 100, concurrency: 10 });
  return NextResponse.json({ ok: true, ...stats });
}

export const GET = run;
export const POST = run;
