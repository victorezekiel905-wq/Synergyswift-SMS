import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { appUrl } from "@/lib/school";
import { audienceContacts, sendCampaign, campaignStats, CrmError, type Audience } from "@/lib/community-server";
import { renderCampaign, smsParts, type Block } from "@/lib/community";
import { AudienceSchema } from "@/lib/community-schemas";
import { loadBrand, enqueue, tryDispatch } from "@/lib/messaging/outbox";
import { emailConfigured, whatsappConfigured, smsConfigured } from "@/lib/messaging/providers";

export const dynamic = "force-dynamic";

/** Campaigns and newsletters with delivery numbers. */
export async function GET() {
  const ctx = await requireCtx(ROLES.admin, "community");
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  const { data, error } = await ctx.sb.from("crm_campaigns").select("*").eq("tenant_id", tid).order("created_at", { ascending: false }).limit(200);
  if (error) return jsonError(error.message);
  const svc = createServiceClient();
  const stats = await campaignStats(svc, tid, (data ?? []).filter((c: any) => c.status === "sent").map((c: any) => c.id));
  const [{ data: segments }, { data: classes }, { data: years }] = await Promise.all([
    ctx.sb.from("family_segments").select("id,name").eq("tenant_id", tid).order("name"),
    svc.from("class_groups").select("id,name").eq("tenant_id", tid).order("name"),
    svc.from("alumni").select("graduation_year").eq("tenant_id", tid).not("graduation_year", "is", null).limit(5000)
  ]);
  return NextResponse.json({
    items: (data ?? []).map((c: any) => ({ ...c, stats: stats[c.id] ?? null })),
    segments: segments ?? [], classes: classes ?? [],
    alumni_years: [...new Set((years ?? []).map((y: any) => y.graduation_year))].sort((a: any, b: any) => b - a),
    providers: { email: emailConfigured(), whatsapp: whatsappConfigured(), sms: smsConfigured() }
  });
}

const BlockSchema = z.object({
  heading: z.string().trim().max(160).nullish(), text: z.string().trim().max(4000).nullish(),
  image_url: z.string().trim().url().max(500).nullish().or(z.literal("")), link_url: z.string().trim().url().max(500).nullish().or(z.literal("")), link_label: z.string().trim().max(60).nullish()
});
const Content = {
  name: z.string().trim().min(2).max(120), kind: z.enum(["campaign", "newsletter"]).default("campaign"),
  subject: z.string().trim().min(2).max(160), body: z.string().trim().max(10000).default(""), blocks: z.array(BlockSchema).max(20).default([]),
  channels: z.array(z.enum(["email", "whatsapp", "sms"])).min(1).default(["email"]), audience: AudienceSchema
};
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), id: z.string().uuid().nullish(), ...Content }),
  z.object({ action: z.literal("preview"), audience: AudienceSchema, channels: z.array(z.enum(["email", "whatsapp", "sms"])).default(["email"]),
    kind: z.enum(["campaign", "newsletter"]).default("campaign"), subject: z.string().max(160).default(""), body: z.string().max(10000).default(""), blocks: z.array(BlockSchema).max(20).default([]) }),
  z.object({ action: z.literal("test"), id: z.string().uuid() }),
  z.object({ action: z.literal("send"), id: z.string().uuid() }),
  z.object({ action: z.literal("schedule"), id: z.string().uuid(), at: z.string().datetime({ offset: true }) }),
  z.object({ action: z.literal("cancel"), id: z.string().uuid() }),
  z.object({ action: z.literal("duplicate"), id: z.string().uuid() }),
  z.object({ action: z.literal("delete"), id: z.string().uuid() })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.admin, "community");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  const svc = createServiceClient();
  const base = appUrl(req);
  const load = async (id: string) => (await ctx.sb.from("crm_campaigns").select("*").eq("tenant_id", tid).eq("id", id).maybeSingle()).data;
  try {
    switch (b.action) {
      case "save": {
        const { action: _a, id, ...row } = b;
        const clean = { ...row, blocks: row.blocks.map(x => ({ ...x, image_url: x.image_url || null, link_url: x.link_url || null })), updated_at: new Date().toISOString() };
        if (id) {
          const { data, error } = await ctx.sb.from("crm_campaigns").update(clean).eq("tenant_id", tid).eq("id", id).in("status", ["draft", "scheduled"]).select("id").maybeSingle();
          if (error) return jsonError(error.message);
          if (!data) return jsonError("sent campaigns cannot be edited; duplicate it instead");
          return NextResponse.json({ ok: true, id });
        }
        const { data, error } = await ctx.sb.from("crm_campaigns").insert({ ...clean, tenant_id: tid, created_by: ctx.userId }).select("id").single();
        return error ? jsonError(error.message) : NextResponse.json({ ok: true, id: data.id }, { status: 201 });
      }
      case "preview": {
        const contacts = await audienceContacts(svc, tid, b.audience as Audience, { marketing: true });
        const brand = await loadBrand(svc, tid);
        const sample = renderCampaign(brand, { kind: b.kind, subject: b.subject || "Subject", body: b.body, blocks: b.blocks as Block[] }, { name: contacts[0]?.full_name ?? "Mrs Ada Obi", unsubscribeUrl: `${base}/unsubscribe/preview` });
        return NextResponse.json({
          recipients: contacts.length, with_email: contacts.filter(c => c.email).length, with_phone: contacts.filter(c => c.phone || c.whatsapp_phone).length,
          sms_parts: smsParts(`${sample.subject}: ${sample.wa.text.replace(/\*/g, "")}`), html: sample.html, whatsapp: sample.wa.text,
          names: contacts.slice(0, 8).map(c => c.full_name)
        });
      }
      case "test": {
        const c = await load(b.id);
        if (!c) return jsonError("campaign not found", 404);
        const { data: me } = await svc.from("users").select("email,full_name").eq("id", ctx.userId).maybeSingle();
        if (!me?.email) return jsonError("your account has no email address for a test");
        const brand = await loadBrand(svc, tid);
        const m = renderCampaign(brand, { kind: c.kind, subject: c.subject, body: c.body, blocks: c.blocks ?? [] }, { name: me.full_name, unsubscribeUrl: `${base}/unsubscribe/preview` });
        await enqueue(svc, [{ tenant_id: tid, channel: "email", to_address: me.email, to_name: me.full_name, kind: `${c.kind}_test`, subject: `[Test] ${m.subject}`, body_text: m.text, body_html: m.html, ref_id: null, created_by: ctx.userId }]);
        await tryDispatch(svc, { budgetMs: 6000 });
        return NextResponse.json({ ok: true, to: me.email });
      }
      case "send": {
        const r = await sendCampaign(svc, tid, b.id, base);
        await svc.from("audit_logs").insert({ tenant_id: tid, actor_id: ctx.userId, action: "campaign.sent", meta: { id: b.id, ...r } });
        return NextResponse.json({ ok: true, ...r });
      }
      case "schedule": {
        if (new Date(b.at).getTime() < Date.now() + 60_000) return jsonError("choose a time at least a minute from now");
        const { data, error } = await ctx.sb.from("crm_campaigns").update({ status: "scheduled", scheduled_at: b.at, updated_at: new Date().toISOString() })
          .eq("tenant_id", tid).eq("id", b.id).in("status", ["draft", "scheduled"]).select("id").maybeSingle();
        if (error || !data) return jsonError(error?.message ?? "only drafts can be scheduled");
        return NextResponse.json({ ok: true });
      }
      case "cancel": {
        const { data, error } = await ctx.sb.from("crm_campaigns").update({ status: "draft", scheduled_at: null, updated_at: new Date().toISOString() })
          .eq("tenant_id", tid).eq("id", b.id).eq("status", "scheduled").select("id").maybeSingle();
        if (error || !data) return jsonError(error?.message ?? "only scheduled campaigns can be cancelled");
        return NextResponse.json({ ok: true });
      }
      case "duplicate": {
        const c = await load(b.id);
        if (!c) return jsonError("campaign not found", 404);
        const { data, error } = await ctx.sb.from("crm_campaigns").insert({ tenant_id: tid, name: `${c.name} (copy)`.slice(0, 120), kind: c.kind, subject: c.subject, body: c.body, blocks: c.blocks,
          channels: c.channels, audience: c.audience, created_by: ctx.userId }).select("id").single();
        return error ? jsonError(error.message) : NextResponse.json({ ok: true, id: data.id }, { status: 201 });
      }
      case "delete": {
        const { data, error } = await ctx.sb.from("crm_campaigns").delete().eq("tenant_id", tid).eq("id", b.id).in("status", ["draft", "cancelled"]).select("id");
        if (error) return jsonError(error.message);
        if (!data?.length) return jsonError("only drafts can be deleted");
        return NextResponse.json({ ok: true });
      }
    }
  } catch (e) {
    if (e instanceof CrmError) return jsonError(e.message, e.status);
    return jsonError((e as Error).message);
  }
}
