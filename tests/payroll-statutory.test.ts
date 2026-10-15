import { describe, it, expect } from "vitest";
import { bandTax, computePay, workedShare, isPensionable, DEFAULT_PAY_SETTINGS, NTA2025_BANDS, type PayProfile } from "@/lib/payroll";

const base: PayProfile = { basic: 200_000, allowances: [{ name: "Housing", amount: 100_000 }, { name: "Transport", amount: 50_000 }], deductions: [], tax_percent: 0, pension_percent: 0 };

describe("PAYE bands (Nigeria Tax Act 2025)", () => {
  it("taxes each band at its own rate", () => {
    expect(bandTax(800_000)).toBe(0);
    expect(bandTax(3_000_000)).toBe(330_000);
    expect(bandTax(12_000_000)).toBe(330_000 + 1_620_000);
    expect(bandTax(60_000_000)).toBe(330_000 + 1_620_000 + 2_730_000 + 5_750_000 + 2_500_000);
    expect(bandTax(-5)).toBe(0);
  });
  it("uses a school's own bands when given", () => {
    expect(bandTax(1_000_000, [{ upto: 500_000, rate: 0 }, { upto: null, rate: 10 }])).toBe(50_000);
    expect(NTA2025_BANDS.at(-1)).toEqual({ upto: null, rate: 25 });
  });
});

describe("a month's pay", () => {
  it("works through pension, NHF, rent relief and PAYE", () => {
    const p = computePay({ ...base, nhf: true, annual_rent: 1_200_000 }, DEFAULT_PAY_SETTINGS);
    expect(p.gross).toBe(350_000);
    expect(p.pensionEmployee).toBe(28_000);                // 8% of basic + housing + transport
    expect(p.pensionEmployer).toBe(35_000);                // 10%
    expect(p.nhf).toBe(5_000);                             // 2.5% of basic
    expect(p.taxable).toBe(4_200_000 - 396_000 - 240_000); // annual pay less pension and NHF less 20% of rent
    expect(p.paye).toBe(35_960);
    expect(p.net).toBe(350_000 - 28_000 - 5_000 - 35_960);
    expect(p.employer.map(e => e.name)).toEqual(["Pension, employer (10%)", "NSITF (1%)"]);
    expect(p.employerTotal).toBe(35_000 + 3_500);
  });
  it("caps rent relief and pays no tax under the threshold", () => {
    expect(computePay({ ...base, annual_rent: 10_000_000 }, DEFAULT_PAY_SETTINGS).taxable).toBe(4_200_000 - 336_000 - 500_000);
    expect(computePay({ basic: 60_000, allowances: [], deductions: [], tax_percent: 0, pension_percent: 0 }, DEFAULT_PAY_SETTINGS).paye).toBe(0);
  });
  it("leaves out pension for exempt staff and non-taxable allowances from tax", () => {
    const p = computePay({ ...base, pension_exempt: true, allowances: [...base.allowances, { name: "Meal", amount: 12_000, taxable: false }] }, DEFAULT_PAY_SETTINGS);
    expect(p.pensionEmployee).toBe(0);
    expect(p.gross).toBe(362_000);
    expect(p.taxable).toBe(4_200_000);
  });
  it("knows which allowances count for pension", () => {
    expect(isPensionable({ name: "Housing allowance", amount: 1 })).toBe(true);
    expect(isPensionable({ name: "Leave allowance", amount: 1 })).toBe(false);
    expect(isPensionable({ name: "Leave allowance", amount: 1, pensionable: true })).toBe(true);
  });
  it("prorates joiners and leavers and deducts unpaid leave", () => {
    expect(workedShare("2026-10", null, null)).toEqual({ share: 1, days: 22 });
    const joined = workedShare("2026-10", "2026-10-19", null);       // Mon 19th to Sat 31st: 10 working days of 22
    expect(joined.days).toBe(10);
    expect(workedShare("2026-10", "2026-11-02", null).share).toBe(0);
    expect(workedShare("2026-10", null, "2026-10-02").days).toBe(2);
    const p = computePay(base, DEFAULT_PAY_SETTINGS, { share: 0.5, unpaidLeaveDays: 1, workingDays: 22 });
    expect(p.basic).toBe(100_000 - Math.round((200_000 / 22) * 100) / 100);
    expect(p.allowances).toEqual([{ name: "Housing", amount: 50_000 }, { name: "Transport", amount: 25_000 }]);
    expect(p.deductions[0].name).toBe("Unpaid leave (1 day)");
  });
  it("takes loan repayments last without going below zero", () => {
    const p = computePay({ basic: 50_000, allowances: [], deductions: [{ name: "Union dues", amount: 1_000 }], tax_percent: 0, pension_percent: 0 }, { ...DEFAULT_PAY_SETTINGS, nsitf_pct: 0 },
      { loans: [{ id: "l1", monthly_deduction: 30_000, balance: 10_000 }, { id: "l2", monthly_deduction: 40_000, balance: 100_000 }] });
    expect(p.loanRepayments).toEqual([{ loan_id: "l1", amount: 10_000 }, { loan_id: "l2", amount: 50_000 - 4_000 - 1_000 - 10_000 }]);
    expect(p.net).toBe(0);
  });
  it("keeps the flat rate for schools that use it", () => {
    const p = computePay({ ...base, tax_percent: 10, pension_percent: 7.5 }, { ...DEFAULT_PAY_SETTINGS, tax_regime: "flat" });
    expect(p.pensionEmployee).toBe(15_000);
    expect(p.paye).toBe(33_500);
  });
});
