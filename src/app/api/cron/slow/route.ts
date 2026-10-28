import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { appUrl } from "@/lib/school";
import { runBilling } from "@/lib/saas-server";
import { runAccountAutomation } from "@/lib/accounts-server";
import { runEntranceAutomation } from "@/lib/entrance-server";
import { takeCronLock, releaseCronLock } from "@/lib/cron-lock";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The slower scheduled jobs, every 5 minutes in their own request so the
 * every-minute dispatcher stays quick with many schools (20,000-user report,
 * finding 5): Synergy Swift billing, new students' and parents' sign-ins,
 * and entrance-test automation. Messages they queue go out on the
 * dispatcher's next run. Started by the dispatcher (Authorization: Bearer $CRON_SECRET).
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const svc = createServiceClient();
  const lock = await takeCronLock(svc, "slow", 290);
  if (lock.skip) return NextResponse.json({ skipped: "previous run still going" });
  const base = appUrl(req);
  try {
    // Synergy Swift billing: renewals, overdue and paused schools, cancellations, module end dates.
    const billing = await runBilling(svc).catch(() => null);
    // New students get sign-ins (sent to their parents); new parents get invited.
    const accounts = await runAccountAutomation(svc, base).catch(() => null);
    // Entrance tests: seats, PINs, reminders, absences and decisions.
    const entrance = await runEntranceAutomation(svc, base).catch(() => null);
    return NextResponse.json({ billing, accounts, entrance });
  } finally {
    await releaseCronLock(svc, "slow", lock.run);
  }
}
