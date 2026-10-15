/**
 * Fees: invoices from fee schedules, manual and online payments, receipts,
 * reminders. Service-client functions: callers must authorise first and
 * every query is scoped by tenant.
 */
import { notifyGuardians, money } from "./notify";
import { feeReceipt, feeReminder } from "./messaging/notices";
import { initializePayment, verifyPayment, matchesExpected, newReference, providerConfigured, type Provider } from "./payments";
import { studentName } from "./school";
import { chargesFor, invoiceLines, siblingRanks, splitInstallments, type Rule, type Award, type Part } from "./fee-rules";

export async function financeSettings(svc: any, tenantId: string) {
  const { data } = await svc.from("tenant_settings")
    .select("currency,payment_provider,payment_subaccount,bank_details,withhold_results_for_debtors,school_name,logo_url")
    .eq("tenant_id", tenantId).maybeSingle();
  return {
    currency: (data?.currency as string) || "NGN",
    provider: (data?.payment_provider as Provider | null) ?? null,
    subaccount: (data?.payment_subaccount as string | null) ?? null,
    bankDetails: (data?.bank_details as string | null) ?? null,
    withholdResults: Boolean(data?.withhold_results_for_debtors),
    schoolName: (data?.school_name as string | null) ?? null,
    logoUrl: (data?.logo_url as string | null) ?? null
  };
}

/** Pure: which schedule rows apply to a student's class (class-specific rows override "all classes"). */
export function applicableCharges(schedules: { fee_item_id: string; class_group_id: string | null; amount: number; optional: boolean; name: string }[], classGroupId: string | null) {
  const byItem = new Map<string, { fee_item_id: string; amount: number; name: string }>();
  for (const s of schedules.filter(x => !x.optional && x.class_group_id === null)) byItem.set(s.fee_item_id, s);
  for (const s of schedules.filter(x => !x.optional && x.class_group_id !== null && x.class_group_id === classGroupId)) byItem.set(s.fee_item_id, s);
  return [...byItem.values()].filter(c => Number(c.amount) > 0);
}

/**
 * Term invoices for whole classes. Each child's charges come from the most
 * specific schedule rows (class, fee category) plus the optional extras the
 * family chose; then the best discount rule (sibling, staff child, category)
 * and any approved scholarships or waivers. An instalment plan splits the
 * total into dated parts.
 */
export async function generateInvoices(svc: any, p: { tenantId: string; termId: string; classGroupIds: string[]; createdBy: string; dueDate?: string | null; title?: string; planId?: string | null }) {
  const title = p.title?.trim() || "School fees";
  const today = new Date().toISOString().slice(0, 10);
  const [{ data: schedules }, { data: rules }, { data: plan }] = await Promise.all([
    svc.from("fee_schedules").select("fee_item_id,class_group_id,category,amount,optional,fee_items(name)").eq("tenant_id", p.tenantId).eq("term_id", p.termId),
    svc.from("fee_discount_rules").select("*").eq("tenant_id", p.tenantId).eq("active", true),
    p.planId ? svc.from("installment_plans").select("parts").eq("tenant_id", p.tenantId).eq("id", p.planId).maybeSingle() : { data: null }
  ]);
  const rows = (schedules ?? []).map((s: any) => ({ ...s, amount: Number(s.amount), name: s.fee_items?.name ?? "Fee" }));
  if (!rows.length) throw new Error("no fee schedule for this term yet; add fees under Fee setup first");
  if (p.planId && !plan) throw new Error("instalment plan not found");

  // Every active student (sibling order counts the whole family, not only the classes chosen).
  const { data: all } = await svc.from("students").select("id,class_group_id,fee_category,date_of_birth,admitted_on").eq("tenant_id", p.tenantId).eq("status", "active").limit(20000);
  const students = (all ?? []).filter((s: any) => !p.classGroupIds.length || p.classGroupIds.includes(s.class_group_id));
  const ids = (all ?? []).map((s: any) => s.id);
  const [{ data: links }, { data: existing }, { data: choices }, { data: awards }] = await Promise.all([
    svc.from("student_guardians").select("student_id,guardian_id,guardians(user_id)").eq("tenant_id", p.tenantId).limit(40000),
    svc.from("fee_invoices").select("student_id").eq("tenant_id", p.tenantId).eq("term_id", p.termId).eq("title", title).neq("status", "void").limit(20000),
    svc.from("fee_optional_choices").select("student_id,fee_item_id,term_id").eq("tenant_id", p.tenantId).limit(40000),
    svc.from("fee_awards").select("*").eq("tenant_id", p.tenantId).not("approved_by", "is", null).limit(20000)
  ]);
  const ranks = siblingRanks(all ?? [], (links ?? []).filter((l: any) => ids.includes(l.student_id)));
  // A child of a member of staff: a guardian who signs in as staff.
  const guardianUsers = [...new Set((links ?? []).map((l: any) => l.guardians?.user_id).filter(Boolean))] as string[];
  const { data: staffUsers } = guardianUsers.length ? await svc.from("users").select("id,role").in("id", guardianUsers).not("role", "in", "(parent,student,alumni)") : { data: [] };
  const staffSet = new Set((staffUsers ?? []).map((u: any) => u.id));
  const staffChildren = new Set((links ?? []).filter((l: any) => staffSet.has(l.guardians?.user_id)).map((l: any) => l.student_id));
  const have = new Set((existing ?? []).map((e: { student_id: string }) => e.student_id));

  let created = 0, skipped = 0, discounted = 0;
  for (const s of students) {
    if (have.has(s.id)) { skipped++; continue; }
    const chosen = new Set<string>((choices ?? []).filter((c: any) => c.student_id === s.id && (!c.term_id || c.term_id === p.termId)).map((c: any) => c.fee_item_id));
    const charges = chargesFor(rows, { classGroupId: s.class_group_id, category: s.fee_category ?? null, chosenOptional: chosen });
    if (!charges.length) { skipped++; continue; }
    const lines = invoiceLines(charges, { rank: ranks.get(s.id) ?? 1, staffChild: staffChildren.has(s.id) || s.fee_category === "staff_child", category: s.fee_category ?? null,
      rules: (rules ?? []) as Rule[], awards: ((awards ?? []) as (Award & { student_id: string })[]).filter(a => a.student_id === s.id), on: today });
    const total = lines.reduce((a, l) => a + l.amount, 0);
    const parts = plan ? splitInstallments(total, plan.parts as Part[], p.dueDate ?? today) : [];
    const { data: no } = await svc.rpc("next_doc_no", { p_tenant: p.tenantId, p_kind: "inv" });
    const { data: inv, error } = await svc.from("fee_invoices").insert({
      tenant_id: p.tenantId, student_id: s.id, term_id: p.termId, invoice_no: no, title, due_date: parts[0]?.due_date ?? p.dueDate ?? null, created_by: p.createdBy
    }).select("id").single();
    if (error) { skipped++; continue; }
    await svc.from("fee_invoice_lines").insert(lines.map(l => ({ invoice_id: inv.id, tenant_id: p.tenantId, fee_item_id: l.fee_item_id, kind: l.kind, description: l.description, amount: l.amount, source: l.source })));
    if (parts.length) await svc.from("invoice_installments").insert(parts.map(x => ({ ...x, tenant_id: p.tenantId, invoice_id: inv.id })));
    if (lines.some(l => l.amount < 0)) discounted++;
    created++;
  }
  return { created, skipped, discounted };
}

/** One-off invoice (trip, uniform, application fee…). */
export async function createInvoice(svc: any, p: { tenantId: string; studentId: string; title: string; lines: { description: string; amount: number; fee_item_id?: string | null }[]; createdBy?: string | null; dueDate?: string | null }) {
  const { data: no } = await svc.rpc("next_doc_no", { p_tenant: p.tenantId, p_kind: "inv" });
  const { data: inv, error } = await svc.from("fee_invoices").insert({
    tenant_id: p.tenantId, student_id: p.studentId, title: p.title, invoice_no: no, due_date: p.dueDate ?? null, created_by: p.createdBy ?? null
  }).select("id,pay_token").single();
  if (error) throw new Error(error.message);
  await svc.from("fee_invoice_lines").insert(p.lines.map(l => ({ invoice_id: inv.id, tenant_id: p.tenantId, fee_item_id: l.fee_item_id ?? null, description: l.description, amount: l.amount })));
  return inv as { id: string; pay_token: string };
}

async function sendReceipt(svc: any, paymentId: string, baseUrl: string) {
  const { data: pay } = await svc.from("fee_payments")
    .select("id,tenant_id,student_id,amount,receipt_no,currency,fee_invoices(total,amount_paid,pay_token)").eq("id", paymentId).maybeSingle();
  if (!pay?.receipt_no) return;
  const inv = pay.fee_invoices;
  const balance = Math.max(0, Number(inv?.total ?? 0) - Number(inv?.amount_paid ?? 0));
  const { data: st } = await svc.from("students").select("first_name,last_name,other_names").eq("id", pay.student_id).maybeSingle();
  await notifyGuardians(svc, {
    tenantId: pay.tenant_id, studentIds: [pay.student_id], kind: "fee_receipt", refId: pay.id,
    build: (brand, g) => feeReceipt(brand, {
      guardianName: g.full_name, studentName: studentName(st), amount: money(pay.amount, pay.currency),
      receiptNo: pay.receipt_no, balance: money(balance, pay.currency), link: `${baseUrl}/pay/${inv?.pay_token}`
    })
  });
}

export async function recordManualPayment(svc: any, p: {
  tenantId: string; invoiceId: string; amount: number; method: "cash" | "transfer" | "pos" | "cheque"; reference?: string | null;
  payerName?: string | null; recordedBy: string; paidAt?: string | null; baseUrl: string;
}) {
  const { data: inv } = await svc.from("fee_invoices").select("id,student_id,status,total,amount_paid").eq("tenant_id", p.tenantId).eq("id", p.invoiceId).maybeSingle();
  if (!inv) throw new Error("invoice not found");
  if (inv.status === "void") throw new Error("this invoice is void");
  if (!(p.amount > 0)) throw new Error("amount must be more than zero");
  const { currency } = await financeSettings(svc, p.tenantId);
  const { data: pay, error } = await svc.from("fee_payments").insert({
    tenant_id: p.tenantId, invoice_id: inv.id, student_id: inv.student_id, amount: p.amount, currency, method: p.method,
    reference: p.reference?.trim() || newReference(p.method.toUpperCase()), status: "success", payer_name: p.payerName ?? null,
    recorded_by: p.recordedBy, paid_at: p.paidAt ?? new Date().toISOString()
  }).select("id,receipt_no").single();
  if (error) throw new Error(error.message.includes("duplicate") ? "that payment reference has already been recorded" : error.message);
  await sendReceipt(svc, pay.id, p.baseUrl);
  return pay;
}

/** Parent starts an online payment from the pay link. */
export async function startOnlinePayment(svc: any, p: { payToken: string; amount?: number | null; email?: string | null; baseUrl: string; method?: "card" | "remita" | "stripe" | null }) {
  const { data: inv } = await svc.from("fee_invoices")
    .select("id,tenant_id,student_id,title,invoice_no,status,total,amount_paid,tenants(status)").eq("pay_token", p.payToken).maybeSingle();
  if (!inv || inv.tenants?.status !== "active") throw new Error("invoice not found");
  if (inv.status === "void" || inv.status === "paid") throw new Error(`this invoice is ${inv.status}`);
  const s = await financeSettings(svc, inv.tenant_id);
  const method = p.method ?? "card";
  if (method === "card" && !providerConfigured(s.provider)) throw new Error("online payment is not enabled for this school; please pay by transfer or at the bursary");
  const balance = Math.round((Number(inv.total) - Number(inv.amount_paid)) * 100) / 100;
  const amount = p.amount ? Math.min(Math.round(p.amount * 100) / 100, balance) : balance;
  if (!(amount > 0)) throw new Error("nothing to pay");

  // A payer email is required by the providers; fall back to the guardian's.
  let email = p.email?.trim() || null;
  if (!email) {
    const { data: gs } = await svc.from("student_guardians").select("guardians(email)").eq("student_id", inv.student_id).limit(5);
    email = (gs ?? []).map((g: any) => g.guardians?.email).find((e: string | null) => e) ?? process.env.PAYMENTS_FALLBACK_EMAIL ?? null;
  }
  if (!email) throw new Error("enter an email address for the payment receipt");

  const reference = newReference("FEE");
  if (method === "remita" || method === "stripe") {
    const { startMorePayment } = await import("./fees-plus");
    return startMorePayment(svc, { method, inv, amount, currency: s.currency, email, reference, schoolName: s.schoolName, baseUrl: p.baseUrl, payToken: p.payToken });
  }
  const { error } = await svc.from("fee_payments").insert({
    tenant_id: inv.tenant_id, invoice_id: inv.id, student_id: inv.student_id, amount, currency: s.currency, method: "online",
    provider: s.provider, reference, status: "pending", payer_email: email
  });
  if (error) throw new Error(error.message);
  const init = await initializePayment({
    provider: s.provider!, reference, amount, currency: s.currency, email, subaccount: s.subaccount,
    callbackUrl: `${p.baseUrl}/api/pay/verify?reference=${encodeURIComponent(reference)}`,
    description: `${s.schoolName ?? "School"}: ${inv.title} ${inv.invoice_no}`, logoUrl: s.logoUrl,
    metadata: { invoice_no: inv.invoice_no, tenant_id: inv.tenant_id }
  });
  if (!init.ok) {
    await svc.from("fee_payments").update({ status: "failed", meta: { error: init.error } }).eq("reference", reference).eq("tenant_id", inv.tenant_id);
    throw new Error(init.error);
  }
  return { url: init.url, reference };
}

/** Verify with the provider and settle. Idempotent: safe for both the redirect and the webhook. */
export async function confirmOnlinePayment(svc: any, reference: string, baseUrl: string) {
  const { data: pay } = await svc.from("fee_payments").select("id,tenant_id,amount,currency,provider,status,meta,fee_invoices(pay_token)")
    .eq("reference", reference).maybeSingle();
  if (!pay) return { status: "unknown" as const };
  const token = pay.fee_invoices?.pay_token as string | undefined;
  if (pay.status === "success") return { status: "success" as const, token };
  if (pay.status !== "pending") return { status: pay.status as string, token };
  const v = pay.provider === "remita" || pay.provider === "stripe"
    ? await (await import("./fees-plus")).verifyMorePayment(svc, { ...pay, reference })
    : await verifyPayment(pay.provider as Provider, reference);
  if ("error" in v) return { status: "pending" as const, token };
  if (matchesExpected(v, Number(pay.amount), pay.currency)) {
    const { data: updated } = await svc.from("fee_payments").update({ status: "success", meta: v.raw ?? {} })
      .eq("id", pay.id).eq("status", "pending").select("id").maybeSingle();
    if (updated) await sendReceipt(svc, pay.id, baseUrl);
    return { status: "success" as const, token };
  }
  if (v.status === "failed" || (v.status === "success" && !matchesExpected(v, Number(pay.amount), pay.currency))) {
    await svc.from("fee_payments").update({ status: "failed", meta: { verified: v } }).eq("id", pay.id).eq("status", "pending");
    return { status: "failed" as const, token };
  }
  return { status: "pending" as const, token };
}

export async function sendFeeReminders(svc: any, p: { tenantId: string; termId?: string | null; classGroupIds?: string[]; baseUrl: string; createdBy: string }) {
  let q = svc.from("fee_invoices").select("id,student_id,title,total,amount_paid,due_date,pay_token,students!inner(first_name,last_name,other_names,class_group_id)")
    .eq("tenant_id", p.tenantId).in("status", ["issued", "part_paid"]).limit(20000);
  if (p.termId) q = q.eq("term_id", p.termId);
  if (p.classGroupIds?.length) q = q.in("students.class_group_id", p.classGroupIds);
  const { data: invoices } = await q;
  const { currency } = await financeSettings(svc, p.tenantId);
  let queued = 0;
  for (const inv of invoices ?? []) {
    const balance = Number(inv.total) - Number(inv.amount_paid);
    if (balance <= 0) continue;
    const r = await notifyGuardians(svc, {
      tenantId: p.tenantId, studentIds: [inv.student_id], kind: "fee_reminder", refId: inv.id, createdBy: p.createdBy, budgetMs: 1000,
      build: (brand, g) => feeReminder(brand, {
        guardianName: g.full_name, studentName: studentName(inv.students), balance: money(balance, currency), title: inv.title,
        due: inv.due_date, link: `${p.baseUrl}/pay/${inv.pay_token}`
      })
    });
    queued += r.queued;
  }
  return { invoices: (invoices ?? []).length, messages_queued: queued };
}

/** Outstanding balance per student for a term (used to withhold results). */
export async function debtorsForTerm(svc: any, tenantId: string, termId: string): Promise<Set<string>> {
  const { data } = await svc.from("fee_invoices").select("student_id,total,amount_paid")
    .eq("tenant_id", tenantId).eq("term_id", termId).in("status", ["issued", "part_paid"]).limit(20000);
  return new Set((data ?? []).filter((i: any) => Number(i.total) - Number(i.amount_paid) > 0).map((i: any) => i.student_id));
}
