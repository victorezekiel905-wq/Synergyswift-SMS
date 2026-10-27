import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { dispatchDue, requeueStale } from "@/lib/messaging/outbox";
import { processSequences, sendBookingReminders } from "@/lib/admissions-crm";
import { escalateTickets, sendDueCampaigns } from "@/lib/community-server";
import { sendScheduledNotices } from "@/lib/notices-server";
import { escalateConcerns } from "@/lib/welfare-server";
import { alertLateReturns } from "@/lib/boarding-server";
import { notifyReadyHolds } from "@/lib/library-server";
import { alertLateTrips } from "@/lib/cocurricular-server";
import { snapshotKpis } from "@/lib/portal-server";
import { sendDueReports } from "@/lib/report-builder-server";
import { deliverWebhooks } from "@/lib/open-api-server";
import { appUrl } from "@/lib/school";
import { runBilling } from "@/lib/saas-server";

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
  // Admissions follow-ups and visit reminders queue messages, which this run then sends.
  const base = appUrl(req);
  const followUps = await processSequences(svc, { limit: 50, baseUrl: base }).catch(() => null);
  const reminders = await sendBookingReminders(svc, base).catch(() => 0);
  // Overdue complaints escalate to the admins; scheduled campaigns go out.
  const escalated = await escalateTickets(svc, base).catch(() => 0);
  const campaigns = await sendDueCampaigns(svc, base).catch(() => 0);
  const notices = await sendScheduledNotices(svc, base).catch(() => 0);
  // Safeguarding concerns nobody has picked up go to the head.
  const safeguarding = await escalateConcerns(svc, base).catch(() => 0);
  // Boarders not back from exeat on time.
  const lateReturns = await alertLateReturns(svc, base).catch(() => 0);
  // Reserved library books waiting to be collected.
  const holds = await notifyReadyHolds(svc, base).catch(() => 0);
  // School trips with children not ticked back after the planned return.
  const lateTrips = await alertLateTrips(svc, base).catch(() => 0);
  // Once a day after school: the head's numbers, kept for the trend lines.
  const kpiSnapshots = await snapshotKpis(svc).catch(() => 0);
  // Saved reports on a schedule go to the staff chosen.
  const scheduledReports = await sendDueReports(svc, base).catch(() => 0);
  // Signed webhooks to other systems, with retries.
  const webhooks = await deliverWebhooks(svc).catch(() => null);
  // Synergy Swift billing: renewals, overdue and paused schools, cancellations, module end dates.
  const billing = await runBilling(svc).catch(() => null);
  const stats = await dispatchDue(svc, { budgetMs: 40_000, limit: 100, concurrency: 10 });
  return NextResponse.json({ ok: true, ...stats, admissions_follow_ups: followUps, visit_reminders: reminders, tickets_escalated: escalated, campaigns_sent: campaigns, notices_sent: notices, safeguarding_escalated: safeguarding, late_exeat_returns: lateReturns, library_holds_ready: holds, late_trips: lateTrips, kpi_snapshots: kpiSnapshots, scheduled_reports: scheduledReports, webhooks, billing });
}

export const GET = run;
export const POST = run;
