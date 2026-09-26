"use client";
import { useState } from "react";
import { useApi, send, Page, PageHeader, Tabs, Alert, Empty, Modal, Field, Badge, Stat, money, fmtDate, rolesOf, type Me } from "@/components/ui";

type Tab = "cashbook" | "expenses" | "stock" | "assets";

export default function FinancePage() {
  const { data: me } = useApi<Me>("/api/me");
  const roles = rolesOf(me);
  const finance = ["bursar", "school_admin", "principal", "platform_admin"].some(r => roles.has(r));
  const [tab, setTab] = useState<Tab>("cashbook");
  const { data: settings } = useApi<{ settings: { currency?: string } }>("/api/school/settings");
  const cur = settings?.settings?.currency ?? "NGN";
  const tabs: { id: Tab; label: string }[] = finance
    ? [{ id: "cashbook", label: "Cashbook" }, { id: "expenses", label: "Expenses" }, { id: "stock", label: "Stock" }, { id: "assets", label: "Assets" }]
    : [{ id: "stock", label: "Stock" }, { id: "assets", label: "Assets" }];
  const active = tabs.some(t => t.id === tab) ? tab : tabs[0].id;
  return (
    <Page wide>
      <PageHeader eyebrow="Finance" title="Accounts, stock & assets" subtitle="Money in from fees and money out as expenses in one cashbook, plus a stock store and an asset register." />
      <Tabs value={active} onChange={setTab} tabs={tabs} />
      {active === "cashbook" && <Cashbook currency={cur} />}
      {active === "expenses" && <Expenses currency={cur} />}
      {active === "stock" && <Stock canEdit={finance} currency={cur} />}
      {active === "assets" && <Assets canEdit={finance} currency={cur} />}
    </Page>
  );
}

function Cashbook({ currency }: { currency: string }) {
  const [range, setRange] = useState({ from: new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) });
  const { data, error } = useApi<{ income: number; spent: number; net: number; rows: { date: string; kind: string; description: string; method: string | null; amount: number; balance: number }[] }>(
    `/api/finance?view=cashbook&from=${range.from}&to=${range.to}`, [range.from, range.to]);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="From"><input className="input" type="date" value={range.from} onChange={e => setRange({ ...range, from: e.target.value })} /></Field>
        <Field label="To"><input className="input" type="date" value={range.to} onChange={e => setRange({ ...range, to: e.target.value })} /></Field>
        <a className="btn btn-ghost border border-slate-200" href={`/api/finance?view=cashbook&from=${range.from}&to=${range.to}&format=csv`}>CSV</a>
      </div>
      {error && <Alert>{error}</Alert>}
      {data && <div className="grid grid-cols-3 gap-3"><Stat label="Income" value={money(data.income, currency)} tone="good" /><Stat label="Expenses" value={money(data.spent, currency)} tone="warn" /><Stat label="Net" value={money(data.net, currency)} tone={data.net >= 0 ? "good" : "bad"} /></div>}
      {!data?.rows.length ? <Empty>No money in or out in this period.</Empty> : (
        <div className="card overflow-x-auto"><table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-2">Date</th><th className="p-2">Description</th><th className="p-2">Method</th><th className="p-2 text-right">In</th><th className="p-2 text-right">Out</th><th className="p-2 text-right">Balance</th></tr></thead>
          <tbody>{data.rows.map((r, i) => <tr key={i} className="border-t border-slate-100"><td className="p-2">{r.date}</td><td className="p-2">{r.description}</td><td className="p-2 capitalize">{r.method}</td>
            <td className="p-2 text-right tabular-nums text-emerald-700">{r.kind === "in" ? money(r.amount, currency) : ""}</td><td className="p-2 text-right tabular-nums text-rose-700">{r.kind === "out" ? money(r.amount, currency) : ""}</td>
            <td className="p-2 text-right tabular-nums">{money(r.balance, currency)}</td></tr>)}</tbody></table></div>
      )}
    </div>
  );
}

function Expenses({ currency }: { currency: string }) {
  const { data, reload } = useApi<any[]>("/api/finance?view=expenses");
  const [f, setF] = useState({ category: "Supplies", description: "", amount: "", spent_on: new Date().toISOString().slice(0, 10), payee: "", method: "transfer", reference: "" });
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="grid gap-5 xl:grid-cols-3">
      <form className="card h-fit space-y-3 p-5" onSubmit={async e => {
        e.preventDefault();
        const r = await send("/api/finance", { action: "add_expense", ...f, amount: Number(f.amount), payee: f.payee || null, reference: f.reference || null });
        if (!r.ok) return setErr(r.error);
        setErr(null); setF({ ...f, description: "", amount: "", payee: "", reference: "" }); reload();
      }}>
        <h2 className="font-semibold">Record an expense</h2>
        <Field label="Category"><input className="input" list="exp-cats" value={f.category} onChange={e => setF({ ...f, category: e.target.value })} required /></Field>
        <datalist id="exp-cats">{["Salaries", "Supplies", "Utilities", "Repairs", "Transport", "Feeding", "Events", "Rent", "Tax", "Other"].map(c => <option key={c} value={c} />)}</datalist>
        <Field label="Description"><input className="input" value={f.description} onChange={e => setF({ ...f, description: e.target.value })} required /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Amount"><input className="input" type="number" min={0.01} step="any" value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} required /></Field>
          <Field label="Date"><input className="input" type="date" value={f.spent_on} onChange={e => setF({ ...f, spent_on: e.target.value })} required /></Field>
        </div>
        <Field label="Paid to"><input className="input" value={f.payee} onChange={e => setF({ ...f, payee: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Method"><select className="input" value={f.method} onChange={e => setF({ ...f, method: e.target.value })}><option value="transfer">Transfer</option><option value="cash">Cash</option><option value="pos">POS</option><option value="cheque">Cheque</option></select></Field>
          <Field label="Reference"><input className="input" value={f.reference} onChange={e => setF({ ...f, reference: e.target.value })} /></Field>
        </div>
        {err && <Alert>{err}</Alert>}
        <button className="btn btn-primary w-full">Save expense</button>
      </form>
      <div className="xl:col-span-2">
        <div className="mb-2 flex justify-end"><a className="btn btn-ghost border border-slate-200 text-xs" href="/api/finance?view=expenses&format=csv">CSV</a></div>
        {!data?.length ? <Empty>No expenses recorded.</Empty> : (
          <div className="card overflow-x-auto"><table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-2">Date</th><th className="p-2">Category</th><th className="p-2">Description</th><th className="p-2">Payee</th><th className="p-2 text-right">Amount</th><th className="p-2" /></tr></thead>
            <tbody>{data.map((e: any) => <tr key={e.id} className="border-t border-slate-100"><td className="p-2">{e.spent_on}</td><td className="p-2">{e.category}</td><td className="p-2">{e.description}</td><td className="p-2">{e.payee}</td>
              <td className="p-2 text-right tabular-nums">{money(e.amount, currency)}</td><td className="p-2 text-right"><button className="text-xs text-rose-600" onClick={async () => { if (confirm("Delete this expense?")) { await send("/api/finance", { action: "delete_expense", id: e.id }); reload(); } }}>Delete</button></td></tr>)}</tbody></table></div>
        )}
      </div>
    </div>
  );
}

function Stock({ canEdit, currency }: { canEdit: boolean; currency: string }) {
  const { data, reload } = useApi<any[]>("/api/finance?view=inventory");
  const moves = useApi<any[]>(canEdit ? "/api/finance?view=moves" : null);
  const [edit, setEdit] = useState<any | null>(null);
  const [move, setMove] = useState<{ item: any; kind: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const low = (data ?? []).filter((i: any) => Number(i.quantity) <= Number(i.reorder_level) && Number(i.reorder_level) > 0);
  return (
    <div className="space-y-4">
      {low.length > 0 && <Alert tone="amber">Low stock: {low.map((i: any) => `${i.name} (${i.quantity} ${i.unit})`).join(", ")}. Raise a requisition to restock.</Alert>}
      {canEdit && <button className="btn btn-primary" onClick={() => setEdit({ unit: "pcs", reorder_level: 0, unit_cost: 0 })}>+ Add stock item</button>}
      {!data?.length ? <Empty>No stock items yet.</Empty> : (
        <div className="card overflow-x-auto"><table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-2">Item</th><th className="p-2">Category</th><th className="p-2">Location</th><th className="p-2 text-right">In stock</th><th className="p-2 text-right">Value</th><th className="p-2" /></tr></thead>
          <tbody>{data.map((i: any) => <tr key={i.id} className="border-t border-slate-100"><td className="p-2 font-medium">{i.name}<div className="text-xs text-slate-400">{i.sku}</div></td><td className="p-2">{i.category}</td><td className="p-2">{i.location}</td>
            <td className={"p-2 text-right tabular-nums " + (Number(i.quantity) <= Number(i.reorder_level) && Number(i.reorder_level) > 0 ? "font-semibold text-amber-700" : "")}>{i.quantity} {i.unit}</td>
            <td className="p-2 text-right tabular-nums">{money(Number(i.quantity) * Number(i.unit_cost), currency)}</td>
            <td className="whitespace-nowrap p-2 text-right">{canEdit && <>
              <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setMove({ item: i, kind: "in" })}>Receive</button>
              <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setMove({ item: i, kind: "out" })}>Issue</button>
              <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setEdit(i)}>Edit</button></>}</td></tr>)}</tbody></table></div>
      )}
      {canEdit && (moves.data ?? []).length > 0 && (
        <section className="card p-4"><h2 className="mb-2 text-sm font-semibold">Recent movements</h2>
          <ul className="space-y-1 text-xs">{(moves.data ?? []).slice(0, 30).map((m: any) => <li key={m.id}>{fmtDate(m.at, true)} · <Badge tone={m.kind === "in" ? "green" : m.kind === "out" ? "amber" : "slate"}>{m.kind}</Badge> {m.quantity} {m.inventory_items?.unit} {m.inventory_items?.name}{m.reason ? ` · ${m.reason}` : ""}</li>)}</ul>
        </section>
      )}
      <Modal open={Boolean(edit)} onClose={() => setEdit(null)} title={edit?.id ? "Edit item" : "New stock item"}>
        {edit && <form className="grid gap-3 sm:grid-cols-2" onSubmit={async e => {
          e.preventDefault();
          const r = await send("/api/finance", { action: "save_item", id: edit.id, name: edit.name, sku: edit.sku || null, category: edit.category || null, unit: edit.unit || "pcs",
            reorder_level: Number(edit.reorder_level || 0), unit_cost: Number(edit.unit_cost || 0), location: edit.location || null });
          if (!r.ok) return setErr(r.error);
          setErr(null); setEdit(null); reload();
        }}>
          <div className="sm:col-span-2"><Field label="Name"><input className="input" required value={edit.name ?? ""} onChange={e => setEdit({ ...edit, name: e.target.value })} /></Field></div>
          <Field label="SKU / code"><input className="input" value={edit.sku ?? ""} onChange={e => setEdit({ ...edit, sku: e.target.value })} /></Field>
          <Field label="Category"><input className="input" value={edit.category ?? ""} onChange={e => setEdit({ ...edit, category: e.target.value })} /></Field>
          <Field label="Unit"><input className="input" value={edit.unit ?? ""} onChange={e => setEdit({ ...edit, unit: e.target.value })} /></Field>
          <Field label="Reorder at"><input className="input" type="number" min={0} value={edit.reorder_level ?? 0} onChange={e => setEdit({ ...edit, reorder_level: e.target.value })} /></Field>
          <Field label="Unit cost"><input className="input" type="number" min={0} step="any" value={edit.unit_cost ?? 0} onChange={e => setEdit({ ...edit, unit_cost: e.target.value })} /></Field>
          <Field label="Location"><input className="input" value={edit.location ?? ""} onChange={e => setEdit({ ...edit, location: e.target.value })} /></Field>
          {err && <div className="sm:col-span-2"><Alert>{err}</Alert></div>}
          <div className="sm:col-span-2 flex justify-end"><button className="btn btn-primary">Save</button></div>
        </form>}
      </Modal>
      <Modal open={Boolean(move)} onClose={() => setMove(null)} title={move ? `${move.kind === "in" ? "Receive" : "Issue"}: ${move.item.name}` : ""}>
        {move && <form className="space-y-3" onSubmit={async e => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const r = await send("/api/finance", { action: "move", item_id: move.item.id, kind: move.kind, quantity: Number(fd.get("qty")), reason: String(fd.get("reason") || "") || null, reference: String(fd.get("ref") || "") || null });
          if (!r.ok) return setErr(r.error);
          setErr(null); setMove(null); reload(); moves.reload();
        }}>
          <Field label={`Quantity (${move.item.unit})`}><input name="qty" className="input" type="number" min={0.01} step="any" required /></Field>
          <Field label={move.kind === "in" ? "Supplier / delivery note" : "Issued to / purpose"}><input name="reason" className="input" /></Field>
          <Field label="Reference"><input name="ref" className="input" /></Field>
          {err && <Alert>{err}</Alert>}
          <button className="btn btn-primary w-full">Save</button>
        </form>}
      </Modal>
    </div>
  );
}

function Assets({ canEdit, currency }: { canEdit: boolean; currency: string }) {
  const { data, reload } = useApi<any[]>("/api/finance?view=assets");
  const { data: staff } = useApi<{ id: string; full_name: string }[]>(canEdit ? "/api/hr/staff" : null);
  const [edit, setEdit] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const total = (data ?? []).filter((a: any) => a.status !== "retired" && a.status !== "lost").reduce((s: number, a: any) => s + Number(a.cost ?? 0), 0);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">{canEdit && <button className="btn btn-primary" onClick={() => setEdit({ condition: "good", status: "in_use" })}>+ Register asset</button>}<span className="text-sm text-slate-600">Book value of assets in use: <b>{money(total, currency)}</b></span></div>
      {!data?.length ? <Empty>No assets registered.</Empty> : (
        <div className="card overflow-x-auto"><table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-2">Tag</th><th className="p-2">Asset</th><th className="p-2">Location</th><th className="p-2">Assigned to</th><th className="p-2">Condition</th><th className="p-2">Status</th><th className="p-2" /></tr></thead>
          <tbody>{data.map((a: any) => <tr key={a.id} className="border-t border-slate-100"><td className="p-2 font-mono text-xs">{a.tag}</td><td className="p-2">{a.name}<div className="text-xs text-slate-400">{a.category}</div></td><td className="p-2">{a.location}</td>
            <td className="p-2">{a.staff?.full_name}</td><td className="p-2"><Badge tone={["poor", "broken"].includes(a.condition) ? "red" : "slate"}>{a.condition}</Badge></td><td className="p-2"><Badge tone={a.status === "in_use" ? "green" : "amber"}>{a.status.replace("_", " ")}</Badge></td>
            <td className="p-2 text-right">{canEdit && <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setEdit(a)}>Edit</button>}</td></tr>)}</tbody></table></div>
      )}
      <Modal open={Boolean(edit)} onClose={() => setEdit(null)} title={edit?.id ? "Edit asset" : "Register asset"} wide>
        {edit && <form className="grid gap-3 sm:grid-cols-3" onSubmit={async e => {
          e.preventDefault();
          const r = await send("/api/finance", { action: "save_asset", id: edit.id, tag: edit.tag, name: edit.name, category: edit.category || null, location: edit.location || null,
            assigned_staff: edit.assigned_staff || null, condition: edit.condition, status: edit.status, purchase_date: edit.purchase_date || null, cost: edit.cost ? Number(edit.cost) : null, notes: edit.notes || null });
          if (!r.ok) return setErr(r.error);
          setErr(null); setEdit(null); reload();
        }}>
          <Field label="Asset tag"><input className="input" required value={edit.tag ?? ""} onChange={e => setEdit({ ...edit, tag: e.target.value })} /></Field>
          <div className="sm:col-span-2"><Field label="Name"><input className="input" required value={edit.name ?? ""} onChange={e => setEdit({ ...edit, name: e.target.value })} /></Field></div>
          <Field label="Category"><input className="input" value={edit.category ?? ""} onChange={e => setEdit({ ...edit, category: e.target.value })} /></Field>
          <Field label="Location"><input className="input" value={edit.location ?? ""} onChange={e => setEdit({ ...edit, location: e.target.value })} /></Field>
          <Field label="Assigned to"><select className="input" value={edit.assigned_staff ?? ""} onChange={e => setEdit({ ...edit, assigned_staff: e.target.value })}><option value="">—</option>{(staff ?? []).map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select></Field>
          <Field label="Condition"><select className="input" value={edit.condition} onChange={e => setEdit({ ...edit, condition: e.target.value })}>{["new", "good", "fair", "poor", "broken"].map(c => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Status"><select className="input" value={edit.status} onChange={e => setEdit({ ...edit, status: e.target.value })}>{["in_use", "in_store", "repair", "retired", "lost"].map(c => <option key={c} value={c}>{c.replace("_", " ")}</option>)}</select></Field>
          <Field label="Purchase date"><input className="input" type="date" value={edit.purchase_date ?? ""} onChange={e => setEdit({ ...edit, purchase_date: e.target.value })} /></Field>
          <Field label="Cost"><input className="input" type="number" min={0} step="any" value={edit.cost ?? ""} onChange={e => setEdit({ ...edit, cost: e.target.value })} /></Field>
          <div className="sm:col-span-2"><Field label="Notes"><input className="input" value={edit.notes ?? ""} onChange={e => setEdit({ ...edit, notes: e.target.value })} /></Field></div>
          {err && <div className="sm:col-span-3"><Alert>{err}</Alert></div>}
          <div className="sm:col-span-3 flex justify-end"><button className="btn btn-primary">Save</button></div>
        </form>}
      </Modal>
    </div>
  );
}
