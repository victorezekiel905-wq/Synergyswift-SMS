"use client";
import { useState } from "react";
import { useApi, send, Tabs, Alert, Empty, Modal, Field, Badge, money, fmtDate, localDate } from "@/components/ui";

type Account = { id: string; code: string; name: string; type: "asset" | "liability" | "equity" | "income" | "expense"; system_key: string | null; active: boolean };
type Chart = { accounts: Account[]; mappings: { source: string; key: string; account_id: string }[]; fee_items: { id: string; name: string }[]; expense_categories: string[];
  methods: string[]; books_closed_until: string | null; can_close: boolean; currency: string };
type Row = { account: Account; amount: number };
type Sub = "statements" | "journals" | "chart" | "export";
type Statement = "income_statement" | "balance_sheet" | "trial_balance" | "ledger";

const TYPES: Account["type"][] = ["asset", "liability", "equity", "income", "expense"];
const SRC: Record<string, string> = { fees_billed: "Fees billed", fees_received: "Fees received", expenses: "Expenses", petty_cash: "Petty cash", payroll: "Payroll", wallet: "Wallet", journal: "Journal" };

/** The general ledger: statements built from fees, payments, expenses, payroll, wallet and petty cash, plus manual journals. */
export function Ledger() {
  const [sub, setSub] = useState<Sub>("statements");
  const chart = useApi<Chart>("/api/accounts?view=chart");
  return (
    <div className="space-y-4">
      <Tabs value={sub} onChange={setSub} tabs={[{ id: "statements", label: "Statements" }, { id: "journals", label: "Journals" }, { id: "chart", label: "Chart of accounts" }, { id: "export", label: "Export to accounting" }]} />
      {chart.error && <Alert>{chart.error}</Alert>}
      {chart.data && sub === "statements" && <Statements chart={chart.data} />}
      {chart.data && sub === "journals" && <Journals chart={chart.data} />}
      {chart.data && sub === "chart" && <ChartSetup chart={chart.data} reload={chart.reload} />}
      {chart.data && sub === "export" && <ExportPanel chart={chart.data} reload={chart.reload} />}
    </div>
  );
}

function Statements({ chart }: { chart: Chart }) {
  const cur = chart.currency;
  const [kind, setKind] = useState<Statement>("income_statement");
  const [range, setRange] = useState({ from: `${new Date().getFullYear()}-01-01`, to: localDate() });
  const [account, setAccount] = useState(chart.accounts.find(a => a.system_key === "bank")?.id ?? "");
  const q = `from=${range.from}&to=${range.to}${kind === "ledger" ? `&account=${account}` : ""}`;
  const { data, error, loading } = useApi<any>(`/api/accounts?view=${kind}&${q}`, [kind, q]);
  const pointInTime = kind === "balance_sheet" || kind === "trial_balance";
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Statement"><select className="input" value={kind} onChange={e => setKind(e.target.value as Statement)}>
          <option value="income_statement">Income and expenditure</option><option value="balance_sheet">Balance sheet</option><option value="trial_balance">Trial balance</option><option value="ledger">Account ledger</option></select></Field>
        {kind === "ledger" && <Field label="Account"><select className="input" value={account} onChange={e => setAccount(e.target.value)}>{chart.accounts.map(a => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}</select></Field>}
        {!pointInTime && <Field label="From"><input className="input" type="date" value={range.from} onChange={e => setRange({ ...range, from: e.target.value })} /></Field>}
        <Field label={pointInTime ? "As at" : "To"}><input className="input" type="date" value={range.to} onChange={e => setRange({ ...range, to: e.target.value })} /></Field>
        <a className="btn btn-outline" href={`/api/accounts?view=${kind}&${q}&format=csv`}>CSV</a>
        <button className="btn btn-ghost" onClick={() => window.print()}>Print</button>
      </div>
      {error && <Alert>{error}</Alert>}
      {loading && !data && <p className="text-sm text-slate-500">Working it out…</p>}
      {data && kind === "income_statement" && (
        <div className="card overflow-x-auto p-4 print:shadow-none">
          <h3 className="font-semibold">Income and expenditure, {fmtDate(data.from)} to {fmtDate(data.to)}</h3>
          <Section title="Income" rows={data.income} total={data.totalIncome} cur={cur} />
          <Section title="Expenditure" rows={data.expenses} total={data.totalExpenses} cur={cur} />
          <p className={"mt-3 flex justify-between border-t-2 border-slate-300 pt-2 font-semibold " + (data.surplus < 0 ? "text-rose-700" : "text-emerald-700")}><span>{data.surplus < 0 ? "Deficit" : "Surplus"}</span><span className="tabular-nums">{money(Math.abs(data.surplus), cur)}</span></p>
        </div>
      )}
      {data && kind === "balance_sheet" && (
        <div className="card overflow-x-auto p-4">
          <h3 className="font-semibold">Balance sheet as at {fmtDate(data.asAt)} {!data.balanced && <Badge tone="red">does not balance</Badge>}</h3>
          <Section title="Assets" rows={data.assets} total={data.totalAssets} cur={cur} />
          <Section title="Liabilities" rows={data.liabilities} total={data.totalLiabilities} cur={cur} />
          <Section title="Equity" rows={[...data.equity, { account: { id: "surplus", code: "", name: "Accumulated surplus" }, amount: data.surplus }]} total={data.totalEquity} cur={cur} />
          <p className="mt-3 flex justify-between border-t-2 border-slate-300 pt-2 font-semibold"><span>Liabilities and equity</span><span className="tabular-nums">{money(data.totalLiabilities + data.totalEquity, cur)}</span></p>
        </div>
      )}
      {data && kind === "trial_balance" && (
        <div className="card overflow-x-auto"><table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-[13px] text-slate-500"><tr><th className="p-2">Code</th><th className="p-2">Account</th><th className="p-2 text-right">Debit</th><th className="p-2 text-right">Credit</th></tr></thead>
          <tbody>{data.rows.map((r: { account: Account; debit: number; credit: number }) => <tr key={r.account.id} className="border-t border-slate-100"><td className="p-2 font-mono text-xs">{r.account.code}</td><td className="p-2">{r.account.name}</td>
            <td className="p-2 text-right tabular-nums">{r.debit ? money(r.debit, cur) : ""}</td><td className="p-2 text-right tabular-nums">{r.credit ? money(r.credit, cur) : ""}</td></tr>)}
            <tr className="border-t-2 border-slate-300 font-semibold"><td /><td className="p-2">Total {data.balanced ? <Badge tone="green">balances</Badge> : <Badge tone="red">out by {money(Math.abs(data.debit - data.credit), cur)}</Badge>}</td>
              <td className="p-2 text-right tabular-nums">{money(data.debit, cur)}</td><td className="p-2 text-right tabular-nums">{money(data.credit, cur)}</td></tr></tbody></table></div>
      )}
      {data && kind === "ledger" && (
        <div className="card overflow-x-auto"><table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-[13px] text-slate-500"><tr><th className="p-2">Date</th><th className="p-2">Ref</th><th className="p-2">Details</th><th className="p-2 text-right">Debit</th><th className="p-2 text-right">Credit</th><th className="p-2 text-right">Balance</th></tr></thead>
          <tbody><tr className="text-slate-500"><td className="p-2" colSpan={5}>Brought forward</td><td className="p-2 text-right tabular-nums">{money(data.opening, cur)}</td></tr>
            {data.rows.map((r: any, i: number) => <tr key={i} className="border-t border-slate-100"><td className="p-2 whitespace-nowrap">{fmtDate(r.date)}</td><td className="p-2 font-mono text-xs">{r.ref}</td><td className="p-2">{r.memo} <span className="text-xs text-slate-400">{SRC[r.source]}</span></td>
              <td className="p-2 text-right tabular-nums">{r.debit ? money(r.debit, cur) : ""}</td><td className="p-2 text-right tabular-nums">{r.credit ? money(r.credit, cur) : ""}</td><td className="p-2 text-right tabular-nums">{money(r.balance, cur)}</td></tr>)}
            <tr className="border-t-2 border-slate-300 font-semibold"><td className="p-2" colSpan={5}>Closing balance{data.truncated ? " (latest 2,000 lines shown; the CSV has them all)" : ""}</td><td className="p-2 text-right tabular-nums">{money(data.closing, cur)}</td></tr></tbody></table></div>
      )}
      <p className="text-xs text-slate-500">Built from invoices (fees billed), payments, expenses, petty cash, approved payroll and the wallet, plus posted journals. Salaries entered as expenses as well as through payroll would be counted twice.</p>
    </div>
  );
}

function Section({ title, rows, total, cur }: { title: string; rows: Row[]; total: number; cur: string }) {
  return (
    <div className="mt-3">
      <p className="text-xs font-semibold uppercase text-slate-500">{title}</p>
      {!rows.length ? <p className="text-sm text-slate-400">None</p> : rows.map(r => <p key={r.account.id} className="flex justify-between py-0.5 text-sm"><span>{r.account.code && <span className="mr-2 font-mono text-xs text-slate-400">{r.account.code}</span>}{r.account.name}</span><span className="tabular-nums">{money(r.amount, cur)}</span></p>)}
      <p className="flex justify-between border-t border-slate-200 pt-1 text-sm font-semibold"><span>Total {title.toLowerCase()}</span><span className="tabular-nums">{money(total, cur)}</span></p>
    </div>
  );
}

type JLine = { account_id: string; debit: number; credit: number; description?: string | null };
type Journal = { id: string; entry_no: string | null; entry_date: string; memo: string; status: "draft" | "posted"; reverses: string | null; journal_lines: (JLine & { id: string })[] };

function Journals({ chart }: { chart: Chart }) {
  const { data, error, reload } = useApi<{ accounts: Account[]; journals: Journal[]; currency: string }>("/api/accounts?view=journals");
  const [edit, setEdit] = useState<{ id?: string; entry_date: string; memo: string; lines: JLine[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const accounts = data?.accounts ?? chart.accounts;
  const name = (id: string) => { const a = accounts.find(x => x.id === id); return a ? `${a.code} ${a.name}` : "?"; };
  const cur = chart.currency;
  const dr = edit ? edit.lines.reduce((s, l) => s + Math.round((Number(l.debit) || 0) * 100), 0) / 100 : 0;
  const cr = edit ? edit.lines.reduce((s, l) => s + Math.round((Number(l.credit) || 0) * 100), 0) / 100 : 0;
  const save = async (post: boolean) => {
    if (!edit) return;
    const r = await send("/api/accounts", { action: "save_journal", ...edit, post, lines: edit.lines.filter(l => l.account_id).map(l => ({ account_id: l.account_id, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0, description: l.description || null })) });
    if (!r.ok) return setErr(r.error);
    setEdit(null); setErr(null); reload();
  };
  const act = async (body: object, ask?: string) => {
    if (ask && !confirm(ask)) return;
    const r = await send("/api/accounts", body);
    if (!r.ok) alert(r.error); else reload();
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn btn-primary" onClick={() => setEdit({ entry_date: localDate(), memo: "", lines: [{ account_id: "", debit: 0, credit: 0 }, { account_id: "", debit: 0, credit: 0 }] })}>+ New journal</button>
        <button className="btn btn-outline" onClick={() => setEdit({ entry_date: localDate(), memo: "Opening balances", lines: [
          { account_id: chart.accounts.find(a => a.system_key === "bank")?.id ?? "", debit: 0, credit: 0, description: "Bank balance on the start date" },
          { account_id: chart.accounts.find(a => a.system_key === "cash")?.id ?? "", debit: 0, credit: 0, description: "Cash in hand" },
          { account_id: chart.accounts.find(a => a.system_key === "opening")?.id ?? "", debit: 0, credit: 0, description: "Balancing figure" }] })}>Opening balances</button>
        <p className="text-sm text-slate-500">For opening balances, corrections, depreciation, loans and anything not recorded elsewhere.</p>
      </div>
      {error && <Alert>{error}</Alert>}
      {!data?.journals.length ? <Empty>No journals yet.</Empty> : (
        <div className="space-y-2">{data.journals.map(j => (
          <div key={j.id} className="card p-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-mono text-xs">{j.entry_no ?? "draft"}</span><span>{fmtDate(j.entry_date)}</span><span className="font-medium">{j.memo}</span>
              <Badge tone={j.status === "posted" ? "green" : "amber"}>{j.status}</Badge>{j.reverses && <Badge tone="violet">reversal</Badge>}
              <span className="ml-auto flex gap-1">
                {j.status === "draft" && <>
                  <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setEdit({ id: j.id, entry_date: j.entry_date, memo: j.memo, lines: j.journal_lines.map(l => ({ account_id: l.account_id, debit: Number(l.debit), credit: Number(l.credit), description: l.description })) })}>Edit</button>
                  <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => act({ action: "post_journal", id: j.id }, "Post this journal? Posted journals cannot be changed, only reversed.")}>Post</button>
                  <button className="btn btn-ghost px-2 py-1 text-xs text-rose-600" onClick={() => act({ action: "delete_journal", id: j.id }, "Delete this draft?")}>Delete</button></>}
                {j.status === "posted" && !j.reverses && <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => { const d = prompt("Date of the reversal (YYYY-MM-DD)", localDate()); if (d) act({ action: "reverse_journal", id: j.id, entry_date: d }); }}>Reverse</button>}
              </span>
            </div>
            <table className="mt-2 w-full text-xs"><tbody>{j.journal_lines.map(l => <tr key={l.id} className="border-t border-slate-100"><td className="py-1">{name(l.account_id)}</td><td className="py-1 text-slate-500">{l.description}</td>
              <td className="py-1 text-right tabular-nums">{Number(l.debit) ? money(l.debit, cur) : ""}</td><td className="py-1 text-right tabular-nums">{Number(l.credit) ? money(l.credit, cur) : ""}</td></tr>)}</tbody></table>
          </div>))}</div>
      )}
      <Modal open={Boolean(edit)} onClose={() => { setEdit(null); setErr(null); }} title={edit?.id ? "Edit journal" : "New journal"} wide>
        {edit && <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Date"><input className="input" type="date" value={edit.entry_date} onChange={e => setEdit({ ...edit, entry_date: e.target.value })} /></Field>
            <div className="sm:col-span-2"><Field label="Narration"><input className="input" maxLength={300} value={edit.memo} onChange={e => setEdit({ ...edit, memo: e.target.value })} /></Field></div>
          </div>
          <table className="w-full text-sm">
            <thead className="text-left text-[13px] text-slate-500"><tr><th className="py-1">Account</th><th className="py-1">Details</th><th className="py-1 text-right">Debit</th><th className="py-1 text-right">Credit</th><th /></tr></thead>
            <tbody>{edit.lines.map((l, i) => {
              const set = (p: Partial<JLine>) => setEdit({ ...edit, lines: edit.lines.map((x, j) => j === i ? { ...x, ...p } : x) });
              return (
                <tr key={i}>
                  <td className="py-1 pr-2"><select className="input" value={l.account_id} onChange={e => set({ account_id: e.target.value })}><option value="">Choose…</option>
                    {TYPES.map(t => <optgroup key={t} label={t}>{accounts.filter(a => a.type === t && (a.active || a.id === l.account_id)).map(a => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}</optgroup>)}</select></td>
                  <td className="py-1 pr-2"><input className="input" maxLength={200} value={l.description ?? ""} onChange={e => set({ description: e.target.value })} /></td>
                  <td className="py-1 pr-2"><input className="input w-32 text-right" type="number" min={0} step="any" value={l.debit || ""} onChange={e => set({ debit: Number(e.target.value), credit: Number(e.target.value) ? 0 : l.credit })} /></td>
                  <td className="py-1 pr-2"><input className="input w-32 text-right" type="number" min={0} step="any" value={l.credit || ""} onChange={e => set({ credit: Number(e.target.value), debit: Number(e.target.value) ? 0 : l.debit })} /></td>
                  <td><button type="button" className="text-xs text-rose-600" aria-label="Remove line" onClick={() => setEdit({ ...edit, lines: edit.lines.filter((_, j) => j !== i) })}>✕</button></td>
                </tr>
              );
            })}
              <tr className="border-t border-slate-200 font-semibold"><td className="py-1"><button type="button" className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setEdit({ ...edit, lines: [...edit.lines, { account_id: "", debit: 0, credit: 0 }] })}>+ Line</button></td>
                <td className="py-1 text-right text-xs">{dr === cr ? (dr ? <Badge tone="green">balances</Badge> : null) : <Badge tone="red">out by {money(Math.abs(dr - cr), cur)}</Badge>}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{money(dr, cur)}</td><td className="py-1 pr-2 text-right tabular-nums">{money(cr, cur)}</td><td /></tr></tbody>
          </table>
          {err && <Alert>{err}</Alert>}
          <div className="flex justify-end gap-2">
            <button className="btn btn-outline" disabled={!edit.memo.trim()} onClick={() => save(false)}>Save draft</button>
            <button className="btn btn-primary" disabled={!edit.memo.trim() || dr !== cr || !dr} onClick={() => save(true)}>Save and post</button>
          </div>
        </div>}
      </Modal>
    </div>
  );
}

function ChartSetup({ chart, reload }: { chart: Chart; reload: () => void }) {
  const [edit, setEdit] = useState<Partial<Account> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const mapped = (source: string, key: string) => chart.mappings.find(m => m.source === source && m.key === (source === "fee_item" ? key : key.toLowerCase()))?.account_id ?? "";
  const map = async (source: string, key: string, account_id: string) => {
    const r = await send("/api/accounts", { action: "map", source, key, account_id: account_id || null });
    if (!r.ok) alert(r.error); else reload();
  };
  const pick = (type: Account["type"] | Account["type"][], value: string, onChange: (v: string) => void, placeholder: string) => (
    <select className="input" value={value} onChange={e => onChange(e.target.value)}><option value="">{placeholder}</option>
      {chart.accounts.filter(a => (Array.isArray(type) ? type.includes(a.type) : a.type === type) && a.active).map(a => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}</select>
  );
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <section className="space-y-2">
        <div className="flex items-center gap-2"><h2 className="font-semibold">Accounts</h2><button className="btn btn-outline ml-auto" onClick={() => setEdit({ type: "expense", active: true })}>+ Account</button></div>
        <div className="card overflow-x-auto"><table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-[13px] text-slate-500"><tr><th className="p-2">Code</th><th className="p-2">Name</th><th className="p-2">Type</th><th className="p-2" /></tr></thead>
          <tbody>{chart.accounts.slice().sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })).map(a => (
            <tr key={a.id} className={"border-t border-slate-100 " + (a.active ? "" : "text-slate-400")}><td className="p-2 font-mono text-xs">{a.code}</td><td className="p-2">{a.name}{a.system_key && <span className="ml-1 text-xs text-slate-400">built-in</span>}{!a.active && " (hidden)"}</td>
              <td className="p-2 capitalize">{a.type}</td><td className="p-2 text-right"><button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setEdit(a)}>Edit</button></td></tr>))}</tbody></table></div>
      </section>
      <section className="space-y-4">
        <div><h2 className="font-semibold">Where things are posted</h2><p className="text-sm text-slate-500">Leave a row blank for the default. Expense categories also match an expense account with the same name.</p></div>
        <div className="card p-3"><h3 className="mb-2 text-sm font-semibold">Fee items → income account <span className="font-normal text-slate-500">(default: School fees)</span></h3>
          {!chart.fee_items.length ? <p className="text-sm text-slate-400">No fee items.</p> : chart.fee_items.map(f => <div key={f.id} className="grid grid-cols-2 items-center gap-2 py-1 text-sm"><span>{f.name}</span>{pick("income", mapped("fee_item", f.id), v => map("fee_item", f.id, v), "School fees")}</div>)}</div>
        <div className="card p-3"><h3 className="mb-2 text-sm font-semibold">Expense categories → expense account <span className="font-normal text-slate-500">(default: same name, else General expenses)</span></h3>
          {!chart.expense_categories.length ? <p className="text-sm text-slate-400">No expenses yet.</p> : chart.expense_categories.map(c => <div key={c} className="grid grid-cols-2 items-center gap-2 py-1 text-sm"><span>{c}</span>{pick(["expense", "asset"], mapped("expense_category", c), v => map("expense_category", c, v), "Default")}</div>)}</div>
        <div className="card p-3"><h3 className="mb-2 text-sm font-semibold">Payment methods → money account <span className="font-normal text-slate-500">(default: cash to Cash on hand, the rest to Bank)</span></h3>
          {chart.methods.map(m => <div key={m} className="grid grid-cols-2 items-center gap-2 py-1 text-sm"><span className="capitalize">{m}</span>{pick("asset", mapped("payment_method", m), v => map("payment_method", m, v), "Default")}</div>)}
          <p className="mt-1 text-xs text-slate-500">Tip: add a “Paystack clearing” asset account for online payments if the money reaches the bank a day or two later.</p></div>
      </section>
      <Modal open={Boolean(edit)} onClose={() => { setEdit(null); setErr(null); }} title={edit?.id ? "Edit account" : "New account"}>
        {edit && <form className="space-y-3" onSubmit={async e => {
          e.preventDefault();
          const r = await send("/api/accounts", { action: "save_account", id: edit.id, code: edit.code, name: edit.name, type: edit.type, active: edit.active !== false });
          if (!r.ok) return setErr(r.error);
          setEdit(null); setErr(null); reload();
        }}>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Code"><input className="input font-mono" required maxLength={20} value={edit.code ?? ""} onChange={e => setEdit({ ...edit, code: e.target.value })} /></Field>
            <div className="col-span-2"><Field label="Name"><input className="input" required maxLength={120} value={edit.name ?? ""} onChange={e => setEdit({ ...edit, name: e.target.value })} /></Field></div>
          </div>
          <Field label="Type"><select className="input capitalize" disabled={Boolean(edit.system_key)} value={edit.type} onChange={e => setEdit({ ...edit, type: e.target.value as Account["type"] })}>{TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={edit.active !== false} onChange={e => setEdit({ ...edit, active: e.target.checked })} />Show in lists</label>
          {err && <Alert>{err}</Alert>}
          <div className="flex gap-2">
            <button className="btn btn-primary flex-1">Save</button>
            {edit.id && !edit.system_key && <button type="button" className="btn btn-ghost text-rose-600" onClick={async () => { if (!confirm("Delete this account?")) return; const r = await send("/api/accounts", { action: "delete_account", id: edit.id }); if (!r.ok) return setErr(r.error); setEdit(null); reload(); }}>Delete</button>}
          </div>
        </form>}
      </Modal>
    </div>
  );
}

function ExportPanel({ chart, reload }: { chart: Chart; reload: () => void }) {
  const [f, setF] = useState({ format_for: "quickbooks", from: `${new Date().getFullYear()}-01-01`, to: localDate(), detail: "summary" });
  const [until, setUntil] = useState(chart.books_closed_until ?? "");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const href = `/api/accounts?view=export&format_for=${f.format_for}&from=${f.from}&to=${f.to}&detail=${f.detail}`;
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <section className="card space-y-3 p-4">
        <h2 className="font-semibold">Journals for your accounting package</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Package"><select className="input" value={f.format_for} onChange={e => setF({ ...f, format_for: e.target.value })}>
            <option value="quickbooks">QuickBooks Online</option><option value="sage">Sage 50 (audit trail import)</option><option value="zoho">Zoho Books</option><option value="generic">Plain CSV (Excel, Xero, others)</option></select></Field>
          <Field label="Detail"><select className="input" value={f.detail} onChange={e => setF({ ...f, detail: e.target.value })}><option value="summary">One journal per day and source</option><option value="full">Every transaction</option></select></Field>
          <Field label="From"><input className="input" type="date" value={f.from} onChange={e => setF({ ...f, from: e.target.value })} /></Field>
          <Field label="To"><input className="input" type="date" value={f.to} onChange={e => setF({ ...f, to: e.target.value })} /></Field>
        </div>
        <div className="flex flex-wrap gap-2"><a className="btn btn-primary" href={href}>Download journals</a><a className="btn btn-outline" href="/api/accounts?view=export&chart=1">Download chart of accounts</a></div>
        <ul className="list-disc space-y-1 pl-5 text-xs text-slate-600">
          <li>Set up the same accounts in the package first. QuickBooks and Zoho Books match accounts by name, Sage by nominal code.</li>
          <li>QuickBooks: Settings → Import data → Journal entries; dates are day/month/year.</li>
          <li>Sage 50: File → Import → Audit trail transactions (JD/JC rows, tax code T9).</li>
          <li>Zoho Books: Accountant → Manual journals → Import.</li>
          <li>Export each period once, then close the books up to its end so the figures cannot move.</li>
        </ul>
      </section>
      <section className="card space-y-3 p-4">
        <h2 className="font-semibold">Close the books</h2>
        <p className="text-sm text-slate-600">After a period is reported or exported, close it. Expenses, petty cash and journals dated on or before the date can then not be added, changed or deleted; corrections go into an open period.</p>
        <p className="text-sm">{chart.books_closed_until ? <>Closed up to <b>{fmtDate(chart.books_closed_until)}</b>.</> : "Nothing is closed yet."}</p>
        {chart.can_close ? (
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Closed up to"><input className="input" type="date" value={until} onChange={e => setUntil(e.target.value)} /></Field>
            <button className="btn btn-primary" onClick={async () => { const r = await send("/api/accounts", { action: "close_books", until: until || null }); setMsg({ ok: r.ok, text: r.ok ? (until ? "Saved." : "Books reopened.") : r.error ?? "" }); if (r.ok) reload(); }}>{until ? "Save" : "Reopen everything"}</button>
          </div>
        ) : <p className="text-xs text-slate-500">The principal or a school admin closes the books.</p>}
        {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      </section>
    </div>
  );
}
