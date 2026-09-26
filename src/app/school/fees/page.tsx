"use client";
import { useEffect, useMemo, useState } from "react";
import { useApi, send, Page, PageHeader, Tabs, Alert, Empty, Modal, Field, Badge, Stat, statusTone, money, fmtDate } from "@/components/ui";

type Term = { id: string; name: string; is_current: boolean };
type Session = { id: string; name: string; terms: Term[] };
type Overview = {
  term_id: string | null;
  settings: { currency: string; provider: string | null; subaccount: string | null; bankDetails: string | null; withholdResults: boolean };
  items: { id: string; name: string; description: string | null }[];
  schedules: { id: string; fee_item_id: string; class_group_id: string | null; amount: number; optional: boolean }[];
  summary: { invoices: number; billed: number; collected: number; outstanding: number; collection_rate: number | null; paid: number; part_paid: number; unpaid: number;
    collected_30d: number; expenses_30d: number; by_method_30d: Record<string, number>; by_class: Record<string, { billed: number; paid: number }> };
};
type Invoice = { id: string; invoice_no: string; title: string; status: string; total: number; amount_paid: number; due_date: string | null; pay_token: string;
  students: { first_name: string; last_name: string; admission_no: string; class_groups: { name: string } | null } };

export default function FeesPage() {
  const { data: sessions } = useApi<Session[]>("/api/school/academic");
  const { data: structure } = useApi<{ class_groups: { id: string; name: string }[] }>("/api/school/structure");
  const [termId, setTermId] = useState("");
  useEffect(() => { if (!termId && sessions) { const t = sessions.flatMap(s => s.terms).find(t => t.is_current) ?? sessions[0]?.terms[0]; if (t) setTermId(t.id); } }, [sessions, termId]);
  const ov = useApi<Overview>(termId ? `/api/fees?term_id=${termId}` : null, [termId]);
  const [tab, setTab] = useState<"overview" | "setup" | "invoices" | "settings">("overview");
  const cur = ov.data?.settings.currency ?? "NGN";
  const s = ov.data?.summary;
  const groups = structure?.class_groups ?? [];

  return (
    <Page wide>
      <PageHeader eyebrow="Bursary" title="Fees & payments"
        subtitle="Set fees once per term, generate every invoice in one click, and let parents pay online from a WhatsApp link. Receipts and reminders go out automatically."
        actions={<select className="input w-auto" value={termId} onChange={e => setTermId(e.target.value)} aria-label="Term">
          {(sessions ?? []).map(se => <optgroup key={se.id} label={se.name}>{se.terms.map(t => <option key={t.id} value={t.id}>{t.name} {se.name}</option>)}</optgroup>)}
        </select>} />
      {ov.error && <Alert>{ov.error}</Alert>}
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "overview", label: "Overview" }, { id: "setup", label: "Fee setup" }, { id: "invoices", label: "Invoices & payments" }, { id: "settings", label: "Online payments" }]} />
      {tab === "overview" && s && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
            <Stat label="Billed this term" value={money(s.billed, cur)} />
            <Stat label="Collected" value={money(s.collected, cur)} tone="good" />
            <Stat label="Outstanding" value={money(s.outstanding, cur)} tone={s.outstanding > 0 ? "warn" : undefined} />
            <Stat label="Collection rate" value={s.collection_rate === null ? "—" : `${s.collection_rate}%`} />
            <Stat label="Collected (30 days)" value={money(s.collected_30d, cur)} />
            <Stat label="Expenses (30 days)" value={money(s.expenses_30d, cur)} />
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <section className="card p-5">
              <h2 className="mb-3 font-semibold">By class</h2>
              {!Object.keys(s.by_class).length ? <Empty>No invoices this term.</Empty> : (
                <table className="w-full text-sm"><thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-1">Class</th><th className="text-right">Billed</th><th className="text-right">Paid</th><th className="text-right">Rate</th></tr></thead>
                  <tbody>{Object.entries(s.by_class).sort().map(([k, v]) => (
                    <tr key={k} className="border-t border-slate-100"><td className="py-1.5">{k}</td><td className="text-right tabular-nums">{money(v.billed, cur)}</td><td className="text-right tabular-nums">{money(v.paid, cur)}</td>
                      <td className="text-right tabular-nums">{v.billed ? Math.round((v.paid / v.billed) * 100) : 0}%</td></tr>))}</tbody></table>
              )}
            </section>
            <section className="card p-5">
              <h2 className="mb-3 font-semibold">Payments by method (30 days)</h2>
              {!Object.keys(s.by_method_30d).length ? <Empty>No payments yet.</Empty> : (
                <ul className="space-y-2 text-sm">{Object.entries(s.by_method_30d).map(([m, v]) => (
                  <li key={m} className="flex items-center justify-between"><span className="capitalize">{m}</span><span className="font-semibold tabular-nums">{money(v, cur)}</span></li>))}</ul>
              )}
              <div className="mt-4 flex flex-wrap gap-2 text-xs">
                <Badge tone="green">{s.paid} paid</Badge><Badge tone="amber">{s.part_paid} part paid</Badge><Badge tone="red">{s.unpaid} unpaid</Badge>
              </div>
              <a className="btn btn-ghost mt-4 border border-slate-200 text-xs" href={`/api/fees?term_id=${termId}&format=csv`}>Download fee register (CSV)</a>
            </section>
          </div>
        </div>
      )}
      {tab === "setup" && ov.data && termId && <Setup ov={ov.data} termId={termId} groups={groups} sessions={sessions ?? []} reload={ov.reload} />}
      {tab === "invoices" && termId && <Invoices termId={termId} groups={groups} currency={cur} />}
      {tab === "settings" && ov.data && <Settings ov={ov.data} reload={ov.reload} />}
    </Page>
  );
}

function useFlash() {
  const [m, setM] = useState<{ ok: boolean; text: string } | null>(null);
  return { flash: (ok: boolean, text: string) => setM({ ok, text }), node: m ? <div className="mb-3"><Alert tone={m.ok ? "green" : "red"}>{m.text}</Alert></div> : null };
}

function Setup({ ov, termId, groups, sessions, reload }: { ov: Overview; termId: string; groups: { id: string; name: string }[]; sessions: Session[]; reload: () => void }) {
  const [item, setItem] = useState("");
  const [row, setRow] = useState({ fee_item_id: "", class_group_id: "", amount: "", optional: false });
  const [gen, setGen] = useState<{ classes: string[]; due: string }>({ classes: [], due: "" });
  const [copyFrom, setCopyFrom] = useState("");
  const { flash, node } = useFlash();
  const cur = ov.settings.currency;
  const act = async (body: Record<string, unknown>, ok: string) => { const r = await send("/api/fees", body); flash(r.ok, r.ok ? (typeof ok === "string" ? ok : "") + (r.data?.created !== undefined ? ` Created ${r.data.created}, skipped ${r.data.skipped}.` : "") : r.error ?? "failed"); if (r.ok) reload(); };
  const itemName = (id: string) => ov.items.find(i => i.id === id)?.name ?? "?";
  const groupName = (id: string | null) => id ? groups.find(g => g.id === id)?.name ?? "?" : "All classes";
  const terms = sessions.flatMap(s => s.terms.map(t => ({ ...t, label: `${t.name} ${s.name}` }))).filter(t => t.id !== termId);
  return (
    <div className="space-y-5">
      {node}
      <div className="grid gap-5 lg:grid-cols-3">
        <section className="card p-5">
          <h2 className="mb-3 font-semibold">Fee items</h2>
          <form className="mb-3 flex gap-2" onSubmit={e => { e.preventDefault(); act({ action: "save_item", name: item }, "Fee item added."); setItem(""); }}>
            <input className="input" placeholder="e.g. Tuition, Development levy, Bus" value={item} onChange={e => setItem(e.target.value)} required aria-label="Fee item" />
            <button className="btn btn-primary">Add</button>
          </form>
          <ul className="space-y-1 text-sm">{ov.items.map(i => <li key={i.id} className="flex justify-between rounded bg-slate-50 px-2 py-1">{i.name}
            <button className="text-xs text-rose-600" onClick={() => confirm(`Delete ${i.name}?`) && act({ action: "delete_item", id: i.id }, "Deleted.")}>Delete</button></li>)}</ul>
        </section>
        <section className="card p-5 lg:col-span-2">
          <h2 className="mb-3 font-semibold">Amounts this term</h2>
          <form className="mb-4 grid gap-2 sm:grid-cols-5" onSubmit={e => { e.preventDefault(); act({ action: "save_schedule", term_id: termId, fee_item_id: row.fee_item_id, class_group_id: row.class_group_id || null, amount: Number(row.amount), optional: row.optional }, "Saved."); }}>
            <select className="input" required value={row.fee_item_id} onChange={e => setRow({ ...row, fee_item_id: e.target.value })} aria-label="Fee item"><option value="">Fee item…</option>{ov.items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select>
            <select className="input" value={row.class_group_id} onChange={e => setRow({ ...row, class_group_id: e.target.value })} aria-label="Class"><option value="">All classes</option>{groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
            <input className="input" type="number" min={0} step="any" required placeholder="Amount" value={row.amount} onChange={e => setRow({ ...row, amount: e.target.value })} aria-label="Amount" />
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={row.optional} onChange={e => setRow({ ...row, optional: e.target.checked })} /> Optional</label>
            <button className="btn btn-primary">Save</button>
          </form>
          {!ov.schedules.length ? <Empty>No fees set for this term.{terms.length ? " You can copy them from another term." : ""}</Empty> : (
            <table className="w-full text-sm"><thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-1">Item</th><th>Class</th><th className="text-right">Amount</th><th /></tr></thead>
              <tbody>{ov.schedules.map(sc => <tr key={sc.id} className="border-t border-slate-100"><td className="py-1.5">{itemName(sc.fee_item_id)} {sc.optional && <Badge>optional</Badge>}</td><td>{groupName(sc.class_group_id)}</td>
                <td className="text-right tabular-nums">{money(sc.amount, cur)}</td><td className="text-right"><button className="text-xs text-rose-600" onClick={() => act({ action: "delete_schedule", id: sc.id }, "Removed.")}>Remove</button></td></tr>)}</tbody></table>
          )}
          <p className="mt-2 text-xs text-slate-500">A class-specific amount replaces the &ldquo;All classes&rdquo; amount for that class. Optional fees (bus, boarding) are added per student on the invoice.</p>
          {terms.length > 0 && (
            <div className="mt-3 flex gap-2">
              <select className="input max-w-xs" value={copyFrom} onChange={e => setCopyFrom(e.target.value)} aria-label="Copy from term"><option value="">Copy fees from…</option>{terms.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}</select>
              <button className="btn btn-ghost border border-slate-200 text-xs" disabled={!copyFrom} onClick={() => act({ action: "copy_schedule", from_term_id: copyFrom, to_term_id: termId }, "Copied.")}>Copy</button>
            </div>
          )}
        </section>
      </div>
      <section className="card p-5">
        <h2 className="mb-1 font-semibold">Generate invoices</h2>
        <p className="mb-3 text-sm text-slate-600">Creates one invoice per active student from the amounts above. Students who already have this term&apos;s invoice are skipped, so it is safe to run again after new admissions.</p>
        <div className="mb-3 flex flex-wrap gap-2">
          {groups.map(g => <label key={g.id} className="flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-sm"><input type="checkbox" checked={gen.classes.includes(g.id)}
            onChange={e => setGen({ ...gen, classes: e.target.checked ? [...gen.classes, g.id] : gen.classes.filter(x => x !== g.id) })} />{g.name}</label>)}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Due date"><input className="input" type="date" value={gen.due} onChange={e => setGen({ ...gen, due: e.target.value })} /></Field>
          <button className="btn btn-primary" onClick={() => confirm(`Generate invoices for ${gen.classes.length ? `${gen.classes.length} classes` : "every class"}?`) && act({ action: "generate_invoices", term_id: termId, class_group_ids: gen.classes, due_date: gen.due || null }, "Invoices generated.")}>
            Generate for {gen.classes.length ? `${gen.classes.length} classes` : "all classes"}
          </button>
          <button className="btn btn-ghost border border-slate-200" onClick={() => confirm("Send a fee reminder with a pay link to every parent with a balance?") && act({ action: "send_reminders", term_id: termId, class_group_ids: gen.classes }, "Reminders queued.")}>Send reminders to debtors</button>
        </div>
      </section>
    </div>
  );
}

function Invoices({ termId, groups, currency }: { termId: string; groups: { id: string; name: string }[]; currency: string }) {
  const [f, setF] = useState({ cg: "", status: "outstanding", q: "" });
  const params = new URLSearchParams({ term_id: termId, ...(f.cg ? { class_group_id: f.cg } : {}), ...(f.status ? { status: f.status } : {}), ...(f.q ? { q: f.q } : {}) });
  const list = useApi<Invoice[]>(`/api/fees/invoices?${params}`, [termId, f.cg, f.status, f.q]);
  const [open, setOpen] = useState<string | null>(null);
  const totals = useMemo(() => (list.data ?? []).reduce((a, i) => ({ total: a.total + Number(i.total), paid: a.paid + Number(i.amount_paid) }), { total: 0, paid: 0 }), [list.data]);
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        <input className="input max-w-xs" placeholder="Search student, admission no or INV-…" value={f.q} onChange={e => setF({ ...f, q: e.target.value })} aria-label="Search invoices" />
        <select className="input w-auto" value={f.cg} onChange={e => setF({ ...f, cg: e.target.value })} aria-label="Class"><option value="">All classes</option>{groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
        <select className="input w-auto" value={f.status} onChange={e => setF({ ...f, status: e.target.value })} aria-label="Status">
          <option value="outstanding">Outstanding</option><option value="">All</option><option value="paid">Paid</option><option value="part_paid">Part paid</option><option value="issued">Unpaid</option><option value="void">Void</option>
        </select>
        <span className="ml-auto self-center text-sm text-slate-600">Total {money(totals.total, currency)} · paid {money(totals.paid, currency)} · balance <b>{money(totals.total - totals.paid, currency)}</b></span>
      </div>
      {list.error && <Alert>{list.error}</Alert>}
      {!list.data?.length ? <Empty>No invoices match.</Empty> : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-2">Invoice</th><th className="p-2">Student</th><th className="p-2">Class</th><th className="p-2 text-right">Total</th><th className="p-2 text-right">Paid</th><th className="p-2 text-right">Balance</th><th className="p-2">Status</th></tr></thead>
            <tbody>{list.data.map(i => (
              <tr key={i.id} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50" onClick={() => setOpen(i.id)}>
                <td className="p-2 font-mono text-xs">{i.invoice_no}<div className="font-sans text-slate-500">{i.title}</div></td>
                <td className="p-2">{i.students.last_name}, {i.students.first_name} <span className="text-xs text-slate-400">{i.students.admission_no}</span></td>
                <td className="p-2">{i.students.class_groups?.name}</td>
                <td className="p-2 text-right tabular-nums">{money(i.total, currency)}</td><td className="p-2 text-right tabular-nums">{money(i.amount_paid, currency)}</td>
                <td className="p-2 text-right font-semibold tabular-nums">{money(Number(i.total) - Number(i.amount_paid), currency)}</td>
                <td className="p-2"><Badge tone={statusTone(i.status === "part_paid" ? "pending" : i.status === "issued" ? "rejected" : i.status)}>{i.status.replace("_", " ")}</Badge></td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
      <Modal open={Boolean(open)} onClose={() => setOpen(null)} title="Invoice" wide>{open && <InvoiceDetail id={open} currency={currency} onChange={list.reload} />}</Modal>
    </div>
  );
}

function InvoiceDetail({ id, currency, onChange }: { id: string; currency: string; onChange: () => void }) {
  const { data, reload } = useApi<any>(`/api/fees/invoices?id=${id}`, [id]);
  const [pay, setPay] = useState({ amount: "", method: "cash", reference: "", payer_name: "" });
  const [line, setLine] = useState({ kind: "discount", description: "", amount: "" });
  const { flash, node } = useFlash();
  if (!data) return <p className="text-sm text-slate-500">Loading…</p>;
  const balance = Number(data.total) - Number(data.amount_paid);
  const act = async (body: Record<string, unknown>, ok: string) => { const r = await send("/api/fees", body); flash(r.ok, r.ok ? ok : r.error ?? "failed"); if (r.ok) { reload(); onChange(); } };
  const payLink = typeof window !== "undefined" ? `${window.location.origin}/pay/${data.pay_token}` : "";
  return (
    <div className="space-y-4 text-sm">
      {node}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><p className="font-mono text-xs">{data.invoice_no}</p><p className="text-lg font-semibold">{data.students?.first_name} {data.students?.last_name}</p><p className="text-slate-500">{data.title} · {data.students?.class_groups?.name}</p></div>
        <div className="text-right"><p className="text-xs uppercase text-slate-500">Balance</p><p className="text-2xl font-bold tabular-nums">{money(balance, currency)}</p><Badge tone={statusTone(data.status === "part_paid" ? "pending" : data.status)}>{data.status.replace("_", " ")}</Badge></div>
      </div>
      <table className="w-full"><tbody>{(data.fee_invoice_lines ?? []).map((l: any) => (
        <tr key={l.id} className="border-t border-slate-100"><td className="py-1.5">{l.description} {l.kind !== "charge" && <Badge tone="violet">{l.kind}</Badge>}</td><td className="text-right tabular-nums">{money(l.amount, currency)}</td>
          <td className="w-16 text-right">{data.status !== "void" && <button className="text-xs text-rose-600" onClick={() => act({ action: "remove_line", line_id: l.id }, "Removed.")}>Remove</button>}</td></tr>))}
        <tr className="border-t-2 border-slate-300 font-semibold"><td className="py-1.5">Total</td><td className="text-right tabular-nums">{money(data.total, currency)}</td><td /></tr></tbody></table>
      {data.status !== "void" && (
        <>
          <form className="grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-4" onSubmit={e => { e.preventDefault(); act({ action: "add_line", invoice_id: id, kind: line.kind, description: line.description, amount: Number(line.amount) }, "Line added."); setLine({ ...line, description: "", amount: "" }); }}>
            <select className="input" value={line.kind} onChange={e => setLine({ ...line, kind: e.target.value })} aria-label="Line type"><option value="discount">Discount</option><option value="scholarship">Scholarship</option><option value="charge">Extra charge</option><option value="adjustment">Adjustment</option></select>
            <input className="input" placeholder="Description" required value={line.description} onChange={e => setLine({ ...line, description: e.target.value })} aria-label="Description" />
            <input className="input" type="number" step="any" placeholder="Amount" required value={line.amount} onChange={e => setLine({ ...line, amount: e.target.value })} aria-label="Amount" />
            <button className="btn btn-ghost border border-slate-200">Add line</button>
          </form>
          {balance > 0 && (
            <form className="grid gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 sm:grid-cols-5" onSubmit={e => { e.preventDefault(); act({ action: "record_payment", invoice_id: id, amount: Number(pay.amount), method: pay.method, reference: pay.reference || null, payer_name: pay.payer_name || null }, "Payment recorded and receipt sent."); setPay({ amount: "", method: "cash", reference: "", payer_name: "" }); }}>
              <input className="input" type="number" min={0.01} step="any" max={balance} placeholder={`Amount (max ${balance})`} required value={pay.amount} onChange={e => setPay({ ...pay, amount: e.target.value })} aria-label="Amount paid" />
              <select className="input" value={pay.method} onChange={e => setPay({ ...pay, method: e.target.value })} aria-label="Method"><option value="cash">Cash</option><option value="transfer">Bank transfer</option><option value="pos">POS</option><option value="cheque">Cheque</option></select>
              <input className="input" placeholder="Reference (teller, transfer id)" value={pay.reference} onChange={e => setPay({ ...pay, reference: e.target.value })} aria-label="Reference" />
              <input className="input" placeholder="Paid by" value={pay.payer_name} onChange={e => setPay({ ...pay, payer_name: e.target.value })} aria-label="Payer" />
              <button className="btn btn-primary">Record payment</button>
            </form>
          )}
        </>
      )}
      <div>
        <h3 className="mb-1 font-semibold">Payments</h3>
        {!(data.fee_payments ?? []).length ? <p className="text-slate-500">None yet.</p> : (
          <table className="w-full"><tbody>{data.fee_payments.map((p: any) => (
            <tr key={p.id} className="border-t border-slate-100"><td className="py-1.5">{fmtDate(p.paid_at ?? p.created_at, true)}</td><td>{p.method}{p.provider ? ` (${p.provider})` : ""}</td><td className="font-mono text-xs">{p.receipt_no ?? p.reference}</td>
              <td className="text-right tabular-nums">{money(p.amount, currency)}</td><td><Badge tone={statusTone(p.status === "success" ? "sent" : p.status)}>{p.status}</Badge></td>
              <td className="text-right">{p.status === "success" && <button className="text-xs text-rose-600" onClick={() => { const r = prompt("Reason for reversing this payment?"); if (r) act({ action: "reverse_payment", payment_id: p.id, reason: r }, "Payment reversed."); }}>Reverse</button>}</td></tr>))}</tbody></table>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
        <a className="btn btn-ghost border border-slate-200 text-xs" href={`/pay/${data.pay_token}`} target="_blank" rel="noreferrer">Open parent view / print</a>
        <button className="btn btn-ghost border border-slate-200 text-xs" onClick={() => { navigator.clipboard?.writeText(payLink); flash(true, "Pay link copied."); }}>Copy pay link</button>
        {data.status !== "void" && Number(data.amount_paid) === 0 && <button className="btn btn-ghost ml-auto text-xs text-rose-600" onClick={() => { const r = prompt("Reason for voiding this invoice?"); if (r) act({ action: "void_invoice", invoice_id: id, reason: r }, "Invoice voided."); }}>Void invoice</button>}
      </div>
    </div>
  );
}

function Settings({ ov, reload }: { ov: Overview; reload: () => void }) {
  const [f, setF] = useState({ provider: ov.settings.provider ?? "", subaccount: ov.settings.subaccount ?? "", bank: ov.settings.bankDetails ?? "", withhold: ov.settings.withholdResults });
  const { flash, node } = useFlash();
  return (
    <form className="card max-w-2xl space-y-4 p-5" onSubmit={async e => {
      e.preventDefault();
      const r = await send("/api/fees", { action: "settings", payment_provider: f.provider || null, payment_subaccount: f.subaccount || null, bank_details: f.bank || null, withhold_results_for_debtors: f.withhold });
      flash(r.ok, r.ok ? "Saved." : r.error ?? "failed"); if (r.ok) reload();
    }}>
      {node}
      <Field label="Online payment provider" hint="Parents pay by card, bank transfer or USSD on the provider's secure page. The platform operator configures the provider keys.">
        <select className="input" value={f.provider} onChange={e => setF({ ...f, provider: e.target.value })}><option value="">Off (bank transfer and bursary only)</option><option value="paystack">Paystack</option><option value="flutterwave">Flutterwave</option></select>
      </Field>
      <Field label="Settlement subaccount code" hint="From your Paystack or Flutterwave dashboard. Payments settle straight into the school's bank account."><input className="input" value={f.subaccount} onChange={e => setF({ ...f, subaccount: e.target.value })} placeholder="ACCT_xxxxxxxx" /></Field>
      <Field label="Bank details shown on invoices"><textarea className="input h-20" value={f.bank} onChange={e => setF({ ...f, bank: e.target.value })} placeholder="Bank name, account number, account name" /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.withhold} onChange={e => setF({ ...f, withhold: e.target.checked })} /> Withhold report cards for students with unpaid fees for that term</label>
      <button className="btn btn-primary">Save</button>
    </form>
  );
}
