/**
 * Cashless school wallet: pocket money for the tuck shop, canteen and
 * bookshop, spent by scanning the student's ID card.
 *
 * Balances only move inside database functions (wallet_charge,
 * wallet_credit, wallet_settle) that lock the row, so a balance can never go
 * below zero or be double-spent, and the parent's daily limit and freeze are
 * enforced at the till. Online top-ups are verified with the payment
 * provider before any money is credited.
 */
import { notifyGuardians, money } from "./notify";
import { walletTopUp, walletLow } from "./messaging/notices";
import { financeSettings } from "./fees";
import { initializePayment, verifyPayment, matchesExpected, newReference, providerConfigured, type Provider } from "./payments";
import { studentName } from "./school";

export class WalletError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

/** Only these in-app paths can be used as a return address after checkout. */
export function safeReturnPath(p: string | null | undefined): string {
  return p && /^\/(parent|g\/[0-9a-f]{32,128})([?#][\w=&#-]*)?$/i.test(p) ? p : "/";
}

/** Pure: total of a till basket from item prices, never trusting a client total. */
export function basketTotal(items: { id: string; qty: number }[], catalogue: { id: string; name: string; price: number; active: boolean }[]) {
  const lines: { id: string; name: string; qty: number; price: number }[] = [];
  let total = 0;
  for (const it of items) {
    const c = catalogue.find(x => x.id === it.id);
    if (!c || !c.active) throw new WalletError("an item in the basket is not for sale");
    const qty = Math.max(1, Math.min(50, Math.floor(it.qty)));
    lines.push({ id: c.id, name: c.name, qty, price: Number(c.price) });
    total += qty * Math.round(Number(c.price) * 100);
  }
  return { lines, total: total / 100 };
}

export async function walletsForStudents(svc: any, tenantId: string, studentIds: string[]) {
  if (!studentIds.length) return [];
  const [{ data: wallets }, { data: tx }] = await Promise.all([
    svc.from("wallets").select("student_id,balance,daily_limit,low_balance_alert,frozen").eq("tenant_id", tenantId).in("student_id", studentIds),
    svc.from("wallet_transactions").select("id,student_id,kind,amount,balance_after,description,items,status,created_at").eq("tenant_id", tenantId)
      .in("student_id", studentIds).neq("status", "failed").order("created_at", { ascending: false }).limit(100)
  ]);
  return studentIds.map(id => {
    const w = (wallets ?? []).find((x: any) => x.student_id === id);
    return {
      student_id: id, balance: Number(w?.balance ?? 0), daily_limit: w?.daily_limit ?? null, low_balance_alert: w?.low_balance_alert ?? null,
      frozen: Boolean(w?.frozen), transactions: (tx ?? []).filter((t: any) => t.student_id === id).slice(0, 30)
    };
  });
}

/** Parent starts an online top-up; money settles to the school's own account like fees. */
export async function startWalletTopUp(svc: any, p: { tenantId: string; guardianId: string; studentId: string; amount: number; email?: string | null; baseUrl: string; returnPath: string }) {
  const s = await financeSettings(svc, p.tenantId);
  if (!providerConfigured(s.provider)) throw new WalletError("online top-up is not enabled for this school; please pay at the bursary");
  const amount = Math.round(p.amount * 100) / 100;
  if (!(amount > 0 && amount <= 10_000_000)) throw new WalletError("enter a valid amount");
  const { data: g } = await svc.from("guardians").select("email,full_name").eq("id", p.guardianId).maybeSingle();
  const email = p.email?.trim() || g?.email || process.env.PAYMENTS_FALLBACK_EMAIL || null;
  if (!email) throw new WalletError("enter an email address for the receipt");
  const { data: st } = await svc.from("students").select("first_name,last_name,other_names").eq("id", p.studentId).maybeSingle();
  const reference = newReference("WAL");
  const { error } = await svc.from("wallet_transactions").insert({
    tenant_id: p.tenantId, student_id: p.studentId, kind: "topup", amount, status: "pending", method: "online", provider: s.provider,
    reference, description: `Online top-up by ${g?.full_name ?? "parent"}`, payer_email: email
  });
  if (error) throw new WalletError(error.message);
  const init = await initializePayment({
    provider: s.provider!, reference, amount, currency: s.currency, email, subaccount: s.subaccount,
    callbackUrl: `${p.baseUrl}/api/pay/verify?reference=${encodeURIComponent(reference)}&return=${encodeURIComponent(safeReturnPath(p.returnPath))}`,
    description: `${s.schoolName ?? "School"}: wallet top-up for ${studentName(st)}`, logoUrl: s.logoUrl,
    metadata: { kind: "wallet", tenant_id: p.tenantId }
  });
  if (!init.ok) {
    await svc.from("wallet_transactions").update({ status: "failed" }).eq("tenant_id", p.tenantId).eq("reference", reference);
    throw new WalletError(init.error);
  }
  return { url: init.url, reference };
}

/** Verify with the provider, then credit. Idempotent for the redirect and the webhook. */
export async function confirmWalletTopUp(svc: any, reference: string) {
  const { data: t } = await svc.from("wallet_transactions").select("id,tenant_id,student_id,amount,status,provider,kind").eq("reference", reference).maybeSingle();
  if (!t || t.kind !== "topup") return { status: "unknown" as const };
  if (t.status !== "pending") return { status: t.status as string };
  const { currency } = await financeSettings(svc, t.tenant_id);
  const v = await verifyPayment(t.provider as Provider, reference);
  if ("error" in v) return { status: "pending" as const };
  if (matchesExpected(v, Number(t.amount), currency)) {
    const { data: settled, error } = await svc.rpc("wallet_settle", { p_tx: t.id });
    if (error) return { status: "pending" as const };
    if (settled?.balance !== undefined) {
      const { data: st } = await svc.from("students").select("first_name,last_name,other_names").eq("id", t.student_id).maybeSingle();
      await notifyGuardians(svc, {
        tenantId: t.tenant_id, studentIds: [t.student_id], kind: "wallet_topup", refId: t.id, budgetMs: 3000,
        build: (brand, g) => walletTopUp(brand, { guardianName: g.full_name, studentName: studentName(st), amount: money(t.amount, currency), balance: money(settled.balance, currency) })
      }).catch(() => undefined);
    }
    return { status: "success" as const };
  }
  if (v.status !== "pending") {
    await svc.from("wallet_transactions").update({ status: "failed" }).eq("id", t.id).eq("status", "pending");
    return { status: "failed" as const };
  }
  return { status: "pending" as const };
}

/** Once a day at most: tell parents when the balance drops below their alert level. */
export async function maybeLowBalanceAlert(svc: any, p: { tenantId: string; studentId: string; balance: number; baseUrl: string }) {
  const since = new Date(Date.now() - 20 * 3600_000).toISOString();
  const { data: sent } = await svc.from("message_outbox").select("id").eq("tenant_id", p.tenantId).eq("kind", "wallet_low").eq("ref_id", p.studentId).gte("created_at", since).limit(1);
  if (sent?.length) return;
  const [{ currency }, { data: st }] = await Promise.all([
    financeSettings(svc, p.tenantId),
    svc.from("students").select("first_name,last_name,other_names").eq("id", p.studentId).maybeSingle()
  ]);
  await notifyGuardians(svc, {
    tenantId: p.tenantId, studentIds: [p.studentId], kind: "wallet_low", refId: p.studentId, budgetMs: 2000,
    build: (brand, g) => walletLow(brand, { guardianName: g.full_name, studentName: studentName(st), balance: money(p.balance, currency),
      link: g.portal_token ? `${p.baseUrl}/g/${g.portal_token}#wallet` : `${p.baseUrl}/parent#wallet` })
  });
}
