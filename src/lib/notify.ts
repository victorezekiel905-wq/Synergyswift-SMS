/**
 * One call to tell every guardian of one or more students about something:
 * builds per-guardian messages, queues them and sends immediately (best effort).
 */
import { enqueue, tryDispatch, guardiansByStudent, loadBrand, rowsForGuardian, type Guardian, type OutboxRow } from "./messaging/outbox";
import type { Brand, Rendered } from "./messaging/templates";

export async function notifyGuardians(svc: any, p: {
  tenantId: string;
  studentIds: string[];
  kind: string;
  build: (brand: Brand, guardian: Guardian, studentId: string) => Rendered;
  refId?: string | null;
  createdBy?: string | null;
  dedupeGuardians?: boolean;
  budgetMs?: number;
}): Promise<{ queued: number; noContact: string[] }> {
  if (!p.studentIds.length) return { queued: 0, noContact: [] };
  const brand = await loadBrand(svc, p.tenantId);
  const map = await guardiansByStudent(svc, p.tenantId, p.studentIds);
  const rows: OutboxRow[] = [];
  const seen = new Set<string>();
  const noContact: string[] = [];
  for (const sid of p.studentIds) {
    const before = rows.length;
    for (const g of map.get(sid) ?? []) {
      if (p.dedupeGuardians && seen.has(g.id)) continue;
      seen.add(g.id);
      rows.push(...rowsForGuardian(p.tenantId, g, p.kind, p.build(brand, g, sid), p.refId ?? null, p.createdBy ?? null));
    }
    if (rows.length === before) noContact.push(sid);
  }
  if (rows.length) {
    await enqueue(svc, rows);
    await tryDispatch(svc, { budgetMs: p.budgetMs ?? 6000 });
  }
  return { queued: rows.length, noContact };
}

/** Send one message to an arbitrary contact (e.g. an admissions applicant who is not yet a guardian). */
export async function notifyContact(svc: any, p: {
  tenantId: string; name: string; email?: string | null; phone?: string | null; kind: string;
  build: (brand: Brand) => Rendered; refId?: string | null;
}) {
  const brand = await loadBrand(svc, p.tenantId);
  const g: Guardian = { id: "contact", full_name: p.name, email: p.email ?? null, phone: p.phone ?? null, whatsapp_phone: null,
    notify_email: true, notify_whatsapp: true };
  const rows = rowsForGuardian(p.tenantId, g, p.kind, p.build(brand), p.refId ?? null, null);
  if (rows.length) { await enqueue(svc, rows); await tryDispatch(svc, { budgetMs: 6000 }); }
  return rows.length;
}

export function money(amount: number | string | null | undefined, currency = "NGN"): string {
  const v = Number(amount ?? 0);
  try { return new Intl.NumberFormat("en-NG", { style: "currency", currency, maximumFractionDigits: 2 }).format(v); }
  catch { return `${currency} ${v.toFixed(2)}`; }
}
