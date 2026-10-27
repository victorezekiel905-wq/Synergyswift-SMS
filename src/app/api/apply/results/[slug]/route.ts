import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { jsonError, readJson } from "@/lib/auth";
import { clientIp } from "@/lib/net";
import { tenantForEnquiry } from "@/lib/admissions";

export const dynamic = "force-dynamic";

const MAX_TRIES = 20; // per computer in 15 minutes

const SHOWN: Record<string, string> = {
  offered: "Offered a place. Check your email or WhatsApp for the offer letter.", accepted: "Offered a place, and the offer has been accepted.",
  enrolled: "Admitted.", waitlisted: "On the waiting list.", rejected: "Not offered a place this time.", interview: "Invited to an interview. Check your messages for the time.",
  declined: "The offer was declined.", expired: "The offer has expired.", withdrawn: "The application was withdrawn."
};

/** School name and colours for the results checker page. */
export async function GET(_req: NextRequest, props: { params: Promise<{ slug: string }> }) {
  const t = await tenantForEnquiry(createServiceClient(), (await props.params).slug);
  if (!t) return jsonError("not found", 404);
  return NextResponse.json({ school: { name: t.settings.school_name ?? t.tenant.name, logo_url: t.settings.logo_url ?? null, brand_color: t.settings.brand_color ?? null } });
}

/**
 * Entrance results checker (phase 14e): application number + the child's surname. Shows
 * the decision only once the school has released results for that intake; never shows the
 * family's private link. Tries are counted per computer.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ slug: string }> }) {
  const svc = createServiceClient();
  const t = await tenantForEnquiry(svc, (await props.params).slug);
  if (!t) return jsonError("not found", 404);
  const parsed = z.object({ application_no: z.string().trim().min(3).max(40), surname: z.string().trim().min(1).max(60) }).safeParse(await readJson(req));
  if (!parsed.success) return jsonError("Type the application number and the child's surname.");
  const ip = clientIp(req.headers) ?? "unknown";
  const { count } = await svc.from("entrance_lookups").select("id", { count: "exact", head: true }).eq("ip", ip).eq("kind", "results").gte("at", new Date(Date.now() - 15 * 60_000).toISOString());
  if ((count ?? 0) >= MAX_TRIES) return jsonError("Too many tries. Please wait 15 minutes.", 429);
  await svc.from("entrance_lookups").insert({ ip, kind: "results", ok: false });

  const { data: a } = await svc.from("applications").select("id,status,first_name,last_name,applying_for,entrance_plan_id,composite_score")
    .eq("tenant_id", t.tenant.id).ilike("application_no", parsed.data.application_no).maybeSingle();
  if (!a || a.last_name.trim().toLowerCase() !== parsed.data.surname.trim().toLowerCase()) return jsonError("No application matches those details. Check the application number on your messages.", 404);
  const { data: plan } = a.entrance_plan_id ? await svc.from("entrance_plans").select("release_at,show_scores").eq("id", a.entrance_plan_id).maybeSingle() : { data: null };
  const released = !plan || !plan.release_at || new Date(plan.release_at) <= new Date();
  const decided = Boolean(SHOWN[a.status]);
  return NextResponse.json({
    child: a.first_name, level: a.applying_for,
    result: released && decided ? SHOWN[a.status] : null,
    waiting: !released ? `Results for ${a.applying_for} will be released on ${new Date(plan!.release_at).toLocaleDateString("en-GB", { dateStyle: "long" })}.`
      : decided ? null : "There is no decision yet. You will hear from the school as soon as there is.",
    score: released && plan?.show_scores && a.composite_score !== null ? Number(a.composite_score) : null
  });
}
