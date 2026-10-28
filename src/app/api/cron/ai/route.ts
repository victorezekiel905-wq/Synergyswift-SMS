import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { aiConfigured } from "@/lib/ai";
import { runSalesAutopilot } from "@/lib/sales-ai";
import { runAdmissionsAutopilot } from "@/lib/admissions-ai";
import { sendEmail } from "@/lib/messaging/providers";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The AI jobs (phase 14p), in their own request so they never slow the
 * every-minute dispatcher: the sales manager's follow-up drafts and Monday
 * summary, and each school's admissions assistant. The dispatcher starts this
 * every 10 minutes (Authorization: Bearer $CRON_SECRET).
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!aiConfigured()) return NextResponse.json({ skipped: "no AI key" });
  const svc = createServiceClient();
  // One run at a time: a run that overlaps the next one would draft twice.
  const { data: lock } = await svc.from("platform_settings").select("value").eq("key", "cron.ai").maybeSingle();
  const busyUntil = (lock?.value as { until?: string } | null)?.until;
  if (busyUntil && Date.parse(busyUntil) > Date.now()) return NextResponse.json({ skipped: "running" });
  await svc.from("platform_settings").upsert({ key: "cron.ai", value: { until: new Date(Date.now() + 280_000).toISOString() }, updated_at: new Date().toISOString() });
  try {
    const sales = await runSalesAutopilot(svc, { budgetMs: 90_000, send: (to, subject, text) => sendEmail({ to, subject, text }) }).catch(e => ({ error: (e as Error).message }));
    const admissions = await runAdmissionsAutopilot(svc, { budgetMs: 150_000 }).catch(e => ({ error: (e as Error).message }));
    return NextResponse.json({ sales, admissions });
  } finally {
    await svc.from("platform_settings").upsert({ key: "cron.ai", value: { until: null, at: new Date().toISOString() }, updated_at: new Date().toISOString() });
  }
}
