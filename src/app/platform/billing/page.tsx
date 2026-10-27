"use client";
import { useState } from "react";
import Link from "next/link";
import { useApi, send, Page, PageHeader, Badge, Alert, Field, Loading, Empty, Modal, fmtDate } from "@/components/ui";
import PlatformNav from "@/components/platform/PlatformNav";
import { PayInvoice } from "@/components/platform/TenantPlan";
import { moduleLabel, naira } from "@/lib/saas";

type Inv = { id: string; number: string; tenant_id: string; status: string; kind: string; amount_cents: number; due_at: string | null; paid_at: string | null; method: string | null; period_start: string | null; period_end: string | null; created_at: string; tenants: { name: string } | null };
type Req = { id: string; tenant_id: string; module: string; action: "add" | "remove"; note: string | null; status: string; reply: string | null; created_at: string; tenants: { name: string } | null; users: { full_name: string; email: string } | null };
type Sub = { tenant_id: string; status: string; custom_annual: number | null };

/** Money in, money owed, and schools' module requests. */
export default function BillingPage() {
  const [filter, setFilter] = useState("open");
  const { data, reload } = useApi<{ invoices: Inv[]; subscriptions: Sub[] }>(`/api/platform/invoices${filter ? `?status=${filter}` : ""}`, [filter]);
  const { data: all } = useApi<{ invoices: Inv[] }>("/api/platform/invoices");
  const { data: requests, reload: reloadReq } = useApi<Req[]>("/api/platform/requests");
  const { data: schools } = useApi<{ id: string; name: string }[]>("/api/platform/tenants");
  const [pay, setPay] = useState<Inv | null>(null);
  const [answer, setAnswer] = useState<Req | null>(null);
  const [newInv, setNewInv] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const year = new Date().getFullYear();
  const inv = all?.invoices ?? [];
  const paidThisYear = inv.filter(i => i.status === "paid" && i.paid_at && new Date(i.paid_at).getFullYear() === year).reduce((s, i) => s + i.amount_cents / 100, 0);
  const owed = inv.filter(i => i.status === "open").reduce((s, i) => s + i.amount_cents / 100, 0);
  const overdue = inv.filter(i => i.status === "open" && i.due_at && new Date(i.due_at) < new Date()).reduce((s, i) => s + i.amount_cents / 100, 0);
  const pending = (requests ?? []).filter(r => r.status === "pending");
  return (
    <Page wide>
      <PlatformNav />
      <PageHeader eyebrow="Synergy Swift platform" title="Billing and requests" actions={<button className="btn btn-primary" onClick={() => setNewInv(true)}>+ One-off invoice</button>} />
      {msg && <div className="mb-4"><Alert tone="green">{msg}</Alert></div>}
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="card p-4"><p className="text-[13px] text-slate-500">Paid in {year}</p><p className="text-2xl font-bold tabular-nums">{naira(paidThisYear)}</p></div>
        <div className="card p-4"><p className="text-[13px] text-slate-500">Unpaid invoices</p><p className="text-2xl font-bold tabular-nums">{naira(owed)}</p></div>
        <div className="card p-4"><p className="text-[13px] text-slate-500">Past their due date</p><p className="text-2xl font-bold tabular-nums">{naira(overdue)}</p></div>
        <div className="card p-4"><p className="text-[13px] text-slate-500">Module requests waiting</p><p className="text-2xl font-bold">{pending.length}</p></div>
      </div>

      {pending.length > 0 && (
        <section className="card mb-5 p-5">
          <h2 className="mb-3 font-semibold">Requests from schools</h2>
          <ul className="divide-y divide-slate-100 text-sm">
            {pending.map(r => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 py-2">
                <span className="flex-1"><b>{r.tenants?.name}</b> asks to <b>{r.action}</b> {moduleLabel(r.module)}{r.users ? <span className="text-slate-500"> · {r.users.full_name}</span> : null}{r.note && <span className="block text-slate-600">&ldquo;{r.note}&rdquo;</span>}</span>
                <span className="text-xs text-slate-500">{fmtDate(r.created_at)}</span>
                <button className="btn btn-outline px-2 py-1 text-xs" onClick={() => setAnswer(r)}>Answer</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card p-5">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="flex-1 font-semibold">Invoices</h2>
          {[["open", "Unpaid"], ["paid", "Paid"], ["void", "Cancelled"], ["", "All"]].map(([k, l]) => <button key={k} className={"rounded-full px-3 py-1 text-xs " + (filter === k ? "bg-brand-600 text-white" : "bg-slate-100")} onClick={() => setFilter(k)}>{l}</button>)}
        </div>
        {!data ? <Loading /> : data.invoices.length === 0 ? <Empty>No invoices here.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-slate-500"><tr><th className="py-1">Number</th><th>School</th><th>For</th><th className="text-right">Amount</th><th>Due</th><th>Status</th><th /></tr></thead>
              <tbody>
                {data.invoices.map(i => {
                  const late = i.status === "open" && i.due_at && new Date(i.due_at) < new Date();
                  return (
                    <tr key={i.id} className="border-t border-slate-100">
                      <td className="py-2 font-mono text-xs">{i.number}</td>
                      <td><Link className="text-brand-700 hover:underline" href={`/platform/${i.tenant_id}`}>{i.tenants?.name ?? "—"}</Link></td>
                      <td>{i.period_start ? `${fmtDate(i.period_start)} to ${fmtDate(i.period_end!)}` : i.kind}</td>
                      <td className="text-right tabular-nums">{naira(i.amount_cents / 100)}</td>
                      <td className={late ? "text-rose-700" : ""}>{i.due_at ? fmtDate(i.due_at) : "—"}</td>
                      <td><Badge tone={i.status === "paid" ? "green" : i.status === "open" ? (late ? "red" : "amber") : "slate"}>{i.status === "open" ? (late ? "overdue" : "unpaid") : i.status === "void" ? "cancelled" : i.status}</Badge>{i.paid_at && <span className="ml-1 text-xs text-slate-500">{fmtDate(i.paid_at)}</span>}</td>
                      <td className="text-right">{i.status === "open" && <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setPay(i)}>Record payment</button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <PayInvoice inv={pay} onClose={() => setPay(null)} onDone={t => { setPay(null); setMsg(t); reload(); }} />
      <AnswerRequest r={answer} onClose={() => setAnswer(null)} onDone={t => { setAnswer(null); setMsg(t); reloadReq(); }} />
      <OneOff open={newInv} schools={schools ?? []} onClose={() => setNewInv(false)} onDone={t => { setNewInv(false); setMsg(t); reload(); }} />
    </Page>
  );
}

function AnswerRequest({ r, onClose, onDone }: { r: Req | null; onClose: () => void; onDone: (t: string) => void }) {
  const [reply, setReply] = useState("");
  const [until, setUntil] = useState("");
  const [err, setErr] = useState<string | null>(null);
  if (!r) return null;
  const go = async (status: "done" | "declined") => {
    const res = await send("/api/platform/requests", { id: r.id, status, reply: reply || null, apply: true, expires_at: until ? new Date(`${until}T23:59:59`).toISOString() : null }, "PATCH");
    if (!res.ok) return setErr(res.error);
    onDone(status === "done" ? `${moduleLabel(r.module)} ${r.action === "add" ? "switched on" : "switched off"} for ${r.tenants?.name}. They have been told.` : "Request declined. The school has been told.");
  };
  return (
    <Modal open onClose={onClose} title={`${r.tenants?.name}: ${r.action} ${moduleLabel(r.module)}`}>
      <div className="space-y-3">
        {r.note && <p className="rounded bg-slate-50 p-2 text-sm">&ldquo;{r.note}&rdquo;</p>}
        <Field label="Reply to the school (optional)"><textarea className="input h-20" value={reply} onChange={e => setReply(e.target.value)} placeholder={r.action === "add" ? "Added from today. The add-on will appear on your next invoice." : ""} /></Field>
        {r.action === "add" && <Field label="Switch on until (optional)" hint="For a free trial of the module."><input className="input" type="date" value={until} onChange={e => setUntil(e.target.value)} /></Field>}
        <p className="text-xs text-slate-500">Accepting switches the module {r.action === "add" ? "on" : "off"} for this school now. To charge for it, also add its group on the school&apos;s Plan &amp; billing tab.</p>
        {err && <Alert>{err}</Alert>}
        <div className="flex justify-end gap-2"><button className="btn btn-ghost" onClick={() => go("declined")}>Decline</button><button className="btn btn-primary" onClick={() => go("done")}>Accept and switch {r.action === "add" ? "on" : "off"}</button></div>
      </div>
    </Modal>
  );
}

function OneOff({ open, schools, onClose, onDone }: { open: boolean; schools: { id: string; name: string }[]; onClose: () => void; onDone: (t: string) => void }) {
  const [tenant, setTenant] = useState("");
  const [lines, setLines] = useState([{ label: "", amount: "" }]);
  const [err, setErr] = useState<string | null>(null);
  if (!open) return null;
  const total = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  return (
    <Modal open onClose={onClose} title="One-off invoice">
      <div className="space-y-3">
        <Field label="School"><select className="input" value={tenant} onChange={e => setTenant(e.target.value)}><option value="">Choose…</option>{schools.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-[1fr_140px] gap-2">
            <input className="input" placeholder="What for (training day, data import, add-on part-year)" value={l.label} onChange={e => setLines(lines.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} />
            <input className="input" type="number" placeholder="₦" value={l.amount} onChange={e => setLines(lines.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} />
          </div>
        ))}
        <button className="btn btn-ghost text-xs" onClick={() => setLines([...lines, { label: "", amount: "" }])}>+ Add a line</button>
        <p className="text-sm">Total: <b className="tabular-nums">{naira(total)}</b></p>
        {err && <Alert>{err}</Alert>}
        <div className="flex justify-end gap-2"><button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={async () => {
            const r = await send<{ number: string }>("/api/platform/invoices", { tenant_id: tenant, lines: lines.filter(l => l.label.trim()).map(l => ({ label: l.label.trim(), amount: Math.round(Number(l.amount)) })) });
            if (!r.ok) return setErr(r.error);
            onDone(`Invoice ${r.data.number} created.`);
          }}>Create invoice</button></div>
      </div>
    </Modal>
  );
}
