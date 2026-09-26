import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";
import { toCsv } from "@/lib/school";

/**
 * Expenses, stock and assets.
 * GET ?view=expenses|cashbook|inventory|moves|assets  (&format=csv for expenses and cashbook)
 */
export async function GET(req: NextRequest) {
  const u = new URL(req.url);
  const view = u.searchParams.get("view") ?? "expenses";
  const staffViews = ["inventory", "assets"];
  const ctx = await requireCtx(staffViews.includes(view) ? ROLES.staff : ROLES.finance, view === "expenses" || view === "cashbook" ? "fees" : "inventory");
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id;
  const from = u.searchParams.get("from") ?? new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10);
  const to = u.searchParams.get("to") ?? new Date().toISOString().slice(0, 10);

  if (view === "expenses" || view === "cashbook") {
    const { data: expenses } = await ctx.sb.from("expenses").select("*").eq("tenant_id", tid).gte("spent_on", from).lte("spent_on", to).order("spent_on", { ascending: false }).limit(5000);
    if (view === "expenses") {
      if (u.searchParams.get("format") === "csv") {
        return csv("expenses.csv", [["Date", "Category", "Description", "Payee", "Method", "Reference", "Amount"],
          ...(expenses ?? []).map((e: any) => [e.spent_on, e.category, e.description, e.payee, e.method, e.reference, e.amount])]);
      }
      return NextResponse.json(expenses ?? []);
    }
    // Cashbook: fee receipts in, expenses out, running balance.
    const { data: pays } = await ctx.sb.from("fee_payments").select("amount,method,receipt_no,paid_at,payer_name,students(first_name,last_name)")
      .eq("tenant_id", tid).eq("status", "success").gte("paid_at", `${from}T00:00:00Z`).lte("paid_at", `${to}T23:59:59Z`).limit(20000);
    const entries = [
      ...(pays ?? []).map((p: any) => ({ date: String(p.paid_at).slice(0, 10), kind: "in", description: `Fees ${p.receipt_no ?? ""} ${p.students?.first_name ?? ""} ${p.students?.last_name ?? ""}`.trim(), method: p.method, amount: Number(p.amount) })),
      ...(expenses ?? []).map((e: any) => ({ date: e.spent_on, kind: "out", description: `${e.category}: ${e.description}`, method: e.method, amount: Number(e.amount) }))
    ].sort((a, b) => a.date.localeCompare(b.date));
    let bal = 0;
    const rows = entries.map(e => { bal += e.kind === "in" ? e.amount : -e.amount; return { ...e, balance: Math.round(bal * 100) / 100 }; });
    if (u.searchParams.get("format") === "csv") {
      return csv("cashbook.csv", [["Date", "In/Out", "Description", "Method", "Amount", "Balance"], ...rows.map(r => [r.date, r.kind, r.description, r.method, r.amount, r.balance])]);
    }
    const income = rows.filter(r => r.kind === "in").reduce((a, r) => a + r.amount, 0);
    const spent = rows.filter(r => r.kind === "out").reduce((a, r) => a + r.amount, 0);
    return NextResponse.json({ from, to, income, spent, net: income - spent, rows: rows.reverse() });
  }
  if (view === "inventory") {
    const { data } = await ctx.sb.from("inventory_items").select("*").eq("tenant_id", tid).order("name");
    return NextResponse.json(data ?? []);
  }
  if (view === "moves") {
    const { data } = await ctx.sb.from("inventory_moves").select("*,inventory_items(name,unit)").eq("tenant_id", tid).order("at", { ascending: false }).limit(300);
    return NextResponse.json(data ?? []);
  }
  const { data } = await ctx.sb.from("assets").select("*,staff(full_name)").eq("tenant_id", tid).order("tag");
  return NextResponse.json(data ?? []);
}

function csv(name: string, rows: unknown[][]) {
  return new NextResponse("﻿" + toCsv(rows as (string | number | null)[][]), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"` } });
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add_expense"), category: z.string().trim().min(1).max(60), description: z.string().trim().min(1).max(200), amount: z.number().positive().max(1e10),
    spent_on: date, payee: z.string().trim().max(120).nullish(), method: z.string().trim().max(30).nullish(), reference: z.string().trim().max(80).nullish(), requisition_id: z.string().uuid().nullish() }),
  z.object({ action: z.literal("delete_expense"), id: z.string().uuid() }),
  z.object({ action: z.literal("save_item"), id: z.string().uuid().optional(), name: z.string().trim().min(1).max(120), sku: z.string().trim().max(40).nullish(), category: z.string().trim().max(60).nullish(),
    unit: z.string().trim().max(20).default("pcs"), reorder_level: z.number().min(0).max(1e9).default(0), unit_cost: z.number().min(0).max(1e10).default(0), location: z.string().trim().max(80).nullish() }),
  z.object({ action: z.literal("move"), item_id: z.string().uuid(), kind: z.enum(["in", "out", "adjust"]), quantity: z.number().min(0).max(1e9), reason: z.string().trim().max(200).nullish(), reference: z.string().trim().max(80).nullish() }),
  z.object({ action: z.literal("save_asset"), id: z.string().uuid().optional(), tag: z.string().trim().min(1).max(40), name: z.string().trim().min(1).max(120), category: z.string().trim().max(60).nullish(),
    location: z.string().trim().max(80).nullish(), assigned_staff: z.string().uuid().nullish(), condition: z.enum(["new", "good", "fair", "poor", "broken"]).default("good"),
    status: z.enum(["in_use", "in_store", "repair", "retired", "lost"]).default("in_use"), purchase_date: date.nullish(), cost: z.number().min(0).max(1e10).nullish(), notes: z.string().trim().max(500).nullish() })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.finance);
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  const sb = ctx.sb;
  switch (b.action) {
    case "add_expense": {
      const { action: _a, ...row } = b;
      const { data, error } = await sb.from("expenses").insert({ ...row, tenant_id: tid, recorded_by: ctx.userId }).select("id").single();
      return error ? jsonError(error.message) : NextResponse.json(data, { status: 201 });
    }
    case "delete_expense": {
      const { error } = await sb.from("expenses").delete().eq("tenant_id", tid).eq("id", b.id);
      return error ? jsonError(error.message) : NextResponse.json({ ok: true });
    }
    case "save_item": {
      const { action: _a, id, ...row } = b;
      const { data, error } = id ? await sb.from("inventory_items").update(row).eq("tenant_id", tid).eq("id", id).select("id").single()
        : await sb.from("inventory_items").insert({ ...row, tenant_id: tid }).select("id").single();
      return error ? jsonError(error.message.includes("duplicate") ? "an item with that name exists" : error.message) : NextResponse.json(data);
    }
    case "move": {
      const { data, error } = await sb.rpc("inventory_move", { p_item: b.item_id, p_kind: b.kind, p_qty: b.quantity, p_reason: b.reason ?? null, p_ref: b.reference ?? null });
      return error ? jsonError(error.message) : NextResponse.json({ quantity: data });
    }
    case "save_asset": {
      const { action: _a, id, ...row } = b;
      const { data, error } = id ? await sb.from("assets").update(row).eq("tenant_id", tid).eq("id", id).select("id").single()
        : await sb.from("assets").insert({ ...row, tenant_id: tid }).select("id").single();
      return error ? jsonError(error.message.includes("duplicate") ? "that asset tag is already used" : error.message) : NextResponse.json(data);
    }
  }
}
