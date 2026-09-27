"use client";
import { useState } from "react";
import { useApi, send, Page, PageHeader, Alert, Empty, Modal, Field, Badge, statusTone, fmtDate, money, Icon } from "@/components/ui";

type Req = {
  id: string; title: string; department: string | null; justification: string | null; needed_by: string | null; status: string;
  total_amount: number; created_at: string; decided_at: string | null; decision_note: string | null; requested_by: string;
  requisition_items: { id: string; description: string; quantity: number; unit_cost: number }[];
  requester: { full_name: string } | null; decider: { full_name: string } | null;
};

export default function RequisitionsPage() {
  const [status, setStatus] = useState("");
  const { data, error, reload } = useApi<{ items: Req[]; can_approve: boolean; me: string }>(`/api/requisitions${status ? `?status=${status}` : ""}`, [status]);
  const { data: settings } = useApi<{ settings: { currency?: string } }>("/api/school/settings");
  const currency = settings?.settings?.currency ?? "NGN";
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function decide(id: string, s: string) {
    const note = s === "rejected" ? prompt("Reason for rejection?") ?? "" : s === "approved" ? prompt("Note (optional)") ?? "" : "";
    const r = await send("/api/requisitions", { id, status: s, note: note || null }, "PATCH");
    setMsg({ ok: r.ok, text: r.ok ? `Marked ${s}.` : r.error ?? "failed" });
    reload();
  }

  return (
    <Page wide>
      <PageHeader eyebrow="Operations" title="Requisitions"
        subtitle="Any staff member can request items. The bursar, principal or admin approves, rejects and marks items fulfilled. Nobody can approve their own request."
        actions={<button className="btn btn-primary" onClick={() => setOpen(true)}>+ New requisition</button>} />
      <select className="input mb-4 max-w-[200px]" value={status} onChange={e => setStatus(e.target.value)} aria-label="Status filter">
        <option value="">All</option><option value="submitted">Awaiting approval</option><option value="approved">Approved</option><option value="fulfilled">Fulfilled</option><option value="rejected">Rejected</option><option value="cancelled">Cancelled</option>
      </select>
      {error && <Alert>{error}</Alert>}
      {msg && <div className="mb-3"><Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert></div>}
      {!data?.items.length ? <Empty>No requisitions.</Empty> : (
        <div className="space-y-3">
          {data.items.map(r => (
            <details key={r.id} className="card p-4">
              <summary className="flex cursor-pointer flex-wrap items-center gap-3">
                <span className="font-semibold">{r.title}</span>
                <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                <span className="text-sm text-slate-500">{r.requester?.full_name} · {r.department ?? "—"} · {fmtDate(r.created_at)}</span>
                <span className="ml-auto font-semibold tabular-nums">{money(r.total_amount, currency)}</span>
              </summary>
              <div className="mt-3 border-t border-slate-100 pt-3 text-sm">
                {r.justification && <p className="mb-2 text-slate-700">{r.justification}</p>}
                {r.needed_by && <p className="mb-2 text-xs text-slate-500">Needed by {fmtDate(r.needed_by)}</p>}
                <div className="overflow-x-auto print:overflow-visible"><table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase text-slate-500"><tr><th>Item</th><th className="text-right">Qty</th><th className="text-right">Unit</th><th className="text-right">Amount</th></tr></thead>
                  <tbody>{r.requisition_items.map(i => <tr key={i.id}><td>{i.description}</td><td className="text-right">{i.quantity}</td><td className="text-right">{money(i.unit_cost, currency)}</td><td className="text-right">{money(i.quantity * i.unit_cost, currency)}</td></tr>)}</tbody>
                </table></div>
                {r.decider && <p className="mt-2 text-xs text-slate-500">Decided by {r.decider.full_name} on {fmtDate(r.decided_at)}{r.decision_note ? `: ${r.decision_note}` : ""}</p>}
                <div className="mt-3 flex flex-wrap gap-2">
                  {data.can_approve && r.status === "submitted" && r.requested_by !== data.me && <>
                    <button className="btn btn-primary text-xs" onClick={() => decide(r.id, "approved")}>Approve</button>
                    <button className="btn btn-danger text-xs" onClick={() => decide(r.id, "rejected")}>Reject</button>
                  </>}
                  {data.can_approve && r.status === "approved" && <button className="btn btn-primary text-xs" onClick={() => decide(r.id, "fulfilled")}>Mark fulfilled</button>}
                  {r.requested_by === data.me && r.status === "submitted" && <button className="btn btn-ghost text-xs" onClick={() => decide(r.id, "cancelled")}>Cancel</button>}
                </div>
              </div>
            </details>
          ))}
        </div>
      )}
      <NewRequisition open={open} currency={currency} onClose={() => setOpen(false)} onDone={() => { setOpen(false); reload(); }} />
    </Page>
  );
}

function NewRequisition({ open, onClose, onDone, currency }: { open: boolean; onClose: () => void; onDone: () => void; currency: string }) {
  const [f, setF] = useState({ title: "", department: "", justification: "", needed_by: "" });
  const [items, setItems] = useState([{ description: "", quantity: "1", unit_cost: "0" }]);
  const [err, setErr] = useState<string | null>(null);
  const total = items.reduce((a, i) => a + Number(i.quantity || 0) * Number(i.unit_cost || 0), 0);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const r = await send("/api/requisitions", { ...f, needed_by: f.needed_by || null, items: items.filter(i => i.description).map(i => ({ description: i.description, quantity: Number(i.quantity), unit_cost: Number(i.unit_cost) })) });
    if (!r.ok) return setErr(r.error);
    setF({ title: "", department: "", justification: "", needed_by: "" }); setItems([{ description: "", quantity: "1", unit_cost: "0" }]); setErr(null); onDone();
  }
  return (
    <Modal open={open} onClose={onClose} title="New requisition" wide>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2"><Field label="Title"><input className="input" required value={f.title} onChange={e => setF({ ...f, title: e.target.value })} /></Field></div>
          <Field label="Department"><input className="input" value={f.department} onChange={e => setF({ ...f, department: e.target.value })} /></Field>
        </div>
        <Field label="Why is it needed?"><textarea className="input h-20" value={f.justification} onChange={e => setF({ ...f, justification: e.target.value })} /></Field>
        <Field label="Needed by"><input className="input max-w-xs" type="date" value={f.needed_by} onChange={e => setF({ ...f, needed_by: e.target.value })} /></Field>
        <div className="overflow-x-auto print:overflow-visible"><table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-slate-500"><tr><th>Item</th><th>Qty</th><th>Unit cost</th><th /></tr></thead>
          <tbody>
            {items.map((i, k) => (
              <tr key={k}>
                <td className="pr-2 py-1"><input className="input py-1" value={i.description} onChange={e => setItems(items.map((x, j) => j === k ? { ...x, description: e.target.value } : x))} aria-label="Item" /></td>
                <td className="pr-2"><input className="input w-20 py-1" type="number" min={0} step="any" value={i.quantity} onChange={e => setItems(items.map((x, j) => j === k ? { ...x, quantity: e.target.value } : x))} aria-label="Quantity" /></td>
                <td className="pr-2"><input className="input w-32 py-1" type="number" min={0} step="any" value={i.unit_cost} onChange={e => setItems(items.map((x, j) => j === k ? { ...x, unit_cost: e.target.value } : x))} aria-label="Unit cost" /></td>
                <td><button type="button" className="btn btn-ghost px-2 text-rose-600" onClick={() => setItems(items.filter((_, j) => j !== k))} aria-label="Remove item"><Icon name="x" className="h-4 w-4" /></button></td>
              </tr>
            ))}
          </tbody>
        </table></div>
        <div className="flex items-center justify-between">
          <button type="button" className="btn btn-ghost text-xs" onClick={() => setItems([...items, { description: "", quantity: "1", unit_cost: "0" }])}>+ Add item</button>
          <span className="font-semibold">Total {money(total, currency)}</span>
        </div>
        {err && <Alert>{err}</Alert>}
        <div className="flex justify-end gap-2"><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary">Submit</button></div>
      </form>
    </Modal>
  );
}
