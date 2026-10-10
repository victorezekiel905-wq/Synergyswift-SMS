import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { jsonError, readJson } from "@/lib/auth";
import { syncLeadFromApplication, letterHash } from "@/lib/admissions-crm";
import { enqueue, staffRows } from "@/lib/messaging/outbox";
import { clientIp } from "@/lib/net";
import { appUrl } from "@/lib/school";

export const dynamic = "force-dynamic";

async function load(token: string) {
  if (!/^[0-9a-f]{24,64}$/i.test(token)) return null;
  const svc = createServiceClient();
  const { data: a } = await svc.from("applications").select("*,tenants(name,status)").eq("tracking_token", token).maybeSingle();
  if (!a || a.tenants?.status !== "active" || !a.offer_letter) return null;
  return { svc, a };
}

/** The offer letter, with its signature once signed. */
export async function GET(_req: NextRequest, props: { params: Promise<{ token: string }> }) {
  const r = await load((await props.params).token);
  if (!r) return jsonError("no offer letter found", 404);
  const { svc, a } = r;
  const { data: s } = await svc.from("tenant_settings").select("school_name,logo_url,brand_color,address,phone,email,principal_signature_url,stamp_url,currency").eq("tenant_id", a.tenant_id).maybeSingle();
  const expired = a.status === "expired" || (a.status === "offered" && a.offer_expires_on && a.offer_expires_on < new Date().toISOString().slice(0, 10));
  return NextResponse.json({
    letter: a.offer_letter, status: a.status, expired, accepted_at: a.offer_accepted_at, signer_name: a.offer_signer_name, signature: a.offer_signature,
    letter_hash: letterHash(a.offer_letter), acceptance_fee: Number(a.acceptance_fee ?? 0), acceptance_paid: a.acceptance_paid, currency: s?.currency ?? "NGN",
    child: `${a.first_name} ${a.last_name}`, application_no: a.application_no,
    school: { name: s?.school_name ?? a.tenants?.name, logo_url: s?.logo_url, brand_color: s?.brand_color, address: s?.address, phone: s?.phone, email: s?.email,
      principal_signature_url: s?.principal_signature_url, stamp_url: s?.stamp_url }
  }, { headers: { "Cache-Control": "no-store" } });
}

const Body = z.object({
  signer_name: z.string().trim().min(3).max(120),
  signature: z.string().max(300_000).regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/, "draw your signature"),
  letter_hash: z.string().regex(/^[0-9a-f]{64}$/),
  agree: z.literal(true, { errorMap: () => ({ message: "tick the box to accept the terms of the offer" }) })
});

/**
 * Electronic acceptance: the parent types their name and draws a signature.
 * We record the letter's fingerprint, time, IP address and browser, so the
 * school can show exactly what was accepted, by whom and when.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ token: string }> }) {
  const r = await load((await props.params).token);
  if (!r) return jsonError("no offer letter found", 404);
  const { svc, a } = r;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => i.message).join("; "));
  const b = parsed.data;
  if (a.status !== "offered") return jsonError(a.status === "accepted" ? "this offer has already been accepted" : "this offer is no longer open");
  if (a.offer_expires_on && a.offer_expires_on < new Date().toISOString().slice(0, 10)) return jsonError("this offer has expired; please contact the school");
  const hash = letterHash(a.offer_letter);
  if (b.letter_hash !== hash) return jsonError("the letter has changed since you opened it; please reload the page and read it again", 409);
  const meta = { ip: clientIp(req.headers), user_agent: req.headers.get("user-agent")?.slice(0, 300) ?? null, letter_hash: hash };
  const { data: app, error } = await svc.from("applications").update({ status: "accepted", offer_accepted_at: new Date().toISOString(), offer_signer_name: b.signer_name,
    offer_signature: b.signature, offer_sign_meta: meta, updated_at: new Date().toISOString() }).eq("id", a.id).eq("status", "offered").select("*").single();
  if (error || !app) return jsonError("could not record the acceptance; please try again");
  await syncLeadFromApplication(svc, app);
  if (app.lead_id) await svc.from("lead_activities").insert({ tenant_id: app.tenant_id, lead_id: app.lead_id, kind: "system", body: `Offer accepted and signed online by ${b.signer_name}.`, meta });
  // Tell the family's admissions owner.
  const { data: lead } = app.lead_id ? await svc.from("admission_leads").select("owner_id").eq("id", app.lead_id).maybeSingle() : { data: null };
  if (lead?.owner_id) {
    const rows = await staffRows(svc, { tenantId: app.tenant_id, userIds: [lead.owner_id], kind: "admissions_lead", subject: `Offer accepted: ${app.first_name} ${app.last_name}`,
      text: `${b.signer_name} signed the offer for ${app.first_name} (${app.applying_for}).${Number(app.acceptance_fee) > 0 && !app.acceptance_paid ? " The acceptance fee is not paid yet." : ""}`,
      url: `${appUrl(req)}/school/admissions?lead=${app.lead_id}`, refId: app.lead_id });
    if (rows.length) await enqueue(svc, rows);
  }
  return NextResponse.json({ ok: true, acceptance_fee_due: Number(app.acceptance_fee) > 0 && !app.acceptance_paid });
}
