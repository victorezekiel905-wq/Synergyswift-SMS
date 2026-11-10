import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, hasAny, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { financeSettings } from "@/lib/fees";
import { appUrl, startOfTodayIso } from "@/lib/school";
import { sell, latestScan, shopEvents, ShopError } from "@/lib/tuck-shop-server";
import { sellRefusal } from "@/lib/tuck-shop";

export const dynamic = "force-dynamic";

const SETTINGS = "shop_purchases_per_day,shop_gap_minutes,shop_code_windows,shop_daily_cap,shop_require_code,shop_notify_each_purchase,shop_parent_topup";
const WINDOWS = /^\s*(\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}\s*)(,\s*\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}\s*)*$/;

/**
 * The tuck shop (migration 9700), for sellers and admins.
 *   GET                         items, today's takings, shop fingerprint machines, the rules
 *   GET ?view=scan&device=&since=  the fingerprint read at that machine since the till asked
 *   GET ?view=activity          everything that happened at the shop (sales, refusals, codes, top-ups)
 *   GET ?view=stock             items with stock and the latest stock changes
 */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.till, "wallet");
  if (ctx instanceof NextResponse) return ctx;
  const u = new URL(req.url).searchParams;
  const tid = ctx.tenant.id;
  const svc = createServiceClient();
  const view = u.get("view");
  try {
    if (view === "scan") {
      const device = u.get("device") ?? "", since = u.get("since") ?? new Date(Date.now() - 60_000).toISOString();
      if (!/^[0-9a-f-]{36}$/.test(device)) return jsonError("choose the shop's fingerprint machine");
      return NextResponse.json({ scan: await latestScan(svc, { tenantId: tid, deviceId: device, since }) });
    }
    if (view === "activity") return NextResponse.json({ events: await shopEvents(svc, { tenantId: tid, limit: 200 }) });
    if (view === "stock") {
      const [{ data: items }, { data: moves }] = await Promise.all([
        svc.from("shop_items").select("id,name,category,price,active,stock,stock_alert").eq("tenant_id", tid).order("category").order("name"),
        svc.from("shop_stock_moves").select("id,item_id,change,reason,note,created_at,users:by_user(full_name)").eq("tenant_id", tid).order("created_at", { ascending: false }).limit(100)
      ]);
      return NextResponse.json({ items: items ?? [], moves: (moves ?? []).map((m: any) => ({ ...m, by: m.users?.full_name ?? null })) });
    }
    const today = startOfTodayIso(ctx.tenant.timezone);
    const [{ currency }, { data: items }, { data: devices }, { data: settings }, { data: sales }] = await Promise.all([
      financeSettings(svc, tid),
      svc.from("shop_items").select("id,name,price,category,active,stock,stock_alert,barcode").eq("tenant_id", tid).eq("active", true).order("category").order("name"),
      svc.from("attendance_devices").select("id,name,location,last_seen_at").eq("tenant_id", tid).eq("mode", "shop").eq("active", true).order("name"),
      svc.from("tenant_settings").select(SETTINGS).eq("tenant_id", tid).maybeSingle(),
      svc.from("wallet_transactions").select("amount,kind").eq("tenant_id", tid).eq("status", "success").eq("kind", "purchase").gte("created_at", today).limit(5000)
    ]);
    return NextResponse.json({
      currency, timezone: ctx.tenant.timezone, items: items ?? [], devices: devices ?? [], settings: settings ?? {},
      can_settings: hasAny(ctx, ROLES.admin), can_credit: hasAny(ctx, ROLES.admin),
      today: { sales: (sales ?? []).length, takings: (sales ?? []).reduce((a: number, s: any) => a - Number(s.amount), 0) }
    });
  } catch (e) {
    return jsonError((e as Error).message, e instanceof ShopError ? e.status : 400);
  }
}

const Item = z.object({ id: z.string().uuid(), qty: z.number().int().min(1).max(50) });
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("sell"), items: z.array(Item).max(40).default([]), amount: z.number().positive().max(1_000_000).nullish(),
    method: z.enum(["code", "fingerprint", "card"]), code: z.string().trim().max(8).nullish(), scan_id: z.string().uuid().nullish(), student_id: z.string().uuid().nullish() }),
  z.object({ action: z.literal("save_item"), id: z.string().uuid().optional(), name: z.string().trim().min(1).max(80), price: z.number().min(0).max(1_000_000),
    category: z.string().trim().max(40).nullish(), active: z.boolean().default(true), stock: z.number().int().min(0).max(1_000_000).nullable(), stock_alert: z.number().int().min(0).max(100_000).nullable() }),
  z.object({ action: z.literal("stock"), item_id: z.string().uuid(), change: z.number().int().min(-100_000).max(100_000), reason: z.enum(["restock", "count", "damaged"]), note: z.string().trim().max(200).nullish() }),
  z.object({ action: z.literal("settings"), purchases_per_day: z.number().int().min(1).max(20), gap_minutes: z.number().int().min(0).max(600),
    code_windows: z.string().trim().max(200), daily_cap: z.number().min(0).max(10_000_000).nullable(), require_code: z.boolean(), notify_each_purchase: z.boolean(), parent_topup: z.boolean() })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.till, "wallet");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  const svc = createServiceClient();
  try {
    if (b.action === "sell") {
      if (b.method === "code" && !b.code) return jsonError("Type the student's buy code.");
      if (b.method === "fingerprint" && !b.scan_id) return jsonError("Ask the student to scan their finger.");
      if (b.method === "card" && !b.student_id) return jsonError("Scan the student's ID card.");
      const r = await sell(svc, { tenantId: tid, operator: ctx.userId, items: b.items, amount: b.amount ?? null, method: b.method, code: b.code ?? null,
        scanId: b.scan_id ?? null, studentId: b.student_id ?? null, baseUrl: appUrl(req) });
      if (!r.ok) {
        const { currency } = await financeSettings(svc, tid);
        let name: string | null = null;
        if (r.refusal.student_id) {
          const { data: s } = await svc.from("students").select("first_name,last_name").eq("id", r.refusal.student_id).maybeSingle();
          name = s ? `${s.first_name} ${s.last_name}` : null;
        }
        return NextResponse.json({ error: sellRefusal(r.refusal, { currency, timeZone: ctx.tenant.timezone, name }), reason: r.refusal.error }, { status: 409 });
      }
      return NextResponse.json({ ok: true, ...r.sale });
    }
    if (b.action === "save_item") {
      const row = { tenant_id: tid, name: b.name, price: b.price, category: b.category || null, active: b.active, stock: b.stock, stock_alert: b.stock_alert };
      const { data: before } = b.id ? await svc.from("shop_items").select("stock").eq("tenant_id", tid).eq("id", b.id).maybeSingle() : { data: null };
      const { data, error } = b.id
        ? await svc.from("shop_items").update(row).eq("tenant_id", tid).eq("id", b.id).select("id").maybeSingle()
        : await svc.from("shop_items").insert(row).select("id").single();
      if (error) return jsonError(error.message.includes("duplicate") ? "an item with that name already exists" : error.message);
      if (!data) return jsonError("item not found", 404);
      const was = before?.stock ?? 0, now = b.stock ?? 0;
      if (b.stock !== null && now !== (b.id ? was : 0)) {
        await svc.from("shop_stock_moves").insert({ tenant_id: tid, item_id: data.id, change: now - (b.id ? was : 0), reason: b.id ? "count" : "restock", note: b.id ? "Stock set on the item" : "Opening stock", by_user: ctx.userId });
      }
      return NextResponse.json({ ok: true, id: data.id });
    }
    if (b.action === "stock") {
      const { data: it } = await svc.from("shop_items").select("id,name,stock,stock_alert").eq("tenant_id", tid).eq("id", b.item_id).maybeSingle();
      if (!it) return jsonError("item not found", 404);
      const next = (it.stock ?? 0) + b.change;
      if (next < 0) return jsonError(`there are only ${it.stock ?? 0} ${it.name} in stock`);
      const { error } = await svc.from("shop_items").update({ stock: next }).eq("id", it.id);
      if (error) return jsonError(error.message);
      await svc.from("shop_stock_moves").insert({ tenant_id: tid, item_id: it.id, change: b.change, reason: b.reason, note: b.note ?? null, by_user: ctx.userId });
      if (b.reason === "restock") await svc.from("shop_events").insert({ tenant_id: tid, kind: "restock", amount: null, detail: { item: it.name, change: b.change, stock: next }, operator: ctx.userId });
      return NextResponse.json({ ok: true, stock: next });
    }
    // settings: admins only
    if (!hasAny(ctx, ROLES.admin)) return jsonError("only a school admin can change the tuck shop rules", 403);
    if (b.code_windows && !WINDOWS.test(b.code_windows)) return jsonError("write the times like 10:00-10:30, 12:30-13:15 (or leave empty for any time)");
    const { error } = await svc.from("tenant_settings").upsert({ tenant_id: tid, shop_purchases_per_day: b.purchases_per_day, shop_gap_minutes: b.gap_minutes,
      shop_code_windows: b.code_windows.replace(/\s+/g, " ").trim(), shop_daily_cap: b.daily_cap, shop_require_code: b.require_code,
      shop_notify_each_purchase: b.notify_each_purchase, shop_parent_topup: b.parent_topup }, { onConflict: "tenant_id" });
    if (error) return jsonError(/shop_/.test(error.message) ? "The tuck shop needs the database update (migration 20260101009700)." : error.message);
    await svc.from("audit_logs").insert({ tenant_id: tid, actor_id: ctx.userId, action: "shop.settings", meta: b });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return jsonError((e as Error).message, e instanceof ShopError ? e.status : 400);
  }
}
