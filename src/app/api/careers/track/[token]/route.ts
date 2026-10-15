import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { readJson } from "@/lib/auth";

export const dynamic = "force-dynamic";

const SHOWN: Record<string, string> = { applied: "Received", shortlisted: "Shortlisted", interview: "Interview", offer: "Offer made", hired: "Hired", rejected: "Not taken forward", withdrawn: "Withdrawn" };

async function find(token: string) {
  if (!/^[0-9a-f]{36}$/.test(token)) return null;
  const svc = createServiceClient();
  const { data } = await svc.from("job_applications").select("id,tenant_id,full_name,stage,created_at,job_postings(title),job_interviews(scheduled_at,duration_min,mode,location,status)")
    .eq("track_token", token).maybeSingle();
  return data ? { svc, a: data as any } : null;
}

/** A candidate's view of their application: where it stands and any interview booked. */
export async function GET(_req: NextRequest, props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  const r = await find(token);
  if (!r) return NextResponse.json({ error: "not found" }, { status: 404 });
  const { a, svc } = r;
  const [{ data: s }, { data: t }] = await Promise.all([
    svc.from("tenant_settings").select("school_name,logo_url,brand_color").eq("tenant_id", a.tenant_id).maybeSingle(),
    svc.from("tenants").select("name,timezone").eq("id", a.tenant_id).maybeSingle()
  ]);
  const upcoming = (a.job_interviews ?? []).filter((i: any) => i.status === "scheduled" && Date.parse(i.scheduled_at) > Date.now() - 3_600_000)
    .sort((x: any, y: any) => x.scheduled_at.localeCompare(y.scheduled_at));
  return NextResponse.json({
    school: { name: s?.school_name ?? t?.name ?? "", logo_url: s?.logo_url ?? null, brand_color: s?.brand_color ?? null }, timezone: t?.timezone ?? "Africa/Lagos",
    name: a.full_name, title: a.job_postings?.title ?? "", applied_on: a.created_at, stage: SHOWN[a.stage] ?? a.stage,
    can_withdraw: !["hired", "rejected", "withdrawn"].includes(a.stage),
    interviews: upcoming.map((i: any) => ({ at: i.scheduled_at, duration_min: i.duration_min, mode: i.mode, location: i.mode === "video" || i.mode === "in_person" ? i.location : null }))
  });
}

/** The candidate withdraws. */
export async function POST(req: NextRequest, props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  const body = (await readJson(req)) as { action?: string } | null;
  if (body?.action !== "withdraw") return NextResponse.json({ error: "unknown action" }, { status: 400 });
  const r = await find(token);
  if (!r) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (["hired", "rejected", "withdrawn"].includes(r.a.stage)) return NextResponse.json({ error: "this application is closed" }, { status: 400 });
  await r.svc.from("job_applications").update({ stage: "withdrawn", stage_changed_at: new Date().toISOString() }).eq("id", r.a.id);
  await r.svc.from("job_interviews").update({ status: "cancelled" }).eq("application_id", r.a.id).eq("status", "scheduled");
  return NextResponse.json({ ok: true });
}
