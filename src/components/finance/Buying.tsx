"use client";
import { useState } from "react";
import { useApi, send, Alert, Empty, Modal, Field, Badge, Tabs, money, fmtDate } from "@/components/ui";
import { bestQuote } from "@/lib/procurement";

type Supplier = { id: string; name: string; contact_name: string | null; phone: string | null; email: string | null; address: string | null; category: string | null; tax_id: string | null;
  bank_name: string | null; account_no: string | null; account_name: string | null; notes: string | null; active: boolean };
type Line = { id?: string; description: string; quantity: number; unit_cost: number; inventory_item_id: string | null; is_asset: boolean; received_qty?: number; inventory_items?: { name: string; variant: string | null; unit: string } | null };
type Sub = "overview" | "orders" | "suppliers";
const STATUS_TONE: Record<string, "slate" | "blue" | "amber" | "green" | "red"> = { draft: "slate", sent: "blue", partly_received: "amber", received: "green", cancelled: "red" };

/** Buying: approved requisitions to order, what to reorder, orders, goods received and paid, suppliers. */
export function Buying({ currency }: { currency: string }) {
  const [sub, setSub] = useState<Sub>("overview");
  const [order, setOrder] = useState<string | null>(null);
  const suppliers = useApi<Supplier[]>("/api/procurement?view=suppliers");
  return (
    <div className="space-y-4">
      <Tabs value={sub} onChange={setSub} tabs={[{ id: "overview", label: "To do" }, { id: "orders", label: "Purchase orders" }, { id: "suppliers", label: "Suppliers" }]} />
      {sub === "overview" && <Overview currency={currency} suppliers={suppliers.data ?? []} onOpen={setOrder} />}
      {sub === "orders" && <Orders currency={currency} onOpen={setOrder} />}
      {sub === "suppliers" && <Suppliers list={suppliers.data ?? []} reload={suppliers.reload} />}
      <OrderDetail id={order} currency={currency} onClose={() => setOrder(null)} />
    </div>
  );
}

function Overview({ currency, suppliers, onOpen }: { currency: string; suppliers: Supplier[]; onOpen: (id: string) => void }) {
  const { data, reload } = useApi<any>("/api/procurement?view=overview");
  const [quotes, setQuotes] = useState<any | null>(null);
  const [newOrder, setNewOrder] = useState<{ requisition_id?: string; lines?: Line[]; title: string; supplier_id?: string } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!data) return null;
  const toOrder = data.requisitions.filter((r: any) => r.status === "approved" && !r.ordered);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {msg && <div className="lg:col-span-2"><Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert></div>}
      <section className="card p-4">
        <h2 className="mb-2 font-semibold">Approved, to order ({toOrder.length})</h2>
        {!toOrder.length ? <p className="text-sm text-slate-500">Nothing waiting.</p> : <ul className="space-y-2 text-sm">{toOrder.map((r: any) => (
          <li key={r.id} className="flex flex-wrap items-center gap-2"><span className="font-medium">{r.title}</span><span className="text-slate-500">{r.requester?.full_name} · {money(r.total_amount, currency)}</span>
            <span className="ml-auto flex gap-1"><button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setQuotes(r)}>Quotes</button>
              <button className="btn btn-primary px-2 py-1 text-xs" onClick={() => setNewOrder({ requisition_id: r.id, title: r.title })}>Order</button></span></li>))}</ul>}
        {data.requisitions.some((r: any) => r.status !== "approved") && <p className="mt-2 text-xs text-slate-500">{data.requisitions.filter((r: any) => r.status !== "approved").length} more waiting for approval under Requisitions.</p>}
      </section>
      <section className="card p-4">
        <div className="mb-2 flex items-center"><h2 className="mr-auto font-semibold">Running low ({data.reorder.length})</h2>
          {data.reorder.length > 0 && <button className="btn btn-outline px-2 py-1 text-xs" onClick={() => setNewOrder({ title: "Restock", lines: data.reorder.map((i: any) => ({ description: `${i.name}${i.variant ? ` (${i.variant})` : ""}`, quantity: i.suggest, unit_cost: Number(i.unit_cost), inventory_item_id: i.id, is_asset: false })) })}>Order all</button>}</div>
        {!data.reorder.length ? <p className="text-sm text-slate-500">Stock is above its reorder levels.</p> : <ul className="space-y-1 text-sm">{data.reorder.map((i: any) => <li key={i.id} className="flex justify-between"><span>{i.name}{i.variant ? ` (${i.variant})` : ""}: <b>{i.quantity}</b> left</span><span className="text-slate-500">order {i.suggest} · {money(i.cost, currency)}</span></li>)}</ul>}
      </section>
      <section className="card p-4">
        <h2 className="mb-2 font-semibold">Orders in progress</h2>
        {!data.orders.length ? <p className="text-sm text-slate-500">None.</p> : <ul className="space-y-1 text-sm">{data.orders.map((o: any) => <li key={o.id}><button className="text-brand-700 hover:underline" onClick={() => onOpen(o.id)}>{o.po_no ?? "Draft"}</button> · {o.suppliers?.name} · {money(o.total, currency)} <Badge tone={STATUS_TONE[o.status]}>{o.status.replace("_", " ")}</Badge>{o.expected_on ? <span className="text-xs text-slate-500"> due {fmtDate(o.expected_on)}</span> : null}</li>)}</ul>}
      </section>
      <section className="card p-4">
        <h2 className="mb-2 font-semibold">Assets needing attention</h2>
        {!data.faults.length && !data.due.service.length && !data.due.warranty.length ? <p className="text-sm text-slate-500">Nothing reported or due.</p> : <ul className="space-y-1 text-sm">
          {data.faults.map((f: any) => <li key={f.id}><Badge tone="red">fault</Badge> {f.assets?.tag} {f.assets?.name}: {f.description} <span className="text-xs text-slate-500">{fmtDate(f.created_at)}</span></li>)}
          {data.due.service.map((a: any) => <li key={a.id}><Badge tone={a.overdue ? "red" : "amber"}>service</Badge> {a.tag} {a.name} · {fmtDate(a.next_maintenance_on)}</li>)}
          {data.due.warranty.map((a: any) => <li key={a.id}><Badge>warranty</Badge> {a.tag} {a.name} ends {fmtDate(a.warranty_expires)}</li>)}</ul>}
        <p className="mt-2 text-xs text-slate-500">Log services and repairs under Assets.</p>
      </section>
      <Quotes req={quotes} suppliers={suppliers} currency={currency} onClose={() => setQuotes(null)} onOrder={(sid) => { const r = quotes; setQuotes(null); setNewOrder({ requisition_id: r.id, title: r.title, supplier_id: sid }); }} />
      <Modal open={Boolean(newOrder)} onClose={() => setNewOrder(null)} title={`New purchase order: ${newOrder?.title ?? ""}`}>
        {newOrder && <form className="space-y-3" onSubmit={async e => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const r = await send<{ id: string }>("/api/procurement", { action: "create_order", requisition_id: newOrder.requisition_id ?? null, supplier_id: String(fd.get("supplier")), expected_on: String(fd.get("expected") || "") || null, lines: newOrder.lines });
          setMsg({ ok: r.ok, text: r.ok ? "Draft order created. Check the lines, then send it." : r.error ?? "" });
          if (r.ok) { setNewOrder(null); reload(); onOpen(r.data.id); }
        }}>
          {!suppliers.filter(s => s.active).length ? <Alert tone="amber">Add a supplier first (Suppliers tab).</Alert> :
            <Field label="Supplier"><select className="input" name="supplier" required defaultValue={newOrder.supplier_id}>{suppliers.filter(s => s.active).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>}
          <Field label="Expected by"><input className="input" type="date" name="expected" /></Field>
          <p className="text-xs text-slate-500">{newOrder.requisition_id ? "The requisition's items become the order lines." : `${newOrder.lines?.length ?? 0} lines from the stock that is running low.`}</p>
          <button className="btn btn-primary w-full">Create draft</button>
        </form>}
      </Modal>
    </div>
  );
}

function Quotes({ req, suppliers, currency, onClose, onOrder }: { req: any | null; suppliers: Supplier[]; currency: string; onClose: () => void; onOrder: (supplierId: string) => void }) {
  const { data, reload } = useApi<any[]>(req ? `/api/procurement?view=quotes&requisition=${req.id}` : null, [req?.id]);
  const best = bestQuote((data ?? []).map(q => ({ ...q, amount: Number(q.amount) })));
  return (
    <Modal open={Boolean(req)} onClose={onClose} title={`Quotes: ${req?.title ?? ""}`}>
      {req && <div className="space-y-3 text-sm">
        <p className="text-slate-600">Budgeted {money(req.total_amount, currency)}. Most schools get three quotes for larger purchases.</p>
        {!(data ?? []).length ? <p className="text-slate-500">No quotes yet.</p> : <ul className="space-y-1">{data!.map(q => (
          <li key={q.id} className="flex flex-wrap items-center gap-2"><b>{q.suppliers?.name}</b> {money(q.amount, currency)}{q.delivery_days != null ? ` · ${q.delivery_days} days` : ""}
            {best?.id === q.id && <Badge tone="green">best</Badge>}{q.chosen && <Badge tone="blue">chosen</Badge>}
            <span className="ml-auto flex gap-1">{!q.chosen && <button className="btn btn-ghost px-2 py-1 text-xs" onClick={async () => { await send("/api/procurement", { action: "choose_quote", id: q.id }); reload(); }}>Choose</button>}
              <button className="btn btn-primary px-2 py-1 text-xs" onClick={() => onOrder(q.supplier_id)}>Order from them</button></span></li>))}</ul>}
        <form className="grid grid-cols-3 gap-2" onSubmit={async e => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const r = await send("/api/procurement", { action: "save_quote", requisition_id: req.id, supplier_id: String(fd.get("supplier")), amount: Number(fd.get("amount")), delivery_days: fd.get("days") ? Number(fd.get("days")) : null });
          if (r.ok) { (e.target as HTMLFormElement).reset(); reload(); } else alert(r.error);
        }}>
          <select className="input" name="supplier" required aria-label="Supplier">{suppliers.filter(s => s.active).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <input className="input" name="amount" type="number" min={0} step="any" required placeholder="Amount" aria-label="Amount" />
          <input className="input" name="days" type="number" min={0} placeholder="Days to deliver" aria-label="Delivery days" />
          <button className="btn btn-outline col-span-3">Add quote</button>
        </form>
      </div>}
    </Modal>
  );
}

function Orders({ currency, onOpen }: { currency: string; onOpen: (id: string) => void }) {
  const { data } = useApi<any[]>("/api/procurement?view=orders");
  if (!data) return null;
  return !data.length ? <Empty>No purchase orders yet.</Empty> : (
    <div className="card overflow-x-auto"><table className="w-full text-sm">
      <thead className="bg-slate-50 text-left text-[13px] text-slate-500"><tr><th className="p-2">Order</th><th className="p-2">Supplier</th><th className="p-2">For</th><th className="p-2 text-right">Total</th><th className="p-2">Status</th><th className="p-2">Paid</th></tr></thead>
      <tbody>{data.map(o => <tr key={o.id} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50" onClick={() => onOpen(o.id)}>
        <td className="p-2 font-mono text-xs">{o.po_no ?? "draft"}</td><td className="p-2">{o.suppliers?.name}</td><td className="p-2">{o.requisitions?.title ?? ""}</td>
        <td className="p-2 text-right tabular-nums">{money(o.total, currency)}</td><td className="p-2"><Badge tone={STATUS_TONE[o.status]}>{o.status.replace("_", " ")}</Badge></td><td className="p-2">{o.paid_at ? fmtDate(o.paid_at) : ""}</td></tr>)}</tbody></table></div>
  );
}

function OrderDetail({ id, currency, onClose }: { id: string | null; currency: string; onClose: () => void }) {
  const { data, reload } = useApi<any>(id ? `/api/procurement?view=order&id=${id}` : null, [id]);
  const [lines, setLines] = useState<Line[] | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const call = async (body: object, ok: string) => { const r = await send<any>("/api/procurement", body); setMsg({ ok: r.ok, text: r.ok ? ok : r.error ?? "" }); if (r.ok) { setLines(null); reload(); } return r; };
  const o = data?.order;
  const draft = o?.status === "draft";
  const ls: Line[] = lines ?? data?.lines ?? [];
  const setL = (i: number, p: Partial<Line>) => setLines(ls.map((x, j) => j === i ? { ...x, ...p } : x));
  return (
    <Modal open={Boolean(id)} onClose={() => { setLines(null); setMsg(null); onClose(); }} title={o ? `${o.po_no ?? "Draft order"} · ${o.suppliers?.name}` : "Order"} wide>
      {o && <div className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center gap-2"><Badge tone={STATUS_TONE[o.status]}>{o.status.replace("_", " ")}</Badge><span className="font-semibold">{money(o.total, currency)}</span>
          {o.requisitions?.title && <span className="text-slate-500">for {o.requisitions.title}</span>}{o.expected_on && <span className="text-slate-500">expected {fmtDate(o.expected_on)}</span>}
          <span className="ml-auto flex gap-1">
            {draft && <button className="btn btn-primary px-2 py-1 text-xs" onClick={() => call({ action: "order_status", po_id: o.id, status: "sent" }, "Sent. Print it or email it to the supplier.")}>Send</button>}
            {o.status !== "draft" && <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => window.print()}>Print</button>}
            {["draft", "sent"].includes(o.status) && <button className="btn btn-ghost px-2 py-1 text-xs text-rose-600" onClick={() => confirm("Cancel this order?") && call({ action: "order_status", po_id: o.id, status: "cancelled" }, "Cancelled.")}>Cancel</button>}
          </span></div>
        {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
        <table className="w-full"><thead className="text-left text-[13px] text-slate-500"><tr><th>Item</th><th className="text-right">Qty</th><th className="text-right">Unit cost</th><th>Goes into</th>{!draft && <th>Received</th>}<th /></tr></thead>
          <tbody>{ls.map((l, i) => (
            <tr key={l.id ?? i} className="border-t border-slate-100 align-top">
              <td className="py-1 pr-2">{draft ? <input className="input" value={l.description} onChange={e => setL(i, { description: e.target.value })} /> : l.description}</td>
              <td className="py-1 pr-2 text-right">{draft ? <input className="input w-20 text-right" type="number" min={0.01} step="any" value={l.quantity} onChange={e => setL(i, { quantity: Number(e.target.value) })} /> : l.quantity}</td>
              <td className="py-1 pr-2 text-right">{draft ? <input className="input w-28 text-right" type="number" min={0} step="any" value={l.unit_cost} onChange={e => setL(i, { unit_cost: Number(e.target.value) })} /> : money(l.unit_cost, currency)}</td>
              <td className="py-1 pr-2">{draft ? <select className="input" value={l.is_asset ? "asset" : l.inventory_item_id ?? ""} onChange={e => setL(i, e.target.value === "asset" ? { is_asset: true, inventory_item_id: null } : { is_asset: false, inventory_item_id: e.target.value || null })}>
                <option value="">Nowhere (a service or consumable)</option><option value="asset">Asset register</option>{(data.items ?? []).map((s: any) => <option key={s.id} value={s.id}>Stock: {s.name}{s.variant ? ` (${s.variant})` : ""}</option>)}</select>
                : l.is_asset ? "Asset register" : l.inventory_items ? `Stock: ${l.inventory_items.name}` : "—"}</td>
              {!draft && <td className="py-1">{l.received_qty}/{l.quantity}{["sent", "partly_received"].includes(o.status) && Number(l.received_qty) < Number(l.quantity) &&
                <button className="ml-2 text-xs text-brand-700" onClick={() => { const q = prompt(`How many arrived? (up to ${Number(l.quantity) - Number(l.received_qty)})`, String(Number(l.quantity) - Number(l.received_qty))); if (q) call({ action: "receive", line_id: l.id, quantity: Number(q) }, l.is_asset ? "Received and added to the asset register." : l.inventory_item_id ? "Received into stock." : "Received."); }}>receive</button>}</td>}
              <td>{draft && <button type="button" className="text-xs text-rose-600" aria-label="Remove" onClick={() => setLines(ls.filter((_, j) => j !== i))}>✕</button>}</td>
            </tr>))}</tbody></table>
        {draft && <div className="flex gap-2"><button className="btn btn-ghost" onClick={() => setLines([...ls, { description: "", quantity: 1, unit_cost: 0, inventory_item_id: null, is_asset: false }])}>+ Line</button>
          {lines && <button className="btn btn-outline" onClick={() => call({ action: "save_lines", po_id: o.id, lines: ls.filter(l => l.description.trim()).map(l => ({ description: l.description, quantity: Number(l.quantity), unit_cost: Number(l.unit_cost), inventory_item_id: l.inventory_item_id, is_asset: l.is_asset })) }, "Lines saved.")}>Save lines</button>}</div>}
        {!draft && <p className="text-xs text-slate-500">{data.progress.received} of {data.progress.ordered} received ({money(data.progress.value_received, currency)}).</p>}
        {o.status !== "draft" && o.status !== "cancelled" && (o.paid_at ? <p className="text-emerald-700">Paid {fmtDate(o.paid_at)}; recorded as an expense.</p> :
          <form className="flex flex-wrap items-end gap-2 rounded border border-slate-200 p-2" onSubmit={e => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            call({ action: "pay", po_id: o.id, amount: Number(fd.get("amount")), method: String(fd.get("method")), reference: String(fd.get("ref") || "") || null }, "Payment recorded as an expense.");
          }}>
            <Field label="Pay supplier"><input className="input w-36" name="amount" type="number" min={0.01} step="any" defaultValue={o.total} required /></Field>
            <Field label="How"><select className="input" name="method"><option value="transfer">Transfer</option><option value="cheque">Cheque</option><option value="cash">Cash</option><option value="pos">POS</option></select></Field>
            <Field label="Reference"><input className="input" name="ref" /></Field>
            <button className="btn btn-primary">Record payment</button>
          </form>)}
        {o.suppliers && <p className="text-xs text-slate-500">{[o.suppliers.contact_name, o.suppliers.phone, o.suppliers.email, o.suppliers.bank_name && `${o.suppliers.bank_name} ${o.suppliers.account_no ?? ""}`].filter(Boolean).join(" · ")}</p>}
      </div>}
    </Modal>
  );
}

function Suppliers({ list, reload }: { list: Supplier[]; reload: () => void }) {
  const [edit, setEdit] = useState<Partial<Supplier> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const f = (k: keyof Supplier, label: string) => <Field label={label}><input className="input" value={(edit?.[k] as string) ?? ""} onChange={e => setEdit({ ...edit, [k]: e.target.value })} /></Field>;
  return (
    <div className="space-y-3">
      <button className="btn btn-primary" onClick={() => setEdit({ active: true })}>+ Supplier</button>
      {!list.length ? <Empty>No suppliers yet.</Empty> : <div className="card overflow-x-auto"><table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-[13px] text-slate-500"><tr><th className="p-2">Supplier</th><th className="p-2">Supplies</th><th className="p-2">Contact</th><th className="p-2">Bank</th><th /></tr></thead>
        <tbody>{list.map(s => <tr key={s.id} className={"border-t border-slate-100 " + (s.active ? "" : "text-slate-400")}><td className="p-2 font-medium">{s.name}</td><td className="p-2">{s.category}</td>
          <td className="p-2 text-xs">{[s.contact_name, s.phone, s.email].filter(Boolean).join(" · ")}</td><td className="p-2 text-xs">{s.bank_name} {s.account_no}</td>
          <td className="p-2 text-right"><button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setEdit(s)}>Edit</button></td></tr>)}</tbody></table></div>}
      <Modal open={Boolean(edit)} onClose={() => { setEdit(null); setErr(null); }} title={edit?.id ? "Edit supplier" : "New supplier"} wide>
        {edit && <form className="grid gap-3 sm:grid-cols-3" onSubmit={async e => {
          e.preventDefault();
          const r = await send("/api/procurement", { action: "save_supplier", ...edit });
          if (!r.ok) return setErr(r.error);
          setEdit(null); setErr(null); reload();
        }}>
          <div className="sm:col-span-2"><Field label="Name"><input className="input" required value={edit.name ?? ""} onChange={e => setEdit({ ...edit, name: e.target.value })} /></Field></div>
          {f("category", "What they supply")}{f("contact_name", "Contact person")}{f("phone", "Phone")}{f("email", "Email")}
          <div className="sm:col-span-3">{f("address", "Address")}</div>
          {f("tax_id", "Tax ID")}{f("bank_name", "Bank")}{f("account_no", "Account number")}{f("account_name", "Account name")}
          <div className="sm:col-span-2">{f("notes", "Notes")}</div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={edit.active !== false} onChange={e => setEdit({ ...edit, active: e.target.checked })} />Still using them</label>
          {err && <div className="sm:col-span-3"><Alert>{err}</Alert></div>}
          <button className="btn btn-primary sm:col-span-3">Save</button>
        </form>}
      </Modal>
    </div>
  );
}
