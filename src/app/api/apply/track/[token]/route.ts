import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { jsonError, readJson } from "@/lib/auth";
import { startAdmissionPayment, syncLeadFromApplication } from "@/lib/admissions-crm";
import { providerConfigured, type Provider } from "@/lib/payments";
import { appUrl } from "@/lib/school";

const DECISION: Record<string, string> = {
  offered: "Offered a place", accepted: "Offered a place (accepted)", enrolled: "Admitted", waitlisted: "On the waiting list",
  rejected: "Not offered a place this time", interview: "Invited to an interview"
};

/**
 * Where and when the entrance test is, the sittings a family can choose from, and the
 * result once the school releases it (phase 14e). Read separately so the page still works
 * on a database without migration 20260101006200.
 */
async function entranceDetails(svc: any, a: any) {
  const [{ data: attempts }, { data: app }] = await Promise.all([
    svc.from("entrance_attempts").select("id,status,sitting_id,absent").eq("application_id", a.id),
    svc.from("applications").select("entrance_plan_id,composite_score,merit_rank").eq("id", a.id).maybeSingle()
  ]);
  if (!attempts && !app) return null;
  const { data: plan } = app?.entrance_plan_id ? await svc.from("entrance_plans").select("id,where_mode,release_at,show_scores,status").eq("id", app.entrance_plan_id).maybeSingle() : { data: null };
  const ids = [...new Set((attempts ?? []).map((t: any) => t.sitting_id).filter(Boolean))];
  const { data: booked } = ids.length ? await svc.from("entrance_sittings").select("id,kind,centre,address,starts_at,ends_at").in("id", ids) : { data: [] };
  let choices: any[] = [];
  const open = (attempts ?? []).find((t: any) => t.status === "assigned");
  if (plan?.where_mode === "choice" && open) {
    const { data: all } = await svc.from("entrance_sittings").select("id,kind,centre,address,starts_at,ends_at,seats").eq("plan_id", plan.id).gt("starts_at", new Date(Date.now() + 2 * 3_600_000).toISOString()).order("starts_at").limit(50);
    const { data: taken } = (all ?? []).length ? await svc.from("entrance_attempts").select("sitting_id").in("sitting_id", (all ?? []).map((x: any) => x.id)) : { data: [] };
    const used = new Map<string, number>();
    for (const t of taken ?? []) used.set(t.sitting_id, (used.get(t.sitting_id) ?? 0) + 1);
    choices = (all ?? []).filter((x: any) => x.seats === null || (used.get(x.id) ?? 0) < x.seats || x.id === open.sitting_id)
      .map((x: any) => ({ id: x.id, kind: x.kind, centre: x.centre, address: x.address, starts_at: x.starts_at, ends_at: x.ends_at, chosen: x.id === open.sitting_id }));
  }
  const released = plan && (!plan.release_at || new Date(plan.release_at) <= new Date());
  const result = released && DECISION[a.status] ? { decision: DECISION[a.status], score: plan.show_scores && app?.composite_score !== null && app?.composite_score !== undefined ? Number(app.composite_score) : null } : null;
  return {
    sittings: Object.fromEntries((booked ?? []).map((x: any) => [x.id, x])),
    attempts: Object.fromEntries((attempts ?? []).map((t: any) => [t.id, { sitting_id: t.sitting_id, absent: t.absent }])),
    choices, result, attempt_to_book: open && plan?.where_mode === "choice" ? open.id : null
  };
}

export const dynamic = "force-dynamic";

async function load(token: string) {
  if (!/^[0-9a-f]{24,64}$/i.test(token)) return null;
  const svc = createServiceClient();
  const { data: a } = await svc.from("applications")
    .select("id,application_no,status,first_name,last_name,applying_for,assessment_at,interview_at,offer_expires_on,decision_note,fee_paid,acceptance_fee,acceptance_paid,offer_letter,offer_accepted_at,waitlist_position,created_at,tenant_id,lead_id,tenants(name,status),application_documents(id,kind,name,size,uploaded_at),entrance_attempts(id,token,status,opens_at,closes_at,exams(title,duration_minutes))")
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
  const extra = await entranceDetails(svc, a).catch(() => null);
  return NextResponse.json({
    application: { ...rest, has_offer: Boolean(offer_letter) && ["offered", "accepted", "enrolled"].includes(a.status) },
    documents: application_documents ?? [],
    entrance: (entrance_attempts ?? []).map((e: any) => {
      const t = extra?.attempts?.[e.id], sitting = t?.sitting_id ? extra?.sittings?.[t.sitting_id] : null;
      // A test at a centre starts there with the PIN, so no link to start it from home.
      const atCentre = sitting?.kind === "centre";
      return { token: !atCentre && (e.status === "assigned" || e.status === "in_progress") ? e.token : null, status: e.status, opens_at: e.opens_at, closes_at: e.closes_at,
        title: e.exams?.title, minutes: e.exams?.duration_minutes, absent: Boolean(t?.absent),
        centre: atCentre ? { name: sitting.centre, address: sitting.address, starts_at: sitting.starts_at, ends_at: sitting.ends_at } : null };
    }),
    sittings: extra?.choices ?? [], book_attempt: Boolean(extra?.attempt_to_book), result: extra?.result ?? null,
    school: { name: s?.school_name ?? a.tenants?.name, logo_url: s?.logo_url, brand_color: s?.brand_color, phone: s?.phone, email: s?.email },
    application_fee: Number(s?.application_fee ?? 0), currency: s?.currency ?? "NGN",
    pay_online: providerConfigured((s?.payment_provider ?? null) as Provider | null), bank_details: s?.bank_details ?? null
  }, { headers: { "Cache-Control": "no-store" } });
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("pay"), kind: z.enum(["application_fee", "acceptance_fee"]), email: z.string().trim().email().nullish() }),
  z.object({ action: z.literal("decline_offer"), reason: z.string().trim().max(500).nullish() }),
  z.object({ action: z.literal("withdraw"), reason: z.string().trim().max(500).nullish() }),
  z.object({ action: z.literal("choose_sitting"), sitting_id: z.string().uuid() })
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
    if (b.action === "choose_sitting") {
      const extra = await entranceDetails(svc, a);
      const attempt = extra?.attempt_to_book;
      if (!attempt || !(extra?.choices ?? []).some((c: any) => c.id === b.sitting_id)) return jsonError("That date is no longer available. Please choose another.", 409);
      const { data: ok } = await svc.rpc("entrance_book_sitting", { p_attempt: attempt, p_sitting: b.sitting_id });
      if (!ok) return jsonError("That date has just filled up. Please choose another.", 409);
      return NextResponse.json({ ok: true });
    }
    if (b.action === "decline_offer" && a.status !== "offered") return jsonError("there is no open offer to decline");
    if (b.action === "withdraw" && ["enrolled", "withdrawn", "rejected"].includes(a.status)) return jsonError(`this application is already ${a.status}`);
    const status = b.action === "decline_offer" ? "declined" : "withdrawn";
    const { data: app } = await svc.from("applications").update({ status, decision_note: b.reason ? `Family: ${b.reason}` : null, updated_at: new Date().toISOString() }).eq("id", a.id).select("*").single();
    await syncLeadFromApplication(svc, app);
    return NextResponse.json({ ok: true, status });
  } catch (e) { return jsonError((e as Error).message); }
}
