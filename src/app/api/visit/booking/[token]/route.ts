import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { jsonError } from "@/lib/auth";

export const dynamic = "force-dynamic";

async function load(token: string) {
  if (!/^[0-9a-f]{32}$/i.test(token)) return null;
  const svc = createServiceClient();
  const { data } = await svc.from("admission_bookings").select("id,tenant_id,lead_id,name,party_size,status,admission_events(title,kind,starts_at,ends_at,location,details),tenants(name,status)")
    .eq("token", token).maybeSingle();
  if (!data || (data as any).tenants?.status !== "active") return null;
  return { svc, b: data as any };
}

/** A family's own booking (from the confirmation message). */
export async function GET(_req: NextRequest, props: { params: Promise<{ token: string }> }) {
  const r = await load((await props.params).token);
  if (!r) return jsonError("booking not found", 404);
  const { data: s } = await r.svc.from("tenant_settings").select("school_name,logo_url,brand_color,phone,address").eq("tenant_id", r.b.tenant_id).maybeSingle();
  return NextResponse.json({ booking: { name: r.b.name, party_size: r.b.party_size, status: r.b.status, event: r.b.admission_events },
    school: { name: s?.school_name ?? r.b.tenants?.name, logo_url: s?.logo_url ?? null, brand_color: s?.brand_color ?? null, phone: s?.phone ?? null, address: s?.address ?? null } });
}

/** Cancel the booking. */
export async function POST(_req: NextRequest, props: { params: Promise<{ token: string }> }) {
  const r = await load((await props.params).token);
  if (!r) return jsonError("booking not found", 404);
  if (r.b.status !== "booked") return jsonError(`this booking is already ${r.b.status.replace("_", " ")}`);
  await r.svc.from("admission_bookings").update({ status: "cancelled" }).eq("id", r.b.id);
  if (r.b.lead_id) await r.svc.from("lead_activities").insert({ tenant_id: r.b.tenant_id, lead_id: r.b.lead_id, kind: "system", body: `Family cancelled their booking for ${r.b.admission_events?.title}.` });
  return NextResponse.json({ ok: true });
}
