import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { buildIcs } from "@/lib/crm";

export const dynamic = "force-dynamic";

/** Calendar file for a booked visit (Add to calendar). */
export async function GET(_req: NextRequest, props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  if (!/^[0-9a-f]{32}$/i.test(token)) return new NextResponse("not found", { status: 404 });
  const svc = createServiceClient();
  const { data: b } = await svc.from("admission_bookings").select("id,tenant_id,status,admission_events(title,starts_at,ends_at,location,details),tenants(name)").eq("token", token).maybeSingle();
  if (!b || b.status === "cancelled") return new NextResponse("not found", { status: 404 });
  const e: any = b.admission_events;
  const { data: s } = await svc.from("tenant_settings").select("school_name").eq("tenant_id", b.tenant_id).maybeSingle();
  const school = s?.school_name ?? (b as any).tenants?.name ?? "School";
  const ics = buildIcs({ uid: b.id, title: `${e.title}: ${school}`, starts_at: e.starts_at, ends_at: e.ends_at, location: e.location, details: e.details, organizer: school });
  return new NextResponse(ics, { headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `attachment; filename="visit.ics"` } });
}
