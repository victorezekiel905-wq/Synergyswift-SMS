/**
 * Payroll maths. Pure functions, unit-tested.
 *
 * gross      = basic − unpaid-leave deduction + allowances
 * pension    = pension% × basic
 * tax        = tax% × (gross − pension)      (flat rate set per staff; schools
 *              with graduated PAYE can enter the monthly tax as a fixed deduction)
 * other      = fixed amounts, or % of basic
 * net        = gross − (pension + tax + other), never below zero
 */
export type Allowance = { name: string; amount: number };
export type Deduction = { name: string; amount?: number | null; percent?: number | null };
export type SalaryProfile = { basic: number; allowances: Allowance[]; deductions: Deduction[]; tax_percent: number; pension_percent: number };

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Monday–Friday count in a month (period "YYYY-MM"). */
export function workingDaysInMonth(period: string): number {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1, 1));
  let n = 0;
  while (d.getUTCMonth() === m - 1) { const w = d.getUTCDay(); if (w !== 0 && w !== 6) n++; d.setUTCDate(d.getUTCDate() + 1); }
  return n;
}

/** Working days of a leave range that fall inside the payroll month. */
export function leaveDaysInMonth(period: string, startsOn: string, endsOn: string): number {
  const [y, m] = period.split("-").map(Number);
  const monthStart = Date.UTC(y, m - 1, 1), monthEnd = Date.UTC(y, m, 0);
  const from = Math.max(monthStart, Date.parse(`${startsOn}T00:00:00Z`));
  const to = Math.min(monthEnd, Date.parse(`${endsOn}T00:00:00Z`));
  let n = 0;
  for (let t = from; t <= to; t += 86400_000) { const w = new Date(t).getUTCDay(); if (w !== 0 && w !== 6) n++; }
  return n;
}

export function computePayslip(p: SalaryProfile, opts: { unpaidLeaveDays?: number; workingDays?: number } = {}) {
  const basic = Math.max(0, Number(p.basic) || 0);
  const unpaid = Math.max(0, opts.unpaidLeaveDays ?? 0);
  const wd = Math.max(1, opts.workingDays ?? 22);
  const leaveDeduction = r2(Math.min(basic, (basic / wd) * unpaid));
  const allowances = (p.allowances ?? []).filter(a => a.name && Number(a.amount) > 0).map(a => ({ name: a.name, amount: r2(Number(a.amount)) }));
  const gross = r2(basic - leaveDeduction + allowances.reduce((s, a) => s + a.amount, 0));

  const lines: { name: string; amount: number }[] = [];
  if (leaveDeduction > 0) lines.push({ name: `Unpaid leave (${unpaid} day${unpaid === 1 ? "" : "s"})`, amount: 0 }); // shown for info; already out of gross
  const pension = r2(basic * (Math.max(0, Number(p.pension_percent) || 0) / 100));
  if (pension > 0) lines.push({ name: `Pension (${p.pension_percent}%)`, amount: pension });
  const tax = r2(Math.max(0, gross - pension) * (Math.max(0, Number(p.tax_percent) || 0) / 100));
  if (tax > 0) lines.push({ name: `Tax (${p.tax_percent}%)`, amount: tax });
  for (const d of p.deductions ?? []) {
    if (!d.name) continue;
    const amt = d.percent ? r2(basic * (Number(d.percent) / 100)) : r2(Number(d.amount) || 0);
    if (amt > 0) lines.push({ name: d.percent ? `${d.name} (${d.percent}%)` : d.name, amount: amt });
  }
  const totalDeductions = r2(lines.reduce((s, l) => s + l.amount, 0));
  return {
    basic, leaveDeduction, allowances, gross,
    deductions: lines.filter(l => l.amount > 0 || l.name.startsWith("Unpaid")),
    totalDeductions,
    net: r2(Math.max(0, gross - totalDeductions))
  };
}
