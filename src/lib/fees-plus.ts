/**
 * More of the bursary: Remita and Stripe payments, bank transfers reported
 * by parents, automatic reminders and late fees, statements of account and
 * debt ageing. Service-client functions: callers authorise first; every
 * query is scoped by tenant.
 */
import { moreCreds, remitaInit, remitaStatus, stripeCheckout, stripeSession, type RemitaCreds, type StripeCreds } from "./payments-more";
import type { Verification } from "./payments";
import { providerConfigured } from "./payments";
import { financeSettings, recordManualPayment } from "./fees";
import { notifyGuardians, money } from "./notify";
import { feeReminder } from "./messaging/notices";
import { reminderDue, lateFee, installmentStatus, statement, aging } from "./fee-rules";
import { studentName } from "./school";
import { localParts } from "./attendance";

// ---------------- payment methods ----------------

export async function paymentMethods(svc: any, tenantId: string) {
  const s = await financeSettings(svc, tenantId);
  const [remita, stripe, { data: t }] = await Promise.all([moreCreds(svc, tenantId, "remita"), moreCreds(svc, tenantId, "stripe"),
    svc.from("tenant_settings").select("accept_transfer_claims").eq("tenant_id", tenantId).maybeSingle()]);
  return { card: providerConfigured(s.provider) ? s.provider : null, remita: Boolean(remita), stripe: Boolean(stripe), transfer: t?.accept_transfer_claims !== false && Boolean(s.bankDetails) };
}

export async function startMorePayment(svc: any, p: { method: "remita" | "stripe"; inv: any; amount: number; currency: string; email: string; reference: string; schoolName: string | null; baseUrl: string; payToken: string }) {
  const creds = await moreCreds(svc, p.inv.tenant_id, p.method);
  if (!creds) throw new Error(`${p.method === "remita" ? "Remita" : "Card payment from abroad"} is not set up for this school`);
  const description = `${p.schoolName ?? "School"}: ${p.inv.title} ${p.inv.invoice_no}`;
  const base = { tenant_id: p.inv.tenant_id, invoice_id: p.inv.id, student_id: p.inv.student_id, amount: p.amount, currency: p.currency, method: "online", provider: p.method,
    reference: p.reference, status: "pending", payer_email: p.email };
  if (p.method === "remita") {
    const { data: st } = await svc.from("students").select("first_name,last_name,other_names").eq("id", p.inv.student_id).maybeSingle();
    const { rrr } = await remitaInit(creds as RemitaCreds, { orderId: p.reference, amount: p.amount, payerName: `Parent of ${studentName(st)}`, payerEmail: p.email, description });
    const { error } = await svc.from("fee_payments").insert({ ...base, meta: { rrr } });
    if (error) throw new Error(error.message);
    return { url: `${p.baseUrl}/api/pay/remita/${encodeURIComponent(p.reference)}`, reference: p.reference, rrr };
  }
  const { error } = await svc.from("fee_payments").insert(base);
  if (error) throw new Error(error.message);
  const s = await stripeCheckout(creds as StripeCreds, { reference: p.reference, amount: p.amount, currency: p.currency, email: p.email, description,
    successUrl: `${p.baseUrl}/api/pay/verify?reference=${encodeURIComponent(p.reference)}`, cancelUrl: `${p.baseUrl}/pay/${p.payToken}` });
  await svc.from("fee_payments").update({ meta: { session_id: s.id } }).eq("reference", p.reference).eq("tenant_id", p.inv.tenant_id);
  return { url: s.url, reference: p.reference };
}

export async function verifyMorePayment(svc: any, pay: { tenant_id: string; provider: string; currency: string; meta: any; amount: number; reference: string }): Promise<Verification | { error: string }> {
  const creds = await moreCreds(svc, pay.tenant_id, pay.provider as "remita" | "stripe");
  if (!creds) return { error: "not configured" };
  if (pay.provider === "remita") return remitaStatus(creds as RemitaCreds, pay.reference, pay.currency);
  if (!pay.meta?.session_id) return { error: "no checkout session" };
  return stripeSession(creds as StripeCreds, pay.meta.session_id);
}

// ---------------- bank transfers reported by parents ----------------

export async function submitClaim(svc: any, p: { payToken: string; amount: number; paidOn: string; bankReference: string; payerName?: string | null; proof?: { buf: Buffer; ext: string; type: string } | null }) {
  const { data: inv } = await svc.from("fee_invoices").select("id,tenant_id,student_id,status,total,amount_paid,tenants(status)").eq("pay_token", p.payToken).maybeSingle();
  if (!inv || inv.tenants?.status !== "active") throw new Error("invoice not found");
  if (inv.status === "void" || inv.status === "paid") throw new Error(`this invoice is ${inv.status}`);
  const m = await paymentMethods(svc, inv.tenant_id);
  if (!m.transfer) throw new Error("this school does not take transfer reports online; please send the proof to the bursary");
  const balance = Number(inv.total) - Number(inv.amount_paid);
  if (p.amount > balance + 0.009) throw new Error("that is more than the balance");
  const { count } = await svc.from("payment_claims").select("id", { count: "exact", head: true }).eq("invoice_id", inv.id).eq("status", "pending");
  if ((count ?? 0) >= 3) throw new Error("the bursary is still checking your earlier reports for this invoice");
  let proof_path: string | null = null;
  if (p.proof) {
    proof_path = `${inv.tenant_id}/${inv.id}/${Date.now()}.${p.proof.ext}`;
    const { error } = await svc.storage.from("payment-proofs").upload(proof_path, p.proof.buf, { contentType: p.proof.type });
    if (error) throw new Error(`could not save the proof: ${error.message}`);
  }
  const { data, error } = await svc.from("payment_claims").insert({ tenant_id: inv.tenant_id, invoice_id: inv.id, student_id: inv.student_id, amount: p.amount, paid_on: p.paidOn,
    bank_reference: p.bankReference, payer_name: p.payerName ?? null, proof_path }).select("id").single();
  if (error) throw new Error(error.message);
  return { id: data.id };
}

export async function decideClaim(svc: any, p: { tenantId: string; id: string; confirm: boolean; note: string | null; userId: string; baseUrl: string }) {
  const { data: c } = await svc.from("payment_claims").select("*").eq("tenant_id", p.tenantId).eq("id", p.id).eq("status", "pending").maybeSingle();
  if (!c) throw new Error("this report is not waiting for a decision");
  let paymentId: string | null = null;
  if (p.confirm) {
    const pay = await recordManualPayment(svc, { tenantId: p.tenantId, invoiceId: c.invoice_id, amount: Number(c.amount), method: "transfer", reference: `TRF-${c.bank_reference}`,
      payerName: c.payer_name, recordedBy: p.userId, paidAt: `${c.paid_on}T12:00:00Z`, baseUrl: p.baseUrl });
    paymentId = pay.id;
  }
  await svc.from("payment_claims").update({ status: p.confirm ? "confirmed" : "rejected", payment_id: paymentId, decided_by: p.userId, decided_at: new Date().toISOString(), note: p.note }).eq("id", c.id);
  if (!p.confirm) {
    const { data: st } = await svc.from("students").select("first_name,last_name,other_names").eq("id", c.student_id).maybeSingle();
    const { communityNote } = await import("./messaging/notices");
    await notifyGuardians(svc, { tenantId: p.tenantId, studentIds: [c.student_id], kind: "fee_receipt", refId: c.id, createdBy: p.userId,
      build: (brand, g) => communityNote(brand, { name: g.full_name, subject: `Transfer not confirmed: ${studentName(st)}`,
        lines: [`The bursary could not match your transfer of ${money(c.amount)} (reference ${c.bank_reference}) to the school's account.`, ...(p.note ? [p.note] : []), "Please contact the bursary."] }) });
  }
  return { ok: true, payment_id: paymentId };
}

// ---------------- automatic reminders and late fees ----------------

/** Daily: reminders before and after due dates, and late fees after the grace period. */
export async function runFeeAutomation(svc: any, baseUrl: string) {
  const { data: tenants } = await svc.from("tenant_settings").select("tenant_id,auto_fee_reminders,remind_days_before,remind_every_days,late_fee_percent,late_fee_amount,late_fee_grace_days,currency,tenants!inner(status,timezone)")
    .eq("tenants.status", "active").or("auto_fee_reminders.eq.true,late_fee_percent.gt.0,late_fee_amount.gt.0");
  let reminded = 0, lateFees = 0;
  for (const t of tenants ?? []) {
    const today = localParts(new Date(), t.tenants?.timezone ?? "Africa/Lagos").date;
    const { data: invoices } = await svc.from("fee_invoices").select("id,student_id,title,total,amount_paid,due_date,pay_token,late_fee_applied_at,last_reminded_at,students(first_name,last_name,other_names),invoice_installments(id,seq,amount,due_date,late_fee_applied)")
      .eq("tenant_id", t.tenant_id).in("status", ["issued", "part_paid"]).not("due_date", "is", null).limit(5000);
    for (const inv of invoices ?? []) {
      const balance = Number(inv.total) - Number(inv.amount_paid);
      if (balance <= 0) continue;
      const insts = installmentStatus((inv.invoice_installments ?? []).map((i: any) => ({ ...i, amount: Number(i.amount) })), Number(inv.amount_paid), today);
      const next = insts.find(i => i.due > 0);
      const dueDate = next?.due_date ?? inv.due_date;
      const amountDue = next ? insts.filter(i => i.state === "overdue").reduce((a, i) => a + i.due, 0) || next.due : balance;
      // Late fee: once per invoice, or once per overdue instalment.
      if (Number(t.late_fee_percent) > 0 || Number(t.late_fee_amount) > 0) {
        const targets = insts.length ? insts.filter(i => i.state === "overdue" && !(inv.invoice_installments ?? []).find((x: any) => x.id === (i as any).id)?.late_fee_applied)
          : !inv.late_fee_applied_at ? [{ id: null, due_date: inv.due_date, due: balance, label: "" }] : [];
        for (const x of targets) {
          const fee = lateFee({ overdue: x.due, dueDate: x.due_date, today, percent: Number(t.late_fee_percent), amount: Number(t.late_fee_amount), graceDays: t.late_fee_grace_days });
          if (fee <= 0) continue;
          await svc.from("fee_invoice_lines").insert({ invoice_id: inv.id, tenant_id: t.tenant_id, kind: "late_fee", description: `Late payment${(x as any).label ? ` (${(x as any).label})` : ""}`, amount: fee, source: "auto:late_fee" });
          if ((x as any).id) await svc.from("invoice_installments").update({ late_fee_applied: true }).eq("id", (x as any).id);
          else await svc.from("fee_invoices").update({ late_fee_applied_at: new Date().toISOString() }).eq("id", inv.id);
          lateFees++;
        }
      }
      if (t.auto_fee_reminders && reminderDue({ dueDate, today, lastReminded: inv.last_reminded_at, daysBefore: t.remind_days_before, everyDays: t.remind_every_days })) {
        await notifyGuardians(svc, { tenantId: t.tenant_id, studentIds: [inv.student_id], kind: "fee_reminder", refId: inv.id, budgetMs: 500,
          build: (brand, g) => feeReminder(brand, { guardianName: g.full_name, studentName: studentName(inv.students), balance: money(amountDue, t.currency ?? "NGN"), title: inv.title, due: dueDate, link: `${baseUrl}/pay/${inv.pay_token}` }) });
        await svc.from("fee_invoices").update({ last_reminded_at: new Date().toISOString() }).eq("id", inv.id);
        reminded++;
      }
    }
  }
  return { reminded, late_fees: lateFees };
}

// ---------------- statements and ageing ----------------

export async function studentStatement(svc: any, tenantId: string, studentIds: string[], from: string, to: string) {
  const [{ data: invoices }, { data: payments }, { data: students }] = await Promise.all([
    svc.from("fee_invoices").select("id,student_id,invoice_no,title,total,status,created_at").eq("tenant_id", tenantId).in("student_id", studentIds).limit(5000),
    svc.from("fee_payments").select("student_id,receipt_no,reference,amount,method,status,paid_at,created_at").eq("tenant_id", tenantId).in("student_id", studentIds).in("status", ["success", "reversed"]).limit(10000),
    svc.from("students").select("id,first_name,last_name,other_names,admission_no,class_groups(name)").in("id", studentIds)
  ]);
  return (students ?? []).map((s: any) => ({
    student: { id: s.id, name: studentName(s), admission_no: s.admission_no, class_name: s.class_groups?.name ?? null },
    ...statement({ from, to,
      invoices: (invoices ?? []).filter((i: any) => i.student_id === s.id).map((i: any) => ({ date: i.created_at, ref: i.invoice_no, description: i.title, total: Number(i.total), void: i.status === "void" })),
      payments: (payments ?? []).filter((x: any) => x.student_id === s.id).map((x: any) => ({ date: x.paid_at ?? x.created_at, ref: x.receipt_no ?? x.reference, description: `Payment (${x.method})`, amount: Number(x.amount), reversed: x.status === "reversed" })) })
  }));
}

export async function debtAging(svc: any, tenantId: string, today: string, classGroupId?: string | null) {
  let q = svc.from("fee_invoices").select("id,student_id,invoice_no,title,total,amount_paid,due_date,students!inner(first_name,last_name,other_names,admission_no,class_group_id,class_groups(name))")
    .eq("tenant_id", tenantId).in("status", ["issued", "part_paid"]).limit(20000);
  if (classGroupId) q = q.eq("students.class_group_id", classGroupId);
  const { data } = await q;
  const rows = (data ?? []).map((i: any) => ({ ...i, balance: Math.round((Number(i.total) - Number(i.amount_paid)) * 100) / 100 })).filter((i: any) => i.balance > 0);
  const byStudent = new Map<string, { name: string; admission_no: string; class_name: string | null; balance: number; oldest_due: string | null; invoices: number }>();
  for (const r of rows) {
    const cur = byStudent.get(r.student_id) ?? { name: studentName(r.students), admission_no: r.students?.admission_no, class_name: r.students?.class_groups?.name ?? null, balance: 0, oldest_due: null, invoices: 0 };
    cur.balance = Math.round((cur.balance + r.balance) * 100) / 100; cur.invoices++;
    if (r.due_date && (!cur.oldest_due || r.due_date < cur.oldest_due)) cur.oldest_due = r.due_date;
    byStudent.set(r.student_id, cur);
  }
  return { buckets: aging(rows, today), total: Math.round(rows.reduce((a: number, r: any) => a + r.balance, 0) * 100) / 100,
    debtors: [...byStudent.entries()].map(([id, v]) => ({ student_id: id, ...v })).sort((a, b) => b.balance - a.balance) };
}
