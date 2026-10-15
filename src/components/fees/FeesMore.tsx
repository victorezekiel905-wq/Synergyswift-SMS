"use client";
import { useState } from "react";
import { useApi, send, Alert, Empty, Field, Badge, Stat, Loading, money, fmtDate, localDate } from "@/components/ui";
import PeoplePicker, { type Person } from "@/components/comms/PeoplePicker";

type Rule = { id: string; name: string; kind: string; percent: number | null; amount: number | null; nth_child: number | null; category: string | null; item_ids: string[]; active: boolean };
type Award = { id: string; student_id: string; student: string; admission_no: string; class_name: string | null; kind: string; name: string; percent: number | null; amount: number | null;
  item_ids: string[]; valid_from: string; valid_to: string | null; note: string | null; approved_by: string | null; created_by: string | null; approver: { full_name: string } | null; creator: { full_name: string } | null };
type Plan = { id: string; name: string; parts: { label: string; percent: number; days_after: number }[]; active: boolean };
type Claim = { id: string; student: string; class_name: string | null; amount: number; paid_on: string; bank_reference: string; payer_name: string | null; proof_path: string | null; created_at: string;
  fee_invoices: { invoice_no: string; title: string; total: number; amount_paid: number } | null };
export type PlusData = { rules: Rule[]; awards: Award[]; plans: Plan[]; claims: Claim[]; categories: string[]; items: { id: string; name: string }[]; admin: boolean; me: string;
  settings: { late_fee_percent: number; late_fee_amount: number; late_fee_grace_days: number; remind_days_before: number; remind_every_days: number; auto_fee_reminders: boolean; accept_transfer_claims: boolean } | null;
  methods: { card: string | null; remita: boolean; stripe: boolean; transfer: boolean }; own_keys: string[] };

const off = (x: { percent: number | null; amount: number | null }, cur: string) => (x.percent ? `${x.percent}%` : money(x.amount ?? 0, cur));
function useAct(reload: () => void) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const act = async (b: Record<string, unknown>, ok: string) => { const r = await send<any>("/api/fees/plus", b); setMsg({ ok: r.ok, text: r.ok ? ok : r.error ?? "failed" }); if (r.ok) reload(); return r; };
  return { msg, act, setMsg };
}
function Items({ items, value, onChange }: { items: { id: string; name: string }[]; value: string[]; onChange: (v: string[]) => void }) {
  return <div className="flex flex-wrap gap-2">{items.map(i => <label key={i.id} className="flex items-center gap-1 text-xs"><input type="checkbox" checked={value.includes(i.id)} onChange={e => onChange(e.target.checked ? [...value, i.id] : value.filter(x => x !== i.id))} />{i.name}</label>)}
    <span className="text-xs text-slate-500">{value.length ? "" : "(every fee)"}</span></div>;
}

// ---------------- discounts and scholarships ----------------

export function Discounts({ data, reload, currency }: { data: PlusData; reload: () => void; currency: string }) {
  const { msg, act } = useAct(reload);
  const [r, setR] = useState<Partial<Rule> & { by: "percent" | "amount"; value: string }>({ kind: "sibling", nth_child: 2, item_ids: [], by: "percent", value: "", name: "" });
  const [a, setA] = useState<{ student: Person[]; kind: string; name: string; by: "percent" | "amount"; value: string; item_ids: string[]; valid_from: string; valid_to: string; note: string }>(
    { student: [], kind: "scholarship", name: "", by: "percent", value: "", item_ids: [], valid_from: localDate(), valid_to: "", note: "" });
  return (
    <div className="space-y-4 text-sm">
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      <section className="card space-y-2 p-4">
        <h2 className="font-semibold">Discount rules</h2>
        <p className="text-slate-600">Applied when invoices are made. A child gets the single best rule that fits (rules do not add up); scholarships come on top.</p>
        {!data.rules.length ? <Empty>No rules yet.</Empty> : <ul className="divide-y divide-slate-100">{data.rules.map(x => (
          <li key={x.id} className="flex items-center gap-2 py-1.5"><span className={"mr-auto " + (x.active ? "" : "text-slate-400")}><b>{x.name}</b>: {off(x, currency)} off {x.item_ids.length ? data.items.filter(i => x.item_ids.includes(i.id)).map(i => i.name).join(", ") : "all fees"}
            <span className="text-xs text-slate-500"> · {x.kind === "sibling" ? `${x.nth_child}${x.nth_child === 2 ? "nd" : x.nth_child === 3 ? "rd" : "th"} child and younger` : x.kind === "staff_child" ? "children of staff" : `category “${x.category}”`}</span></span>
            <button className="text-xs text-brand-700" onClick={() => act({ action: "save_rule", ...x, active: !x.active }, x.active ? "Paused." : "Active again.")}>{x.active ? "Pause" : "Resume"}</button>
            <button className="text-xs text-rose-600" onClick={() => confirm("Delete this rule?") && act({ action: "delete_rule", id: x.id }, "Deleted.")}>Delete</button></li>))}</ul>}
        <form className="grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-4" onSubmit={async e => { e.preventDefault();
          const ok = (await act({ action: "save_rule", name: r.name, kind: r.kind, percent: r.by === "percent" ? Number(r.value) : null, amount: r.by === "amount" ? Number(r.value) : null,
            nth_child: r.kind === "sibling" ? r.nth_child : null, category: r.kind === "category" ? r.category : null, item_ids: r.item_ids ?? [] }, "Rule saved.")).ok;
          if (ok) setR({ ...r, name: "", value: "" }); }}>
          <Field label="Name"><input className="input" value={r.name ?? ""} onChange={e => setR({ ...r, name: e.target.value })} required minLength={2} placeholder="Second child" /></Field>
          <Field label="For"><select className="input" value={r.kind} onChange={e => setR({ ...r, kind: e.target.value })}><option value="sibling">Siblings</option><option value="staff_child">Children of staff</option><option value="category">A fee category</option></select></Field>
          {r.kind === "sibling" && <Field label="From which child"><select className="input" value={r.nth_child ?? 2} onChange={e => setR({ ...r, nth_child: Number(e.target.value) })}>{[2, 3, 4, 5].map(n => <option key={n} value={n}>{n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`} child on</option>)}</select></Field>}
          {r.kind === "category" && <Field label="Category"><input className="input" list="plus-cats" value={r.category ?? ""} onChange={e => setR({ ...r, category: e.target.value })} required /></Field>}
          {r.kind === "staff_child" && <div />}
          <Field label="Discount"><div className="flex gap-1"><input className="input" type="number" min={0} step="any" value={r.value} onChange={e => setR({ ...r, value: e.target.value })} required />
            <select className="input w-auto" value={r.by} onChange={e => setR({ ...r, by: e.target.value as "percent" | "amount" })}><option value="percent">%</option><option value="amount">{currency}</option></select></div></Field>
          <div className="sm:col-span-4"><Field label="On which fees"><Items items={data.items} value={r.item_ids ?? []} onChange={v => setR({ ...r, item_ids: v })} /></Field></div>
          <div><button className="btn btn-primary">Add rule</button></div>
        </form>
        <datalist id="plus-cats">{data.categories.map(c => <option key={c} value={c} />)}</datalist>
      </section>

      <section className="card space-y-2 p-4">
        <h2 className="font-semibold">Scholarships, bursaries and waivers</h2>
        <p className="text-slate-600">Entered by one person and approved by another before they reduce any invoice. Changing an approved one needs approving again.</p>
        {!data.awards.length ? <Empty>None yet.</Empty> : <table className="w-full text-xs"><thead className="text-left text-slate-500"><tr><th className="p-1">Student</th><th className="p-1">Award</th><th className="p-1">Value</th><th className="p-1">Dates</th><th className="p-1">Status</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{data.awards.map(x => (
            <tr key={x.id}><td className="p-1">{x.student} <span className="text-slate-500">{x.class_name}</span></td><td className="p-1">{x.name} <Badge tone="slate">{x.kind}</Badge></td><td className="p-1">{off(x, currency)}</td>
              <td className="p-1">{fmtDate(x.valid_from)}{x.valid_to ? ` – ${fmtDate(x.valid_to)}` : " onwards"}</td>
              <td className="p-1">{x.approved_by ? <Badge tone="green">approved by {x.approver?.full_name}</Badge> : x.created_by === data.me ? <span className="text-slate-500">waiting for someone else to approve</span>
                : <button className="btn btn-primary px-2 py-0.5 text-xs" onClick={() => act({ action: "approve_award", id: x.id }, "Approved.")}>Approve</button>}
                <button className="ml-2 text-rose-600" onClick={() => confirm("Remove this award? Invoices already made keep it.") && act({ action: "delete_award", id: x.id }, "Removed.")}>Remove</button></td></tr>))}</tbody></table>}
        <form className="grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-4" onSubmit={async e => { e.preventDefault(); if (!a.student[0]) return;
          const ok = (await act({ action: "save_award", student_id: a.student[0].id, kind: a.kind, name: a.name, percent: a.by === "percent" ? Number(a.value) : null, amount: a.by === "amount" ? Number(a.value) : null,
            item_ids: a.item_ids, valid_from: a.valid_from, valid_to: a.valid_to || null, note: a.note || null }, "Saved. Someone else must now approve it.")).ok;
          if (ok) setA({ ...a, student: [], name: "", value: "", note: "" }); }}>
          <div className="sm:col-span-2"><Field label="Student"><PeoplePicker value={a.student} onChange={p => setA({ ...a, student: p.slice(-1) })} types={["Student"]} /></Field></div>
          <Field label="Kind"><select className="input" value={a.kind} onChange={e => setA({ ...a, kind: e.target.value })}><option value="scholarship">Scholarship</option><option value="bursary">Bursary</option><option value="waiver">Waiver</option><option value="discount">Special discount</option></select></Field>
          <Field label="Name"><input className="input" value={a.name} onChange={e => setA({ ...a, name: e.target.value })} required minLength={2} placeholder="Academic scholarship" /></Field>
          <Field label="Value"><div className="flex gap-1"><input className="input" type="number" min={0} step="any" value={a.value} onChange={e => setA({ ...a, value: e.target.value })} required />
            <select className="input w-auto" value={a.by} onChange={e => setA({ ...a, by: e.target.value as "percent" | "amount" })}><option value="percent">%</option><option value="amount">{currency}</option></select></div></Field>
          <Field label="From"><input className="input" type="date" value={a.valid_from} onChange={e => setA({ ...a, valid_from: e.target.value })} required /></Field>
          <Field label="Until (optional)"><input className="input" type="date" value={a.valid_to} onChange={e => setA({ ...a, valid_to: e.target.value })} /></Field>
          <Field label="Note"><input className="input" value={a.note} onChange={e => setA({ ...a, note: e.target.value })} maxLength={500} /></Field>
          <div className="sm:col-span-4"><Field label="On which fees"><Items items={data.items} value={a.item_ids} onChange={v => setA({ ...a, item_ids: v })} /></Field></div>
          <div><button className="btn btn-primary" disabled={!a.student.length}>Save award</button></div>
        </form>
      </section>
    </div>
  );
}

// ---------------- instalments, late fees, reminders ----------------

export function Instalments({ data, reload, currency }: { data: PlusData; reload: () => void; currency: string }) {
  const { msg, act } = useAct(reload);
  const [plan, setPlan] = useState<{ name: string; parts: { label: string; percent: string; days_after: string }[] }>({ name: "", parts: [{ label: "First", percent: "50", days_after: "0" }, { label: "Second", percent: "50", days_after: "30" }] });
  const s = data.settings ?? { late_fee_percent: 0, late_fee_amount: 0, late_fee_grace_days: 7, remind_days_before: 3, remind_every_days: 7, auto_fee_reminders: false, accept_transfer_claims: true };
  const [f, setF] = useState(s);
  const total = plan.parts.reduce((a, p) => a + Number(p.percent || 0), 0);
  return (
    <div className="space-y-4 text-sm">
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      <section className="card space-y-2 p-4">
        <h2 className="font-semibold">Instalment plans</h2>
        <p className="text-slate-600">Choose a plan when generating invoices (Fee setup), or for one invoice from its details. Each part has its own due date; payments clear the earliest part first.</p>
        {!data.plans.length ? <Empty>No plans yet.</Empty> : <ul className="divide-y divide-slate-100">{data.plans.map(p => (
          <li key={p.id} className="flex items-center gap-2 py-1.5"><span className="mr-auto"><b>{p.name}</b> <span className="text-xs text-slate-500">{p.parts.map(x => `${x.label} ${x.percent}% (day ${x.days_after})`).join(" · ")}</span></span>
            <button className="text-xs text-rose-600" onClick={() => confirm("Delete this plan?") && act({ action: "delete_plan", id: p.id }, "Deleted.")}>Delete</button></li>))}</ul>}
        <form className="space-y-2 rounded-lg bg-slate-50 p-3" onSubmit={async e => { e.preventDefault();
          if ((await act({ action: "save_plan", name: plan.name, parts: plan.parts.map(p => ({ label: p.label, percent: Number(p.percent), days_after: Number(p.days_after) })) }, "Plan saved.")).ok) setPlan({ ...plan, name: "" }); }}>
          <Field label="Name"><input className="input" value={plan.name} onChange={e => setPlan({ ...plan, name: e.target.value })} required minLength={2} placeholder="Two instalments" /></Field>
          {plan.parts.map((p, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2">
              <Field label="Part"><input className="input w-32" value={p.label} onChange={e => setPlan({ ...plan, parts: plan.parts.map((x, j) => j === i ? { ...x, label: e.target.value } : x) })} required /></Field>
              <Field label="%"><input className="input w-20" type="number" min={1} max={100} value={p.percent} onChange={e => setPlan({ ...plan, parts: plan.parts.map((x, j) => j === i ? { ...x, percent: e.target.value } : x) })} required /></Field>
              <Field label="Days after the first due date"><input className="input w-24" type="number" min={0} max={365} value={p.days_after} onChange={e => setPlan({ ...plan, parts: plan.parts.map((x, j) => j === i ? { ...x, days_after: e.target.value } : x) })} required /></Field>
              {plan.parts.length > 1 && <button type="button" className="text-xs text-rose-600" onClick={() => setPlan({ ...plan, parts: plan.parts.filter((_, j) => j !== i) })}>Remove</button>}
            </div>))}
          <div className="flex items-center gap-3"><button type="button" className="btn btn-ghost text-xs" onClick={() => setPlan({ ...plan, parts: [...plan.parts, { label: `Part ${plan.parts.length + 1}`, percent: "0", days_after: "60" }] })}>+ Part</button>
            <span className={total === 100 ? "text-emerald-700" : "text-rose-700"}>{total}% of 100%</span><button className="btn btn-primary" disabled={total !== 100}>Save plan</button></div>
        </form>
      </section>
      <form className="card grid gap-3 p-4 sm:grid-cols-3" onSubmit={e => { e.preventDefault(); void act({ action: "settings", ...f }, "Saved."); }}>
        <h2 className="font-semibold sm:col-span-3">Late fees and reminders</h2>
        <Field label="Late fee (% of the overdue amount)"><input className="input" type="number" min={0} max={50} step="any" value={f.late_fee_percent} onChange={e => setF({ ...f, late_fee_percent: Number(e.target.value) })} /></Field>
        <Field label={`Plus a fixed late fee (${currency})`}><input className="input" type="number" min={0} step="any" value={f.late_fee_amount} onChange={e => setF({ ...f, late_fee_amount: Number(e.target.value) })} /></Field>
        <Field label="Days of grace after the due date"><input className="input" type="number" min={0} max={90} value={f.late_fee_grace_days} onChange={e => setF({ ...f, late_fee_grace_days: Number(e.target.value) })} /></Field>
        <label className="flex items-center gap-2 sm:col-span-3"><input type="checkbox" checked={f.auto_fee_reminders} onChange={e => setF({ ...f, auto_fee_reminders: e.target.checked })} />Send reminders automatically</label>
        <Field label="Days before the due date"><input className="input" type="number" min={0} max={30} value={f.remind_days_before} onChange={e => setF({ ...f, remind_days_before: Number(e.target.value) })} /></Field>
        <Field label="Then every … days while unpaid (0 = no more)"><input className="input" type="number" min={0} max={60} value={f.remind_every_days} onChange={e => setF({ ...f, remind_every_days: Number(e.target.value) })} /></Field>
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.accept_transfer_claims} onChange={e => setF({ ...f, accept_transfer_claims: e.target.checked })} />Parents can report bank transfers on the pay page</label>
        <p className="text-xs text-slate-500 sm:col-span-3">A late fee is added once per overdue invoice (or once per overdue instalment) by the daily job, as a separate line parents can see.</p>
        <div><button className="btn btn-primary">Save</button></div>
      </form>
    </div>
  );
}

// ---------------- transfers reported by parents ----------------

export function Transfers({ data, reload, currency }: { data: PlusData; reload: () => void; currency: string }) {
  const { msg, act } = useAct(reload);
  const [note, setNote] = useState<Record<string, string>>({});
  return (
    <div className="space-y-3 text-sm">
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      <p className="text-slate-600">Parents who paid by bank transfer report it on the pay page. Check each one against the bank statement, then confirm (a receipt is sent and the invoice updated) or reject it.</p>
      {!data.claims.length ? <Empty>Nothing to confirm.</Empty> : <ul className="space-y-2">{data.claims.map(c => (
        <li key={c.id} className="card space-y-1 p-3">
          <div className="flex flex-wrap items-center gap-2"><b className="mr-auto">{c.student} <span className="font-normal text-slate-500">{c.class_name}</span></b><span className="text-lg font-semibold tabular-nums">{money(c.amount, currency)}</span></div>
          <p className="text-xs text-slate-600">Paid {fmtDate(c.paid_on)} · bank reference <b className="font-mono">{c.bank_reference}</b>{c.payer_name ? ` · by ${c.payer_name}` : ""} · {c.fee_invoices?.invoice_no} {c.fee_invoices?.title} (balance {money(Number(c.fee_invoices?.total ?? 0) - Number(c.fee_invoices?.amount_paid ?? 0), currency)})
            {c.proof_path && <> · <a className="text-brand-700 underline" href={`/api/fees/plus?proof=${c.id}`} target="_blank" rel="noreferrer">proof</a></>}</p>
          <div className="flex flex-wrap gap-2"><input className="input flex-1" value={note[c.id] ?? ""} onChange={e => setNote({ ...note, [c.id]: e.target.value })} placeholder="Note (sent to the parent if you reject)" aria-label="Note" />
            <button className="btn btn-primary" onClick={() => act({ action: "decide_claim", id: c.id, confirm: true, note: note[c.id] || null }, "Confirmed and receipted.")}>Confirm</button>
            <button className="btn btn-outline" onClick={() => act({ action: "decide_claim", id: c.id, confirm: false, note: note[c.id] || null }, "Rejected; the parent was told.")}>Reject</button></div>
        </li>))}</ul>}
    </div>
  );
}

// ---------------- debtors and statements ----------------

export function Debtors({ groups, currency }: { groups: { id: string; name: string }[]; currency: string }) {
  const [cg, setCg] = useState("");
  const { data } = useApi<{ today: string; buckets: Record<string, number>; total: number; debtors: { student_id: string; name: string; admission_no: string; class_name: string | null; balance: number; oldest_due: string | null; invoices: number }[] }>(`/api/fees/plus?aging=1${cg ? `&class_group_id=${cg}` : ""}`, [cg]);
  const [st, setSt] = useState<{ id: string; name: string } | null>(null);
  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap gap-2"><select className="input w-auto" value={cg} onChange={e => setCg(e.target.value)} aria-label="Class"><option value="">Every class</option>{groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
        <a className="btn btn-outline" href={`/api/fees/plus?aging=1&format=csv${cg ? `&class_group_id=${cg}` : ""}`}>Download debtors (CSV)</a></div>
      {!data ? <Loading /> : <>
        <div className="grid gap-2 sm:grid-cols-6"><Stat label="Outstanding" value={money(data.total, currency)} tone={data.total ? "bad" : "good"} />
          {Object.entries(data.buckets).map(([k, v]) => <Stat key={k} label={k === "current" ? "Not yet due" : `${k} days overdue`} value={money(v, currency)} tone={k === "90+" && v ? "bad" : undefined} />)}</div>
        {!data.debtors.length ? <Empty>No one owes anything.</Empty> : <div className="card overflow-x-auto"><table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-2">Student</th><th className="p-2">Class</th><th className="p-2 text-right">Balance</th><th className="p-2">Oldest due</th><th className="p-2" /></tr></thead>
          <tbody>{data.debtors.map(d => <tr key={d.student_id} className="border-t border-slate-100"><td className="p-2">{d.name} <span className="text-xs text-slate-500">{d.admission_no}</span></td><td className="p-2">{d.class_name}</td>
            <td className="p-2 text-right tabular-nums">{money(d.balance, currency)}</td><td className="p-2">{d.oldest_due ? fmtDate(d.oldest_due) : "—"}</td>
            <td className="p-2 text-right"><button className="text-xs text-brand-700" onClick={() => setSt({ id: d.student_id, name: d.name })}>Statement</button></td></tr>)}</tbody></table></div>}
      </>}
      {st && <Statement studentId={st.id} currency={currency} onClose={() => setSt(null)} />}
    </div>
  );
}

export function Statement({ studentId, currency, onClose }: { studentId: string; currency: string; onClose?: () => void }) {
  const [from, setFrom] = useState(localDate(365));
  const [to, setTo] = useState(localDate());
  const { data } = useApi<{ statements: { student: { name: string; admission_no: string; class_name: string | null }; opening: number; closing: number; invoiced: number; paid: number;
    lines: { date: string; kind: string; ref: string; description: string; debit: number; credit: number; balance: number }[] }[] }>(`/api/fees/plus?statement=${studentId}&from=${from}&to=${to}`, [studentId, from, to]);
  const s = data?.statements[0];
  return (
    <section className="card space-y-2 p-4 print:shadow-none">
      <div className="flex flex-wrap items-end gap-2 print:hidden"><h2 className="mr-auto font-semibold">Statement of account</h2>
        <Field label="From"><input className="input" type="date" value={from} onChange={e => setFrom(e.target.value)} /></Field>
        <Field label="To"><input className="input" type="date" value={to} onChange={e => setTo(e.target.value)} /></Field>
        <button className="btn btn-outline" onClick={() => window.print()}>Print</button>{onClose && <button className="btn btn-ghost" onClick={onClose}>Close</button>}</div>
      {!s ? <Loading /> : <>
        <p><b>{s.student.name}</b> {s.student.admission_no} {s.student.class_name ? `· ${s.student.class_name}` : ""} · {fmtDate(from)} to {fmtDate(to)}</p>
        <table className="w-full text-sm"><thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-1">Date</th><th>Reference</th><th>Details</th><th className="text-right">Charged</th><th className="text-right">Paid</th><th className="text-right">Balance</th></tr></thead>
          <tbody><tr className="border-t border-slate-100"><td className="py-1" colSpan={5}>Balance brought forward</td><td className="text-right tabular-nums">{money(s.opening, currency)}</td></tr>
            {s.lines.map((l, i) => <tr key={i} className="border-t border-slate-100"><td className="py-1">{fmtDate(l.date)}</td><td className="font-mono text-xs">{l.ref}</td><td>{l.description}</td>
              <td className="text-right tabular-nums">{l.debit ? money(l.debit, currency) : ""}</td><td className="text-right tabular-nums">{l.credit ? money(l.credit, currency) : ""}</td><td className="text-right tabular-nums">{money(l.balance, currency)}</td></tr>)}
            <tr className="border-t-2 border-slate-300 font-semibold"><td className="py-1" colSpan={3}>Totals</td><td className="text-right tabular-nums">{money(s.invoiced, currency)}</td><td className="text-right tabular-nums">{money(s.paid, currency)}</td><td className="text-right tabular-nums">{money(s.closing, currency)}</td></tr></tbody></table>
      </>}
    </section>
  );
}

// ---------------- categories and optional extras ----------------

export function ExtrasAndCategories({ data, reload, groups, termId }: { data: PlusData; reload: () => void; groups: { id: string; name: string }[]; termId: string }) {
  const { msg, act } = useAct(reload);
  const [people, setPeople] = useState<Person[]>([]);
  const [cg, setCg] = useState("");
  const { data: cls } = useApi<{ students: { id: string; first_name: string; last_name: string; admission_no: string }[] }>(cg ? `/api/attendance?class_group_id=${cg}` : null, [cg]);
  const [cat, setCat] = useState("");
  const [item, setItem] = useState("");
  const [every, setEvery] = useState(true);
  const ids = [...new Set([...people.map(p => p.id), ...(cg ? (cls?.students ?? []).map(s => s.id) : [])])];
  return (
    <div className="space-y-4 text-sm">
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      <section className="card space-y-2 p-4">
        <h2 className="font-semibold">Choose students</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="A whole class"><select className="input" value={cg} onChange={e => setCg(e.target.value)}><option value="">—</option>{groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>
          <Field label="And/or particular students"><PeoplePicker value={people} onChange={setPeople} types={["Student"]} /></Field>
        </div>
        <p className="text-xs text-slate-500">{ids.length} student{ids.length === 1 ? "" : "s"} chosen.</p>
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card space-y-2 p-4">
          <h2 className="font-semibold">Fee category</h2>
          <p className="text-slate-600">For fees that differ by category, such as <i>boarding</i>, <i>day</i> or <i>staff_child</i>. Set the amounts per category under Fee setup.</p>
          <div className="flex gap-2"><input className="input" list="plus-cats2" value={cat} onChange={e => setCat(e.target.value)} placeholder="Category (blank to clear)" aria-label="Category" />
            <datalist id="plus-cats2">{data.categories.map(c => <option key={c} value={c} />)}</datalist>
            <button className="btn btn-primary" disabled={!ids.length} onClick={() => act({ action: "set_category", student_ids: ids, category: cat || null }, `${ids.length} updated.`)}>Set</button></div>
        </section>
        <section className="card space-y-2 p-4">
          <h2 className="font-semibold">Optional extras</h2>
          <p className="text-slate-600">Bus, lunch, clubs, uniform: fees marked optional are charged only to the students given them here.</p>
          <select className="input" value={item} onChange={e => setItem(e.target.value)} aria-label="Fee"><option value="">Choose the fee…</option>{data.items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select>
          <label className="flex items-center gap-2"><input type="checkbox" checked={every} onChange={e => setEvery(e.target.checked)} />Every term until removed (otherwise this term only)</label>
          <div className="flex gap-2">
            <button className="btn btn-primary" disabled={!ids.length || !item} onClick={() => act({ action: "optional", student_ids: ids, fee_item_id: item, term_id: every ? null : termId, on: true }, `Added for ${ids.length}.`)}>Add</button>
            <button className="btn btn-outline" disabled={!ids.length || !item} onClick={() => act({ action: "optional", student_ids: ids, fee_item_id: item, term_id: every ? null : termId, on: false }, `Removed for ${ids.length}.`)}>Remove</button>
          </div>
          <p className="text-xs text-slate-500">Changes apply to invoices made from now on.</p>
        </section>
      </div>
    </div>
  );
}

// ---------------- Remita and Stripe keys ----------------

export function PaymentKeys({ data, reload }: { data: PlusData; reload: () => void }) {
  const { msg, act } = useAct(reload);
  const [r, setR] = useState({ merchant_id: "", service_type_id: "", api_key: "", live: false });
  const [s, setS] = useState({ secret_key: "", webhook_secret: "" });
  if (!data.admin) return null;
  return (
    <section className="card mt-4 space-y-3 p-4 text-sm">
      <h2 className="font-semibold">More ways to pay</h2>
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      <p className="text-slate-600">Now available on the pay page: {[data.methods.card && `cards, bank transfer and USSD via ${data.methods.card}`, data.methods.remita && "Remita", data.methods.stripe && "cards from abroad (Stripe)", data.methods.transfer && "reporting a bank transfer"].filter(Boolean).join(", ") || "none yet"}.</p>
      <form className="grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-4" onSubmit={e => { e.preventDefault(); void act({ action: "keys", provider: "remita", ...r }, "Remita saved."); }}>
        <p className="font-medium sm:col-span-4">Remita {data.own_keys.includes("remita") && <Badge tone="green">connected</Badge>}</p>
        <Field label="Merchant ID"><input className="input" value={r.merchant_id} onChange={e => setR({ ...r, merchant_id: e.target.value })} required /></Field>
        <Field label="Service type ID"><input className="input" value={r.service_type_id} onChange={e => setR({ ...r, service_type_id: e.target.value })} required /></Field>
        <Field label="API key"><input className="input" type="password" autoComplete="off" value={r.api_key} onChange={e => setR({ ...r, api_key: e.target.value })} required /></Field>
        <label className="flex items-center gap-2 pt-5"><input type="checkbox" checked={r.live} onChange={e => setR({ ...r, live: e.target.checked })} />Live (not demo)</label>
        <div className="flex gap-2 sm:col-span-4"><button className="btn btn-primary">Save</button>{data.own_keys.includes("remita") && <button type="button" className="btn btn-ghost text-rose-600" onClick={() => act({ action: "remove_keys", provider: "remita" }, "Removed.")}>Remove</button>}</div>
        <p className="text-xs text-slate-500 sm:col-span-4">Set Remita&apos;s notification URL to <code>/api/pay/webhook/remita</code> on this site. Test with the demo keys first.</p>
      </form>
      <form className="grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-3" onSubmit={e => { e.preventDefault(); void act({ action: "keys", provider: "stripe", ...s }, "Stripe saved."); }}>
        <p className="font-medium sm:col-span-3">Stripe (international cards) {data.own_keys.includes("stripe") && <Badge tone="green">connected</Badge>}</p>
        <Field label="Secret key"><input className="input" type="password" autoComplete="off" value={s.secret_key} onChange={e => setS({ ...s, secret_key: e.target.value })} required placeholder="sk_live_…" /></Field>
        <Field label="Webhook signing secret"><input className="input" type="password" autoComplete="off" value={s.webhook_secret} onChange={e => setS({ ...s, webhook_secret: e.target.value })} placeholder="whsec_…" /></Field>
        <div className="flex items-end gap-2"><button className="btn btn-primary">Check and save</button>{data.own_keys.includes("stripe") && <button type="button" className="btn btn-ghost text-rose-600" onClick={() => act({ action: "remove_keys", provider: "stripe" }, "Removed.")}>Remove</button>}</div>
        <p className="text-xs text-slate-500 sm:col-span-3">In Stripe, add a webhook to <code>/api/pay/webhook/stripe</code> on this site for the event <code>checkout.session.completed</code>. Parents pay in the school&apos;s currency; their bank converts it.</p>
      </form>
    </section>
  );
}
