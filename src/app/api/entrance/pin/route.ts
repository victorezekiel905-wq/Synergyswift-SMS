import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { jsonError, readJson } from "@/lib/auth";
import { clientIp } from "@/lib/net";
import { absoluteRequestUrl, verifySeb } from "@/lib/exams/seb";
import { normalizePin } from "@/lib/entrance";
import { pinHash } from "@/lib/entrance-server";

export const dynamic = "force-dynamic";

const MAX_WRONG = 10; // wrong PINs per computer in 15 minutes

/**
 * Check-in at a test centre (phase 14e): the candidate types their one-time PIN on the
 * school's computer and gets their test. Only during their sitting; in Safe Exam Browser
 * when the intake asks for it. Wrong PINs are counted per computer and slowed down.
 */
export async function POST(req: NextRequest) {
  const parsed = z.object({ pin: z.string().trim().min(4).max(20) }).safeParse(await readJson(req));
  if (!parsed.success) return jsonError("Type the 8-character test PIN.");
  const svc = createServiceClient();
  const ip = clientIp(req.headers) ?? "unknown";
  const since = new Date(Date.now() - 15 * 60_000).toISOString();
  const { count } = await svc.from("entrance_lookups").select("id", { count: "exact", head: true }).eq("ip", ip).eq("kind", "pin").eq("ok", false).gte("at", since);
  if ((count ?? 0) >= MAX_WRONG) return jsonError("Too many wrong PINs on this computer. Ask a member of staff.", 429);
  const wrong = async (msg: string) => { await svc.from("entrance_lookups").insert({ ip, kind: "pin", ok: false }); return jsonError(msg, 400); };

  const pin = normalizePin(parsed.data.pin);
  if (pin.length !== 8) return wrong("That PIN is not right. It has 8 letters and numbers, like 7KQ4-M2XD.");
  const { data: at } = await svc.from("entrance_attempts").select("id,tenant_id,token,status,sitting_id,checked_in_at,pin_expires_at,application_id,exams(settings),tenants(status)")
    .eq("pin_hash", pinHash(pin)).maybeSingle();
  if (!at || (at as any).tenants?.status !== "active" || !["assigned", "in_progress"].includes(at.status) || (at.pin_expires_at && new Date(at.pin_expires_at) < new Date())) {
    return wrong("That PIN is not right, or it has expired. Ask a member of staff for a new one.");
  }
  const { data: sitting } = at.sitting_id ? await svc.from("entrance_sittings").select("kind,centre,starts_at,ends_at,plan_id").eq("id", at.sitting_id).maybeSingle() : { data: null };
  if (!sitting || sitting.kind !== "centre") return wrong("That PIN is not for a test centre.");
  const now = Date.now();
  if (now < new Date(sitting.starts_at).getTime() - 60 * 60_000) {
    return jsonError(`This PIN is for the sitting at ${new Date(sitting.starts_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}.`, 403);
  }
  if (now > new Date(sitting.ends_at).getTime()) return jsonError("This sitting has ended. Ask a member of staff.", 403);
  const { data: plan } = await svc.from("entrance_plans").select("seb_at_centre").eq("id", sitting.plan_id).maybeSingle();
  if (plan?.seb_at_centre !== false) {
    const settings = (at as any).exams?.settings ?? {};
    const check = verifySeb(absoluteRequestUrl(req), req.headers, { require_seb: true, seb_config_keys: settings.seb_config_keys, seb_browser_keys: settings.seb_browser_keys });
    if (!check.ok) return jsonError(check.reason ?? "Use the test computer: this test runs in Safe Exam Browser.", 403);
  }
  if (!at.checked_in_at) {
    await svc.from("entrance_attempts").update({ checked_in_at: new Date().toISOString() }).eq("id", at.id);
    await svc.from("entrance_events").insert({ tenant_id: at.tenant_id, attempt_id: at.id, kind: "checked_in", meta: { centre: sitting.centre } });
  }
  await svc.from("entrance_lookups").insert({ ip, kind: "pin", ok: true });
  return NextResponse.json({ token: at.token });
}
