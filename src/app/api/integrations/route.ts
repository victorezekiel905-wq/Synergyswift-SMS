import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError, hasAny } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { appUrl } from "@/lib/school";
import { SCOPES, EVENTS, newKey, safeWebhookUrl, slugify } from "@/lib/open-api";
import { emailConfigured, whatsappConfigured, smsConfigured } from "@/lib/messaging/providers";
import { pushConfigured } from "@/lib/messaging/push";
import { fcmConfigured } from "@/lib/messaging/fcm";
import { providerConfigured } from "@/lib/payments";
import { moreCreds } from "@/lib/payments-more";
import { zoomCreds } from "@/lib/zoom";

export const dynamic = "force-dynamic";
const NEWS_ROLES = [...ROLES.admin, "admissions_officer"];

/** Integrations: API keys, webhooks, website news and embeds, and which services are connected. */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(NEWS_ROLES);
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  const admin = hasAny(ctx, ROLES.admin);
  const svc = createServiceClient();
  const [{ data: news }, { data: events }, { data: tenant }] = await Promise.all([
    ctx.sb.from("news_posts").select("id,title,slug,summary,body,image_url,status,published_at,updated_at").eq("tenant_id", tid).order("updated_at", { ascending: false }).limit(100),
    ctx.sb.from("school_events").select("id,title,starts_at,show_on_website").eq("tenant_id", tid).gte("starts_at", new Date(Date.now() - 86400_000).toISOString()).order("starts_at").limit(100),
    svc.from("tenants").select("public_slug").eq("id", tid).maybeSingle()
  ]);
  const base = appUrl(req);
  const out: Record<string, unknown> = { base, slug: tenant?.public_slug ?? null, news: news ?? [], events: events ?? [], admin };
  if (!admin) return NextResponse.json(out);
  const [{ data: keys }, { data: endpoints }, { data: deliveries }, remita, stripe, zoom] = await Promise.all([
    ctx.sb.from("api_keys").select("id,name,prefix,scopes,created_at,last_used_at,expires_at,revoked_at").eq("tenant_id", tid).order("created_at", { ascending: false }),
    ctx.sb.from("webhook_endpoints").select("id,url,description,events,secret,active,failures,last_status,last_delivered_at,created_at").eq("tenant_id", tid).order("created_at"),
    ctx.sb.from("webhook_deliveries").select("id,endpoint_id,event,status,attempts,response_code,last_error,created_at,delivered_at").eq("tenant_id", tid).order("created_at", { ascending: false }).limit(50),
    moreCreds(svc, tid, "remita").catch(() => null), moreCreds(svc, tid, "stripe").catch(() => null), zoomCreds(svc, tid).catch(() => null)
  ]);
  return NextResponse.json({
    ...out, scopes: SCOPES, events_list: EVENTS, keys: keys ?? [], endpoints: endpoints ?? [], deliveries: deliveries ?? [],
    services: [
      { name: "Paystack", area: "Payments", on: providerConfigured("paystack") }, { name: "Flutterwave", area: "Payments", on: providerConfigured("flutterwave") },
      { name: "Remita", area: "Payments", on: Boolean(remita) }, { name: "Stripe", area: "Payments", on: Boolean(stripe) },
      { name: "SMS (Termii or Twilio)", area: "Messaging", on: smsConfigured() }, { name: "WhatsApp Business (Meta or Twilio)", area: "Messaging", on: whatsappConfigured() },
      { name: "Email", area: "Messaging", on: emailConfigured() }, { name: "App notifications (web)", area: "Messaging", on: pushConfigured() },
      { name: "App notifications (Android/iPhone)", area: "Messaging", on: fcmConfigured() }, { name: "Zoom", area: "Lessons", on: Boolean(zoom) }
    ]
  });
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create_key"), name: z.string().trim().min(1).max(80), scopes: z.array(z.string()).min(1).max(20), expires_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish() }),
  z.object({ action: z.literal("revoke_key"), id: z.string().uuid() }),
  z.object({ action: z.literal("add_endpoint"), url: z.string().trim().max(500), description: z.string().trim().max(200).nullish(), events: z.array(z.string()).min(1).max(20) }),
  z.object({ action: z.literal("update_endpoint"), id: z.string().uuid(), events: z.array(z.string()).min(1).max(20).optional(), active: z.boolean().optional() }),
  z.object({ action: z.literal("rotate_secret"), id: z.string().uuid() }),
  z.object({ action: z.literal("delete_endpoint"), id: z.string().uuid() }),
  z.object({ action: z.literal("test_endpoint"), id: z.string().uuid() }),
  z.object({ action: z.literal("retry_delivery"), id: z.string().uuid() }),
  z.object({ action: z.literal("save_news"), id: z.string().uuid().nullish(), title: z.string().trim().min(2).max(160), slug: z.string().trim().max(80).nullish(), summary: z.string().trim().max(400).nullish(),
    body: z.string().max(50000).default(""), image_url: z.string().trim().url().startsWith("https://").nullish().or(z.literal("")), status: z.enum(["draft", "published"]) }),
  z.object({ action: z.literal("delete_news"), id: z.string().uuid() }),
  z.object({ action: z.literal("event_on_website"), id: z.string().uuid(), show: z.boolean() })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(NEWS_ROLES);
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  const svc = createServiceClient();
  const done = (r: { error: any }, extra: Record<string, unknown> = {}) => r.error ? jsonError(r.error.message) : NextResponse.json({ ok: true, ...extra });

  if (b.action === "save_news") {
    const row = { title: b.title, slug: slugify(b.slug || b.title), summary: b.summary || null, body: b.body, image_url: b.image_url || null, status: b.status, author_id: ctx.userId };
    const r = b.id ? await ctx.sb.from("news_posts").update(row).eq("tenant_id", tid).eq("id", b.id) : await ctx.sb.from("news_posts").insert({ ...row, tenant_id: tid });
    if (r.error?.message.includes("duplicate")) return jsonError("Another post already uses that web address; change the title or slug.");
    return done(r);
  }
  if (b.action === "delete_news") return done(await ctx.sb.from("news_posts").delete().eq("tenant_id", tid).eq("id", b.id));
  if (b.action === "event_on_website") return done(await ctx.sb.from("school_events").update({ show_on_website: b.show }).eq("tenant_id", tid).eq("id", b.id));

  if (!hasAny(ctx, ROLES.admin)) return jsonError("forbidden", 403);
  switch (b.action) {
    case "create_key": {
      const allowed = new Set<string>(SCOPES.map(s => s.id));
      if (b.scopes.some(s => !allowed.has(s))) return jsonError("unknown scope");
      const k = newKey();
      const r = await ctx.sb.from("api_keys").insert({ tenant_id: tid, name: b.name, prefix: k.prefix, key_hash: k.hash, scopes: b.scopes, created_by: ctx.userId,
        expires_at: b.expires_on ? new Date(`${b.expires_on}T23:59:59Z`).toISOString() : null });
      return done(r, { key: k.key });
    }
    case "revoke_key": return done(await ctx.sb.from("api_keys").update({ revoked_at: new Date().toISOString() }).eq("tenant_id", tid).eq("id", b.id).is("revoked_at", null));
    case "add_endpoint": {
      const bad = safeWebhookUrl(b.url);
      if (bad) return jsonError(`Webhook address: ${bad}.`);
      if (b.events.some(e => e !== "*" && !(EVENTS as readonly string[]).includes(e))) return jsonError("unknown event");
      return done(await ctx.sb.from("webhook_endpoints").insert({ tenant_id: tid, url: b.url, description: b.description ?? null, events: b.events, created_by: ctx.userId }));
    }
    case "update_endpoint": {
      const patch: Record<string, unknown> = {};
      if (b.events) patch.events = b.events;
      if (b.active !== undefined) { patch.active = b.active; if (b.active) patch.failures = 0; }
      return done(await ctx.sb.from("webhook_endpoints").update(patch).eq("tenant_id", tid).eq("id", b.id));
    }
    case "rotate_secret": {
      const secret = [...crypto.getRandomValues(new Uint8Array(24))].map(x => x.toString(16).padStart(2, "0")).join("");
      return done(await ctx.sb.from("webhook_endpoints").update({ secret }).eq("tenant_id", tid).eq("id", b.id));
    }
    case "delete_endpoint": return done(await ctx.sb.from("webhook_endpoints").delete().eq("tenant_id", tid).eq("id", b.id));
    case "test_endpoint": {
      const { data: ep } = await ctx.sb.from("webhook_endpoints").select("id").eq("tenant_id", tid).eq("id", b.id).maybeSingle();
      if (!ep) return jsonError("not found", 404);
      return done(await svc.from("webhook_deliveries").insert({ tenant_id: tid, endpoint_id: ep.id, event: "test",
        payload: { id: crypto.randomUUID(), event: "test", created_at: new Date().toISOString(), data: { message: "Test from Synergy Swift" } } }), { note: "Sent within a minute." });
    }
    case "retry_delivery": {
      const { data: d } = await ctx.sb.from("webhook_deliveries").select("id").eq("tenant_id", tid).eq("id", b.id).maybeSingle();
      if (!d) return jsonError("not found", 404);
      return done(await svc.from("webhook_deliveries").update({ status: "queued", next_attempt_at: new Date().toISOString(), attempts: 0 }).eq("id", d.id));
    }
  }
  return jsonError("unknown action");
}
