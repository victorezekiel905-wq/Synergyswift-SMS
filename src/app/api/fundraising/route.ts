import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { appUrl } from "@/lib/school";
import { slugify } from "@/lib/collections";
import { notifyContact, money } from "@/lib/notify";
import { admissionNote } from "@/lib/messaging/notices";

export const dynamic = "force-dynamic";

const FINANCE = ROLES.finance;

/** Fundraising (phase 14g-2): appeals with totals, gifts and pledges; ?campaign=<id> lists its gifts. */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(FINANCE, "community");
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  const svc = createServiceClient();
  const id = new URL(req.url).searchParams.get("campaign");
  const [{ data: campaigns, error }, { data: tenant }, { data: s }] = await Promise.all([
    ctx.sb.from("fundraising_campaigns").select("*").eq("tenant_id", tid).order("created_at", { ascending: false }),
    ctx.sb.from("tenants").select("public_slug").eq("id", tid).maybeSingle(),
    ctx.sb.from("tenant_settings").select("currency").eq("tenant_id", tid).maybeSingle()
  ]);
  if (error) return jsonError(error.message.includes("fundraising") ? "Fundraising needs the database update (migration 20260101006500)." : error.message);
  const totals = await Promise.all((campaigns ?? []).map(async (c: any) => {
    const { data } = await svc.rpc("campaign_totals", { p_campaign: c.id });
    const t = (data ?? [])[0] ?? { raised: 0, pledged: 0, donors: 0 };
    return { ...c, raised: Number(t.raised), pledged: Number(t.pledged), donors: Number(t.donors),
      public_url: tenant?.public_slug ? `${appUrl(req)}/give/${tenant.public_slug}/${c.slug}` : null };
  }));
  const out: Record<string, unknown> = { campaigns: totals, currency: s?.currency ?? "NGN", has_public_address: Boolean(tenant?.public_slug) };
  if (id) {
    const { data: gifts } = await ctx.sb.from("donations").select("*").eq("tenant_id", tid).eq("campaign_id", id).order("created_at", { ascending: false }).limit(2000);
    out.gifts = gifts ?? [];
  }
  return NextResponse.json(out);
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save_campaign"), id: z.string().uuid().nullish(), title: z.string().trim().min(2).max(160), purpose: z.string().trim().max(4000).nullish(),
    goal: z.number().positive().max(1e12).nullish(), starts_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(), ends_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
    status: z.enum(["draft", "open", "closed"]), show_donors: z.boolean().default(true), show_raised: z.boolean().default(true), cover_url: z.string().trim().url().max(500).nullish().or(z.literal("")) }),
  z.object({ action: z.literal("record"), campaign_id: z.string().uuid(), donor_name: z.string().trim().min(1).max(160), email: z.string().trim().email().nullish().or(z.literal("")),
    phone: z.string().trim().max(30).nullish(), amount: z.number().positive().max(1e12), kind: z.enum(["gift", "pledge"]), method: z.enum(["cash", "transfer", "cheque", "pos"]),
    anonymous: z.boolean().default(false), message: z.string().trim().max(1000).nullish(), pledge_due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(), thank: z.boolean().default(true) }),
  z.object({ action: z.literal("mark_paid"), id: z.string().uuid(), method: z.enum(["cash", "transfer", "cheque", "pos"]) }),
  z.object({ action: z.literal("cancel"), id: z.string().uuid() })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(FINANCE, "community");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  const svc = createServiceClient();
  const receipt = async () => (await svc.rpc("next_doc_no", { p_tenant: tid, p_kind: "don" })).data as string;
  const thank = async (d: any) => {
    const { data: c } = await ctx.sb.from("fundraising_campaigns").select("title").eq("id", d.campaign_id).maybeSingle();
    return notifyContact(svc, { tenantId: tid, name: d.donor_name, email: d.email, phone: d.phone, kind: "donation", refId: d.id,
      build: br => admissionNote(br, { name: d.donor_name, subject: d.kind === "pledge" && d.status === "pledged" ? `Thank you for your pledge to ${c?.title ?? "the school"}` : `Thank you for supporting ${c?.title ?? "the school"}`,
        lines: [d.status === "pledged" ? `Thank you for pledging ${money(Number(d.amount), d.currency)}${d.pledge_due ? ` by ${d.pledge_due}` : ""}.` : `We have received your gift of ${money(Number(d.amount), d.currency)}. Thank you.`,
          ...(d.receipt_no ? [`Receipt ${d.receipt_no}.`] : [])] }) }).catch(() => 0);
  };
  switch (b.action) {
    case "save_campaign": {
      const { action: _a, id, ...row } = b;
      if (row.starts_on && row.ends_on && row.ends_on < row.starts_on) return jsonError("The appeal must end after it starts.");
      const values = { ...row, purpose: row.purpose ?? null, goal: row.goal ?? null, starts_on: row.starts_on ?? null, ends_on: row.ends_on ?? null, cover_url: row.cover_url || null };
      if (id) {
        const { data, error } = await ctx.sb.from("fundraising_campaigns").update(values).eq("tenant_id", tid).eq("id", id).select("*").single();
        return error ? jsonError(error.message) : NextResponse.json({ ok: true, campaign: data });
      }
      let slug = slugify(row.title);
      const { data: taken } = await ctx.sb.from("fundraising_campaigns").select("id").eq("tenant_id", tid).eq("slug", slug).maybeSingle();
      if (taken) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
      const { data, error } = await ctx.sb.from("fundraising_campaigns").insert({ ...values, tenant_id: tid, slug, created_by: ctx.userId }).select("*").single();
      return error ? jsonError(error.message) : NextResponse.json({ ok: true, campaign: data });
    }
    case "record": {
      const { data: s } = await ctx.sb.from("tenant_settings").select("currency").eq("tenant_id", tid).maybeSingle();
      const paid = b.kind === "gift";
      const { data, error } = await ctx.sb.from("donations").insert({ tenant_id: tid, campaign_id: b.campaign_id, donor_name: b.donor_name, email: b.email || null, phone: b.phone ?? null,
        amount: b.amount, currency: s?.currency ?? "NGN", kind: b.kind, status: paid ? "paid" : "pledged", method: b.method, anonymous: b.anonymous, message: b.message ?? null,
        pledge_due: b.pledge_due ?? null, paid_at: paid ? new Date().toISOString() : null, receipt_no: paid ? await receipt() : null, created_by: ctx.userId }).select("*").single();
      if (error) return jsonError(error.message);
      if (b.thank && (data.email || data.phone)) await thank(data);
      return NextResponse.json({ ok: true, donation: data });
    }
    case "mark_paid": {
      const { data, error } = await ctx.sb.from("donations").update({ status: "paid", method: b.method, paid_at: new Date().toISOString(), receipt_no: await receipt() })
        .eq("tenant_id", tid).eq("id", b.id).eq("status", "pledged").select("*").maybeSingle();
      if (error) return jsonError(error.message);
      if (!data) return jsonError("Only a pledge can be marked as paid.");
      if (data.email || data.phone) await thank(data);
      return NextResponse.json({ ok: true });
    }
    case "cancel": {
      const { error } = await ctx.sb.from("donations").update({ status: "cancelled" }).eq("tenant_id", tid).eq("id", b.id).in("status", ["pledged"]);
      return error ? jsonError(error.message) : NextResponse.json({ ok: true });
    }
  }
}
