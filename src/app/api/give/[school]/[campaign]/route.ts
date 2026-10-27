import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { jsonError, readJson } from "@/lib/auth";
import { tenantForEnquiry } from "@/lib/admissions";
import { appUrl } from "@/lib/school";
import { startDonation } from "@/lib/collections-server";

export const dynamic = "force-dynamic";

async function load(school: string, slug: string) {
  const svc = createServiceClient();
  const t = await tenantForEnquiry(svc, school);
  if (!t || !/^[a-z0-9][a-z0-9-]{1,60}$/.test(slug)) return null;
  const { data: c } = await svc.from("fundraising_campaigns").select("*").eq("tenant_id", t.tenant.id).eq("slug", slug).maybeSingle();
  if (!c || c.status === "draft") return null;
  return { svc, t, c };
}

/** The public giving page (phase 14g-2): the appeal, progress and recent donors (as the school allows). */
export async function GET(_req: NextRequest, props: { params: Promise<{ school: string; campaign: string }> }) {
  const { school, campaign } = await props.params;
  const r = await load(school, campaign);
  if (!r) return jsonError("not found", 404);
  const { svc, t, c } = r;
  const [{ data: totals }, { data: recent }, { data: s }] = await Promise.all([
    svc.rpc("campaign_totals", { p_campaign: c.id }),
    c.show_donors ? svc.from("donations").select("donor_name,anonymous,message,paid_at").eq("campaign_id", c.id).eq("status", "paid").order("paid_at", { ascending: false }).limit(20) : Promise.resolve({ data: [] }),
    svc.from("tenant_settings").select("currency,payment_provider").eq("tenant_id", t.tenant.id).maybeSingle()
  ]);
  const tot = (totals ?? [])[0] ?? { raised: 0, donors: 0 };
  const open = c.status === "open" && (!c.ends_on || c.ends_on >= new Date().toISOString().slice(0, 10));
  return NextResponse.json({
    school: { name: t.settings.school_name ?? t.tenant.name, logo_url: t.settings.logo_url ?? null, brand_color: t.settings.brand_color ?? null },
    campaign: { title: c.title, purpose: c.purpose, goal: c.show_raised ? c.goal : null, ends_on: c.ends_on, cover_url: c.cover_url, open },
    raised: c.show_raised ? Number(tot.raised) : null, donors: c.show_raised ? Number(tot.donors) : null, currency: s?.currency ?? "NGN",
    online: Boolean(s?.payment_provider),
    recent: (recent ?? []).map((d: any) => ({ name: d.anonymous ? "Anonymous" : d.donor_name, message: d.message, at: d.paid_at }))
  }, { headers: { "Cache-Control": "no-store" } });
}

const Body = z.object({ name: z.string().trim().min(2).max(160), email: z.string().trim().email(), phone: z.string().trim().max(30).nullish(),
  amount: z.number().min(100).max(1e10), anonymous: z.boolean().default(false), message: z.string().trim().max(1000).nullish(), website: z.string().max(0).optional() });

/** Starts an online gift and returns the payment page to go to. */
export async function POST(req: NextRequest, props: { params: Promise<{ school: string; campaign: string }> }) {
  const { school, campaign } = await props.params;
  const r = await load(school, campaign);
  if (!r) return jsonError("not found", 404);
  if (r.c.status !== "open" || (r.c.ends_on && r.c.ends_on < new Date().toISOString().slice(0, 10))) return jsonError("This appeal has closed. Thank you for thinking of us.");
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError("Please give your name, email and the amount (at least 100).");
  try {
    const out = await startDonation(r.svc, { tenantId: r.t.tenant.id, campaign: r.c, name: parsed.data.name, email: parsed.data.email, phone: parsed.data.phone ?? null,
      amount: parsed.data.amount, anonymous: parsed.data.anonymous, message: parsed.data.message ?? null, base: appUrl(req), schoolSlug: school });
    return NextResponse.json(out);
  } catch (e) { return jsonError((e as Error).message); }
}
