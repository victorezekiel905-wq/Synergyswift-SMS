import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError, hasAny } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { decideClaim, debtAging, studentStatement, paymentMethods } from "@/lib/fees-plus";
import { splitInstallments, type Part } from "@/lib/fee-rules";
import { localParts, addDays } from "@/lib/attendance";
import { appUrl, studentName, toCsv } from "@/lib/school";

export const dynamic = "force-dynamic";

/**
 * Bursary setup and follow-up: discount rules, scholarships and waivers,
 * instalment plans, fee categories, chosen extras, transfers to confirm,
 * debt ageing (?aging=1, CSV with &format=csv) and statements (?statement=<student>&from&to).
 */
export async function GET(req: NextRequest) {
  const ctx = await requireCtx(ROLES.finance, "fees");
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id, tz = ctx.tenant.timezone;
  const u = new URL(req.url).searchParams;
  const svc = createServiceClient();
  const today = localParts(new Date(), tz).date;
  const proof = u.get("proof");
  if (proof) {
    const { data: c } = await ctx.sb.from("payment_claims").select("proof_path").eq("tenant_id", tid).eq("id", proof).maybeSingle();
    if (!c?.proof_path) return jsonError("no proof attached", 404);
    const { data } = await svc.storage.from("payment-proofs").createSignedUrl(c.proof_path, 300);
    return data?.signedUrl ? NextResponse.redirect(data.signedUrl) : jsonError("not found", 404);
  }
  if (u.get("aging")) {
    const r = await debtAging(svc, tid, today, u.get("class_group_id"));
    if (u.get("format") === "csv") {
      const csv = toCsv([["Admission no", "Student", "Class", "Invoices", "Balance", "Oldest due date"], ...r.debtors.map(d => [d.admission_no, d.name, d.class_name, d.invoices, d.balance, d.oldest_due])]);
      return new NextResponse("﻿" + csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="debtors-${today}.csv"` } });
    }
    return NextResponse.json({ today, ...r });
  }
  const st = u.get("statement");
  if (st) {
    const from = /^\d{4}-\d{2}-\d{2}$/.test(u.get("from") ?? "") ? u.get("from")! : addDays(today, -365);
    const to = /^\d{4}-\d{2}-\d{2}$/.test(u.get("to") ?? "") ? u.get("to")! : today;
    const { data: s } = await ctx.sb.from("students").select("id").eq("tenant_id", tid).eq("id", st).maybeSingle();
    if (!s) return jsonError("not found", 404);
    return NextResponse.json({ from, to, statements: await studentStatement(svc, tid, [s.id], from, to) });
  }
  const [{ data: rules }, { data: awards }, { data: plans }, { data: claims }, { data: settings }, { data: categories }, { data: items }, methods, { data: keys }] = await Promise.all([
    ctx.sb.from("fee_discount_rules").select("*").eq("tenant_id", tid).order("created_at"),
    ctx.sb.from("fee_awards").select("*,students(first_name,last_name,other_names,admission_no,class_groups(name)),approver:approved_by(full_name),creator:created_by(full_name)").eq("tenant_id", tid).order("created_at", { ascending: false }).limit(500),
    ctx.sb.from("installment_plans").select("*").eq("tenant_id", tid).order("name"),
    ctx.sb.from("payment_claims").select("*,students(first_name,last_name,other_names,admission_no,class_groups(name)),fee_invoices(invoice_no,title,total,amount_paid)").eq("tenant_id", tid)
      .eq("status", "pending").order("created_at").limit(300),
    svc.from("tenant_settings").select("late_fee_percent,late_fee_amount,late_fee_grace_days,remind_days_before,remind_every_days,auto_fee_reminders,accept_transfer_claims").eq("tenant_id", tid).maybeSingle(),
    ctx.sb.from("students").select("fee_category").eq("tenant_id", tid).not("fee_category", "is", null).limit(20000),
    ctx.sb.from("fee_items").select("id,name").eq("tenant_id", tid).order("name"),
    paymentMethods(svc, tid),
    svc.from("integration_secrets").select("provider,updated_at").eq("tenant_id", tid).in("provider", ["remita", "stripe"])
  ]);
  return NextResponse.json({
    rules: rules ?? [], plans: plans ?? [], settings, items: items ?? [], methods, own_keys: (keys ?? []).map((k: any) => k.provider), admin: hasAny(ctx, ROLES.admin), me: ctx.userId,
    categories: [...new Set((categories ?? []).map((c: any) => c.fee_category))].sort(),
    awards: (awards ?? []).map((a: any) => ({ ...a, student: studentName(a.students), admission_no: a.students?.admission_no, class_name: a.students?.class_groups?.name ?? null, students: undefined })),
    claims: (claims ?? []).map((c: any) => ({ ...c, student: studentName(c.students), class_name: c.students?.class_groups?.name ?? null, students: undefined }))
  });
}

const money = z.number().min(0).max(1e10);
const pctOrAmount = { percent: z.number().gt(0).max(100).nullish(), amount: z.number().gt(0).max(1e10).nullish() };
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save_rule"), id: z.string().uuid().nullish(), name: z.string().trim().min(2).max(80), kind: z.enum(["sibling", "staff_child", "category"]), ...pctOrAmount,
    nth_child: z.number().int().min(2).max(10).nullish(), category: z.string().trim().max(40).nullish(), item_ids: z.array(z.string().uuid()).max(50).default([]), active: z.boolean().default(true) }),
  z.object({ action: z.literal("delete_rule"), id: z.string().uuid() }),
  z.object({ action: z.literal("save_award"), id: z.string().uuid().nullish(), student_id: z.string().uuid(), kind: z.enum(["scholarship", "bursary", "waiver", "discount"]), name: z.string().trim().min(2).max(120),
    ...pctOrAmount, item_ids: z.array(z.string().uuid()).max(50).default([]), valid_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), valid_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(), note: z.string().trim().max(500).nullish() }),
  z.object({ action: z.literal("approve_award"), id: z.string().uuid() }),
  z.object({ action: z.literal("delete_award"), id: z.string().uuid() }),
  z.object({ action: z.literal("save_plan"), id: z.string().uuid().nullish(), name: z.string().trim().min(2).max(80),
    parts: z.array(z.object({ label: z.string().trim().min(1).max(40), percent: z.number().gt(0).max(100), days_after: z.number().int().min(0).max(365) })).min(1).max(12), active: z.boolean().default(true) }),
  z.object({ action: z.literal("delete_plan"), id: z.string().uuid() }),
  z.object({ action: z.literal("apply_plan"), invoice_id: z.string().uuid(), plan_id: z.string().uuid().nullable(), start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish() }),
  z.object({ action: z.literal("set_category"), student_ids: z.array(z.string().uuid()).min(1).max(2000), category: z.string().trim().max(40).nullable() }),
  z.object({ action: z.literal("optional"), student_ids: z.array(z.string().uuid()).min(1).max(2000), fee_item_id: z.string().uuid(), term_id: z.string().uuid().nullish(), on: z.boolean() }),
  z.object({ action: z.literal("decide_claim"), id: z.string().uuid(), confirm: z.boolean(), note: z.string().trim().max(300).nullish() }),
  z.object({ action: z.literal("settings"), late_fee_percent: z.number().min(0).max(50), late_fee_amount: money, late_fee_grace_days: z.number().int().min(0).max(90),
    auto_fee_reminders: z.boolean(), remind_days_before: z.number().int().min(0).max(30), remind_every_days: z.number().int().min(0).max(60), accept_transfer_claims: z.boolean() }),
  z.object({ action: z.literal("keys"), provider: z.enum(["remita", "stripe"]), merchant_id: z.string().trim().max(40).nullish(), service_type_id: z.string().trim().max(40).nullish(),
    api_key: z.string().trim().max(200).nullish(), live: z.boolean().default(false), secret_key: z.string().trim().max(200).nullish(), webhook_secret: z.string().trim().max(200).nullish() }),
  z.object({ action: z.literal("remove_keys"), provider: z.enum(["remita", "stripe"]) })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.finance, "fees");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  const tid = ctx.tenant.id, sb = ctx.sb, svc = createServiceClient();
  const fail = (e: any) => jsonError(String(e?.message ?? e).replace(/^.*?: (?=[a-z])/, ""), 400);
  const audit = (action: string, meta: Record<string, unknown>) => sb.from("audit_logs").insert({ tenant_id: tid, actor_id: ctx.userId, action, meta });
  switch (b.action) {
    case "save_rule": {
      if (!b.percent === !b.amount) return jsonError("give either a percentage or an amount");
      const { action: _a, id, ...row } = b;
      const fields = { ...row, percent: b.percent ?? null, amount: b.amount ?? null, nth_child: b.kind === "sibling" ? b.nth_child ?? 2 : null, category: b.kind === "category" ? b.category : null };
      const { error } = id ? await sb.from("fee_discount_rules").update(fields).eq("tenant_id", tid).eq("id", id) : await sb.from("fee_discount_rules").insert({ ...fields, tenant_id: tid });
      if (!error) await audit("fees.rule_saved", { name: b.name });
      return error ? fail(error) : NextResponse.json({ ok: true });
    }
    case "delete_rule": { const { error } = await sb.from("fee_discount_rules").delete().eq("tenant_id", tid).eq("id", b.id); return error ? fail(error) : NextResponse.json({ ok: true }); }
    case "save_award": {
      if (!b.percent === !b.amount) return jsonError("give either a percentage or an amount");
      const { action: _a, id, ...row } = b;
      const fields = { ...row, percent: b.percent ?? null, amount: b.amount ?? null, valid_to: b.valid_to ?? null, note: b.note ?? null };
      const { error } = id ? await sb.from("fee_awards").update(fields).eq("tenant_id", tid).eq("id", id) : await sb.from("fee_awards").insert({ ...fields, tenant_id: tid });
      if (!error) await audit("fees.award_saved", { student_id: b.student_id, name: b.name, percent: b.percent, amount: b.amount });
      return error ? fail(error) : NextResponse.json({ ok: true, needs_approval: true });
    }
    case "approve_award": {
      const { data, error } = await sb.from("fee_awards").update({ approved_by: ctx.userId }).eq("tenant_id", tid).eq("id", b.id).select("id").maybeSingle();
      if (!error && data) await audit("fees.award_approved", { id: b.id });
      return error ? fail(error) : data ? NextResponse.json({ ok: true }) : jsonError("not found", 404);
    }
    case "delete_award": { const { error } = await sb.from("fee_awards").delete().eq("tenant_id", tid).eq("id", b.id); return error ? fail(error) : NextResponse.json({ ok: true }); }
    case "save_plan": {
      if (Math.abs(b.parts.reduce((a, p) => a + p.percent, 0) - 100) > 0.001) return jsonError("the parts must add up to 100%");
      const { action: _a, id, ...row } = b;
      const { error } = id ? await sb.from("installment_plans").update(row).eq("tenant_id", tid).eq("id", id) : await sb.from("installment_plans").insert({ ...row, tenant_id: tid });
      return error ? fail(error) : NextResponse.json({ ok: true });
    }
    case "delete_plan": { const { error } = await sb.from("installment_plans").delete().eq("tenant_id", tid).eq("id", b.id); return error ? fail(error) : NextResponse.json({ ok: true }); }
    case "apply_plan": {
      const { data: inv } = await sb.from("fee_invoices").select("id,total,status,due_date").eq("tenant_id", tid).eq("id", b.invoice_id).maybeSingle();
      if (!inv || inv.status === "void") return jsonError("invoice not found", 404);
      await sb.from("invoice_installments").delete().eq("invoice_id", inv.id);
      if (!b.plan_id) return NextResponse.json({ ok: true });
      const { data: plan } = await sb.from("installment_plans").select("parts").eq("tenant_id", tid).eq("id", b.plan_id).maybeSingle();
      if (!plan) return jsonError("plan not found", 404);
      try {
        const parts = splitInstallments(Number(inv.total), plan.parts as Part[], b.start ?? inv.due_date ?? localParts(new Date(), ctx.tenant.timezone).date);
        const { error } = await sb.from("invoice_installments").insert(parts.map(p => ({ ...p, tenant_id: tid, invoice_id: inv.id })));
        if (error) return fail(error);
        await sb.from("fee_invoices").update({ due_date: parts[0]?.due_date ?? inv.due_date }).eq("id", inv.id);
        return NextResponse.json({ ok: true, parts });
      } catch (e) { return fail(e); }
    }
    case "set_category": {
      const { error } = await sb.from("students").update({ fee_category: b.category || null }).eq("tenant_id", tid).in("id", b.student_ids);
      return error ? fail(error) : NextResponse.json({ ok: true, updated: b.student_ids.length });
    }
    case "optional": {
      if (b.on) {
        const { error } = await sb.from("fee_optional_choices").upsert(b.student_ids.map(s => ({ tenant_id: tid, student_id: s, fee_item_id: b.fee_item_id, term_id: b.term_id ?? null })),
          { onConflict: "student_id,fee_item_id,term_id", ignoreDuplicates: true });
        return error ? fail(error) : NextResponse.json({ ok: true });
      }
      let q = sb.from("fee_optional_choices").delete().eq("tenant_id", tid).eq("fee_item_id", b.fee_item_id).in("student_id", b.student_ids);
      q = b.term_id ? q.eq("term_id", b.term_id) : q.is("term_id", null);
      const { error } = await q;
      return error ? fail(error) : NextResponse.json({ ok: true });
    }
    case "decide_claim": {
      try {
        const r = await decideClaim(svc, { tenantId: tid, id: b.id, confirm: b.confirm, note: b.note ?? null, userId: ctx.userId, baseUrl: appUrl(req) });
        await audit(b.confirm ? "fees.transfer_confirmed" : "fees.transfer_rejected", { id: b.id });
        return NextResponse.json(r);
      } catch (e) { return fail(e); }
    }
    case "settings": {
      if (!hasAny(ctx, ROLES.admin) && !ctx.roles.has("bursar")) return jsonError("forbidden", 403);
      const { action: _a, ...row } = b;
      const { error } = await svc.from("tenant_settings").upsert({ tenant_id: tid, ...row }, { onConflict: "tenant_id" });
      if (!error) await audit("fees.settings", row);
      return error ? fail(error) : NextResponse.json({ ok: true });
    }
    case "keys": {
      if (!hasAny(ctx, ROLES.admin)) return jsonError("only admins can change payment keys", 403);
      const data = b.provider === "remita" ? { merchant_id: b.merchant_id, service_type_id: b.service_type_id, api_key: b.api_key, live: b.live } : { secret_key: b.secret_key, webhook_secret: b.webhook_secret || null };
      if (Object.entries(data).some(([k, v]) => k !== "webhook_secret" && k !== "live" && !v)) return jsonError("fill in every key");
      if (b.provider === "stripe") {
        const r = await fetch("https://api.stripe.com/v1/balance", { headers: { Authorization: `Bearer ${b.secret_key}` } }).catch(() => null);
        if (!r?.ok) return jsonError("Stripe did not accept that secret key");
      }
      const { error } = await svc.from("integration_secrets").upsert({ tenant_id: tid, provider: b.provider, data, updated_at: new Date().toISOString() }, { onConflict: "tenant_id,provider" });
      if (!error) await audit("fees.payment_keys", { provider: b.provider });
      return error ? fail(error) : NextResponse.json({ ok: true });
    }
    case "remove_keys": {
      if (!hasAny(ctx, ROLES.admin)) return jsonError("only admins can change payment keys", 403);
      await svc.from("integration_secrets").delete().eq("tenant_id", tid).eq("provider", b.provider);
      return NextResponse.json({ ok: true });
    }
  }
}
