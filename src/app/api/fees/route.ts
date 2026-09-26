import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { generateInvoices, recordManualPayment, sendFeeReminders, financeSettings } from "@/lib/fees";
import { appUrl, currentTerm, toCsv, studentName } from "@/lib/school";

/** Bursary overview: fee items, schedule for a term, and collection summary. ?format=csv exports invoices. */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.finance, "fees");
  if (ctx instanceof NextResponse) return ctx;
  const u = new URL(req.url);
  const tid = ctx.tenant.id;
  const termId = u.searchParams.get("term_id") ?? (await currentTerm(ctx.sb, tid))?.id ?? null;
  const [items, schedules, invoices, payments, expenses, settings] = await Promise.all([
    ctx.sb.from("fee_items").select("id,name,description").eq("tenant_id", tid).order("name"),
    termId ? ctx.sb.from("fee_schedules").select("id,fee_item_id,class_group_id,amount,optional").eq("tenant_id", tid).eq("term_id", termId) : { data: [] },
    termId ? ctx.sb.from("fee_invoices").select("id,status,total,amount_paid,student_id,invoice_no,title,due_date,students(first_name,last_name,other_names,admission_no,class_groups(name))")
      .eq("tenant_id", tid).eq("term_id", termId).neq("status", "void").limit(20000) : { data: [] },
    ctx.sb.from("fee_payments").select("amount,method,paid_at").eq("tenant_id", tid).eq("status", "success")
      .gte("paid_at", new Date(Date.now() - 30 * 86400_000).toISOString()).limit(20000),
    ctx.sb.from("expenses").select("amount,spent_on").eq("tenant_id", tid).gte("spent_on", new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10)),
    financeSettings(ctx.sb, tid)
  ]);
  const inv = invoices.data ?? [];
  const billed = inv.reduce((a: number, i: any) => a + Number(i.total), 0);
  const collected = inv.reduce((a: number, i: any) => a + Number(i.amount_paid), 0);

  if (u.searchParams.get("format") === "csv") {
    const rows = [["Invoice", "Admission no", "Student", "Class", "Title", "Total", "Paid", "Balance", "Status", "Due"],
      ...inv.map((i: any) => [i.invoice_no, i.students?.admission_no, studentName(i.students), i.students?.class_groups?.name, i.title,
        i.total, i.amount_paid, Number(i.total) - Number(i.amount_paid), i.status, i.due_date])];
    return new NextResponse("﻿" + toCsv(rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="fees.csv"` } });
  }

  const byMethod: Record<string, number> = {};
  for (const p of payments.data ?? []) byMethod[p.method] = (byMethod[p.method] ?? 0) + Number(p.amount);
  const byClass: Record<string, { billed: number; paid: number }> = {};
  for (const i of inv) {
    const k = i.students?.class_groups?.name ?? "No class";
    byClass[k] ??= { billed: 0, paid: 0 };
    byClass[k].billed += Number(i.total); byClass[k].paid += Number(i.amount_paid);
  }
  return NextResponse.json({
    term_id: termId, settings, items: items.data ?? [], schedules: schedules.data ?? [],
    summary: {
      invoices: inv.length, billed, collected, outstanding: billed - collected,
      collection_rate: billed ? Math.round((collected / billed) * 1000) / 10 : null,
      paid: inv.filter((i: any) => i.status === "paid").length, part_paid: inv.filter((i: any) => i.status === "part_paid").length,
      unpaid: inv.filter((i: any) => i.status === "issued").length,
      collected_30d: (payments.data ?? []).reduce((a: number, p: any) => a + Number(p.amount), 0),
      expenses_30d: (expenses.data ?? []).reduce((a: number, e: any) => a + Number(e.amount), 0),
      by_method_30d: byMethod, by_class: byClass
    }
  });
}

const money = z.number().min(0).max(1e10);
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save_item"), id: z.string().uuid().optional(), name: z.string().trim().min(1).max(80), description: z.string().trim().max(300).nullish() }),
  z.object({ action: z.literal("delete_item"), id: z.string().uuid() }),
  z.object({ action: z.literal("save_schedule"), term_id: z.string().uuid(), fee_item_id: z.string().uuid(), class_group_id: z.string().uuid().nullable(), amount: money, optional: z.boolean().default(false) }),
  z.object({ action: z.literal("delete_schedule"), id: z.string().uuid() }),
  z.object({ action: z.literal("copy_schedule"), from_term_id: z.string().uuid(), to_term_id: z.string().uuid() }),
  z.object({ action: z.literal("generate_invoices"), term_id: z.string().uuid(), class_group_ids: z.array(z.string().uuid()).default([]), due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(), title: z.string().trim().max(80).optional() }),
  z.object({ action: z.literal("add_line"), invoice_id: z.string().uuid(), kind: z.enum(["charge", "discount", "scholarship", "adjustment"]), description: z.string().trim().min(1).max(120), amount: z.number().min(-1e10).max(1e10), fee_item_id: z.string().uuid().nullish() }),
  z.object({ action: z.literal("remove_line"), line_id: z.string().uuid() }),
  z.object({ action: z.literal("void_invoice"), invoice_id: z.string().uuid(), reason: z.string().trim().min(2).max(300) }),
  z.object({ action: z.literal("record_payment"), invoice_id: z.string().uuid(), amount: z.number().positive().max(1e10), method: z.enum(["cash", "transfer", "pos", "cheque"]), reference: z.string().trim().max(80).nullish(), payer_name: z.string().trim().max(120).nullish(), paid_at: z.string().datetime({ offset: true }).nullish() }),
  z.object({ action: z.literal("reverse_payment"), payment_id: z.string().uuid(), reason: z.string().trim().min(2).max(300) }),
  z.object({ action: z.literal("send_reminders"), term_id: z.string().uuid().nullish(), class_group_ids: z.array(z.string().uuid()).default([]) }),
  z.object({ action: z.literal("settings"), payment_provider: z.enum(["paystack", "flutterwave"]).nullable(), payment_subaccount: z.string().trim().max(60).nullish(), bank_details: z.string().trim().max(400).nullish(), withhold_results_for_debtors: z.boolean() })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.finance, "fees");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id;
  const sb = ctx.sb;
  const svc = createServiceClient();
  const audit = (action: string, meta: Record<string, unknown> = {}) =>
    sb.from("audit_logs").insert({ tenant_id: tid, actor_id: ctx.userId, action, meta });

  try {
    switch (b.action) {
      case "save_item": {
        const row = { tenant_id: tid, name: b.name, description: b.description ?? null };
        const { data, error } = b.id ? await sb.from("fee_items").update(row).eq("tenant_id", tid).eq("id", b.id).select("id").single()
          : await sb.from("fee_items").insert(row).select("id").single();
        if (error) return jsonError(error.message.includes("duplicate") ? "a fee item with that name exists" : error.message);
        return NextResponse.json(data);
      }
      case "delete_item": {
        const { error } = await sb.from("fee_items").delete().eq("tenant_id", tid).eq("id", b.id);
        return error ? jsonError(error.message) : NextResponse.json({ ok: true });
      }
      case "save_schedule": {
        const { error } = await sb.from("fee_schedules").upsert({ tenant_id: tid, term_id: b.term_id, fee_item_id: b.fee_item_id, class_group_id: b.class_group_id, amount: b.amount, optional: b.optional },
          { onConflict: "term_id,class_group_id,fee_item_id" });
        return error ? jsonError(error.message) : NextResponse.json({ ok: true });
      }
      case "delete_schedule": {
        const { error } = await sb.from("fee_schedules").delete().eq("tenant_id", tid).eq("id", b.id);
        return error ? jsonError(error.message) : NextResponse.json({ ok: true });
      }
      case "copy_schedule": {
        const { data: rows } = await sb.from("fee_schedules").select("fee_item_id,class_group_id,amount,optional").eq("tenant_id", tid).eq("term_id", b.from_term_id);
        if (!rows?.length) return jsonError("the source term has no fees");
        const { error } = await sb.from("fee_schedules").upsert(rows.map((r: any) => ({ ...r, tenant_id: tid, term_id: b.to_term_id })), { onConflict: "term_id,class_group_id,fee_item_id" });
        return error ? jsonError(error.message) : NextResponse.json({ copied: rows.length });
      }
      case "generate_invoices": {
        const r = await generateInvoices(svc, { tenantId: tid, termId: b.term_id, classGroupIds: b.class_group_ids, createdBy: ctx.userId, dueDate: b.due_date, title: b.title });
        await audit("fees.invoices_generated", { term_id: b.term_id, ...r });
        return NextResponse.json(r);
      }
      case "add_line": {
        const { data: inv } = await sb.from("fee_invoices").select("id,status").eq("tenant_id", tid).eq("id", b.invoice_id).maybeSingle();
        if (!inv) return jsonError("invoice not found", 404);
        if (inv.status === "void") return jsonError("this invoice is void");
        const amount = b.kind === "discount" || b.kind === "scholarship" ? -Math.abs(b.amount) : b.amount;
        const { error } = await sb.from("fee_invoice_lines").insert({ invoice_id: inv.id, tenant_id: tid, kind: b.kind, description: b.description, amount, fee_item_id: b.fee_item_id ?? null });
        if (error) return jsonError(error.message);
        await audit("fees.line_added", { invoice_id: inv.id, kind: b.kind, amount });
        return NextResponse.json({ ok: true });
      }
      case "remove_line": {
        const { error } = await sb.from("fee_invoice_lines").delete().eq("tenant_id", tid).eq("id", b.line_id);
        return error ? jsonError(error.message) : NextResponse.json({ ok: true });
      }
      case "void_invoice": {
        const { count } = await sb.from("fee_payments").select("id", { count: "exact", head: true }).eq("invoice_id", b.invoice_id).eq("status", "success");
        if ((count ?? 0) > 0) return jsonError("reverse the payments on this invoice before voiding it");
        const { error } = await sb.from("fee_invoices").update({ status: "void", voided_at: new Date().toISOString(), notes: `Voided: ${b.reason}` }).eq("tenant_id", tid).eq("id", b.invoice_id);
        if (error) return jsonError(error.message);
        await audit("fees.invoice_voided", { invoice_id: b.invoice_id, reason: b.reason });
        return NextResponse.json({ ok: true });
      }
      case "record_payment": {
        const pay = await recordManualPayment(svc, { tenantId: tid, invoiceId: b.invoice_id, amount: b.amount, method: b.method, reference: b.reference,
          payerName: b.payer_name, recordedBy: ctx.userId, paidAt: b.paid_at, baseUrl: appUrl(req) });
        await audit("fees.payment_recorded", { invoice_id: b.invoice_id, amount: b.amount, method: b.method, receipt: pay.receipt_no });
        return NextResponse.json(pay, { status: 201 });
      }
      case "reverse_payment": {
        const { data, error } = await svc.from("fee_payments").update({ status: "reversed", meta: { reversed_by: ctx.userId, reason: b.reason } })
          .eq("tenant_id", tid).eq("id", b.payment_id).eq("status", "success").select("id").maybeSingle();
        if (error) return jsonError(error.message);
        if (!data) return jsonError("payment not found or not reversible", 404);
        await audit("fees.payment_reversed", { payment_id: b.payment_id, reason: b.reason });
        return NextResponse.json({ ok: true });
      }
      case "send_reminders": {
        const r = await sendFeeReminders(svc, { tenantId: tid, termId: b.term_id, classGroupIds: b.class_group_ids, baseUrl: appUrl(req), createdBy: ctx.userId });
        await audit("fees.reminders_sent", r);
        return NextResponse.json(r);
      }
      case "settings": {
        if (!ROLES.admin.some(r => ctx.roles.has(r))) return jsonError("only school admins can change payment settings", 403);
        const { error } = await sb.from("tenant_settings").upsert({ tenant_id: tid, payment_provider: b.payment_provider, payment_subaccount: b.payment_subaccount || null,
          bank_details: b.bank_details || null, withhold_results_for_debtors: b.withhold_results_for_debtors }, { onConflict: "tenant_id" });
        return error ? jsonError(error.message) : NextResponse.json({ ok: true });
      }
    }
  } catch (e) {
    return jsonError((e as Error).message);
  }
}
