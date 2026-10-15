import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { buildCalendar, feedOwner } from "@/lib/calendar-server";
import { toIcs } from "@/lib/calendar";
import { localParts, addDays } from "@/lib/attendance";
import { appUrl } from "@/lib/school";

export const dynamic = "force-dynamic";

/**
 * The private calendar feed that Google Calendar, Outlook and phones
 * subscribe to: the last month and the next six (weekly lessons for the next six weeks).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const svc = createServiceClient();
  const owner = await feedOwner(svc, token.replace(/\.ics$/i, ""));
  if (!owner) return new Response("This calendar link is no longer valid. Make a new one in the app.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  const today = localParts(new Date(), owner.timezone).date;
  const who = { tenantId: owner.tenantId, timezone: owner.timezone, userId: owner.userId, roles: owner.roles };
  const [soon, later] = await Promise.all([
    buildCalendar(svc, who, addDays(today, -30), addDays(today, 42)),
    buildCalendar(svc, who, addDays(today, 43), addDays(today, 183))
  ]);
  const host = new URL(appUrl(req)).host;
  return new Response(toIcs([...soon, ...later], { name: `${owner.school}`, uidDomain: host }), {
    headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": "inline; filename=\"school.ics\"", "Cache-Control": "private, max-age=900" }
  });
}
