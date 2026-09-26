import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, hasAny, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { resolvePerson } from "@/lib/gate";
import { basketTotal, maybeLowBalanceAlert, walletsForStudents, WalletError } from "@/lib/wallet";
import { financeSettings } from "@/lib/fees";
import { notifyGuardians, money } from "@/lib/notify";
import { walletTopUp } from "@/lib/messaging/notices";
import { appUrl, startOfTodayIso, studentName } from "@/lib/school";
import { newReference } from "@/lib/payments";

/**
 * Tuck shop / canteen till and wallet administration.
 *   GET                 catalogue and today's takings
 *   GET ?scan=<card>    the student on the card: photo, balance, today's spend and food allergies
 *   GET ?student=<id>   one wallet with its history
 */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.till, "wallet");
  if (ctx instanceof NextResponse) return ctx;
  const u = new URL(req.url);
  const tid = ctx.tenant.id;
  const svc = createServiceClient();
  const { currency } = await financeSettings(svc, tid);

  const scan = u.searchParams.get("scan"), sid = u.searchParams.get("student");
  if (scan || sid) {
    let studentId = sid;
    if (scan) {
      const p = await resolvePerson(svc, tid, scan);
      if (!p || p.type !== "student") return jsonError("no student found for that card", 404);
      studentId = p.id;
    }
    const { data: st } = await ctx.sb.from("students").select("id,first_name,last_name,other_names,photo_url,admission_no,class_groups(name)").eq("tenant_id", tid).eq("id", studentId).maybeSingle();
    if (!st) return jsonError("student not found", 404);
    // Only food allergies are shown at the till, for the child's safety; no other medical details.
    const { data: med } = await svc.from("medical_profiles").select("allergies").eq("tenant_id", tid).eq("student_id", st.id).maybeSingle();
    const [w] = await walletsForStudents(ctx.sb, tid, [st.id]);
    const today = startOfTodayIso(ctx.tenant.timezone);
    const spentToday = w.transactions.filter((t: any) => t.kind === "purchase" && t.created_at >= today).reduce((a: number, t: any) => a - Number(t.amount), 0);
    return NextResponse.json({
      currency, student: { id: st.id, name: studentName(st), admission_no: st.admission_no, photo_url: st.photo_url, class_name: st.class_groups?.name ?? null },
      allergies: med?.allergies ?? null, wallet: { ...w, spent_today: spentToday, has_wallet: w.balance > 0 || w.transactions.length > 0 }
    });
  }

  const today = startOfTodayIso(ctx.tenant.timezone);
  const [{ data: items }, { data: sales }] = await Promise.all([
    ctx.sb.from("shop_items").select("id,name,price,category,active").eq("tenant_id", tid).order("category").order("name"),
    ctx.sb.from("wallet_transactions").select("id,amount,kind,description,items,created_at,students(first_name,last_name,other_names)").eq("tenant_id", tid)
      .gte("created_at", today).eq("status", "success").order("created_at", { ascending: false }).limit(500)
  ]);
  const purchases = (sales ?? []).filter((s: any) => s.kind === "purchase");
  return NextResponse.json({
    currency, can_credit: hasAny(ctx, ROLES.finance), items: items ?? [],
    today: {
      takings: purchases.reduce((a: number, s: any) => a - Number(s.amount), 0), sales: purchases.length,
      topups: (sales ?? []).filter((s: any) => s.kind === "topup").reduce((a: number, s: any) => a + Number(s.amount), 0),
      recent: (sales ?? []).slice(0, 40).map((s: any) => ({ id: s.id, kind: s.kind, amount: Number(s.amount), description: s.description, items: s.items, at: s.created_at, student: studentName(s.students) }))
    }
  });
}

const Item = z.object({ id: z.string().uuid(), qty: z.number().int().min(1).max(50) });
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save_item"), id: z.string().uuid().optional(), name: z.string().trim().min(1).max(80), price: z.number().min(0).max(1_000_000),
    category: z.string().trim().max(40).nullish(), active: z.boolean().default(true) }),
  z.object({ action: z.literal("delete_item"), id: z.string().uuid() }),
  z.object({ action: z.literal("charge"), student_id: z.string().uuid(), items: z.array(Item).max(40).default([]),
    amount: z.number().positive().max(1_000_000).nullish(), description: z.string().trim().max(120).nullish() }),
  z.object({ action: z.literal("credit"), student_id: z.string().uuid(), amount: z.number().positive().max(10_000_000), kind: z.enum(["topup", "refund"]),
    method: z.enum(["cash", "transfer", "pos"]), reference: z.string().trim().max(80).nullish(), note: z.string().trim().max(200).nullish() }),
  z.object({ action: z.literal("settings"), student_id: z.string().uuid(), daily_limit: z.number().min(0).max(1_000_000).nullable(),
    low_balance_alert: z.number().min(0).max(1_000_000).nullable(), frozen: z.boolean() })
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
    switch (b.action) {
      case "save_item": {
        const row = { tenant_id: tid, name: b.name, price: b.price, category: b.category ?? null, active: b.active };
        const { error } = b.id ? await ctx.sb.from("shop_items").update(row).eq("tenant_id", tid).eq("id", b.id) : await ctx.sb.from("shop_items").insert(row);
        return error ? jsonError(error.message.includes("duplicate") ? "an item with that name already exists" : error.message) : NextResponse.json({ ok: true });
      }
      case "delete_item": {
        const { error } = await ctx.sb.from("shop_items").update({ active: false }).eq("tenant_id", tid).eq("id", b.id);
        return error ? jsonError(error.message) : NextResponse.json({ ok: true });
      }
      case "charge": {
        let lines: { id: string; name: string; qty: number; price: number }[] = [];
        let total: number;
        if (b.items.length) {
          const { data: catalogue } = await ctx.sb.from("shop_items").select("id,name,price,active").eq("tenant_id", tid).in("id", b.items.map(i => i.id));
          ({ lines, total } = basketTotal(b.items, catalogue ?? []));
        } else if (b.amount) total = Math.round(b.amount * 100) / 100;
        else return jsonError("add items or enter an amount");
        const description = b.description || (lines.length ? lines.map(l => `${l.qty}× ${l.name}`).join(", ").slice(0, 120) : "Purchase");
        const { data, error } = await ctx.sb.rpc("wallet_charge", { p_student: b.student_id, p_amount: total, p_items: lines, p_description: description, p_reference: newReference("POS") });
        if (error) return jsonError(error.message.replace(/^.*?: /, ""));
        if (data?.low) await maybeLowBalanceAlert(svc, { tenantId: tid, studentId: b.student_id, balance: Number(data.balance), baseUrl: appUrl(req) }).catch(() => undefined);
        return NextResponse.json({ ok: true, total, balance: Number(data.balance), spent_today: Number(data.spent_today) });
      }
      case "credit": {
        if (!hasAny(ctx, ROLES.finance)) return jsonError("only the bursar or an admin can add money", 403);
        const { data, error } = await ctx.sb.rpc("wallet_credit", { p_student: b.student_id, p_amount: b.amount, p_kind: b.kind, p_method: b.method,
          p_reference: b.reference || newReference(b.kind === "refund" ? "RFD" : "CASH"), p_description: b.note ?? (b.kind === "refund" ? "Refund" : "Top-up at the bursary") });
        if (error) return jsonError(error.message.includes("duplicate") ? "that reference has already been used" : error.message.replace(/^.*?: /, ""));
        const { currency } = await financeSettings(svc, tid);
        const { data: st } = await svc.from("students").select("first_name,last_name,other_names").eq("id", b.student_id).maybeSingle();
        await notifyGuardians(svc, { tenantId: tid, studentIds: [b.student_id], kind: "wallet_topup", createdBy: ctx.userId, budgetMs: 3000,
          build: (brand, g) => walletTopUp(brand, { guardianName: g.full_name, studentName: studentName(st), amount: money(b.amount, currency), balance: money(data.balance, currency) }) }).catch(() => undefined);
        await svc.from("audit_logs").insert({ tenant_id: tid, actor_id: ctx.userId, action: `wallet.${b.kind}`, target: b.student_id, meta: { amount: b.amount, method: b.method } });
        return NextResponse.json({ ok: true, balance: Number(data.balance) });
      }
      case "settings": {
        if (!hasAny(ctx, ROLES.finance)) return jsonError("only the bursar or an admin can change wallet settings", 403);
        const { data: st } = await ctx.sb.from("students").select("id").eq("tenant_id", tid).eq("id", b.student_id).maybeSingle();
        if (!st) return jsonError("student not found", 404);
        const { error } = await svc.from("wallets").upsert({ student_id: b.student_id, tenant_id: tid, daily_limit: b.daily_limit, low_balance_alert: b.low_balance_alert, frozen: b.frozen, updated_at: new Date().toISOString() }, { onConflict: "student_id" });
        return error ? jsonError(error.message) : NextResponse.json({ ok: true });
      }
    }
  } catch (e) {
    if (e instanceof WalletError) return jsonError(e.message, e.status);
    return jsonError((e as Error).message);
  }
}
