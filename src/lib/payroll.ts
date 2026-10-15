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

// ---------------------------------------------------------------------------
// Statutory payroll (Nigeria). Rates are school settings; the defaults follow the
// Nigeria Tax Act 2025 (in force 1 January 2026) and the Pension Reform Act 2014.
// Schools should confirm them with their tax adviser.
// ---------------------------------------------------------------------------

export type Band = { upto: number | null; rate: number };   // upto = top of the band (annual, cumulative); null = no limit
export const NTA2025_BANDS: Band[] = [
  { upto: 800_000, rate: 0 }, { upto: 3_000_000, rate: 15 }, { upto: 12_000_000, rate: 18 },
  { upto: 25_000_000, rate: 21 }, { upto: 50_000_000, rate: 23 }, { upto: null, rate: 25 }
];

/** Annual tax on annual taxable income, band by band. */
export function bandTax(annualTaxable: number, bands: Band[] = NTA2025_BANDS) {
  let tax = 0, lower = 0;
  const income = Math.max(0, annualTaxable);
  for (const b of bands) {
    const top = b.upto ?? Infinity;
    if (income > lower) tax += (Math.min(income, top) - lower) * (b.rate / 100);
    if (income <= top) break;
    lower = top;
  }
  return r2(tax);
}

export type PaySettings = {
  tax_regime: "nta2025" | "flat"; tax_bands?: Band[] | null;
  pension_employee_pct: number; pension_employer_pct: number; nhf_pct: number; nhis_employee_pct: number; nhis_employer_pct: number;
  nsitf_pct: number; itf_pct: number; rent_relief_pct: number; rent_relief_cap: number;
};
export const DEFAULT_PAY_SETTINGS: PaySettings = {
  tax_regime: "nta2025", tax_bands: null, pension_employee_pct: 8, pension_employer_pct: 10, nhf_pct: 2.5, nhis_employee_pct: 0, nhis_employer_pct: 0,
  nsitf_pct: 1, itf_pct: 0, rent_relief_pct: 20, rent_relief_cap: 500_000
};

export type PayAllowance = { name: string; amount: number; pensionable?: boolean | null; taxable?: boolean | null };
export type PayProfile = Omit<SalaryProfile, "allowances"> & { allowances: PayAllowance[]; annual_rent?: number; nhf?: boolean; nhis?: boolean; pension_exempt?: boolean };
export type Loan = { id: string; monthly_deduction: number; balance: number };

/** Housing, transport and rent allowances count towards pension unless marked otherwise. */
export const isPensionable = (a: PayAllowance) => a.pensionable ?? /housing|transport|rent|accommodation/i.test(a.name);

/** Share of a month someone was employed (joined or left part-way), counted in working days. */
export function workedShare(period: string, hireDate: string | null, exitDate: string | null) {
  const [y, m] = period.split("-").map(Number);
  const first = `${period}-01`, last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const from = hireDate && hireDate > first ? hireDate : first, to = exitDate && exitDate < last ? exitDate : last;
  if (to < from) return { share: 0, days: 0 };
  const total = workingDaysInMonth(period);
  if (from === first && to === last) return { share: 1, days: total };
  const days = leaveDaysInMonth(period, from, to);
  return { share: total ? days / total : 0, days };
}

/**
 * One month's pay. Under the 2025 Act: pension (employee share) on basic + pensionable allowances,
 * NHF on basic, NHIS on basic; PAYE on annualised taxable pay less those contributions and rent relief.
 * The flat regime keeps the older per-person tax and pension percentages.
 */
export function computePay(p: PayProfile, s: PaySettings, opts: { workingDays?: number; unpaidLeaveDays?: number; share?: number; loans?: Loan[] } = {}) {
  const share = Math.min(1, Math.max(0, opts.share ?? 1));
  const wd = Math.max(1, opts.workingDays ?? 22);
  const basic = r2(Math.max(0, Number(p.basic) || 0) * share);
  const unpaid = Math.max(0, opts.unpaidLeaveDays ?? 0);
  const leaveDeduction = r2(Math.min(basic, (Number(p.basic) / wd) * unpaid));
  const allowances = (p.allowances ?? []).filter(a => a.name && Number(a.amount) > 0)
    .map(a => ({ name: a.name, amount: r2(Number(a.amount) * share), pensionable: isPensionable(a), taxable: a.taxable !== false }));
  const basicPaid = r2(basic - leaveDeduction);
  const gross = r2(basicPaid + allowances.reduce((t, a) => t + a.amount, 0));
  const deductions: { name: string; amount: number }[] = [];
  const employer: { name: string; amount: number }[] = [];
  const add = (list: typeof deductions, name: string, amount: number) => { const v = r2(amount); if (v > 0) list.push({ name, amount: v }); return v; };

  let pensionEmployee = 0, nhf = 0, nhis = 0, paye = 0, taxable = 0, pensionEmployer = 0;
  if (s.tax_regime === "nta2025") {
    const pensionBase = basicPaid + allowances.filter(a => a.pensionable).reduce((t, a) => t + a.amount, 0);
    if (!p.pension_exempt) {
      pensionEmployee = add(deductions, `Pension (${s.pension_employee_pct}%)`, pensionBase * s.pension_employee_pct / 100);
      pensionEmployer = add(employer, `Pension, employer (${s.pension_employer_pct}%)`, pensionBase * s.pension_employer_pct / 100);
    }
    if (p.nhf) nhf = add(deductions, `NHF (${s.nhf_pct}%)`, basicPaid * s.nhf_pct / 100);
    if (p.nhis) {
      nhis = add(deductions, `NHIS (${s.nhis_employee_pct}%)`, basicPaid * s.nhis_employee_pct / 100);
      add(employer, `NHIS, employer (${s.nhis_employer_pct}%)`, basicPaid * s.nhis_employer_pct / 100);
    }
    const taxablePay = gross - allowances.filter(a => !a.taxable).reduce((t, a) => t + a.amount, 0);
    const rentRelief = Math.min(Math.max(0, Number(p.annual_rent) || 0) * s.rent_relief_pct / 100, s.rent_relief_cap);
    taxable = r2(Math.max(0, taxablePay * 12 - (pensionEmployee + nhf + nhis) * 12 - rentRelief));
    paye = add(deductions, "PAYE", bandTax(taxable, s.tax_bands?.length ? s.tax_bands : NTA2025_BANDS) / 12);
  } else {
    pensionEmployee = add(deductions, `Pension (${p.pension_percent}%)`, basicPaid * (Number(p.pension_percent) || 0) / 100);
    if (s.pension_employer_pct > 0 && pensionEmployee > 0) pensionEmployer = add(employer, `Pension, employer (${s.pension_employer_pct}%)`, basicPaid * s.pension_employer_pct / 100);
    taxable = r2(Math.max(0, gross - pensionEmployee) * 12);
    paye = add(deductions, `Tax (${p.tax_percent}%)`, Math.max(0, gross - pensionEmployee) * (Number(p.tax_percent) || 0) / 100);
  }
  add(employer, `NSITF (${s.nsitf_pct}%)`, gross * s.nsitf_pct / 100);
  add(employer, `ITF (${s.itf_pct}%)`, gross * s.itf_pct / 100);
  for (const d of p.deductions ?? []) {
    if (!d.name) continue;
    add(deductions, d.percent ? `${d.name} (${d.percent}%)` : d.name, d.percent ? basicPaid * Number(d.percent) / 100 : Number(d.amount) || 0);
  }
  // Loans come last and never push pay below zero.
  const loanRepayments: { loan_id: string; amount: number }[] = [];
  let room = r2(gross - deductions.reduce((t, d) => t + d.amount, 0));
  for (const l of opts.loans ?? []) {
    const amt = r2(Math.min(Number(l.monthly_deduction), Number(l.balance), Math.max(0, room)));
    if (amt <= 0) continue;
    loanRepayments.push({ loan_id: l.id, amount: amt });
    deductions.push({ name: "Loan repayment", amount: amt });
    room = r2(room - amt);
  }
  const totalDeductions = r2(deductions.reduce((t, d) => t + d.amount, 0));
  if (leaveDeduction > 0) deductions.unshift({ name: `Unpaid leave (${unpaid} day${unpaid === 1 ? "" : "s"})`, amount: 0 });   // shown for information; already out of gross
  return {
    basic: basicPaid, leaveDeduction, allowances: allowances.map(a => ({ name: a.name, amount: a.amount })), gross,
    deductions, totalDeductions, net: r2(Math.max(0, gross - totalDeductions)),
    paye, taxable, pensionEmployee, pensionEmployer, nhf, employer, employerTotal: r2(employer.reduce((t, e) => t + e.amount, 0)), loanRepayments
  };
}
