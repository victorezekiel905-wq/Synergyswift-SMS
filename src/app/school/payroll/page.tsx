"use client";
import { useState } from "react";
import { useApi, send, Page, PageHeader, Tabs, Alert, Empty, Modal, Field, Badge, statusTone, money, fmtDate, rolesOf, type Me, Loading } from "@/components/ui";

type Profile = { staff_id: string; basic: number; allowances: { name: string; amount: number }[]; deductions: { name: string; amount?: number | null; percent?: number | null }[];
  tax_percent: number; pension_percent: number; bank_name: string | null; account_no: string | null; account_name: string | null };
type StaffRow = { id: string; full_name: string; staff_no: string; position: string | null; department: string | null; profile: Profile | null };
type Run = { id: string; period: string; status: string; gross: number; deductions: number; net: number; created_by: string; approved_at: string | null; paid_at: string | null };

export default function PayrollPage() {
  const { data: me } = useApi<Me>("/api/me");
  const roles = rolesOf(me);
  const manager = ["hr_manager", "bursar", "school_admin", "principal", "platform_admin"].some(r => roles.has(r));
  const [tab, setTab] = useState<"runs" | "profiles" | "mine">("mine");
  const { data: settings } = useApi<{ settings: { currency?: string } }>("/api/school/settings");
  const cur = settings?.settings?.currency ?? "NGN";
  const tabs = manager ? [{ id: "runs" as const, label: "Payroll runs" }, { id: "profiles" as const, label: "Salaries" }, { id: "mine" as const, label: "My payslips" }] : [{ id: "mine" as const, label: "My payslips" }];
  const active = tabs.some(t => t.id === tab) ? tab : tabs[0].id;
  return (
    <Page wide>
      <PageHeader eyebrow="People" title="Payroll" subtitle="Salary structures, monthly payroll with a second-person approval, a bank payment schedule, and payslips staff can open themselves." />
      <Tabs value={active} onChange={setTab} tabs={tabs} />
      {active === "runs" && <Runs currency={cur} />}
      {active === "profiles" && <Profiles currency={cur} />}
      {active === "mine" && <Mine currency={cur} />}
    </Page>
  );
}

function Runs({ currency }: { currency: string }) {
  const { data, reload } = useApi<{ runs: Run[]; me: string; can_approve: boolean }>("/api/payroll?view=runs");
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const act = async (body: Record<string, unknown>, ok: string) => { const r = await send("/api/payroll", body); setMsg({ ok: r.ok, text: r.ok ? ok : r.error ?? "failed" }); reload(); return r; };
  return (
    <div className="space-y-4">
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Month"><input className="input" type="month" value={period} onChange={e => setPeriod(e.target.value)} /></Field>
        <button className="btn btn-primary" onClick={() => act({ action: "create_run", period }, `Payroll for ${period} prepared. Review it, then ask the principal or an admin to approve.`)}>Prepare payroll</button>
      </div>
      {!data?.runs.length ? <Empty>No payroll runs yet. Set salaries first, then prepare the month.</Empty> : (
        <div className="card overflow-x-auto"><table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-2">Month</th><th className="p-2 text-right">Gross</th><th className="p-2 text-right">Deductions</th><th className="p-2 text-right">Net</th><th className="p-2">Status</th><th className="p-2" /></tr></thead>
          <tbody>{data.runs.map(r => <tr key={r.id} className="border-t border-slate-100"><td className="p-2 font-medium">{r.period}</td><td className="p-2 text-right tabular-nums">{money(r.gross, currency)}</td>
            <td className="p-2 text-right tabular-nums">{money(r.deductions, currency)}</td><td className="p-2 text-right font-semibold tabular-nums">{money(r.net, currency)}</td>
            <td className="p-2"><Badge tone={statusTone(r.status === "paid" ? "sent" : r.status)}>{r.status}</Badge></td>
            <td className="whitespace-nowrap p-2 text-right">
              <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setOpen(r.id)}>Open</button>
              {r.status === "draft" && <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => act({ action: "recalculate", run_id: r.id }, "Recalculated.")}>Recalculate</button>}
              {r.status === "draft" && data.can_approve && r.created_by !== data.me && <button className="btn btn-primary px-2 py-1 text-xs" onClick={() => confirm(`Approve payroll for ${r.period}?`) && act({ action: "approve", run_id: r.id }, "Approved. Staff can now see their payslips.")}>Approve</button>}
              {r.status === "approved" && <button className="btn btn-primary px-2 py-1 text-xs" onClick={() => confirm("Mark as paid? Do this after the bank transfer is done.") && act({ action: "mark_paid", run_id: r.id }, "Marked paid.")}>Mark paid</button>}
              {r.status !== "draft" && <a className="btn btn-ghost px-2 py-1 text-xs" href={`/api/payroll?view=run&id=${r.id}&format=csv`}>Bank schedule</a>}
              {r.status === "draft" && <button className="btn btn-ghost px-2 py-1 text-xs text-rose-600" onClick={() => confirm("Delete this draft?") && act({ action: "delete_run", run_id: r.id }, "Deleted.")}>Delete</button>}
            </td></tr>)}</tbody></table></div>
      )}
      <Modal open={Boolean(open)} onClose={() => setOpen(null)} title="Payroll" wide>{open && <RunDetail id={open} currency={currency} />}</Modal>
    </div>
  );
}

function RunDetail({ id, currency }: { id: string; currency: string }) {
  const { data } = useApi<{ run: Run; payslips: any[] }>(`/api/payroll?view=run&id=${id}`, [id]);
  if (!data) return <Loading />;
  return (
    <div className="overflow-x-auto">
      <p className="mb-2 text-sm">{data.run.period} · {data.payslips.length} staff · net {money(data.run.net, currency)}</p>
      <table className="w-full text-sm"><thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-1">Staff</th><th className="text-right">Gross</th><th className="text-right">Deductions</th><th className="text-right">Net</th><th>Bank</th></tr></thead>
        <tbody>{data.payslips.map(p => <tr key={p.id} className="border-t border-slate-100"><td className="py-1.5">{p.staff?.full_name}<div className="text-xs text-slate-400">{p.staff?.staff_no}{Number(p.unpaid_leave_days) ? ` · ${p.unpaid_leave_days} unpaid leave days` : ""}</div></td>
          <td className="text-right tabular-nums">{money(p.gross, currency)}</td><td className="text-right tabular-nums">{money(p.total_deductions, currency)}</td><td className="text-right font-semibold tabular-nums">{money(p.net, currency)}</td>
          <td className="text-xs">{p.bank_name ? `${p.bank_name} ${p.account_no}` : <span className="text-amber-600">no bank details</span>}</td></tr>)}</tbody></table>
    </div>
  );
}

function Profiles({ currency }: { currency: string }) {
  const { data, reload } = useApi<StaffRow[]>("/api/payroll?view=profiles");
  const [edit, setEdit] = useState<{ staff: StaffRow; p: Profile } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const blank = (sid: string): Profile => ({ staff_id: sid, basic: 0, allowances: [{ name: "Housing", amount: 0 }, { name: "Transport", amount: 0 }], deductions: [], tax_percent: 0, pension_percent: 8, bank_name: null, account_no: null, account_name: null });
  return (
    <div>
      {!data?.length ? <Empty>No staff records. Add staff under HR first.</Empty> : (
        <div className="card overflow-x-auto"><table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-2">Staff</th><th className="p-2 text-right">Basic</th><th className="p-2 text-right">Allowances</th><th className="p-2">Bank</th><th className="p-2" /></tr></thead>
          <tbody>{data.map(s => <tr key={s.id} className="border-t border-slate-100"><td className="p-2">{s.full_name}<div className="text-xs text-slate-400">{s.staff_no} · {s.position}</div></td>
            <td className="p-2 text-right tabular-nums">{s.profile ? money(s.profile.basic, currency) : <span className="text-amber-600">not set</span>}</td>
            <td className="p-2 text-right tabular-nums">{s.profile ? money(s.profile.allowances.reduce((a, x) => a + Number(x.amount), 0), currency) : ""}</td>
            <td className="p-2 text-xs">{s.profile?.bank_name ? `${s.profile.bank_name} ${s.profile.account_no}` : ""}</td>
            <td className="p-2 text-right"><button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setEdit({ staff: s, p: s.profile ?? blank(s.id) })}>{s.profile ? "Edit" : "Set salary"}</button></td></tr>)}</tbody></table></div>
      )}
      <Modal open={Boolean(edit)} onClose={() => setEdit(null)} title={`Salary: ${edit?.staff.full_name ?? ""}`} wide>
        {edit && (
          <form className="space-y-4" onSubmit={async e => {
            e.preventDefault();
            const p = edit.p;
            const r = await send("/api/payroll", { action: "save_profile", staff_id: edit.staff.id, basic: Number(p.basic), tax_percent: Number(p.tax_percent), pension_percent: Number(p.pension_percent),
              allowances: p.allowances.filter(a => a.name && Number(a.amount) > 0).map(a => ({ name: a.name, amount: Number(a.amount) })),
              deductions: p.deductions.filter(d => d.name).map(d => ({ name: d.name, amount: d.percent ? null : Number(d.amount ?? 0), percent: d.percent ? Number(d.percent) : null })),
              bank_name: p.bank_name, account_no: p.account_no, account_name: p.account_name });
            if (!r.ok) return setErr(r.error);
            setErr(null); setEdit(null); reload();
          }}>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Monthly basic"><input className="input" type="number" min={0} step="any" value={edit.p.basic} onChange={e => setEdit({ ...edit, p: { ...edit.p, basic: e.target.value as unknown as number } })} /></Field>
              <Field label="Pension % of basic"><input className="input" type="number" min={0} max={100} step="any" value={edit.p.pension_percent} onChange={e => setEdit({ ...edit, p: { ...edit.p, pension_percent: e.target.value as unknown as number } })} /></Field>
              <Field label="Tax % (flat)" hint="For graduated PAYE, set 0 and add the monthly tax as a fixed deduction."><input className="input" type="number" min={0} max={100} step="any" value={edit.p.tax_percent} onChange={e => setEdit({ ...edit, p: { ...edit.p, tax_percent: e.target.value as unknown as number } })} /></Field>
            </div>
            <div>
              <p className="label">Allowances</p>
              {edit.p.allowances.map((a, i) => <div key={i} className="mb-1 flex gap-2"><input className="input" value={a.name} onChange={e => setEdit({ ...edit, p: { ...edit.p, allowances: edit.p.allowances.map((x, j) => j === i ? { ...x, name: e.target.value } : x) } })} aria-label="Allowance name" />
                <input className="input w-40" type="number" min={0} step="any" value={a.amount} onChange={e => setEdit({ ...edit, p: { ...edit.p, allowances: edit.p.allowances.map((x, j) => j === i ? { ...x, amount: e.target.value as unknown as number } : x) } })} aria-label="Allowance amount" /></div>)}
              <button type="button" className="btn btn-ghost text-xs" onClick={() => setEdit({ ...edit, p: { ...edit.p, allowances: [...edit.p.allowances, { name: "", amount: 0 }] } })}>+ Allowance</button>
            </div>
            <div>
              <p className="label">Other deductions (fixed amount or % of basic)</p>
              {edit.p.deductions.map((d, i) => <div key={i} className="mb-1 flex gap-2"><input className="input" placeholder="e.g. Cooperative, Loan" value={d.name} onChange={e => setEdit({ ...edit, p: { ...edit.p, deductions: edit.p.deductions.map((x, j) => j === i ? { ...x, name: e.target.value } : x) } })} aria-label="Deduction name" />
                <input className="input w-32" type="number" min={0} step="any" placeholder="Amount" value={d.amount ?? ""} onChange={e => setEdit({ ...edit, p: { ...edit.p, deductions: edit.p.deductions.map((x, j) => j === i ? { ...x, amount: e.target.value as unknown as number, percent: null } : x) } })} aria-label="Deduction amount" />
                <input className="input w-24" type="number" min={0} max={100} step="any" placeholder="%" value={d.percent ?? ""} onChange={e => setEdit({ ...edit, p: { ...edit.p, deductions: edit.p.deductions.map((x, j) => j === i ? { ...x, percent: e.target.value as unknown as number, amount: null } : x) } })} aria-label="Deduction percent" /></div>)}
              <button type="button" className="btn btn-ghost text-xs" onClick={() => setEdit({ ...edit, p: { ...edit.p, deductions: [...edit.p.deductions, { name: "", amount: 0 }] } })}>+ Deduction</button>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Bank"><input className="input" value={edit.p.bank_name ?? ""} onChange={e => setEdit({ ...edit, p: { ...edit.p, bank_name: e.target.value } })} /></Field>
              <Field label="Account number"><input className="input" value={edit.p.account_no ?? ""} onChange={e => setEdit({ ...edit, p: { ...edit.p, account_no: e.target.value } })} /></Field>
              <Field label="Account name"><input className="input" value={edit.p.account_name ?? ""} onChange={e => setEdit({ ...edit, p: { ...edit.p, account_name: e.target.value } })} /></Field>
            </div>
            {err && <Alert>{err}</Alert>}
            <div className="flex justify-end"><button className="btn btn-primary">Save salary</button></div>
          </form>
        )}
      </Modal>
    </div>
  );
}

function Mine({ currency }: { currency: string }) {
  const { data, error } = useApi<any[]>("/api/payroll?view=mine");
  const [open, setOpen] = useState<any | null>(null);
  if (error) return <Alert tone="amber">{error}</Alert>;
  if (!data?.length) return <Empty>No payslips yet. They appear here once a payroll is approved.</Empty>;
  return (
    <div className="space-y-2">
      {data.map(p => <button key={p.id} className="card flex w-full items-center justify-between p-4 text-left hover:border-brand-300" onClick={() => setOpen(p)}>
        <span className="font-semibold">{p.payroll_runs?.period}</span><span className="tabular-nums">Net {money(p.net, currency)}</span></button>)}
      <Modal open={Boolean(open)} onClose={() => setOpen(null)} title="Payslip">
        {open && <div className="text-sm">
          <p className="font-semibold">{open.staff?.full_name} · {open.staff?.staff_no}</p><p className="text-slate-500">{open.staff?.position} · {open.payroll_runs?.period}{open.payroll_runs?.paid_at ? ` · paid ${fmtDate(open.payroll_runs.paid_at)}` : ""}</p>
          <div className="overflow-x-auto print:overflow-visible"><table className="mt-3 w-full"><tbody>
            <tr><td className="py-1">Basic</td><td className="text-right tabular-nums">{money(open.basic, currency)}</td></tr>
            {(open.allowances ?? []).map((a: any) => <tr key={a.name}><td className="py-1">{a.name}</td><td className="text-right tabular-nums">{money(a.amount, currency)}</td></tr>)}
            <tr className="border-t font-semibold"><td className="py-1">Gross</td><td className="text-right tabular-nums">{money(open.gross, currency)}</td></tr>
            {(open.deductions ?? []).filter((d: any) => d.amount > 0).map((d: any) => <tr key={d.name}><td className="py-1">{d.name}</td><td className="text-right tabular-nums">−{money(d.amount, currency)}</td></tr>)}
            <tr className="border-t-2 text-base font-bold"><td className="py-1">Net pay</td><td className="text-right tabular-nums">{money(open.net, currency)}</td></tr>
          </tbody></table></div>
          <button className="btn btn-ghost mt-3 border border-slate-200" onClick={() => window.print()}>Print</button>
        </div>}
      </Modal>
    </div>
  );
}
