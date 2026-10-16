import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError, hasAny } from "@/lib/auth";
import { localParts } from "@/lib/attendance";
import { reorderSuggestions, assetsDue, orderProgress } from "@/lib/procurement";

export const dynamic = "force-dynamic";

/**
 * Buying for the school: suppliers, quotes against approved requisitions, purchase orders,
 * goods received into stock or the asset register, and payment recorded as an expense.
 * GET ?view=overview|suppliers|orders|order&id=|quotes&requisition=
 */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.finance, "requisitions");
  if (ctx instanceof NextResponse) return ctx;
  const u = new URL(req.url).searchParams;
  const view = u.get("view") ?? "overview";
  const tid = ctx.tenant.id, sb = ctx.sb;

  if (view === "overview") {
    const today = localParts(new Date(), ctx.tenant.timezone).date;
    const [reqs, orders, items, assets, faults, settings] = await Promise.all([
      sb.from("requisitions").select("id,title,department,total_amount,status,needed_by,endorsed_by,requested_by,requester:users!requisitions_requested_by_fkey(full_name)").eq("tenant_id", tid).in("status", ["submitted", "endorsed", "approved"]).order("created_at"),
      sb.from("purchase_orders").select("id,po_no,status,total,expected_on,paid_at,suppliers(name)").eq("tenant_id", tid).in("status", ["draft", "sent", "partly_received"]).order("created_at", { ascending: false }),
      sb.from("inventory_items").select("id,name,variant,quantity,reorder_level,unit_cost").eq("tenant_id", tid),
      sb.from("assets").select("id,tag,name,status,next_maintenance_on,warranty_expires").eq("tenant_id", tid),
      sb.from("asset_maintenance").select("id,description,created_at,assets(tag,name)").eq("tenant_id", tid).eq("status", "reported").order("created_at"),
      sb.from("tenant_settings").select("procurement_second_approval_over").eq("tenant_id", tid).maybeSingle()
    ]);
    const { data: ordered } = await sb.from("purchase_orders").select("requisition_id").eq("tenant_id", tid).neq("status", "cancelled").not("requisition_id", "is", null);
    const hasOrder = new Set((ordered ?? []).map((o: any) => o.requisition_id));
    return NextResponse.json({
      me: ctx.userId, is_head: hasAny(ctx, ROLES.admin), limit: Number(settings.data?.procurement_second_approval_over ?? 500000),
      requisitions: (reqs.data ?? []).map((r: any) => ({ ...r, ordered: hasOrder.has(r.id) })),
      orders: orders.data ?? [], reorder: reorderSuggestions(items.data ?? []), due: assetsDue(assets.data ?? [], today), faults: faults.data ?? []
    });
  }
  if (view === "suppliers") {
    const { data } = await sb.from("suppliers").select("*").eq("tenant_id", tid).order("name");
    return NextResponse.json(data ?? []);
  }
  if (view === "orders") {
    const { data } = await sb.from("purchase_orders").select("id,po_no,status,total,ordered_on,expected_on,paid_at,created_at,suppliers(name),requisitions(title)").eq("tenant_id", tid).order("created_at", { ascending: false }).limit(300);
    return NextResponse.json(data ?? []);
  }
  if (view === "order") {
    const { data: po } = await sb.from("purchase_orders").select("*,suppliers(*),requisitions(id,title,requisition_items(description,quantity,unit_cost))").eq("tenant_id", tid).eq("id", u.get("id") ?? "").maybeSingle();
    if (!po) return jsonError("not found", 404);
    const [{ data: lines }, { data: items }] = await Promise.all([
      sb.from("purchase_order_lines").select("*,inventory_items(name,variant,unit)").eq("po_id", po.id).order("description"),
      sb.from("inventory_items").select("id,name,variant,unit").eq("tenant_id", tid).order("name")
    ]);
    return NextResponse.json({ order: po, lines: lines ?? [], progress: orderProgress(lines ?? []), items: items ?? [] });
  }
  if (view === "quotes") {
    const { data } = await sb.from("supplier_quotes").select("*,suppliers(name)").eq("tenant_id", tid).eq("requisition_id", u.get("requisition") ?? "").order("amount");
    return NextResponse.json(data ?? []);
  }
  return jsonError("unknown view", 404);
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const opt = (n: number) => z.string().trim().max(n).nullish().transform(v => v || null);
const Line = z.object({ description: z.string().trim().min(1).max(200), quantity: z.number().positive().max(1e6), unit_cost: z.number().min(0).max(1e10),
  inventory_item_id: z.string().uuid().nullish(), is_asset: z.boolean().default(false) });
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save_supplier"), id: z.string().uuid().optional(), name: z.string().trim().min(1).max(160), contact_name: opt(120), phone: opt(30), email: opt(160),
    address: opt(300), category: opt(80), tax_id: opt(40), bank_name: opt(80), account_no: opt(20), account_name: opt(120), notes: opt(1000), active: z.boolean().default(true) }),
  z.object({ action: z.literal("save_quote"), requisition_id: z.string().uuid(), supplier_id: z.string().uuid(), amount: z.number().min(0).max(1e11), delivery_days: z.number().int().min(0).max(365).nullish(), notes: opt(500) }),
  z.object({ action: z.literal("choose_quote"), id: z.string().uuid() }),
  z.object({ action: z.literal("create_order"), requisition_id: z.string().uuid().nullish(), supplier_id: z.string().uuid(), expected_on: date.nullish(), notes: opt(1000), lines: z.array(Line).max(200).optional() }),
  z.object({ action: z.literal("save_lines"), po_id: z.string().uuid(), lines: z.array(Line).min(1).max(200) }),
  z.object({ action: z.literal("order_status"), po_id: z.string().uuid(), status: z.enum(["sent", "cancelled"]) }),
  z.object({ action: z.literal("receive"), line_id: z.string().uuid(), quantity: z.number().positive().max(1e6), tags: z.array(z.string().trim().min(1).max(40)).max(500).optional() }),
  z.object({ action: z.literal("pay"), po_id: z.string().uuid(), amount: z.number().positive().max(1e11), method: z.enum(["transfer", "cash", "cheque", "pos"]), reference: opt(80), category: z.string().trim().min(1).max(60).default("Purchases") }),
  z.object({ action: z.literal("settings"), procurement_second_approval_over: z.number().min(0).max(1e12) })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.finance, "requisitions");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id, sb = ctx.sb;
  const fail = (m: string) => jsonError(m.replace(/^.*?ERROR: /, ""));

  switch (b.action) {
    case "save_supplier": {
      const { action: _a, id, ...row } = b;
      const { error } = id ? await sb.from("suppliers").update(row).eq("tenant_id", tid).eq("id", id) : await sb.from("suppliers").insert({ ...row, tenant_id: tid });
      return error ? fail(error.message.includes("duplicate") ? "a supplier with that name exists" : error.message) : NextResponse.json({ ok: true });
    }
    case "save_quote": {
      const { action: _a, ...row } = b;
      const { error } = await sb.from("supplier_quotes").upsert({ ...row, tenant_id: tid }, { onConflict: "requisition_id,supplier_id" });
      return error ? fail(error.message) : NextResponse.json({ ok: true });
    }
    case "choose_quote": {
      const { data: q } = await sb.from("supplier_quotes").select("id,requisition_id").eq("tenant_id", tid).eq("id", b.id).maybeSingle();
      if (!q) return jsonError("quote not found", 404);
      await sb.from("supplier_quotes").update({ chosen: false }).eq("requisition_id", q.requisition_id);
      const { error } = await sb.from("supplier_quotes").update({ chosen: true }).eq("id", q.id);
      return error ? fail(error.message) : NextResponse.json({ ok: true });
    }
    case "create_order": {
      let lines = b.lines ?? [];
      if (b.requisition_id) {
        const { data: r } = await sb.from("requisitions").select("id,status,requisition_items(description,quantity,unit_cost)").eq("tenant_id", tid).eq("id", b.requisition_id).maybeSingle();
        if (!r) return jsonError("requisition not found", 404);
        if (r.status !== "approved") return jsonError("only approved requisitions can be ordered");
        if (!lines.length) lines = (r.requisition_items ?? []).map((i: any) => ({ description: i.description, quantity: Number(i.quantity), unit_cost: Number(i.unit_cost), inventory_item_id: null, is_asset: false }));
      }
      const { data: po, error } = await sb.from("purchase_orders").insert({ tenant_id: tid, requisition_id: b.requisition_id ?? null, supplier_id: b.supplier_id, expected_on: b.expected_on ?? null, notes: b.notes }).select("id").single();
      if (error) return fail(error.message);
      if (lines.length) {
        const ins = await sb.from("purchase_order_lines").insert(lines.map(l => ({ ...l, inventory_item_id: l.inventory_item_id ?? null, tenant_id: tid, po_id: po.id })));
        if (ins.error) return fail(ins.error.message);
      }
      return NextResponse.json({ id: po.id }, { status: 201 });
    }
    case "save_lines": {
      const del = await sb.from("purchase_order_lines").delete().eq("tenant_id", tid).eq("po_id", b.po_id);
      if (del.error) return fail(del.error.message);
      const ins = await sb.from("purchase_order_lines").insert(b.lines.map(l => ({ ...l, inventory_item_id: l.inventory_item_id ?? null, tenant_id: tid, po_id: b.po_id })));
      return ins.error ? fail(ins.error.message) : NextResponse.json({ ok: true });
    }
    case "order_status": {
      const { data, error } = await sb.from("purchase_orders").update({ status: b.status }).eq("tenant_id", tid).eq("id", b.po_id).select("po_no").maybeSingle();
      if (error) return fail(error.message);
      return data ? NextResponse.json(data) : jsonError("not found", 404);
    }
    case "receive": {
      const { data, error } = await sb.rpc("po_receive", { p_line: b.line_id, p_qty: b.quantity, p_tags: b.tags ?? null });
      return error ? fail(error.message) : NextResponse.json({ status: data });
    }
    case "pay": {
      const { data: po } = await sb.from("purchase_orders").select("id,po_no,status,total,paid_at,suppliers(name)").eq("tenant_id", tid).eq("id", b.po_id).maybeSingle();
      if (!po) return jsonError("not found", 404);
      if (po.paid_at) return jsonError("this order has been paid");
      if (!["sent", "partly_received", "received"].includes(po.status)) return jsonError("send the order before paying it");
      const { data: exp, error } = await sb.from("expenses").insert({ tenant_id: tid, category: b.category, description: `Purchase order ${po.po_no}`, amount: b.amount,
        spent_on: localParts(new Date(), ctx.tenant.timezone).date, payee: (po.suppliers as any)?.name ?? null, method: b.method, reference: b.reference ?? po.po_no, recorded_by: ctx.userId, purchase_order_id: po.id }).select("id").single();
      if (error) return fail(error.message);
      await sb.from("purchase_orders").update({ paid_at: new Date().toISOString(), expense_id: exp.id }).eq("id", po.id);
      return NextResponse.json({ expense_id: exp.id });
    }
    case "settings": {
      const { data, error } = await sb.from("tenant_settings").update({ procurement_second_approval_over: b.procurement_second_approval_over }).eq("tenant_id", tid).select("tenant_id");
      if (error) return fail(error.message);
      return data?.length ? NextResponse.json({ ok: true }) : jsonError("only a school admin can change this", 403);
    }
  }
}
