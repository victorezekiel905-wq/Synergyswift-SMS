import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { jsonError, readJson } from "@/lib/auth";
import { startAdmissionPayment, syncLeadFromApplication } from "@/lib/admissions-crm";
import { providerConfigured, type Provider } from "@/lib/payments";
import { appUrl } from "@/lib/school";

export const dynamic = "force-dynamic";

async function load(token: string) {
  if (!/^[0-9a-f]{24,64}$/i.test(token)) return null;
  const svc = createServiceClient();
  const { data: a } = await svc.from("applications")
    .select("id,application_no,status,first_name,last_name,applying_for,assessment_at,interview_at,offer_expires_on,decision_note,fee_paid,acceptance_fee,acceptance_paid,offer_letter,offer_accepted_at,waitlist_position,created_at,tenant_id,lead_id,tenants(name,status),application_documents(id,kind,name,size,uploaded_at),entrance_attempts(token,status,opens_at,closes_at,exams(title,duration_minutes))")
    .eq("tracking_token", token).maybeSingle();
  if (!a || (a as any).tenants?.status !== "active") return null;
  return { svc, a: a as any };
}

/** The family's private application page: status, documents, fees, offer and entrance tests. */
export async function GET(_req: NextRequest, props: { params: Promise<{ token: string }> }) {
  const r = await load((await props.params).token);
  if (!r) return jsonError("not found", 404);
  const { svc, a } = r;
  const { data: s } = await svc.from("tenant_settings").select("school_name,logo_url,brand_color,phone,email,application_fee,currency,payment_provider,bank_details").eq("tenant_id", a.tenant_id).maybeSingle();
  const { tenant_id: _t, tenants: _x, id: _i, lead_id: _l, offer_letter, entrance_attempts, application_documents, ...rest } = a;
  return NextResponse.json({
    application: { ...rest, has_offer: Boolean(offer_letter) && ["offered", "accepted", "enrolled"].includes(a.status) },
    documents: application_documents ?? [],
    entrance: (entrance_attempts ?? []).map((e: any) => ({ token: e.status === "assigned" || e.status === "in_progress" ? e.token : null, status: e.status, opens_at: e.opens_at, closes_at: e.closes_at, title: e.exams?.title, minutes: e.exams?.duration_minutes })),
    school: { name: s?.school_name ?? a.tenants?.name, logo_url: s?.logo_url, brand_color: s?.brand_color, phone: s?.phone, email: s?.email },
    application_fee: Number(s?.application_fee ?? 0), currency: s?.currency ?? "NGN",
    pay_online: providerConfigured((s?.payment_provider ?? null) as Provider | null), bank_details: s?.bank_details ?? null
  }, { headers: { "Cache-Control": "no-store" } });
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("pay"), kind: z.enum(["application_fee", "acceptance_fee"]), email: z.string().trim().email().nullish() }),
  z.object({ action: z.literal("decline_offer"), reason: z.string().trim().max(500).nullish() }),
  z.object({ action: z.literal("withdraw"), reason: z.string().trim().max(500).nullish() })
]);

export async function POST(req: NextRequest, props: { params: Promise<{ token: string }> }) {
  const token = (await props.params).token;
  const r = await load(token);
  if (!r) return jsonError("not found", 404);
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError("invalid request");
  const b = parsed.data;
  const { svc, a } = r;
  try {
    if (b.action === "pay") return NextResponse.json(await startAdmissionPayment(svc, { trackingToken: token, kind: b.kind, email: b.email ?? null, baseUrl: appUrl(req) }));
    if (b.action === "decline_offer" && a.status !== "offered") return jsonError("there is no open offer to decline");
    if (b.action === "withdraw" && ["enrolled", "withdrawn", "rejected"].includes(a.status)) return jsonError(`this application is already ${a.status}`);
    const status = b.action === "decline_offer" ? "declined" : "withdrawn";
    const { data: app } = await svc.from("applications").update({ status, decision_note: b.reason ? `Family: ${b.reason}` : null, updated_at: new Date().toISOString() }).eq("id", a.id).select("*").single();
    await syncLeadFromApplication(svc, app);
    return NextResponse.json({ ok: true, status });
  } catch (e) { return jsonError((e as Error).message); }
}
