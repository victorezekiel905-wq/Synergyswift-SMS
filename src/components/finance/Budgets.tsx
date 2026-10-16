"use client";
import { useState } from "react";
import { useApi, send, Alert, Empty, Modal, Field, Badge, money, fmtDate } from "@/components/ui";

type BLine = { kind: "income" | "expense"; category: string; amount: number; note?: string | null };
type Budget = { id: string; name: string; starts_on: string; ends_on: string; status: "draft" | "approved"; notes: string | null; created_by: string | null; approved_at: string | null; budget_lines: (BLine & { id: string })[] };
type List = { budgets: Budget[]; me: string; can_approve: boolean; currency: string; income_categories: string[]; expense_categories: string[] };
type Vs = { actual_to: string; rows: { kind: "income" | "expense"; category: string; budget: number; actual: number; variance: number; used: number | null }[];
  totals: { incomeBudget: number; incomeActual: number; expenseBudget: number; expenseActual: number } };

/** Budgets by period with income and expense lines, approved by a second person, and compared with what actually happened. */
export function Budgets() {
  const { data, error, reload } = useApi<List>("/api/accounts?view=budgets");
  const [sel, setSel] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ id?: string; name: string; starts_on: string; ends_on: string; notes: string; lines: BLine[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const current = data?.budgets.find(b => b.id === sel) ?? data?.budgets[0] ?? null;
  const vs = useApi<Vs>(current ? `/api/accounts?view=budget&id=${current.id}` : null, [current?.id, current?.status]);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return null;
  const cur = data.currency;
  const year = new Date().getFullYear();

  const status = async (b: Budget, s: "approved" | "draft") => {
    const r = await send("/api/accounts", { action: "budget_status", id: b.id, status: s });
    if (!r.ok) alert(r.error); else reload();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn btn-primary" onClick={() => setEdit({ name: `${year}/${year + 1}`, starts_on: `${year}-09-01`, ends_on: `${year + 1}-08-31`, notes: "", lines: [{ kind: "income", category: data.income_categories[0] ?? "School fees", amount: 0 }, { kind: "expense", category: "Salaries", amount: 0 }] })}>+ New budget</button>
        {current && <Field label="Budget"><select className="input" value={current.id} onChange={e => setSel(e.target.value)}>{data.budgets.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>}
      </div>
      {!current ? <Empty>No budgets yet. A budget sets what you expect to bill and spend by category over a period, then shows how you are doing.</Empty> : (
        <section className="card space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold">{current.name}</h2>
            <span className="text-sm text-slate-500">{fmtDate(current.starts_on)} – {fmtDate(current.ends_on)}</span>
            <Badge tone={current.status === "approved" ? "green" : "amber"}>{current.status === "approved" ? `approved ${fmtDate(current.approved_at)}` : "draft"}</Badge>
            <span className="ml-auto flex flex-wrap gap-2">
              {current.status === "draft" && <button className="btn btn-outline" onClick={() => setEdit({ id: current.id, name: current.name, starts_on: current.starts_on, ends_on: current.ends_on, notes: current.notes ?? "", lines: current.budget_lines.map(l => ({ kind: l.kind, category: l.category, amount: Number(l.amount), note: l.note })) })}>Edit</button>}
              {current.status === "draft" && data.can_approve && current.created_by !== data.me && <button className="btn btn-primary" onClick={() => status(current, "approved")}>Approve</button>}
              {current.status === "draft" && current.created_by === data.me && <span className="text-xs text-slate-500">The principal or another admin approves it.</span>}
              {current.status === "approved" && data.can_approve && <button className="btn btn-ghost" onClick={() => { if (confirm("Reopen this budget for changes? It will need approving again.")) status(current, "draft"); }}>Reopen</button>}
              {current.status === "draft" && <button className="btn btn-ghost text-rose-600" onClick={async () => { if (confirm("Delete this budget?")) { const r = await send("/api/accounts", { action: "delete_budget", id: current.id }); if (!r.ok) alert(r.error); else { setSel(null); reload(); } } }}>Delete</button>}
              <a className="btn btn-outline" href={`/api/accounts?view=budget&id=${current.id}&format=csv`}>CSV</a>
            </span>
          </div>
          {vs.error && <Alert>{vs.error}</Alert>}
          {vs.data && <>
            <p className="text-xs text-slate-500">Actual to {fmtDate(vs.data.actual_to)}: income is fees billed by fee item; spending is expenses by category plus approved payroll under Salaries.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Summary label="Income" budget={vs.data.totals.incomeBudget} actual={vs.data.totals.incomeActual} cur={cur} good="up" />
              <Summary label="Spending" budget={vs.data.totals.expenseBudget} actual={vs.data.totals.expenseActual} cur={cur} good="down" />
            </div>
            {(["income", "expense"] as const).map(kind => {
              const rows = vs.data!.rows.filter(r => r.kind === kind);
              if (!rows.length) return null;
              return (
                <div key={kind} className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-[13px] text-slate-500"><tr><th className="p-2">{kind === "income" ? "Income" : "Spending"}</th><th className="p-2 text-right">Budget</th><th className="p-2 text-right">Actual</th><th className="p-2 w-40">Used</th><th className="p-2 text-right">Variance</th></tr></thead>
                    <tbody>{rows.map(r => {
                      const over = kind === "expense" && r.used !== null && r.used > 100;
                      return (
                        <tr key={r.category} className="border-t border-slate-100">
                          <td className="p-2">{r.category}{!r.budget && <span className="ml-1 text-xs text-amber-700">(not budgeted)</span>}</td>
                          <td className="p-2 text-right tabular-nums">{money(r.budget, cur)}</td>
                          <td className="p-2 text-right tabular-nums">{money(r.actual, cur)}</td>
                          <td className="p-2">{r.used !== null && <div className="flex items-center gap-2"><div className="h-1.5 flex-1 rounded bg-slate-100"><div className={"h-1.5 rounded " + (over ? "bg-rose-500" : "bg-brand-500")} style={{ width: `${Math.min(100, r.used)}%` }} /></div><span className="w-12 text-right text-xs tabular-nums">{r.used}%</span></div>}</td>
                          <td className={"p-2 text-right tabular-nums " + (r.variance < 0 ? "text-rose-700" : "text-emerald-700")}>{r.variance > 0 ? "+" : ""}{money(r.variance, cur)}</td>
                        </tr>
                      );
                    })}</tbody>
                  </table>
                </div>
              );
            })}
          </>}
        </section>
      )}

      <Modal open={Boolean(edit)} onClose={() => { setEdit(null); setErr(null); }} title={edit?.id ? "Edit budget" : "New budget"} wide>
        {edit && <form className="space-y-3" onSubmit={async e => {
          e.preventDefault();
          const r = await send<{ id: string }>("/api/accounts", { action: "save_budget", ...edit, notes: edit.notes || null, lines: edit.lines.filter(l => l.category.trim()).map(l => ({ ...l, amount: Number(l.amount) || 0 })) });
          if (!r.ok) return setErr(r.error);
          setEdit(null); setErr(null); setSel(r.data.id); reload();
        }}>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Name"><input className="input" required maxLength={80} value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="From"><input className="input" type="date" required value={edit.starts_on} onChange={e => setEdit({ ...edit, starts_on: e.target.value })} /></Field>
            <Field label="To"><input className="input" type="date" required value={edit.ends_on} onChange={e => setEdit({ ...edit, ends_on: e.target.value })} /></Field>
          </div>
          <datalist id="bud-income">{data.income_categories.map(c => <option key={c} value={c} />)}</datalist>
          <datalist id="bud-expense">{data.expense_categories.map(c => <option key={c} value={c} />)}</datalist>
          <table className="w-full text-sm">
            <thead className="text-left text-[13px] text-slate-500"><tr><th className="py-1">Kind</th><th className="py-1">Category</th><th className="py-1 text-right">Amount</th><th /></tr></thead>
            <tbody>{edit.lines.map((l, i) => (
              <tr key={i}>
                <td className="py-1 pr-2"><select className="input" value={l.kind} onChange={e => setEdit({ ...edit, lines: edit.lines.map((x, j) => j === i ? { ...x, kind: e.target.value as BLine["kind"] } : x) })}><option value="income">Income</option><option value="expense">Spending</option></select></td>
                <td className="py-1 pr-2"><input className="input" list={l.kind === "income" ? "bud-income" : "bud-expense"} value={l.category} onChange={e => setEdit({ ...edit, lines: edit.lines.map((x, j) => j === i ? { ...x, category: e.target.value } : x) })} /></td>
                <td className="py-1 pr-2"><input className="input text-right" type="number" min={0} step="any" value={l.amount} onChange={e => setEdit({ ...edit, lines: edit.lines.map((x, j) => j === i ? { ...x, amount: Number(e.target.value) } : x) })} /></td>
                <td><button type="button" className="text-xs text-rose-600" aria-label="Remove line" onClick={() => setEdit({ ...edit, lines: edit.lines.filter((_, j) => j !== i) })}>✕</button></td>
              </tr>))}</tbody>
          </table>
          <div className="flex gap-2">
            <button type="button" className="btn btn-ghost" onClick={() => setEdit({ ...edit, lines: [...edit.lines, { kind: "income", category: "", amount: 0 }] })}>+ Income line</button>
            <button type="button" className="btn btn-ghost" onClick={() => setEdit({ ...edit, lines: [...edit.lines, { kind: "expense", category: "", amount: 0 }] })}>+ Spending line</button>
          </div>
          <p className="text-xs text-slate-500">Use fee item names for income and your expense categories for spending, so actual figures match up. Total income {money(edit.lines.filter(l => l.kind === "income").reduce((s, l) => s + (Number(l.amount) || 0), 0), cur)}, spending {money(edit.lines.filter(l => l.kind === "expense").reduce((s, l) => s + (Number(l.amount) || 0), 0), cur)}.</p>
          <Field label="Notes"><textarea className="input" rows={2} maxLength={500} value={edit.notes} onChange={e => setEdit({ ...edit, notes: e.target.value })} /></Field>
          {err && <Alert>{err}</Alert>}
          <button className="btn btn-primary w-full">Save as draft</button>
        </form>}
      </Modal>
    </div>
  );
}

function Summary({ label, budget, actual, cur, good }: { label: string; budget: number; actual: number; cur: string; good: "up" | "down" }) {
  const pct = budget ? Math.round((actual / budget) * 1000) / 10 : null;
  const bad = pct !== null && (good === "down" ? pct > 100 : false);
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <p className="text-[13px] text-slate-500">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{money(actual, cur)} <span className="text-sm font-normal text-slate-500">of {money(budget, cur)}</span></p>
      {pct !== null && <div className="mt-1 h-2 rounded bg-slate-100"><div className={"h-2 rounded " + (bad ? "bg-rose-500" : "bg-brand-500")} style={{ width: `${Math.min(100, pct)}%` }} /></div>}
      {pct !== null && <p className="mt-1 text-xs text-slate-500">{pct}%</p>}
    </div>
  );
}
