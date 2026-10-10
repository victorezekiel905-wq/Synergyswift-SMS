import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError, hasAny } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { DEFAULT_TEMPLATES, SOURCES } from "@/lib/crm";
import { randomToken } from "@/lib/crypto";
import { appUrl } from "@/lib/school";

/** Admissions setup: letters, seats per level, marketing spend, and the links and keys for capturing enquiries. */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.admissions, "admissions");
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  const base = appUrl(req);
  const [{ data: templates }, { data: capacity }, { data: costs }, { data: s }, { data: t }, { data: levels }] = await Promise.all([
    ctx.sb.from("admission_templates").select("kind,subject,body,updated_at").eq("tenant_id", tid),
    ctx.sb.from("admission_capacity").select("level,intake,seats").eq("tenant_id", tid).order("level"),
    ctx.sb.from("admission_costs").select("*").eq("tenant_id", tid).order("month", { ascending: false }).limit(200),
    ctx.sb.from("tenant_settings").select("acceptance_fee,offer_valid_days,admissions_whatsapp,application_fee,admissions_open,currency").eq("tenant_id", tid).maybeSingle(),
    ctx.sb.from("tenants").select("public_slug").eq("id", tid).maybeSingle(),
    ctx.sb.from("class_groups").select("level").eq("tenant_id", tid)
  ]);
  const slug = t?.public_slug ?? null;
  const tpl = (kind: keyof typeof DEFAULT_TEMPLATES) => (templates ?? []).find((x: any) => x.kind === kind) ?? { kind, ...DEFAULT_TEMPLATES[kind], updated_at: null };
  const wa = String(s?.admissions_whatsapp ?? "").replace(/[^\d]/g, "");
  const admin = hasAny(ctx, ROLES.admin);
  // The webhook key is a secret: only the server can read admission_secrets, and only admins are shown it.
  const { data: secret } = admin ? await createServiceClient().from("admission_secrets").select("lead_webhook_key").eq("tenant_id", tid).maybeSingle() : { data: null };
  return NextResponse.json({
    templates: { offer: tpl("offer"), waitlist: tpl("waitlist"), regret: tpl("regret") },
    capacity: capacity ?? [], costs: costs ?? [], levels: [...new Set((levels ?? []).map((l: any) => l.level).filter(Boolean))].sort(),
    settings: { acceptance_fee: Number(s?.acceptance_fee ?? 0), offer_valid_days: s?.offer_valid_days ?? 14, admissions_whatsapp: s?.admissions_whatsapp ?? "", currency: s?.currency ?? "NGN" },
    links: slug ? {
      enquiry: `${base}/enquire/${slug}`,
      apply: `${base}/apply/${slug}`,
      visit: `${base}/visit/${slug}`,
      embed: `<iframe src="${base}/enquire/${slug}?embed=1" style="width:100%;min-height:640px;border:0" title="Enquire"></iframe>`,
      whatsapp: wa ? `https://wa.me/${wa}?text=${encodeURIComponent("Hello, I would like to know more about admission for my child.")}` : null,
      campaign_example: `${base}/enquire/${slug}?utm_source=facebook&utm_medium=paid&utm_campaign=september-intake`
    } : null,
    // Only admins see the webhook key (it lets outside tools create leads).
    webhook: admin ? { url: secret?.lead_webhook_key ? `${base}/api/crm/webhook/${secret.lead_webhook_key}` : null } : null,
    is_admin: admin
  });
}

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("template"), kind: z.enum(["offer", "waitlist", "regret"]), subject: z.string().trim().min(2).max(160), body: z.string().trim().min(10).max(8000) }),
  z.object({ action: z.literal("capacity"), level: z.string().trim().min(1).max(60), intake: z.string().trim().max(60).default(""), seats: z.number().int().min(0).max(10000) }),
  z.object({ action: z.literal("capacity_delete"), level: z.string().max(60), intake: z.string().max(60).default("") }),
  z.object({ action: z.literal("cost"), month: z.string().regex(/^\d{4}-\d{2}$/), source: z.enum(SOURCES), campaign: z.string().trim().max(80).nullish(), amount: z.number().min(0).max(1e10), note: z.string().trim().max(200).nullish() }),
  z.object({ action: z.literal("cost_delete"), id: z.string().uuid() }),
  z.object({ action: z.literal("settings"), acceptance_fee: z.number().min(0).max(1e9), offer_valid_days: z.number().int().min(1).max(180), admissions_whatsapp: z.string().trim().max(30).nullish() }),
  z.object({ action: z.literal("webhook_key"), enabled: z.boolean() })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.admissions, "admissions");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  const done = (e: { message: string } | null) => (e ? jsonError(e.message) : NextResponse.json({ ok: true }));
  switch (b.action) {
    case "template":
      return done((await ctx.sb.from("admission_templates").upsert({ tenant_id: tid, kind: b.kind, subject: b.subject, body: b.body, updated_at: new Date().toISOString() }, { onConflict: "tenant_id,kind" })).error);
    case "capacity":
      return done((await ctx.sb.from("admission_capacity").upsert({ tenant_id: tid, level: b.level, intake: b.intake, seats: b.seats }, { onConflict: "tenant_id,level,intake" })).error);
    case "capacity_delete":
      return done((await ctx.sb.from("admission_capacity").delete().eq("tenant_id", tid).eq("level", b.level).eq("intake", b.intake)).error);
    case "cost":
      return done((await ctx.sb.from("admission_costs").insert({ tenant_id: tid, month: `${b.month}-01`, source: b.source, campaign: b.campaign ?? null, amount: b.amount, note: b.note ?? null })).error);
    case "cost_delete":
      return done((await ctx.sb.from("admission_costs").delete().eq("tenant_id", tid).eq("id", b.id)).error);
    case "settings":
    case "webhook_key": {
      if (!hasAny(ctx, ROLES.admin)) return jsonError("only school admins can change admission settings", 403);
      // tenant_settings writes are admin-only under RLS; use the service client after the role check above.
      const svc = createServiceClient();
      if (b.action === "webhook_key") {
        return done((await svc.from("admission_secrets").upsert({ tenant_id: tid, lead_webhook_key: b.enabled ? randomToken(18) : null, updated_at: new Date().toISOString() }, { onConflict: "tenant_id" })).error);
      }
      const row = { acceptance_fee: b.acceptance_fee, offer_valid_days: b.offer_valid_days, admissions_whatsapp: b.admissions_whatsapp || null };
      return done((await svc.from("tenant_settings").upsert({ tenant_id: tid, ...row }, { onConflict: "tenant_id" })).error);
    }
  }
}
