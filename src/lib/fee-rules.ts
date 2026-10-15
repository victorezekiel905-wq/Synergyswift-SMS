/**
 * Fee rules: which charges a child pays (class, category, chosen extras),
 * sibling and staff discounts, scholarships and waivers, instalment plans,
 * late fees, debt ageing and statements of account. Pure and unit tested.
 */

const r2 = (n: number) => Math.round(n * 100) / 100;

export type Schedule = { fee_item_id: string; class_group_id: string | null; category: string | null; amount: number; optional: boolean; name: string };
export type Charge = { fee_item_id: string; amount: number; name: string; optional: boolean };

/**
 * The charges for one child: the most specific schedule row per fee item
 * (class and category beat class, which beats category, which beats "all"),
 * with optional items only when the family has chosen them.
 */
export function chargesFor(schedules: Schedule[], p: { classGroupId: string | null; category: string | null; chosenOptional: Set<string> }): Charge[] {
  const score = (s: Schedule) => (s.class_group_id ? 2 : 0) + (s.category ? 1 : 0);
  const best = new Map<string, Schedule>();
  for (const s of schedules) {
    if (s.class_group_id && s.class_group_id !== p.classGroupId) continue;
    if (s.category && s.category !== p.category) continue;
    const cur = best.get(s.fee_item_id);
    if (!cur || score(s) > score(cur)) best.set(s.fee_item_id, s);
  }
  return [...best.values()].filter(s => Number(s.amount) > 0 && (!s.optional || p.chosenOptional.has(s.fee_item_id)))
    .map(s => ({ fee_item_id: s.fee_item_id, amount: r2(Number(s.amount)), name: s.name, optional: s.optional }));
}

// ---------------- families and siblings ----------------

/**
 * Children in the same family (sharing any guardian) numbered 1, 2, 3 …
 * The eldest (earliest date of birth, then earliest admission) is first, so
 * younger siblings receive the sibling discount.
 */
export function siblingRanks(students: { id: string; date_of_birth: string | null; admitted_on: string | null }[], links: { student_id: string; guardian_id: string }[]): Map<string, number> {
  const parent = new Map<string, string>();
  const find = (x: string): string => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x)!)!); x = parent.get(x)!; } return x; };
  for (const s of students) parent.set(s.id, s.id);
  const byGuardian = new Map<string, string[]>();
  for (const l of links) if (parent.has(l.student_id)) byGuardian.set(l.guardian_id, [...(byGuardian.get(l.guardian_id) ?? []), l.student_id]);
  for (const kids of byGuardian.values()) for (const k of kids.slice(1)) parent.set(find(k), find(kids[0]));
  const families = new Map<string, typeof students>();
  for (const s of students) families.set(find(s.id), [...(families.get(find(s.id)) ?? []), s]);
  const out = new Map<string, number>();
  for (const fam of families.values()) {
    fam.sort((a, b) => (a.date_of_birth ?? "9999").localeCompare(b.date_of_birth ?? "9999") || (a.admitted_on ?? "9999").localeCompare(b.admitted_on ?? "9999") || a.id.localeCompare(b.id));
    fam.forEach((s, i) => out.set(s.id, i + 1));
  }
  return out;
}

// ---------------- discounts and awards ----------------

export type Rule = { id: string; name: string; kind: "sibling" | "staff_child" | "category"; percent: number | null; amount: number | null; nth_child: number | null; category: string | null; item_ids: string[]; active: boolean };
export type Award = { id: string; name: string; kind: string; percent: number | null; amount: number | null; item_ids: string[]; valid_from: string; valid_to: string | null; approved_by: string | null };
export type Line = { kind: "charge" | "discount" | "scholarship"; description: string; amount: number; fee_item_id: string | null; source: string | null };

/** Value of a percent or fixed reduction against the charges it covers (never more than they total). */
function reduction(charges: Charge[], itemIds: string[], percent: number | null, amount: number | null) {
  const base = charges.filter(c => !itemIds.length || itemIds.includes(c.fee_item_id)).reduce((a, c) => a + c.amount, 0);
  if (base <= 0) return 0;
  return r2(Math.min(base, percent ? (base * percent) / 100 : amount ?? 0));
}

/**
 * Invoice lines for one child: the charges, the single best discount rule
 * that applies (rules do not stack), then every approved, current award.
 * The total never goes below zero.
 */
export function invoiceLines(charges: Charge[], p: { rank: number; staffChild: boolean; category: string | null; rules: Rule[]; awards: Award[]; on: string }): Line[] {
  const lines: Line[] = charges.map(c => ({ kind: "charge", description: c.name, amount: c.amount, fee_item_id: c.fee_item_id, source: null }));
  const fits = (r: Rule) => r.active && (r.kind === "sibling" ? p.rank >= (r.nth_child ?? 99) : r.kind === "staff_child" ? p.staffChild : r.category === p.category);
  const best = p.rules.filter(fits).map(r => ({ r, v: reduction(charges, r.item_ids, r.percent, r.amount) })).filter(x => x.v > 0).sort((a, b) => b.v - a.v)[0];
  let total = charges.reduce((a, c) => a + c.amount, 0);
  if (best) {
    const v = Math.min(best.v, total);
    lines.push({ kind: "discount", description: best.r.name, amount: -v, fee_item_id: null, source: `rule:${best.r.id}` });
    total = r2(total - v);
  }
  for (const a of p.awards) {
    if (!a.approved_by || a.valid_from > p.on || (a.valid_to && a.valid_to < p.on) || total <= 0) continue;
    const v = Math.min(reduction(charges, a.item_ids, a.percent, a.amount), total);
    if (v <= 0) continue;
    lines.push({ kind: "scholarship", description: a.name, amount: -v, fee_item_id: null, source: `award:${a.id}` });
    total = r2(total - v);
  }
  return lines;
}

// ---------------- instalments ----------------

export type Part = { label: string; percent: number; days_after: number };

/** Splits a total into instalments; amounts add up exactly (any rounding goes on the last). */
export function splitInstallments(total: number, parts: Part[], start: string): { seq: number; label: string; amount: number; due_date: string }[] {
  const sum = parts.reduce((a, p) => a + p.percent, 0);
  if (!parts.length || Math.abs(sum - 100) > 0.001) throw new Error("instalment percentages must add up to 100");
  let left = r2(total);
  return parts.map((p, i) => {
    const amount = i === parts.length - 1 ? left : r2((total * p.percent) / 100);
    left = r2(left - amount);
    const d = new Date(`${start}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + p.days_after);
    return { seq: i + 1, label: p.label, amount, due_date: d.toISOString().slice(0, 10) };
  }).filter(x => x.amount > 0);
}

/** Payments cover the earliest instalments first. */
export function installmentStatus(insts: { seq: number; amount: number; due_date: string }[], paid: number, today: string) {
  let left = paid;
  return [...insts].sort((a, b) => a.seq - b.seq).map(i => {
    const covered = r2(Math.min(i.amount, Math.max(0, left)));
    left = r2(left - covered);
    const due = r2(i.amount - covered);
    return { ...i, paid: covered, due, state: due <= 0 ? "paid" as const : i.due_date < today ? "overdue" as const : "upcoming" as const };
  });
}

// ---------------- late fees and reminders ----------------

/** The late fee for an overdue balance: a percentage, a fixed sum, or both added; none within the grace period. */
export function lateFee(p: { overdue: number; dueDate: string; today: string; percent: number; amount: number; graceDays: number }): number {
  if (p.overdue <= 0 || (!p.percent && !p.amount)) return 0;
  const d = new Date(`${p.dueDate}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + p.graceDays);
  if (p.today <= d.toISOString().slice(0, 10)) return 0;
  return r2((p.overdue * p.percent) / 100 + p.amount);
}

/** Whether to remind today: a few days before the due date, then every N days while unpaid. */
export function reminderDue(p: { dueDate: string | null; today: string; lastReminded: string | null; daysBefore: number; everyDays: number }): boolean {
  if (!p.dueDate) return false;
  const days = Math.round((Date.parse(`${p.dueDate}T12:00:00Z`) - Date.parse(`${p.today}T12:00:00Z`)) / 86400_000);
  const last = p.lastReminded ? Math.round((Date.parse(`${p.today}T12:00:00Z`) - Date.parse(`${p.lastReminded.slice(0, 10)}T12:00:00Z`)) / 86400_000) : null;
  if (days > 0) return days === p.daysBefore && last !== 0;
  if (p.everyDays <= 0) return false;
  return last === null || last >= p.everyDays;
}

// ---------------- reports ----------------

export const AGE_BUCKETS = ["current", "1-30", "31-60", "61-90", "90+"] as const;
/** Outstanding balances by how long they have been overdue. */
export function aging(invoices: { balance: number; due_date: string | null }[], today: string) {
  const out: Record<(typeof AGE_BUCKETS)[number], number> = { current: 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
  for (const i of invoices) {
    if (i.balance <= 0) continue;
    const days = i.due_date ? Math.floor((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${i.due_date}T12:00:00Z`)) / 86400_000) : 0;
    const b = days <= 0 ? "current" : days <= 30 ? "1-30" : days <= 60 ? "31-60" : days <= 90 ? "61-90" : "90+";
    out[b] = r2(out[b] + i.balance);
  }
  return out;
}

export type StatementLine = { date: string; kind: "invoice" | "payment" | "credit" | "reversal"; ref: string; description: string; debit: number; credit: number; balance: number };
/** A statement of account: opening balance, every invoice and payment in date order with a running balance, closing balance. */
export function statement(p: { invoices: { date: string; ref: string; description: string; total: number; void: boolean }[]; payments: { date: string; ref: string; description: string; amount: number; reversed: boolean }[]; from: string; to: string }) {
  const events = [
    ...p.invoices.filter(i => !i.void).map(i => ({ date: i.date, kind: "invoice" as const, ref: i.ref, description: i.description, debit: r2(i.total), credit: 0 })),
    ...p.payments.filter(x => !x.reversed).map(x => ({ date: x.date, kind: "payment" as const, ref: x.ref, description: x.description, debit: 0, credit: r2(x.amount) }))
  ].sort((a, b) => a.date.localeCompare(b.date) || (a.kind === "invoice" ? -1 : 1));
  let opening = 0;
  for (const e of events) if (e.date.slice(0, 10) < p.from) opening = r2(opening + e.debit - e.credit);
  let bal = opening;
  const lines: StatementLine[] = [];
  for (const e of events) {
    const d = e.date.slice(0, 10);
    if (d < p.from || d > p.to) continue;
    bal = r2(bal + e.debit - e.credit);
    lines.push({ ...e, date: d, balance: bal });
  }
  return { opening, lines, closing: bal, invoiced: r2(lines.reduce((a, l) => a + l.debit, 0)), paid: r2(lines.reduce((a, l) => a + l.credit, 0)) };
}
