"use client";
import { useState } from "react";
import { useApi, send, Page, PageHeader, Tabs, Alert, Empty, Modal, Field, Badge, Stat, money, fmtDate, localDate, rolesOf, type Me } from "@/components/ui";
import { PettyCash } from "@/components/finance/PettyCash";
import { Budgets } from "@/components/finance/Budgets";
import { Ledger } from "@/components/finance/Ledger";
import { FinReports } from "@/components/finance/FinReports";
import { Buying } from "@/components/finance/Buying";
import PeoplePicker, { type Person } from "@/components/comms/PeoplePicker";

type Tab = "cashbook" | "expenses" | "petty" | "budgets" | "ledger" | "reports" | "buying" | "stock" | "assets";

export default function FinancePage() {
  const { data: me } = useApi<Me>("/api/me");
  const roles = rolesOf(me);
  const finance = ["bursar", "school_admin", "principal", "platform_admin"].some(r => roles.has(r));
  const [tab, setTab] = useState<Tab>("cashbook");
  const { data: settings } = useApi<{ settings: { currency?: string } }>("/api/school/settings");
  const cur = settings?.settings?.currency ?? "NGN";
  const tabs: { id: Tab; label: string }[] = finance
    ? [{ id: "cashbook", label: "Cashbook" }, { id: "expenses", label: "Expenses" }, { id: "petty", label: "Petty cash" }, { id: "budgets", label: "Budgets" },
       { id: "ledger", label: "Ledger" }, { id: "reports", label: "Reports" }, { id: "buying", label: "Buying" }, { id: "stock", label: "Stock" }, { id: "assets", label: "Assets" }]
    : [{ id: "petty", label: "Petty cash" }, { id: "stock", label: "Stock" }, { id: "assets", label: "Assets" }];
  const active = tabs.some(t => t.id === tab) ? tab : tabs[0].id;
  return (
    <Page wide>
      <PageHeader eyebrow="Finance" title="Accounts, stock & assets" subtitle="Cashbook, expenses, petty cash, budgets, the general ledger and financial reports, plus a stock store and an asset register." />
      <Tabs value={active} onChange={setTab} tabs={tabs} />
      {active === "cashbook" && <Cashbook currency={cur} />}
      {active === "expenses" && <Expenses currency={cur} />}
      {active === "petty" && <PettyCash />}
      {active === "budgets" && <Budgets />}
      {active === "ledger" && <Ledger />}
      {active === "reports" && <FinReports />}
      {active === "buying" && <Buying currency={cur} />}
      {active === "stock" && <Stock canEdit={finance} currency={cur} />}
      {active === "assets" && <Assets canEdit={finance} currency={cur} />}
    </Page>
  );
}

function Cashbook({ currency }: { currency: string }) {
  const [range, setRange] = useState(() => ({ from: localDate(30), to: localDate() }));
  const { data, error } = useApi<{ income: number; spent: number; net: number; rows: { date: string; kind: string; description: string; method: string | null; amount: number; balance: number }[] }>(
    `/api/finance?view=cashbook&from=${range.from}&to=${range.to}`, [range.from, range.to]);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="From"><input className="input" type="date" value={range.from} onChange={e => setRange({ ...range, from: e.target.value })} /></Field>
        <Field label="To"><input className="input" type="date" value={range.to} onChange={e => setRange({ ...range, to: e.target.value })} /></Field>
        <a className="btn btn-outline" href={`/api/finance?view=cashbook&from=${range.from}&to=${range.to}&format=csv`}>CSV</a>
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
  const [f, setF] = useState({ category: "Supplies", description: "", amount: "", spent_on: localDate(), payee: "", method: "transfer", reference: "" });
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
        <div className="mb-2 flex justify-end"><a className="btn btn-outline text-xs" href="/api/finance?view=expenses&format=csv">CSV</a></div>
        {!data?.length ? <Empty>No expenses recorded.</Empty> : (
          <div className="card overflow-x-auto"><table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-2">Date</th><th className="p-2">Category</th><th className="p-2">Description</th><th className="p-2">Payee</th><th className="p-2 text-right">Amount</th><th className="p-2" /></tr></thead>
            <tbody>{data.map((e: any) => <tr key={e.id} className="border-t border-slate-100"><td className="p-2">{e.spent_on}</td><td className="p-2">{e.category}{e.method === "petty_cash" && <span className="ml-1 text-xs text-slate-400">petty cash</span>}</td>
              <td className="p-2">{e.description}{e.receipt_path && <a className="ml-1 text-xs text-brand-700 underline" href={`/api/accounts?receipt=${e.id}`} target="_blank" rel="noreferrer">receipt</a>}</td><td className="p-2">{e.payee}</td>
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
  const [issue, setIssue] = useState<any | null>(null);
  const [who, setWho] = useState<Person[]>([]);
  const { data: staffList } = useApi<{ id: string; full_name: string }[]>(canEdit ? "/api/hr/staff" : null);
  const [err, setErr] = useState<string | null>(null);
  const low = (data ?? []).filter((i: any) => Number(i.quantity) <= Number(i.reorder_level) && Number(i.reorder_level) > 0);
  return (
    <div className="space-y-4">
      {low.length > 0 && <Alert tone="amber">Low stock: {low.map((i: any) => `${i.name} (${i.quantity} ${i.unit})`).join(", ")}. Raise a requisition to restock.</Alert>}
      {canEdit && <button className="btn btn-primary" onClick={() => setEdit({ unit: "pcs", reorder_level: 0, unit_cost: 0 })}>+ Add stock item</button>}
      {!data?.length ? <Empty>No stock items yet.</Empty> : (
        <div className="card overflow-x-auto"><table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-2">Item</th><th className="p-2">Category</th><th className="p-2">Location</th><th className="p-2 text-right">In stock</th><th className="p-2 text-right">Value</th><th className="p-2" /></tr></thead>
          <tbody>{data.map((i: any) => <tr key={i.id} className="border-t border-slate-100"><td className="p-2 font-medium">{i.name}{i.variant && <span className="ml-1 text-xs font-normal text-slate-500">({i.variant})</span>}<div className="text-xs text-slate-400">{[i.sku, i.barcode].filter(Boolean).join(" · ")}{i.sell_price ? ` · sells at ${money(i.sell_price, currency)}` : ""}</div></td><td className="p-2">{i.category}</td><td className="p-2">{i.location}</td>
            <td className={"p-2 text-right tabular-nums " + (Number(i.quantity) <= Number(i.reorder_level) && Number(i.reorder_level) > 0 ? "font-semibold text-amber-700" : "")}>{i.quantity} {i.unit}</td>
            <td className="p-2 text-right tabular-nums">{money(Number(i.quantity) * Number(i.unit_cost), currency)}</td>
            <td className="whitespace-nowrap p-2 text-right">{canEdit && <>
              <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setMove({ item: i, kind: "in" })}>Receive</button>
              <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setMove({ item: i, kind: "out" })}>Use</button>
              <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => { setWho([]); setIssue(i); }}>Issue to…</button>
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
            reorder_level: Number(edit.reorder_level || 0), unit_cost: Number(edit.unit_cost || 0), location: edit.location || null,
            variant: edit.variant || null, barcode: edit.barcode || null, sell_price: edit.sell_price ? Number(edit.sell_price) : null });
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
          <Field label="Size / colour (uniforms)"><input className="input" value={edit.variant ?? ""} onChange={e => setEdit({ ...edit, variant: e.target.value })} placeholder="e.g. Age 9–10" /></Field>
          <Field label="Barcode"><input className="input" value={edit.barcode ?? ""} onChange={e => setEdit({ ...edit, barcode: e.target.value })} /></Field>
          <Field label="Selling price (if sold)"><input className="input" type="number" min={0} step="any" value={edit.sell_price ?? ""} onChange={e => setEdit({ ...edit, sell_price: e.target.value })} /></Field>
          {err && <div className="sm:col-span-2"><Alert>{err}</Alert></div>}
          <div className="sm:col-span-2 flex justify-end"><button className="btn btn-primary">Save</button></div>
        </form>}
      </Modal>
      <Modal open={Boolean(issue)} onClose={() => setIssue(null)} title={issue ? `Issue ${issue.name}${issue.variant ? ` (${issue.variant})` : ""}` : ""}>
        {issue && <form className="space-y-3" onSubmit={async e => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const staffId = String(fd.get("staff") || "");
          const r = await send("/api/finance", { action: "issue", item_id: issue.id, quantity: Number(fd.get("qty")), student_id: !staffId && who[0] ? who[0].id : null, staff_id: staffId || null, reason: String(fd.get("reason") || "") || null });
          if (!r.ok) return setErr(r.error);
          setErr(null); setIssue(null); reload(); moves.reload();
        }}>
          <Field label="To a student"><PeoplePicker types={["Student"]} value={who} onChange={v => setWho(v.slice(-1))} placeholder="Search a student" /></Field>
          <Field label="Or to a member of staff"><select className="input" name="staff" defaultValue=""><option value="">—</option>{(staffList ?? []).map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select></Field>
          <Field label={`Quantity (${issue.unit})`}><input name="qty" className="input" type="number" min={0.01} step="any" required defaultValue={1} /></Field>
          <Field label="What for"><input name="reason" className="input" placeholder="e.g. new starter's uniform" /></Field>
          {err && <Alert>{err}</Alert>}
          <button className="btn btn-primary w-full">Issue</button>
        </form>}
      </Modal>
      <Modal open={Boolean(move)} onClose={() => setMove(null)} title={move ? `${move.kind === "in" ? "Receive" : "Use"}: ${move.item.name}` : ""}>
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

/** An asset's services, repairs and reported faults, and logging new ones. */
function ServiceLog({ asset, currency, onClose }: { asset: any | null; currency: string; onClose: () => void }) {
  const { data, reload } = useApi<any[]>(asset ? `/api/finance?view=maintenance&asset=${asset.id}` : null, [asset?.id]);
  const [f, setF] = useState({ kind: "service", status: "done", description: "", due_on: "", done_on: localDate(), cost: "", vendor: "" });
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal open={Boolean(asset)} onClose={onClose} title={asset ? `${asset.tag} ${asset.name}` : ""} wide>
      {asset && <div className="space-y-3 text-sm">
        <p className="text-slate-600">{asset.maintenance_every_days ? `Serviced every ${asset.maintenance_every_days} days.` : "No regular service set."} {asset.next_maintenance_on ? `Next: ${fmtDate(asset.next_maintenance_on)}.` : ""} {asset.warranty_expires ? `Warranty to ${fmtDate(asset.warranty_expires)}.` : ""}</p>
        {!(data ?? []).length ? <Empty>Nothing logged yet.</Empty> : <ul className="space-y-1">{data!.map((m: any) => (
          <li key={m.id} className="flex flex-wrap items-center gap-2"><Badge tone={m.status === "reported" ? "red" : m.status === "scheduled" ? "amber" : "green"}>{m.kind} · {m.status}</Badge>
            <span>{m.description}</span><span className="text-xs text-slate-500">{m.done_on ? `done ${fmtDate(m.done_on)}` : m.due_on ? `due ${fmtDate(m.due_on)}` : fmtDate(m.created_at)}{m.vendor ? ` · ${m.vendor}` : ""}{m.cost ? ` · ${money(m.cost, currency)}` : ""}</span>
            {m.status !== "done" && <button className="ml-auto text-xs text-brand-700" onClick={async () => { const r = await send("/api/finance", { action: "maintenance", id: m.id, asset_id: asset.id, kind: m.kind === "fault" ? "repair" : m.kind, status: "done", description: m.description, done_on: localDate() }); if (!r.ok) alert(r.error); reload(); }}>mark done</button>}</li>))}</ul>}
        <form className="grid gap-2 rounded border border-slate-200 p-3 sm:grid-cols-3" onSubmit={async e => {
          e.preventDefault();
          const r = await send("/api/finance", { action: "maintenance", asset_id: asset.id, kind: f.kind, status: f.status, description: f.description || null, due_on: f.due_on || null, done_on: f.status === "done" ? f.done_on : null, cost: f.cost ? Number(f.cost) : null, vendor: f.vendor || null });
          if (!r.ok) return setErr(r.error);
          setErr(null); setF({ ...f, description: "", cost: "", vendor: "" }); reload();
        }}>
          <Field label="What"><select className="input" value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })}>{["service", "repair", "inspection", "calibration", "cleaning"].map(k => <option key={k}>{k}</option>)}</select></Field>
          <Field label="Status"><select className="input" value={f.status} onChange={e => setF({ ...f, status: e.target.value })}><option value="done">Done</option><option value="scheduled">Booked</option></select></Field>
          {f.status === "done" ? <Field label="Done on"><input className="input" type="date" value={f.done_on} onChange={e => setF({ ...f, done_on: e.target.value })} /></Field>
            : <Field label="Booked for"><input className="input" type="date" value={f.due_on} onChange={e => setF({ ...f, due_on: e.target.value })} /></Field>}
          <div className="sm:col-span-3"><Field label="Details"><input className="input" value={f.description} onChange={e => setF({ ...f, description: e.target.value })} /></Field></div>
          <Field label="By (vendor)"><input className="input" value={f.vendor} onChange={e => setF({ ...f, vendor: e.target.value })} /></Field>
          <Field label="Cost"><input className="input" type="number" min={0} step="any" value={f.cost} onChange={e => setF({ ...f, cost: e.target.value })} /></Field>
          {err && <div className="sm:col-span-3"><Alert>{err}</Alert></div>}
          <button className="btn btn-primary self-end">Save</button>
        </form>
        <p className="text-xs text-slate-500">A finished service moves the next service date on. Record what it cost as an expense too if it was paid outside a purchase order.</p>
      </div>}
    </Modal>
  );
}

function Assets({ canEdit, currency }: { canEdit: boolean; currency: string }) {
  const { data, reload } = useApi<any[]>("/api/finance?view=assets");
  const { data: staff } = useApi<{ id: string; full_name: string }[]>(canEdit ? "/api/hr/staff" : null);
  const [edit, setEdit] = useState<any | null>(null);
  const [log, setLog] = useState<any | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const today = localDate();
  const due = (data ?? []).filter((a: any) => a.status !== "retired" && a.next_maintenance_on && a.next_maintenance_on <= today);
  const [err, setErr] = useState<string | null>(null);
  const total = (data ?? []).filter((a: any) => a.status !== "retired" && a.status !== "lost").reduce((s: number, a: any) => s + Number(a.cost ?? 0), 0);
  return (
    <div className="space-y-4">
      {note && <Alert tone="green">{note}</Alert>}
      {canEdit && due.length > 0 && <Alert tone="amber">Service due: {due.map((a: any) => `${a.tag} ${a.name} (${fmtDate(a.next_maintenance_on)})`).join(", ")}.</Alert>}
      <div className="flex items-center gap-3">{canEdit && <button className="btn btn-primary" onClick={() => setEdit({ condition: "good", status: "in_use" })}>+ Register asset</button>}<span className="text-sm text-slate-600">Book value of assets in use: <b>{money(total, currency)}</b></span></div>
      {!data?.length ? <Empty>No assets registered.</Empty> : (
        <div className="card overflow-x-auto"><table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-2">Tag</th><th className="p-2">Asset</th><th className="p-2">Location</th><th className="p-2">Assigned to</th><th className="p-2">Condition</th><th className="p-2">Status</th><th className="p-2" /></tr></thead>
          <tbody>{data.map((a: any) => <tr key={a.id} className="border-t border-slate-100"><td className="p-2 font-mono text-xs">{a.tag}</td><td className="p-2">{a.name}<div className="text-xs text-slate-400">{a.category}</div></td><td className="p-2">{a.location}</td>
            <td className="p-2">{a.staff?.full_name}</td><td className="p-2"><Badge tone={["poor", "broken"].includes(a.condition) ? "red" : "slate"}>{a.condition}</Badge></td><td className="p-2"><Badge tone={a.status === "in_use" ? "green" : "amber"}>{a.status.replace("_", " ")}</Badge></td>
            <td className="whitespace-nowrap p-2 text-right">{canEdit && <><button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setLog(a)}>Service log</button><button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setEdit(a)}>Edit</button></>}
              <button className="btn btn-ghost px-2 py-1 text-xs text-rose-600" onClick={async () => { const d = prompt(`What is wrong with ${a.tag} ${a.name}?`); if (d && d.trim().length >= 3) { const r = await send("/api/finance", { action: "report_fault", asset_id: a.id, description: d }); setNote(r.ok ? "Fault reported to the bursary." : r.error); } }}>Report fault</button></td></tr>)}</tbody></table></div>
      )}
      <ServiceLog asset={log} currency={currency} onClose={() => { setLog(null); reload(); }} />
      <Modal open={Boolean(edit)} onClose={() => setEdit(null)} title={edit?.id ? "Edit asset" : "Register asset"} wide>
        {edit && <form className="grid gap-3 sm:grid-cols-3" onSubmit={async e => {
          e.preventDefault();
          const r = await send("/api/finance", { action: "save_asset", id: edit.id, tag: edit.tag, name: edit.name, category: edit.category || null, location: edit.location || null,
            assigned_staff: edit.assigned_staff || null, condition: edit.condition, status: edit.status, purchase_date: edit.purchase_date || null, cost: edit.cost ? Number(edit.cost) : null, notes: edit.notes || null,
            serial_no: edit.serial_no || null, supplier: edit.supplier || null, warranty_expires: edit.warranty_expires || null, maintenance_every_days: edit.maintenance_every_days ? Number(edit.maintenance_every_days) : null,
            next_maintenance_on: edit.next_maintenance_on || null });
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
          <Field label="Serial number"><input className="input" value={edit.serial_no ?? ""} onChange={e => setEdit({ ...edit, serial_no: e.target.value })} /></Field>
          <Field label="Supplier"><input className="input" value={edit.supplier ?? ""} onChange={e => setEdit({ ...edit, supplier: e.target.value })} /></Field>
          <Field label="Warranty ends"><input className="input" type="date" value={edit.warranty_expires ?? ""} onChange={e => setEdit({ ...edit, warranty_expires: e.target.value })} /></Field>
          <Field label="Service every (days)"><input className="input" type="number" min={1} value={edit.maintenance_every_days ?? ""} onChange={e => setEdit({ ...edit, maintenance_every_days: e.target.value })} placeholder="e.g. 90 for a generator" /></Field>
          <Field label="Next service"><input className="input" type="date" value={edit.next_maintenance_on ?? ""} onChange={e => setEdit({ ...edit, next_maintenance_on: e.target.value })} /></Field>
          <div className="sm:col-span-3"><Field label="Notes"><input className="input" value={edit.notes ?? ""} onChange={e => setEdit({ ...edit, notes: e.target.value })} /></Field></div>
          {err && <div className="sm:col-span-3"><Alert>{err}</Alert></div>}
          <div className="sm:col-span-3 flex justify-end"><button className="btn btn-primary">Save</button></div>
        </form>}
      </Modal>
    </div>
  );
}
