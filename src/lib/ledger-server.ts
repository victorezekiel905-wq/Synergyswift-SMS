import { fetchAll } from "@/lib/results";
import { studentName } from "@/lib/school";
import { DEFAULT_ACCOUNTS, buildPostings, groupSum, type Account, type LedgerInput, type Mapping } from "@/lib/ledger";

/** The school's chart, with any missing built-in accounts added (first use, or after an upgrade). */
export async function ensureChart(svc: any, tenantId: string): Promise<Account[]> {
  const { data } = await svc.from("ledger_accounts").select("id,code,name,type,system_key,active").eq("tenant_id", tenantId);
  const have = (data ?? []) as Account[];
  const keys = new Set(have.map(a => a.system_key).filter(Boolean));
  const codes = new Set(have.map(a => a.code));
  const first = have.length === 0;
  const missing = DEFAULT_ACCOUNTS.filter(a => a.system_key ? !keys.has(a.system_key) : first && !codes.has(a.code));
  if (!missing.length) return have;
  const rows = missing.map(a => {
    let code = a.code;
    while (codes.has(code)) code = String(Number(code) + 1);   // a school may already use the code
    codes.add(code);
    return { tenant_id: tenantId, code, name: a.name, type: a.type, system_key: a.system_key };
  });
  const { error } = await svc.from("ledger_accounts").insert(rows);
  if (error) throw new Error(error.message);
  const { data: again } = await svc.from("ledger_accounts").select("id,code,name,type,system_key,active").eq("tenant_id", tenantId);
  return (again ?? []) as Account[];
}

/** Everything the ledger is derived from, up to a date. */
export async function loadLedger(svc: any, tenantId: string, to: string) {
  const end = `${to}T23:59:59.999Z`;
  const accounts = await ensureChart(svc, tenantId);
  const [mappings, invoices, payments, expenses, petty, payroll, wallet, journals] = await Promise.all([
    svc.from("ledger_mappings").select("source,key,account_id").eq("tenant_id", tenantId).then((r: any) => r.data ?? []),
    fetchAll<any>(() => svc.from("fee_invoices").select("id,invoice_no,created_at,status,voided_at,fee_invoice_lines(kind,amount,fee_item_id)")
      .eq("tenant_id", tenantId).lte("created_at", end).order("created_at")),
    fetchAll<any>(() => svc.from("fee_payments").select("reference,receipt_no,amount,method,paid_at,fee_invoices(invoice_no)")
      .eq("tenant_id", tenantId).eq("status", "success").not("paid_at", "is", null).lte("paid_at", end).order("paid_at")),
    fetchAll<any>(() => svc.from("expenses").select("id,category,description,amount,spent_on,method").eq("tenant_id", tenantId).lte("spent_on", to).order("spent_on")),
    fetchAll<any>(() => svc.from("petty_cash_moves").select("kind,amount,on_date,note,petty_cash_floats(name)").eq("tenant_id", tenantId).neq("kind", "spend").lte("on_date", to).order("on_date")),
    svc.from("payroll_runs").select("period,status,gross,deductions,net,employer_total,approved_at,paid_at").eq("tenant_id", tenantId).in("status", ["approved", "paid"]).then((r: any) => r.data ?? []),
    fetchAll<any>(() => svc.from("wallet_transactions").select("kind,amount,method,created_at,reference").eq("tenant_id", tenantId).eq("status", "success").lte("created_at", end).order("created_at")),
    fetchAll<any>(() => svc.from("journal_entries").select("entry_no,entry_date,memo,journal_lines(account_id,debit,credit,description)")
      .eq("tenant_id", tenantId).eq("status", "posted").lte("entry_date", to).order("entry_date"))
  ]);
  const input: LedgerInput = {
    accounts, mappings: mappings as Mapping[],
    invoices: invoices.map(i => ({ ...i, lines: i.fee_invoice_lines ?? [] })),
    payments: payments.map(p => ({ ...p, invoice_no: p.fee_invoices?.invoice_no ?? null })),
    expenses,
    pettyCash: petty.map(m => ({ ...m, float_name: m.petty_cash_floats?.name ?? "Petty cash" })),
    payroll: (payroll as any[]).filter(r => String(r.approved_at ?? r.paid_at ?? "").slice(0, 10) <= to),
    wallet,
    journals: journals.map(j => ({ ...j, lines: j.journal_lines ?? [] }))
  };
  return { accounts, mappings: input.mappings, postings: buildPostings(input) };
}

/** What actually came in (billed, by fee item) and went out (by expense category, plus payroll) in a period. */
export async function budgetActuals(svc: any, tenantId: string, from: string, to: string) {
  const [lines, items, expenses, payroll] = await Promise.all([
    fetchAll<any>(() => svc.from("fee_invoice_lines").select("kind,amount,description,fee_item_id,fee_invoices!inner(created_at,status,tenant_id)")
      .eq("tenant_id", tenantId).neq("fee_invoices.status", "void").gte("fee_invoices.created_at", `${from}T00:00:00Z`).lte("fee_invoices.created_at", `${to}T23:59:59.999Z`)),
    svc.from("fee_items").select("id,name").eq("tenant_id", tenantId).then((r: any) => r.data ?? []),
    fetchAll<any>(() => svc.from("expenses").select("category,amount").eq("tenant_id", tenantId).gte("spent_on", from).lte("spent_on", to)),
    svc.from("payroll_runs").select("gross,employer_total,approved_at,paid_at").eq("tenant_id", tenantId).in("status", ["approved", "paid"]).then((r: any) => r.data ?? [])
  ]);
  const itemName = new Map((items as { id: string; name: string }[]).map(i => [i.id, i.name]));
  const income: Record<string, number> = {}, expense: Record<string, number> = {};
  for (const l of lines) {
    const k = l.kind === "discount" || l.kind === "scholarship" ? "Discounts and scholarships" : l.kind === "late_fee" ? "Late fees"
      : (l.fee_item_id && itemName.get(l.fee_item_id)) || l.description;
    income[k] = (income[k] ?? 0) + Number(l.amount);
  }
  for (const e of expenses) expense[e.category] = (expense[e.category] ?? 0) + Number(e.amount);
  for (const r of payroll as any[]) {
    const d = String(r.approved_at ?? r.paid_at ?? "").slice(0, 10);
    if (d >= from && d <= to) expense.Salaries = (expense.Salaries ?? 0) + Number(r.gross) + Number(r.employer_total ?? 0);
  }
  return { income, expense };
}

/** Fees collected in a period: by day, method, class and who collected it. */
export async function collectionsReport(svc: any, tenantId: string, from: string, to: string) {
  const pays = await fetchAll<any>(() => svc.from("fee_payments")
    .select("amount,method,provider,paid_at,receipt_no,payer_name,recorded_by,fee_invoices(invoice_no,title),students(first_name,last_name,other_names,admission_no,class_groups(name))")
    .eq("tenant_id", tenantId).eq("status", "success").gte("paid_at", `${from}T00:00:00Z`).lte("paid_at", `${to}T23:59:59.999Z`).order("paid_at"));
  const total = pays.reduce((s, p) => s + Math.round(Number(p.amount) * 100), 0) / 100;
  return {
    from, to, total, count: pays.length,
    byDay: groupSum(pays, p => String(p.paid_at).slice(0, 10), p => Number(p.amount)).sort((a, b) => a.label.localeCompare(b.label)),
    byMethod: groupSum(pays, p => p.provider ? `${p.method} (${p.provider})` : p.method, p => Number(p.amount)),
    byClass: groupSum(pays, p => p.students?.class_groups?.name ?? "No class", p => Number(p.amount)),
    rows: pays.map(p => ({ date: String(p.paid_at).slice(0, 10), receipt: p.receipt_no, invoice: p.fee_invoices?.invoice_no ?? null, student: studentName(p.students),
      admission_no: p.students?.admission_no ?? null, class: p.students?.class_groups?.name ?? null, method: p.method, provider: p.provider, amount: Number(p.amount) }))
  };
}

/** Fees billed (net of discounts), paid and outstanding, by class and by fee item, for invoices of a term or raised in a period. */
export async function revenueReport(svc: any, tenantId: string, opts: { termId?: string | null; from?: string; to?: string }) {
  const [invoices, items] = await Promise.all([
    fetchAll<any>(() => {
      let q = svc.from("fee_invoices").select("total,amount_paid,status,students(class_groups(name)),fee_invoice_lines(kind,amount,fee_item_id,description)")
        .eq("tenant_id", tenantId).neq("status", "void");
      if (opts.termId) q = q.eq("term_id", opts.termId);
      if (opts.from) q = q.gte("created_at", `${opts.from}T00:00:00Z`);
      if (opts.to) q = q.lte("created_at", `${opts.to}T23:59:59.999Z`);
      return q.order("created_at");
    }),
    svc.from("fee_items").select("id,name").eq("tenant_id", tenantId).then((r: any) => r.data ?? [])
  ]);
  const itemName = new Map((items as { id: string; name: string }[]).map(i => [i.id, i.name]));
  const c = (n: unknown) => Math.round(Number(n) * 100);
  const classes = new Map<string, { students: number; billed: number; paid: number }>();
  for (const i of invoices) {
    const k = i.students?.class_groups?.name ?? "No class";
    const e = classes.get(k) ?? { students: 0, billed: 0, paid: 0 };
    e.students++; e.billed += c(i.total); e.paid += c(i.amount_paid);
    classes.set(k, e);
  }
  const byClass = [...classes].map(([label, e]) => ({ label, invoices: e.students, billed: e.billed / 100, paid: e.paid / 100, outstanding: (e.billed - e.paid) / 100,
    rate: e.billed ? Math.round((e.paid / e.billed) * 1000) / 10 : null })).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  const lines = invoices.flatMap(i => i.fee_invoice_lines ?? []);
  const byItem = groupSum(lines, (l: any) => l.kind === "discount" || l.kind === "scholarship" ? "Discounts and scholarships" : l.kind === "late_fee" ? "Late fees"
    : (l.fee_item_id && itemName.get(l.fee_item_id)) || l.description, (l: any) => Number(l.amount));
  const sum = (f: "billed" | "paid" | "outstanding") => byClass.reduce((s, r) => s + c(r[f]), 0) / 100;
  return { byClass, byItem, totals: { billed: sum("billed"), paid: sum("paid"), outstanding: sum("outstanding") } };
}
