import { describe, it, expect } from "vitest";
import { DEFAULT_ACCOUNTS, buildPostings, isBalanced, trialBalance, incomeStatement, balanceSheet, accountLedger, summarise, exportRows,
  budgetVsActual, groupSum, checkJournal, resolver, type Account, type LedgerInput } from "@/lib/ledger";

const accounts: Account[] = DEFAULT_ACCOUNTS.map((a, i) => ({ ...a, id: `acc${i}` }));
const id = (key: string) => accounts.find(a => a.system_key === key || a.name === key)!.id;
const BUS = "acc-bus";
const chart: Account[] = [...accounts, { id: BUS, code: "4010", name: "Bus fees", type: "income", system_key: null }];

const input: LedgerInput = {
  accounts: chart,
  mappings: [{ source: "fee_item", key: "item-bus", account_id: BUS }, { source: "payment_method", key: "online", account_id: id("bank") }],
  invoices: [
    { id: "i1", invoice_no: "INV-1", created_at: "2026-01-05T09:00:00Z", status: "part_paid", voided_at: null,
      lines: [{ kind: "charge", amount: 100000, fee_item_id: "item-tuition" }, { kind: "charge", amount: 20000, fee_item_id: "item-bus" },
        { kind: "discount", amount: -10000, fee_item_id: null }, { kind: "late_fee", amount: 5000, fee_item_id: null }] },
    { id: "i2", invoice_no: "INV-2", created_at: "2026-01-05T09:00:00Z", status: "void", voided_at: "2026-01-20T10:00:00Z",
      lines: [{ kind: "charge", amount: 50000, fee_item_id: null }] },
    { id: "i3", invoice_no: "INV-3", created_at: "2026-01-05T09:00:00Z", status: "void", voided_at: null,
      lines: [{ kind: "charge", amount: 70000, fee_item_id: null }] }
  ],
  payments: [{ reference: "R1", receipt_no: "RCT-1", amount: 60000, method: "cash", paid_at: "2026-01-10T12:00:00Z", invoice_no: "INV-1" },
    { reference: "R2", receipt_no: "RCT-2", amount: 15000, method: "online", paid_at: "2026-01-11T12:00:00Z" }],
  expenses: [{ id: "e1234567890", category: "Utilities", description: "Power", amount: 8000, spent_on: "2026-01-12", method: "transfer" },
    { id: "e2234567890", category: "Snacks", description: "Biscuits", amount: 1500, spent_on: "2026-01-12", method: "petty_cash" }],
  pettyCash: [{ kind: "topup", amount: 5000, on_date: "2026-01-02", note: null, float_name: "Front office" },
    { kind: "spend", amount: 1500, on_date: "2026-01-12", note: "Biscuits", float_name: "Front office" },
    { kind: "adjust", amount: -200, on_date: "2026-01-31", note: "count", float_name: "Front office" }],
  payroll: [{ period: "2026-01", status: "paid", gross: 300000, deductions: 30000, net: 270000, employer_total: 33000, approved_at: "2026-01-28T10:00:00Z", paid_at: "2026-01-30T10:00:00Z" },
    { period: "2026-02", status: "draft", gross: 1, deductions: 0, net: 1, approved_at: null, paid_at: null }],
  wallet: [{ kind: "topup", amount: 3000, method: "online", created_at: "2026-01-03T08:00:00Z", reference: "W1" },
    { kind: "purchase", amount: -700, method: null, created_at: "2026-01-04T08:00:00Z", reference: "W2" }],
  journals: [{ entry_no: "JNL-1", entry_date: "2026-01-01", memo: "Opening balances", lines: [
    { account_id: id("bank"), debit: 500000, credit: 0 }, { account_id: id("opening"), debit: 0, credit: 500000 }] }]
};
const postings = buildPostings(input);
const net = (acc: string, to?: string) => postings.filter(p => !to || p.date <= to).flatMap(p => p.lines).filter(l => l.account === acc).reduce((s, l) => s + l.debit - l.credit, 0);

describe("deriving the ledger", () => {
  it("balances every posting", () => {
    expect(postings.length).toBeGreaterThan(8);
    for (const p of postings) expect(isBalanced(p)).toBe(true);
  });
  it("posts invoices to receivables, income by fee item, discounts and late fees", () => {
    const inv = postings.find(p => p.ref === "INV-1")!;
    expect(inv.source).toBe("fees_billed");
    const by = (k: string) => inv.lines.find(l => l.account === id(k));
    expect(by("receivables")).toMatchObject({ debit: 115000, credit: 0 });
    expect(by("fee_income")).toMatchObject({ credit: 100000 });
    expect(inv.lines.find(l => l.account === BUS)).toMatchObject({ credit: 20000 });
    expect(by("discounts")).toMatchObject({ debit: 10000 });
    expect(by("late_fees")).toMatchObject({ credit: 5000 });
  });
  it("reverses voided invoices on the day they were voided, and skips ones never issued", () => {
    const v = postings.filter(p => p.ref === "INV-2");
    expect(v.map(p => p.date)).toEqual(["2026-01-05", "2026-01-20"]);
    expect(postings.some(p => p.ref === "INV-3")).toBe(false);
    expect(net(id("receivables"), "2026-01-19")).toBe(115000 + 50000 - 75000);
    expect(net(id("receivables"))).toBe(115000 - 75000);
  });
  it("puts money where it was paid", () => {
    expect(net(id("cash"))).toBe(60000);
    expect(net(id("bank"))).toBe(500000 + 15000 + 3000 - 8000 - 5000 - 270000);
    expect(net(id("petty_cash"))).toBe(5000 - 1500 - 200);
  });
  it("finds expense accounts by mapping, then by name, then general", () => {
    expect(net(id("Utilities"))).toBe(8000);
    expect(net(id("general_expense"))).toBe(1500);
    const r = resolver(chart, [{ source: "expense_category", key: "  SNACKS ", account_id: id("Feeding") }]);
    expect(r.expenseCategory("snacks")).toBe(id("Feeding"));
    expect(r.method(null)).toBe(id("bank"));
  });
  it("accrues payroll when approved and clears it when paid; drafts are ignored", () => {
    expect(net(id("salaries"))).toBe(300000 + 33000);          // gross pay and the employer's pension and levies
    expect(net(id("salaries_payable"))).toBe(0);
    expect(net(id("deductions_payable"))).toBe(-30000 - 33000);
  });
  it("holds wallet money as a liability until it is spent", () => {
    expect(net(id("wallet"))).toBe(-3000 + 700);
    expect(net(id("shop_sales"))).toBe(-700);
  });
  it("complains if a built-in account is missing", () => {
    expect(() => buildPostings({ ...input, accounts: chart.filter(a => a.system_key !== "receivables") })).toThrow(/receivables/);
  });
});

describe("statements", () => {
  it("trial balance balances", () => {
    const tb = trialBalance(postings, chart);
    expect(tb.balanced).toBe(true);
    expect(tb.debit).toBe(tb.credit);
    expect(tb.rows[0].account.code <= tb.rows[1].account.code).toBe(true);
  });
  it("income and expenditure nets discounts against income", () => {
    const pl = incomeStatement(postings, chart, "2026-01-01", "2026-01-31");
    expect(pl.totalIncome).toBe(100000 + 20000 - 10000 + 5000 + 50000 - 50000 + 700);
    expect(pl.income.find(r => r.account.system_key === "discounts")!.amount).toBe(-10000);
    expect(pl.totalExpenses).toBe(8000 + 1500 + 200 + 300000 + 33000);
    expect(pl.surplus).toBe(pl.totalIncome - pl.totalExpenses);
  });
  it("balance sheet balances, with the surplus in equity", () => {
    const bs = balanceSheet(postings, chart, "2026-01-31");
    expect(bs.balanced).toBe(true);
    expect(bs.totalAssets).toBe(bs.totalLiabilities + bs.totalEquity);
    expect(bs.surplus).toBe(incomeStatement(postings, chart, "2000-01-01", "2026-01-31").surplus);
    expect(balanceSheet(postings, chart, "2026-01-15").balanced).toBe(true);
  });
  it("account ledger carries an opening balance and a running balance", () => {
    const bank = chart.find(a => a.system_key === "bank")!;
    const l = accountLedger(postings, bank, "2026-01-10", "2026-01-31");
    expect(l.opening).toBe(500000 + 3000 - 5000);
    expect(l.rows[l.rows.length - 1].balance).toBe(l.closing);
    expect(l.closing).toBe(net(bank.id));
    const income = chart.find(a => a.system_key === "fee_income")!;
    expect(accountLedger(postings, income, "2026-01-01", "2026-01-31").closing).toBe(150000 - 50000);
  });
});

describe("exports", () => {
  it("summarises to one balanced journal per day and source", () => {
    const s = summarise(postings);
    const day5 = s.filter(p => p.date === "2026-01-05" && p.source === "fees_billed");
    expect(day5).toHaveLength(1);
    expect(day5[0].memo).toContain("(2)");
    for (const p of s) expect(isBalanced(p)).toBe(true);
    expect(s.find(p => p.source === "journal")!.ref).toBe("JNL-1");
    expect(trialBalance(s, chart)).toEqual(trialBalance(postings, chart));
  });
  it("writes QuickBooks, Sage and Zoho layouts", () => {
    const one = postings.filter(p => p.ref === "JNL-1");
    const qb = exportRows(one, chart, "quickbooks", "NGN");
    expect(qb[0]).toEqual(["Journal No", "Journal Date", "Currency", "Memo", "Account", "Debits", "Credits", "Description"]);
    expect(qb[1]).toEqual(["JNL-1", "01/01/2026", "NGN", "Opening balances", "Bank", "500000.00", "", "Opening balances"]);
    const sage = exportRows(one, chart, "sage", "NGN");
    expect(sage[1].slice(0, 3)).toEqual(["JD", "", "1010"]);
    expect(sage[2][0]).toBe("JC");
    expect(sage[2][7]).toBe("500000.00");
    const zoho = exportRows(one, chart, "zoho", "NGN");
    expect(zoho[2]).toContain("Opening balance equity");
    expect(zoho[2][8]).toBe("500000.00");
    expect(exportRows(one, chart, "generic", "NGN")[1][2]).toBe("Journal");
  });
});

describe("budgets, reports and journals", () => {
  it("compares budget with actual, including unbudgeted spending", () => {
    const r = budgetVsActual([{ kind: "expense", category: "Utilities", amount: 10000 }, { kind: "income", category: "Tuition", amount: 100000 }],
      { income: { tuition: 90000 }, expense: { Utilities: 12000, Snacks: 500 } });
    expect(r.rows.find(x => x.category === "Utilities")).toMatchObject({ actual: 12000, variance: -2000, used: 120 });
    expect(r.rows.find(x => x.category === "Tuition")).toMatchObject({ actual: 90000, variance: -10000, used: 90 });
    expect(r.rows.find(x => x.category === "Snacks")).toMatchObject({ budget: 0, actual: 500, variance: -500, used: null });
    expect(r.totals).toEqual({ incomeBudget: 100000, incomeActual: 90000, expenseBudget: 10000, expenseActual: 12500 });
  });
  it("groups and sums", () => {
    expect(groupSum([{ m: "cash", a: 0.1 }, { m: "cash", a: 0.2 }, { m: "", a: 5 }], r => r.m, r => r.a))
      .toEqual([{ label: "—", count: 1, amount: 5 }, { label: "cash", count: 2, amount: 0.3 }]);
  });
  it("checks manual journals", () => {
    expect(checkJournal([{ account_id: "a", debit: 10, credit: 0 }, { account_id: "b", debit: 0, credit: 10 }]).ok).toBe(true);
    const bad = checkJournal([{ account_id: "a", debit: 10, credit: 5 }, { account_id: "", debit: 0, credit: 3 }]);
    expect(bad.ok).toBe(false);
    expect(bad.problems.join(" ")).toMatch(/line 1.*not both.*line 2: choose.*differ by 2.00/);
    expect(checkJournal([{ account_id: "a", debit: 1, credit: 0 }]).problems[0]).toMatch(/two lines/);
  });
});
