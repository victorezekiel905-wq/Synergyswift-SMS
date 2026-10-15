import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCtx, ROLES, readJson, jsonError, hasAny } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { toCsv, currentTerm } from "@/lib/school";
import { localParts } from "@/lib/attendance";
import { financeSettings } from "@/lib/fees";
import { trialBalance, incomeStatement, balanceSheet, accountLedger, summarise, exportRows, budgetVsActual, checkJournal, SOURCE_LABELS, type ExportFormat } from "@/lib/ledger";
import { ensureChart, loadLedger, budgetActuals, collectionsReport, revenueReport } from "@/lib/ledger-server";

export const dynamic = "force-dynamic";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
function csv(name: string, rows: unknown[][]) {
  return new NextResponse("﻿" + toCsv(rows as (string | number | null)[][]), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"` } });
}

/**
 * Accounts: chart of accounts, journals, statements (trial balance, income and expenditure,
 * balance sheet, account ledger), exports for QuickBooks / Sage / Zoho Books, budgets,
 * petty cash and financial reports.
 * GET ?view=chart|journals|trial_balance|income_statement|balance_sheet|ledger|export|budgets|budget|petty|collections|revenue
 */
export async function GET(req: NextRequest) {
  const u = new URL(req.url).searchParams;
  const view = u.get("view") ?? "chart";
  const ctx = await requireCtx(view === "petty" ? ROLES.staff : ROLES.finance, "fees");
  if (ctx instanceof NextResponse) return ctx;
  const tid = ctx.tenant.id, svc = createServiceClient();
  const today = localParts(new Date(), ctx.tenant.timezone).date;
  const to = DATE.test(u.get("to") ?? "") ? u.get("to")! : today;
  const from = DATE.test(u.get("from") ?? "") ? u.get("from")! : `${to.slice(0, 4)}-01-01`;
  const isCsv = u.get("format") === "csv";
  const { currency } = await financeSettings(svc, tid);

  const receipt = u.get("receipt");
  if (receipt) {
    const { data: e } = await ctx.sb.from("expenses").select("receipt_path").eq("tenant_id", tid).eq("id", receipt).maybeSingle();
    if (!e?.receipt_path) return jsonError("no receipt attached", 404);
    const { data } = await svc.storage.from("expense-receipts").createSignedUrl(e.receipt_path, 300);
    return data?.signedUrl ? NextResponse.redirect(data.signedUrl) : jsonError("not found", 404);
  }

  switch (view) {
    case "chart": {
      const accounts = await ensureChart(svc, tid);
      const [maps, items, cats, settings] = await Promise.all([
        ctx.sb.from("ledger_mappings").select("source,key,account_id").eq("tenant_id", tid),
        ctx.sb.from("fee_items").select("id,name").eq("tenant_id", tid).order("name"),
        ctx.sb.from("expenses").select("category").eq("tenant_id", tid).limit(5000),
        ctx.sb.from("tenant_settings").select("books_closed_until").eq("tenant_id", tid).maybeSingle()
      ]);
      const categories = [...new Set((cats.data ?? []).map((c: { category: string }) => c.category.trim()))].sort();
      return NextResponse.json({ accounts, mappings: maps.data ?? [], fee_items: items.data ?? [], expense_categories: categories,
        methods: ["cash", "transfer", "pos", "cheque", "online"], books_closed_until: settings.data?.books_closed_until ?? null,
        can_close: hasAny(ctx, ROLES.admin), currency });
    }
    case "journals": {
      const accounts = await ensureChart(svc, tid);
      const { data } = await ctx.sb.from("journal_entries").select("id,entry_no,entry_date,memo,status,reverses,created_at,posted_at,journal_lines(id,account_id,debit,credit,description)")
        .eq("tenant_id", tid).order("entry_date", { ascending: false }).order("created_at", { ascending: false }).limit(200);
      return NextResponse.json({ accounts, journals: data ?? [], currency });
    }
    case "trial_balance": {
      const { accounts, postings } = await loadLedger(svc, tid, to);
      const tb = trialBalance(postings, accounts, to);
      if (isCsv) return csv(`trial-balance-${to}.csv`, [["Code", "Account", "Type", "Debit", "Credit"],
        ...tb.rows.map(r => [r.account.code, r.account.name, r.account.type, r.debit || "", r.credit || ""]), ["", "Total", "", tb.debit, tb.credit]]);
      return NextResponse.json({ to, currency, ...tb });
    }
    case "income_statement": {
      const { accounts, postings } = await loadLedger(svc, tid, to);
      const pl = incomeStatement(postings, accounts, from, to);
      if (isCsv) return csv(`income-and-expenditure-${from}-${to}.csv`, [["Section", "Code", "Account", "Amount"],
        ...pl.income.map(r => ["Income", r.account.code, r.account.name, r.amount]), ["Income", "", "Total income", pl.totalIncome],
        ...pl.expenses.map(r => ["Expenditure", r.account.code, r.account.name, r.amount]), ["Expenditure", "", "Total expenditure", pl.totalExpenses],
        ["", "", "Surplus (deficit)", pl.surplus]]);
      return NextResponse.json({ currency, ...pl });
    }
    case "balance_sheet": {
      const { accounts, postings } = await loadLedger(svc, tid, to);
      const bs = balanceSheet(postings, accounts, to);
      if (isCsv) return csv(`balance-sheet-${to}.csv`, [["Section", "Code", "Account", "Amount"],
        ...bs.assets.map(r => ["Assets", r.account.code, r.account.name, r.amount]), ["Assets", "", "Total assets", bs.totalAssets],
        ...bs.liabilities.map(r => ["Liabilities", r.account.code, r.account.name, r.amount]), ["Liabilities", "", "Total liabilities", bs.totalLiabilities],
        ...bs.equity.map(r => ["Equity", r.account.code, r.account.name, r.amount]), ["Equity", "", "Accumulated surplus", bs.surplus], ["Equity", "", "Total equity", bs.totalEquity]]);
      return NextResponse.json({ currency, ...bs });
    }
    case "ledger": {
      const { accounts, postings } = await loadLedger(svc, tid, to);
      const acc = accounts.find(a => a.id === u.get("account"));
      if (!acc) return jsonError("choose an account", 404);
      const l = accountLedger(postings, acc, from, to);
      if (isCsv) return csv(`ledger-${acc.code}-${from}-${to}.csv`, [["Date", "Reference", "Source", "Details", "Debit", "Credit", "Balance"], ["", "", "", "Brought forward", "", "", l.opening],
        ...l.rows.map(r => [r.date, r.ref, SOURCE_LABELS[r.source], r.memo, r.debit || "", r.credit || "", r.balance])]);
      return NextResponse.json({ currency, account: acc, from, to, ...l, rows: l.rows.slice(-2000), truncated: l.rows.length > 2000 });
    }
    case "export": {
      const format = (["quickbooks", "sage", "zoho", "generic"].includes(u.get("format_for") ?? "") ? u.get("format_for") : "generic") as ExportFormat;
      if (u.get("chart") === "1") {
        // Set up the same accounts in the package first (Sage matches on codes, QuickBooks and Zoho on names).
        const accounts = await ensureChart(svc, tid);
        return csv("chart-of-accounts.csv", [["Code", "Name", "Type"], ...accounts.filter(a => a.active !== false).map(a => [a.code, a.name, a.type])]);
      }
      const { accounts, postings } = await loadLedger(svc, tid, to);
      const inRange = postings.filter(p => p.date >= from && p.date <= to);
      const rows = exportRows(u.get("detail") === "full" ? inRange : summarise(inRange), accounts, format, currency);
      return csv(`journals-${format}-${from}-${to}.csv`, rows);
    }
    case "budgets": {
      const { data } = await ctx.sb.from("budgets").select("id,name,starts_on,ends_on,status,notes,created_by,approved_by,approved_at,budget_lines(id,kind,category,amount,note)")
        .eq("tenant_id", tid).order("starts_on", { ascending: false });
      const { data: items } = await ctx.sb.from("fee_items").select("name").eq("tenant_id", tid).order("name");
      const { data: cats } = await ctx.sb.from("expenses").select("category").eq("tenant_id", tid).limit(5000);
      return NextResponse.json({ budgets: data ?? [], me: ctx.userId, can_approve: hasAny(ctx, ROLES.admin), currency,
        income_categories: [...(items ?? []).map((i: { name: string }) => i.name), "Late fees", "Discounts and scholarships"],
        expense_categories: [...new Set(["Salaries", ...(cats ?? []).map((c: { category: string }) => c.category.trim())])].sort() });
    }
    case "budget": {
      const { data: b } = await ctx.sb.from("budgets").select("id,name,starts_on,ends_on,status,budget_lines(kind,category,amount)").eq("tenant_id", tid).eq("id", u.get("id") ?? "").maybeSingle();
      if (!b) return jsonError("budget not found", 404);
      const end = b.ends_on < today ? b.ends_on : today;
      const actual = await budgetActuals(svc, tid, b.starts_on, end);
      const r = budgetVsActual(b.budget_lines ?? [], actual);
      if (isCsv) return csv(`budget-${b.name}.csv`, [["Kind", "Category", "Budget", "Actual", "Variance", "% used"], ...r.rows.map(x => [x.kind, x.category, x.budget, x.actual, x.variance, x.used ?? ""])]);
      return NextResponse.json({ currency, budget: b, actual_to: end, ...r });
    }
    case "petty": {
      const finance = hasAny(ctx, ROLES.finance);
      const { data: floats } = await ctx.sb.from("petty_cash_floats").select("id,name,custodian_id,imprest,balance,active,users:custodian_id(full_name)").eq("tenant_id", tid).order("name");
      const ids = (floats ?? []).map((f: { id: string }) => f.id);
      const [moves, counts, staff] = await Promise.all([
        ids.length ? ctx.sb.from("petty_cash_moves").select("id,float_id,kind,amount,on_date,note,expense_id,created_at,expenses(category,payee,receipt_path)")
          .in("float_id", ids).order("on_date", { ascending: false }).order("created_at", { ascending: false }).limit(300) : { data: [] },
        ids.length ? ctx.sb.from("petty_cash_counts").select("id,float_id,counted,expected,note,counted_at").in("float_id", ids).order("counted_at", { ascending: false }).limit(50) : { data: [] },
        finance ? svc.from("staff").select("user_id,full_name").eq("tenant_id", tid).not("user_id", "is", null).order("full_name") : { data: [] }
      ]);
      return NextResponse.json({ finance, me: ctx.userId, currency, floats: floats ?? [],
        moves: (moves.data ?? []).map((m: any) => ({ ...m, category: m.expenses?.category ?? null, payee: m.expenses?.payee ?? null, has_receipt: Boolean(m.expenses?.receipt_path), expenses: undefined })),
        counts: counts.data ?? [], staff: staff.data ?? [] });
    }
    case "collections": {
      const r = await collectionsReport(svc, tid, from, to);
      if (isCsv) return csv(`collections-${from}-${to}.csv`, [["Date", "Receipt", "Invoice", "Student", "Admission no", "Class", "Method", "Provider", "Amount"],
        ...r.rows.map(x => [x.date, x.receipt, x.invoice, x.student, x.admission_no, x.class, x.method, x.provider, x.amount])]);
      return NextResponse.json({ currency, ...r, rows: undefined });
    }
    case "revenue": {
      const termId = u.get("term_id") === "range" ? null : (u.get("term_id") || (await currentTerm(ctx.sb, tid))?.id || null);
      const r = await revenueReport(svc, tid, termId ? { termId } : { from, to });
      if (isCsv) return csv(`revenue-by-class.csv`, [["Class", "Invoices", "Billed", "Paid", "Outstanding", "% collected"], ...r.byClass.map(x => [x.label, x.invoices, x.billed, x.paid, x.outstanding, x.rate ?? ""]),
        ["Total", "", r.totals.billed, r.totals.paid, r.totals.outstanding, ""], [], ["Fee item", "Lines", "Amount"], ...r.byItem.map(x => [x.label, x.count, x.amount])]);
      return NextResponse.json({ currency, term_id: termId, ...r });
    }
  }
  return jsonError("unknown view", 404);
}

const money = z.number().min(0).max(1e11);
const date = z.string().regex(DATE);
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save_account"), id: z.string().uuid().optional(), code: z.string().trim().regex(/^[0-9A-Za-z.-]{1,20}$/, "letters, digits, dots and dashes"),
    name: z.string().trim().min(1).max(120), type: z.enum(["asset", "liability", "equity", "income", "expense"]), active: z.boolean().default(true) }),
  z.object({ action: z.literal("delete_account"), id: z.string().uuid() }),
  z.object({ action: z.literal("map"), source: z.enum(["fee_item", "expense_category", "payment_method"]), key: z.string().trim().min(1).max(120), account_id: z.string().uuid().nullable() }),
  z.object({ action: z.literal("save_journal"), id: z.string().uuid().optional(), entry_date: date, memo: z.string().trim().min(1).max(300), post: z.boolean().default(false),
    lines: z.array(z.object({ account_id: z.string().uuid(), debit: money.default(0), credit: money.default(0), description: z.string().trim().max(200).nullish() })).min(2).max(200) }),
  z.object({ action: z.literal("post_journal"), id: z.string().uuid() }),
  z.object({ action: z.literal("delete_journal"), id: z.string().uuid() }),
  z.object({ action: z.literal("reverse_journal"), id: z.string().uuid(), entry_date: date }),
  z.object({ action: z.literal("close_books"), until: date.nullable() }),
  z.object({ action: z.literal("save_budget"), id: z.string().uuid().optional(), name: z.string().trim().min(1).max(80), starts_on: date, ends_on: date, notes: z.string().trim().max(500).nullish(),
    lines: z.array(z.object({ kind: z.enum(["income", "expense"]), category: z.string().trim().min(1).max(80), amount: money, note: z.string().trim().max(200).nullish() })).max(300) }),
  z.object({ action: z.literal("budget_status"), id: z.string().uuid(), status: z.enum(["approved", "draft"]) }),
  z.object({ action: z.literal("delete_budget"), id: z.string().uuid() }),
  z.object({ action: z.literal("save_float"), id: z.string().uuid().optional(), name: z.string().trim().min(1).max(80), custodian_id: z.string().uuid().nullable(), imprest: money, active: z.boolean().default(true) }),
  z.object({ action: z.literal("float_move"), float_id: z.string().uuid(), kind: z.enum(["topup", "return", "adjust"]), amount: z.number().min(-1e10).max(1e10).refine(n => n !== 0, "enter an amount"),
    on_date: date, note: z.string().trim().max(200).nullish() }),
  z.object({ action: z.literal("count_float"), float_id: z.string().uuid(), counted: money, note: z.string().trim().max(200).nullish(), adjust: z.boolean().default(false) })
]);

export async function POST(req: NextRequest) {
  const ctx = await requireCtx(ROLES.staff, "fees");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = Body.safeParse(await readJson(req));
  if (!parsed.success) return jsonError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const b = parsed.data;
  // Custodians count their own float; everything else is the bursary's.
  if (b.action !== "count_float" && !hasAny(ctx, ROLES.finance)) return jsonError("forbidden", 403);
  const tid = ctx.tenant.id, sb = ctx.sb;
  const fail = (e: { message: string } | null, map?: (m: string) => string) => jsonError(map ? map(e!.message) : e!.message);

  switch (b.action) {
    case "save_account": {
      const { action: _a, id, ...row } = b;
      const { data, error } = id ? await sb.from("ledger_accounts").update(row).eq("tenant_id", tid).eq("id", id).select("id").maybeSingle()
        : await sb.from("ledger_accounts").insert({ ...row, tenant_id: tid }).select("id").single();
      if (error) return fail(error, m => m.includes("duplicate") ? "another account already uses that code" : m);
      return data ? NextResponse.json(data) : jsonError("account not found", 404);
    }
    case "delete_account": {
      const { error } = await sb.from("ledger_accounts").delete().eq("tenant_id", tid).eq("id", b.id);
      return error ? fail(error) : NextResponse.json({ ok: true });
    }
    case "map": {
      const key = b.source === "fee_item" ? b.key : b.key.toLowerCase();
      const { error } = b.account_id
        ? await sb.from("ledger_mappings").upsert({ tenant_id: tid, source: b.source, key, account_id: b.account_id }, { onConflict: "tenant_id,source,key" })
        : await sb.from("ledger_mappings").delete().eq("tenant_id", tid).eq("source", b.source).eq("key", key);
      return error ? fail(error) : NextResponse.json({ ok: true });
    }
    case "save_journal": {
      if (b.post) { const chk = checkJournal(b.lines); if (!chk.ok) return jsonError(chk.problems.join("; ")); }
      let id = b.id;
      if (id) {
        const { data, error } = await sb.from("journal_entries").update({ entry_date: b.entry_date, memo: b.memo }).eq("tenant_id", tid).eq("id", id).select("id").maybeSingle();
        if (error) return fail(error);
        if (!data) return jsonError("journal not found", 404);
        const del = await sb.from("journal_lines").delete().eq("tenant_id", tid).eq("entry_id", id);
        if (del.error) return fail(del.error);
      } else {
        const { data, error } = await sb.from("journal_entries").insert({ tenant_id: tid, entry_date: b.entry_date, memo: b.memo }).select("id").single();
        if (error) return fail(error);
        id = data.id as string;
      }
      const ins = await sb.from("journal_lines").insert(b.lines.map(l => ({ tenant_id: tid, entry_id: id, account_id: l.account_id, debit: l.debit, credit: l.credit, description: l.description || null })));
      if (ins.error) return fail(ins.error);
      if (b.post) {
        const { data, error } = await sb.from("journal_entries").update({ status: "posted" }).eq("tenant_id", tid).eq("id", id).select("entry_no").single();
        if (error) return jsonError(`saved as a draft, not posted: ${error.message}`);
        return NextResponse.json({ id, entry_no: data.entry_no });
      }
      return NextResponse.json({ id });
    }
    case "post_journal": {
      const { data, error } = await sb.from("journal_entries").update({ status: "posted" }).eq("tenant_id", tid).eq("id", b.id).select("entry_no").maybeSingle();
      if (error) return fail(error);
      return data ? NextResponse.json(data) : jsonError("journal not found", 404);
    }
    case "delete_journal": {
      const { error } = await sb.from("journal_entries").delete().eq("tenant_id", tid).eq("id", b.id);
      return error ? fail(error) : NextResponse.json({ ok: true });
    }
    case "reverse_journal": {
      const { data: j } = await sb.from("journal_entries").select("id,entry_no,memo,status,journal_lines(account_id,debit,credit,description)").eq("tenant_id", tid).eq("id", b.id).maybeSingle();
      if (!j || j.status !== "posted") return jsonError("only posted journals can be reversed");
      const { data: already } = await sb.from("journal_entries").select("entry_no").eq("tenant_id", tid).eq("reverses", j.id).limit(1);
      if (already?.length) return jsonError(`already reversed${already[0].entry_no ? ` by ${already[0].entry_no}` : " (a draft reversal exists)"}`);
      const { data: r, error } = await sb.from("journal_entries").insert({ tenant_id: tid, entry_date: b.entry_date, memo: `Reversal of ${j.entry_no}: ${j.memo}`.slice(0, 300), reverses: j.id }).select("id").single();
      if (error) return fail(error);
      const ins = await sb.from("journal_lines").insert((j.journal_lines ?? []).map((l: any) => ({ tenant_id: tid, entry_id: r.id, account_id: l.account_id, debit: l.credit, credit: l.debit, description: l.description })));
      if (ins.error) return fail(ins.error);
      const { data: p, error: pe } = await sb.from("journal_entries").update({ status: "posted" }).eq("id", r.id).select("entry_no").single();
      return pe ? fail(pe) : NextResponse.json({ id: r.id, entry_no: p.entry_no });
    }
    case "close_books": {
      if (!hasAny(ctx, ROLES.admin)) return jsonError("only the principal or a school admin can close the books", 403);
      const { data, error } = await sb.from("tenant_settings").update({ books_closed_until: b.until }).eq("tenant_id", tid).select("books_closed_until");
      if (error) return fail(error);
      return data?.length ? NextResponse.json({ books_closed_until: b.until }) : jsonError("only the principal or a school admin can close the books", 403);
    }
    case "save_budget": {
      if (b.ends_on < b.starts_on) return jsonError("the budget ends before it starts");
      const keys = new Set<string>();
      for (const l of b.lines) { const k = `${l.kind}:${l.category.toLowerCase()}`; if (keys.has(k)) return jsonError(`${l.category} appears twice under ${l.kind}`); keys.add(k); }
      let id = b.id;
      const head = { name: b.name, starts_on: b.starts_on, ends_on: b.ends_on, notes: b.notes || null };
      if (id) {
        const { data, error } = await sb.from("budgets").update(head).eq("tenant_id", tid).eq("id", id).select("id").maybeSingle();
        if (error) return fail(error, m => m.includes("duplicate") ? "another budget has that name" : m);
        if (!data) return jsonError("budget not found", 404);
        const del = await sb.from("budget_lines").delete().eq("tenant_id", tid).eq("budget_id", id);
        if (del.error) return fail(del.error);
      } else {
        const { data, error } = await sb.from("budgets").insert({ ...head, tenant_id: tid }).select("id").single();
        if (error) return fail(error, m => m.includes("duplicate") ? "another budget has that name" : m);
        id = data.id as string;
      }
      if (b.lines.length) {
        const ins = await sb.from("budget_lines").insert(b.lines.map(l => ({ tenant_id: tid, budget_id: id, kind: l.kind, category: l.category, amount: l.amount, note: l.note || null })));
        if (ins.error) return fail(ins.error);
      }
      return NextResponse.json({ id });
    }
    case "budget_status": {
      const { data, error } = await sb.from("budgets").update({ status: b.status }).eq("tenant_id", tid).eq("id", b.id).select("status").maybeSingle();
      if (error) return fail(error);
      return data ? NextResponse.json(data) : jsonError("budget not found", 404);
    }
    case "delete_budget": {
      const { error } = await sb.from("budgets").delete().eq("tenant_id", tid).eq("id", b.id);
      return error ? fail(error) : NextResponse.json({ ok: true });
    }
    case "save_float": {
      const { action: _a, id, ...row } = b;
      const { data, error } = id ? await sb.from("petty_cash_floats").update(row).eq("tenant_id", tid).eq("id", id).select("id").maybeSingle()
        : await sb.from("petty_cash_floats").insert({ ...row, tenant_id: tid }).select("id").single();
      if (error) return fail(error, m => m.includes("duplicate") ? "another float has that name" : m);
      return data ? NextResponse.json(data) : jsonError("float not found", 404);
    }
    case "float_move": {
      if (b.kind !== "adjust" && b.amount < 0) return jsonError("enter a positive amount");
      const { error } = await sb.from("petty_cash_moves").insert({ tenant_id: tid, float_id: b.float_id, kind: b.kind, amount: b.amount, on_date: b.on_date, note: b.note || null });
      return error ? fail(error) : NextResponse.json({ ok: true });
    }
    case "count_float": {
      const { data, error } = await sb.from("petty_cash_counts").insert({ tenant_id: tid, float_id: b.float_id, counted: b.counted, note: b.note || null }).select("id,counted,expected").single();
      if (error) return fail(error, m => m.includes("row-level security") ? "only the custodian or the bursary can count this float" : m);
      const diff = Math.round((Number(data.counted) - Number(data.expected)) * 100) / 100;
      // The bursary can book the difference straight away (over or short).
      if (b.adjust && diff !== 0) {
        if (!hasAny(ctx, ROLES.finance)) return NextResponse.json({ ...data, difference: diff, adjusted: false });
        const today = localParts(new Date(), ctx.tenant.timezone).date;
        const adj = await sb.from("petty_cash_moves").insert({ tenant_id: tid, float_id: b.float_id, kind: "adjust", amount: diff, on_date: today, note: `Cash count ${diff > 0 ? "over" : "short"}${b.note ? `: ${b.note}` : ""}` });
        if (adj.error) return fail(adj.error);
        return NextResponse.json({ ...data, difference: diff, adjusted: true });
      }
      return NextResponse.json({ ...data, difference: diff, adjusted: false });
    }
  }
}
