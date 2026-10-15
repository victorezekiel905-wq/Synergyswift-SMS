/**
 * The general ledger, derived. Schools already record invoices, payments, expenses,
 * payroll, wallet top-ups and petty cash; each becomes a balanced double entry here,
 * alongside the manual journals the bursary posts (opening balances, corrections).
 * Pure functions: the server loads the rows, this builds postings, statements and exports.
 */

export type AccountType = "asset" | "liability" | "equity" | "income" | "expense";
export type Account = { id: string; code: string; name: string; type: AccountType; system_key: string | null; active?: boolean };
export type Source = "fees_billed" | "fees_received" | "expenses" | "petty_cash" | "payroll" | "wallet" | "journal";
export type Line = { account: string; debit: number; credit: number; description?: string };
export type Posting = { date: string; ref: string; memo: string; source: Source; lines: Line[] };

export const SOURCE_LABELS: Record<Source, string> = {
  fees_billed: "Fees billed", fees_received: "Fees received", expenses: "Expenses", petty_cash: "Petty cash",
  payroll: "Payroll", wallet: "Wallet & tuck shop", journal: "Journal"
};

/** The built-in chart. Codes are four digits so they also work as Sage nominal codes. */
export const DEFAULT_ACCOUNTS: { code: string; name: string; type: AccountType; system_key: string | null }[] = [
  { code: "1000", name: "Cash on hand", type: "asset", system_key: "cash" },
  { code: "1010", name: "Bank", type: "asset", system_key: "bank" },
  { code: "1020", name: "Petty cash", type: "asset", system_key: "petty_cash" },
  { code: "1100", name: "Fees receivable", type: "asset", system_key: "receivables" },
  { code: "2000", name: "Parent wallet deposits", type: "liability", system_key: "wallet" },
  { code: "2100", name: "Salaries payable", type: "liability", system_key: "salaries_payable" },
  { code: "2110", name: "Payroll deductions payable (tax, pension)", type: "liability", system_key: "deductions_payable" },
  { code: "3000", name: "Opening balance equity", type: "equity", system_key: "opening" },
  { code: "4000", name: "School fees", type: "income", system_key: "fee_income" },
  { code: "4100", name: "Late payment fees", type: "income", system_key: "late_fees" },
  { code: "4200", name: "Tuck shop sales", type: "income", system_key: "shop_sales" },
  { code: "4900", name: "Discounts and scholarships", type: "income", system_key: "discounts" },
  { code: "5000", name: "Salaries and wages", type: "expense", system_key: "salaries" },
  { code: "5100", name: "General expenses", type: "expense", system_key: "general_expense" },
  { code: "5110", name: "Supplies", type: "expense", system_key: null },
  { code: "5120", name: "Utilities", type: "expense", system_key: null },
  { code: "5130", name: "Repairs", type: "expense", system_key: null },
  { code: "5140", name: "Transport", type: "expense", system_key: null },
  { code: "5150", name: "Feeding", type: "expense", system_key: null },
  { code: "5160", name: "Events", type: "expense", system_key: null },
  { code: "5170", name: "Rent", type: "expense", system_key: null },
  { code: "5180", name: "Tax", type: "expense", system_key: null },
  { code: "5900", name: "Cash over and short", type: "expense", system_key: "cash_over_short" }
];
export const SYSTEM_KEYS = DEFAULT_ACCOUNTS.filter(a => a.system_key).map(a => a.system_key as string);

export type Mapping = { source: "fee_item" | "expense_category" | "payment_method"; key: string; account_id: string };

export type LedgerInput = {
  accounts: Account[];
  mappings: Mapping[];
  invoices: { id: string; invoice_no: string; created_at: string; status: string; voided_at: string | null;
    lines: { kind: string; amount: number; fee_item_id: string | null }[] }[];
  payments: { reference: string; receipt_no: string | null; amount: number; method: string; paid_at: string; invoice_no?: string | null }[];
  expenses: { id: string; category: string; description: string; amount: number; spent_on: string; method: string | null }[];
  pettyCash: { kind: string; amount: number; on_date: string; note: string | null; float_name: string }[];
  payroll: { period: string; status: string; gross: number; deductions: number; net: number; approved_at: string | null; paid_at: string | null }[];
  wallet: { kind: string; amount: number; method: string | null; created_at: string; reference: string }[];
  journals: { entry_no: string | null; entry_date: string; memo: string; lines: { account_id: string; debit: number; credit: number; description?: string | null }[] }[];
};

const cents = (n: number) => Math.round(Number(n) * 100);
const fromCents = (c: number) => c / 100;
const day = (s: string) => String(s).slice(0, 10);

/** How rows find their accounts: explicit mappings first, then sensible defaults. */
export function resolver(accounts: Account[], mappings: Mapping[]) {
  const bySys = new Map(accounts.filter(a => a.system_key).map(a => [a.system_key as string, a.id]));
  const map = new Map(mappings.map(m => [`${m.source}:${m.source === "fee_item" ? m.key : m.key.trim().toLowerCase()}`, m.account_id]));
  const expenseByName = new Map(accounts.filter(a => a.type === "expense").map(a => [a.name.trim().toLowerCase(), a.id]));
  const sys = (key: string) => {
    const id = bySys.get(key);
    if (!id) throw new Error(`the chart of accounts has no ${key} account`);
    return id;
  };
  return {
    sys,
    feeItem: (id: string | null) => (id && map.get(`fee_item:${id}`)) || sys("fee_income"),
    expenseCategory: (cat: string) => {
      const k = String(cat ?? "").trim().toLowerCase();
      return map.get(`expense_category:${k}`) ?? expenseByName.get(k) ?? sys("general_expense");
    },
    method: (m: string | null) => {
      const k = String(m ?? "").trim().toLowerCase();
      if (k === "petty_cash") return sys("petty_cash");
      return map.get(`payment_method:${k}`) ?? (k === "cash" ? sys("cash") : sys("bank"));
    }
  };
}

/** Builds one balanced posting from (account, signed amount) pairs: positive debits, negative credits. */
function posting(date: string, ref: string, memo: string, source: Source, moves: [string, number][]): Posting | null {
  const net = new Map<string, number>();
  for (const [acc, amt] of moves) net.set(acc, (net.get(acc) ?? 0) + cents(amt));
  const lines: Line[] = [];
  for (const [account, c] of net) if (c !== 0) lines.push({ account, debit: c > 0 ? fromCents(c) : 0, credit: c < 0 ? fromCents(-c) : 0 });
  return lines.length ? { date: day(date), ref, memo, source, lines } : null;
}

export function buildPostings(input: LedgerInput): Posting[] {
  const r = resolver(input.accounts, input.mappings);
  const out: Posting[] = [];
  const push = (p: Posting | null) => { if (p) out.push(p); };
  const recv = r.sys("receivables");

  for (const inv of input.invoices) {
    const moves: [string, number][] = [];
    for (const l of inv.lines) {
      const v = Number(l.amount);
      if (!v) continue;
      const target = l.kind === "discount" || l.kind === "scholarship" ? r.sys("discounts")
        : l.kind === "late_fee" ? r.sys("late_fees")
        : l.kind === "adjustment" && v < 0 ? r.sys("discounts")
        : r.feeItem(l.fee_item_id);
      moves.push([recv, v], [target, -v]);
    }
    if (inv.status === "void" && !inv.voided_at) continue;   // never really issued
    push(posting(inv.created_at, inv.invoice_no, `Invoice ${inv.invoice_no}`, "fees_billed", moves));
    if (inv.status === "void" && inv.voided_at) {
      push(posting(inv.voided_at, inv.invoice_no, `Invoice ${inv.invoice_no} voided`, "fees_billed", moves.map(([a, v]) => [a, -v])));
    }
  }
  for (const p of input.payments) {
    const ref = p.receipt_no ?? p.reference;
    push(posting(p.paid_at, ref, `Fees received${p.invoice_no ? ` for ${p.invoice_no}` : ""} (${p.method})`, "fees_received",
      [[r.method(p.method), Number(p.amount)], [recv, -Number(p.amount)]]));
  }
  for (const e of input.expenses) {
    push(posting(e.spent_on, `EXP-${e.id.slice(0, 8)}`, `${e.category}: ${e.description}`, "expenses",
      [[r.expenseCategory(e.category), Number(e.amount)], [r.method(e.method), -Number(e.amount)]]));
  }
  const petty = r.sys("petty_cash");
  for (const m of input.pettyCash) {
    const a = Number(m.amount), memo = `${m.float_name}: ${m.note || m.kind}`;
    if (m.kind === "topup") push(posting(m.on_date, "PETTY", `Top-up of ${memo}`, "petty_cash", [[petty, a], [r.sys("bank"), -a]]));
    else if (m.kind === "return") push(posting(m.on_date, "PETTY", `Returned from ${memo}`, "petty_cash", [[r.sys("bank"), a], [petty, -a]]));
    else if (m.kind === "adjust") push(posting(m.on_date, "PETTY", `Count difference, ${memo}`, "petty_cash", [[petty, a], [r.sys("cash_over_short"), -a]]));
    // spends are expenses (method petty_cash) and are posted with them
  }
  for (const run of input.payroll) {
    if (run.status !== "approved" && run.status !== "paid") continue;
    const gross = Number(run.gross), net = Number(run.net), ded = Math.round((gross - net) * 100) / 100;
    const accrued = run.approved_at ?? run.paid_at;
    if (accrued) push(posting(accrued, `PAY-${run.period}`, `Payroll ${run.period}`, "payroll",
      [[r.sys("salaries"), gross], [r.sys("salaries_payable"), -net], [r.sys("deductions_payable"), -ded]]));
    if (run.status === "paid" && run.paid_at) push(posting(run.paid_at, `PAY-${run.period}`, `Salaries paid ${run.period}`, "payroll",
      [[r.sys("salaries_payable"), net], [r.sys("bank"), -net]]));
  }
  const wallet = r.sys("wallet"), shop = r.sys("shop_sales");
  for (const w of input.wallet) {
    const a = Number(w.amount);
    if (w.kind === "topup") push(posting(w.created_at, w.reference, `Wallet top-up (${w.method ?? "cash"})`, "wallet", [[r.method(w.method), a], [wallet, -a]]));
    else if (w.kind === "purchase") push(posting(w.created_at, w.reference, "Tuck shop sale", "wallet", [[wallet, -a], [shop, a]]));
    else if (w.kind === "refund") push(posting(w.created_at, w.reference, "Tuck shop refund", "wallet", [[shop, a], [wallet, -a]]));
  }
  for (const j of input.journals) {
    out.push({ date: day(j.entry_date), ref: j.entry_no ?? "JNL", memo: j.memo, source: "journal",
      lines: j.lines.map(l => ({ account: l.account_id, debit: Number(l.debit), credit: Number(l.credit), description: l.description ?? undefined })) });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.ref.localeCompare(b.ref));
}

export function isBalanced(p: Posting) {
  return p.lines.reduce((s, l) => s + cents(l.debit) - cents(l.credit), 0) === 0;
}

const inRange = (d: string, from?: string | null, to?: string | null) => (!from || d >= from) && (!to || d <= to);

/** Net debit (in cents) per account over the postings in range. */
function netByAccount(postings: Posting[], from?: string | null, to?: string | null) {
  const m = new Map<string, number>();
  for (const p of postings) if (inRange(p.date, from, to)) for (const l of p.lines) m.set(l.account, (m.get(l.account) ?? 0) + cents(l.debit) - cents(l.credit));
  return m;
}

const order = (accounts: Account[]) => [...accounts].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));

export function trialBalance(postings: Posting[], accounts: Account[], asAt?: string | null) {
  const net = netByAccount(postings, null, asAt);
  const rows = order(accounts).map(a => {
    const c = net.get(a.id) ?? 0;
    return { account: a, debit: c > 0 ? fromCents(c) : 0, credit: c < 0 ? fromCents(-c) : 0 };
  }).filter(r => r.debit || r.credit);
  const debit = fromCents(rows.reduce((s, r) => s + cents(r.debit), 0)), credit = fromCents(rows.reduce((s, r) => s + cents(r.credit), 0));
  return { rows, debit, credit, balanced: cents(debit) === cents(credit) };
}

/** Income and expenditure for a period. Income shows as positive; contra-income (discounts) reduces it. */
export function incomeStatement(postings: Posting[], accounts: Account[], from: string, to: string) {
  const net = netByAccount(postings, from, to);
  const pick = (type: AccountType, sign: number) => order(accounts).filter(a => a.type === type)
    .map(a => ({ account: a, amount: fromCents(sign * (net.get(a.id) ?? 0)) })).filter(r => r.amount !== 0);
  const income = pick("income", -1), expenses = pick("expense", 1);
  const totalIncome = fromCents(income.reduce((s, r) => s + cents(r.amount), 0));
  const totalExpenses = fromCents(expenses.reduce((s, r) => s + cents(r.amount), 0));
  return { from, to, income, expenses, totalIncome, totalExpenses, surplus: fromCents(cents(totalIncome) - cents(totalExpenses)) };
}

/** Balance sheet at a date; all income less expenses to that date shows as the accumulated surplus. */
export function balanceSheet(postings: Posting[], accounts: Account[], asAt: string) {
  const net = netByAccount(postings, null, asAt);
  const pick = (type: AccountType, sign: number) => order(accounts).filter(a => a.type === type)
    .map(a => ({ account: a, amount: fromCents(sign * (net.get(a.id) ?? 0)) })).filter(r => r.amount !== 0);
  const assets = pick("asset", 1), liabilities = pick("liability", -1), equity = pick("equity", -1);
  const surplusC = accounts.filter(a => a.type === "income" || a.type === "expense").reduce((s, a) => s - (net.get(a.id) ?? 0), 0);
  const sum = (rows: { amount: number }[]) => rows.reduce((s, r) => s + cents(r.amount), 0);
  const totalAssets = sum(assets), totalLiabilities = sum(liabilities), totalEquity = sum(equity) + surplusC;
  return {
    asAt, assets, liabilities, equity, surplus: fromCents(surplusC),
    totalAssets: fromCents(totalAssets), totalLiabilities: fromCents(totalLiabilities), totalEquity: fromCents(totalEquity),
    balanced: totalAssets === totalLiabilities + totalEquity
  };
}

/** One account's movements with a running balance (debit positive for assets and expenses, credit positive otherwise). */
export function accountLedger(postings: Posting[], account: Account, from: string, to: string) {
  const sign = account.type === "asset" || account.type === "expense" ? 1 : -1;
  let bal = 0;
  for (const p of postings) if (p.date < from) for (const l of p.lines) if (l.account === account.id) bal += sign * (cents(l.debit) - cents(l.credit));
  const opening = fromCents(bal);
  const rows: { date: string; ref: string; memo: string; source: Source; debit: number; credit: number; balance: number }[] = [];
  for (const p of postings) {
    if (!inRange(p.date, from, to)) continue;
    for (const l of p.lines) {
      if (l.account !== account.id) continue;
      bal += sign * (cents(l.debit) - cents(l.credit));
      rows.push({ date: p.date, ref: p.ref, memo: l.description || p.memo, source: p.source, debit: l.debit, credit: l.credit, balance: fromCents(bal) });
    }
  }
  return { opening, rows, closing: fromCents(bal) };
}

/** One journal per day and source (journals stay as posted), netting each account. What accountants import. */
export function summarise(postings: Posting[]): Posting[] {
  const groups = new Map<string, Posting[]>();
  const out: Posting[] = [];
  for (const p of postings) {
    if (p.source === "journal") { out.push(p); continue; }
    const k = `${p.date}|${p.source}`;
    const g = groups.get(k);
    if (g) g.push(p); else groups.set(k, [p]);
  }
  for (const [k, ps] of groups) {
    const [date, source] = k.split("|") as [string, Source];
    const merged = posting(date, `${source.toUpperCase().replace("_", "-")}-${date}`, `${SOURCE_LABELS[source]}, ${date} (${ps.length})`, source,
      ps.flatMap(p => p.lines.map(l => [l.account, l.debit - l.credit] as [string, number])));
    if (merged) out.push(merged);
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.ref.localeCompare(b.ref));
}

export type ExportFormat = "quickbooks" | "sage" | "zoho" | "generic";
const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const amt = (n: number) => n ? n.toFixed(2) : "";

/**
 * Journal files for the accounting packages' import screens:
 * QuickBooks Online (Journal entries import), Sage 50 (audit trail import, JD/JC rows) and Zoho Books (manual journals import).
 * Accounts go by name for QuickBooks and Zoho and by nominal code for Sage, so the charts should match.
 */
export function exportRows(postings: Posting[], accounts: Account[], format: ExportFormat, currency: string): (string | number)[][] {
  const acc = new Map(accounts.map(a => [a.id, a]));
  const name = (id: string) => acc.get(id)?.name ?? "Unknown account";
  const code = (id: string) => acc.get(id)?.code ?? "";
  const rows: (string | number)[][] = [];
  if (format === "quickbooks") {
    rows.push(["Journal No", "Journal Date", "Currency", "Memo", "Account", "Debits", "Credits", "Description"]);
    for (const p of postings) for (const l of p.lines) rows.push([p.ref, dmy(p.date), currency, p.memo, name(l.account), amt(l.debit), amt(l.credit), l.description ?? p.memo]);
  } else if (format === "sage") {
    rows.push(["Type", "Account Reference", "Nominal A/C Ref", "Department Code", "Date", "Reference", "Details", "Net Amount", "Tax Code", "Tax Amount"]);
    for (const p of postings) for (const l of p.lines) rows.push([l.debit ? "JD" : "JC", "", code(l.account), "", dmy(p.date), p.ref.slice(0, 30), (l.description ?? p.memo).slice(0, 60), (l.debit || l.credit).toFixed(2), "T9", "0.00"]);
  } else if (format === "zoho") {
    rows.push(["Journal Date", "Journal Number", "Reference Number", "Notes", "Currency", "Account", "Description", "Debit", "Credit", "Status"]);
    for (const p of postings) for (const l of p.lines) rows.push([p.date, p.ref, p.ref, p.memo, currency, name(l.account), l.description ?? p.memo, amt(l.debit), amt(l.credit), "Published"]);
  } else {
    rows.push(["Date", "Journal", "Source", "Memo", "Account code", "Account", "Debit", "Credit", "Description"]);
    for (const p of postings) for (const l of p.lines) rows.push([p.date, p.ref, SOURCE_LABELS[p.source], p.memo, code(l.account), name(l.account), amt(l.debit), amt(l.credit), l.description ?? ""]);
  }
  return rows;
}

/** Budget against what actually happened, by category. Categories with spending but no budget are listed too. */
export function budgetVsActual(lines: { kind: "income" | "expense"; category: string; amount: number }[],
  actual: { income: Record<string, number>; expense: Record<string, number> }) {
  const norm = (s: string) => s.trim().toLowerCase();
  const rows: { kind: "income" | "expense"; category: string; budget: number; actual: number; variance: number; used: number | null }[] = [];
  for (const kind of ["income", "expense"] as const) {
    const act = new Map<string, { label: string; v: number }>();
    for (const [k, v] of Object.entries(actual[kind])) {
      const e = act.get(norm(k));
      act.set(norm(k), { label: e?.label ?? k, v: (e?.v ?? 0) + Number(v) });
    }
    const seen = new Set<string>();
    for (const l of lines.filter(l => l.kind === kind)) {
      seen.add(norm(l.category));
      const a = act.get(norm(l.category))?.v ?? 0;
      rows.push({ kind, category: l.category, budget: Number(l.amount), actual: fromCents(cents(a)),
        // positive variance is good: more income or less spending than planned
        variance: fromCents(kind === "income" ? cents(a) - cents(l.amount) : cents(l.amount) - cents(a)),
        used: Number(l.amount) ? Math.round((a / Number(l.amount)) * 1000) / 10 : null });
    }
    for (const [k, e] of act) if (!seen.has(k) && e.v) rows.push({ kind, category: e.label, budget: 0, actual: fromCents(cents(e.v)),
      variance: fromCents(kind === "income" ? cents(e.v) : -cents(e.v)), used: null });
  }
  const tot = (kind: "income" | "expense", f: "budget" | "actual") => fromCents(rows.filter(r => r.kind === kind).reduce((s, r) => s + cents(r[f]), 0));
  return { rows, totals: { incomeBudget: tot("income", "budget"), incomeActual: tot("income", "actual"), expenseBudget: tot("expense", "budget"), expenseActual: tot("expense", "actual") } };
}

/** Sums rows into named groups, largest first. */
export function groupSum<T>(rows: T[], key: (r: T) => string, value: (r: T) => number) {
  const m = new Map<string, { count: number; c: number }>();
  for (const r of rows) {
    const k = key(r) || "—";
    const e = m.get(k) ?? { count: 0, c: 0 };
    e.count++; e.c += cents(value(r));
    m.set(k, e);
  }
  return [...m].map(([label, e]) => ({ label, count: e.count, amount: fromCents(e.c) })).sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label));
}

/** Validates a manual journal before it is saved: whole lines, one side each, balanced. */
export function checkJournal(lines: { account_id: string; debit: number; credit: number }[]) {
  const problems: string[] = [];
  if (lines.length < 2) problems.push("a journal needs at least two lines");
  lines.forEach((l, i) => {
    if (!l.account_id) problems.push(`line ${i + 1}: choose an account`);
    if ((l.debit > 0) === (l.credit > 0)) problems.push(`line ${i + 1}: enter a debit or a credit, not both`);
    if (l.debit < 0 || l.credit < 0) problems.push(`line ${i + 1}: amounts cannot be negative`);
  });
  const dr = lines.reduce((s, l) => s + cents(l.debit || 0), 0), cr = lines.reduce((s, l) => s + cents(l.credit || 0), 0);
  if (dr !== cr) problems.push(`debits (${fromCents(dr).toFixed(2)}) and credits (${fromCents(cr).toFixed(2)}) differ by ${fromCents(Math.abs(dr - cr)).toFixed(2)}`);
  return { ok: problems.length === 0, problems, debit: fromCents(dr), credit: fromCents(cr) };
}
