"use client";
import { useState } from "react";
import { useApi, send, Page, PageHeader, Tabs, Alert, Empty, Modal, Field, Badge, statusTone, money, fmtDate, rolesOf, type Me, Loading } from "@/components/ui";

type Allow = { name: string; amount: number; pensionable?: boolean | null; taxable?: boolean | null };
type Profile = { staff_id: string; grade_id: string | null; basic: number; allowances: Allow[]; deductions: { name: string; amount?: number | null; percent?: number | null }[];
  tax_percent: number; pension_percent: number; annual_rent: number; nhf: boolean; nhis: boolean; pension_exempt: boolean; bank_name: string | null; account_no: string | null; account_name: string | null };
type Grade = { id: string; name: string; basic: number; allowances: Allow[] };
type StaffRow = { id: string; full_name: string; staff_no: string; position: string | null; department: string | null; profile: Profile | null; ids: { tin: boolean; rsa_pin: boolean; pfa: string | null; nhf: boolean } };
type Run = { id: string; period: string; status: string; gross: number; deductions: number; net: number; employer_total: number; created_by: string; approved_at: string | null; paid_at: string | null };
type Settings = { tax_regime: "nta2025" | "flat"; tax_bands: { upto: number | null; rate: number }[] | null; pension_employee_pct: number; pension_employer_pct: number; nhf_pct: number; nhis_employee_pct: number;
  nhis_employer_pct: number; nsitf_pct: number; itf_pct: number; rent_relief_pct: number; rent_relief_cap: number; prorate_joiners: boolean; saved: boolean };
type Tab = "runs" | "profiles" | "loans" | "settings" | "mine";

export default function PayrollPage() {
  const { data: me } = useApi<Me>("/api/me");
  const roles = rolesOf(me);
  const manager = ["hr_manager", "bursar", "school_admin", "principal", "platform_admin"].some(r => roles.has(r));
  const [tab, setTab] = useState<Tab>("mine");
  const { data: settings } = useApi<{ settings: { currency?: string } }>("/api/school/settings");
  const cur = settings?.settings?.currency ?? "NGN";
  const tabs: { id: Tab; label: string }[] = manager
    ? [{ id: "runs", label: "Payroll runs" }, { id: "profiles", label: "Salaries" }, { id: "loans", label: "Loans & advances" }, { id: "settings", label: "Tax & pension" }, { id: "mine", label: "My payslips" }]
    : [{ id: "mine", label: "My payslips" }];
  const active = tabs.some(t => t.id === tab) ? tab : tabs[0].id;
  return (
    <Page wide>
      <PageHeader eyebrow="People" title="Payroll" subtitle="Salaries and grades, PAYE, pension, NHF and employer contributions, loans, monthly payroll with a second-person approval, bank and remittance schedules, and payslips staff open themselves." />
      <Tabs value={active} onChange={setTab} tabs={tabs} />
      {active === "runs" && <Runs currency={cur} />}
      {active === "profiles" && <Profiles currency={cur} />}
      {active === "loans" && <Loans currency={cur} />}
      {active === "settings" && <SettingsTab currency={cur} />}
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
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-2">Month</th><th className="p-2 text-right">Gross</th><th className="p-2 text-right">Deductions</th><th className="p-2 text-right">Net</th><th className="p-2 text-right">Employer cost</th><th className="p-2">Status</th><th className="p-2" /></tr></thead>
          <tbody>{data.runs.map(r => <tr key={r.id} className="border-t border-slate-100"><td className="p-2 font-medium">{r.period}</td><td className="p-2 text-right tabular-nums">{money(r.gross, currency)}</td>
            <td className="p-2 text-right tabular-nums">{money(r.deductions, currency)}</td><td className="p-2 text-right font-semibold tabular-nums">{money(r.net, currency)}</td>
            <td className="p-2 text-right tabular-nums text-slate-600">{money(r.employer_total, currency)}</td>
            <td className="p-2"><Badge tone={statusTone(r.status === "paid" ? "sent" : r.status)}>{r.status}</Badge></td>
            <td className="whitespace-nowrap p-2 text-right">
              <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setOpen(r.id)}>Open</button>
              {r.status === "draft" && <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => act({ action: "recalculate", run_id: r.id }, "Recalculated.")}>Recalculate</button>}
              {r.status === "draft" && data.can_approve && r.created_by !== data.me && <button className="btn btn-primary px-2 py-1 text-xs" onClick={() => confirm(`Approve payroll for ${r.period}?`) && act({ action: "approve", run_id: r.id }, "Approved. Staff have been told their payslips are ready.")}>Approve</button>}
              {r.status === "approved" && <button className="btn btn-primary px-2 py-1 text-xs" onClick={() => confirm("Mark as paid? Do this after the bank transfer is done. Loan balances go down now.") && act({ action: "mark_paid", run_id: r.id }, "Marked paid.")}>Mark paid</button>}
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
  const sum = (k: string) => data.payslips.reduce((t, p) => t + Number(p[k] ?? 0), 0);
  const released = data.run.status !== "draft";
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>{data.run.period} · {data.payslips.length} staff · net {money(data.run.net, currency)}</span>
        <span className="ml-auto flex flex-wrap gap-1">
          {released && <a className="btn btn-outline px-2 py-1 text-xs" href={`/api/payroll?view=run&id=${id}&format=csv`}>Bank schedule</a>}
          <a className="btn btn-ghost px-2 py-1 text-xs" href={`/api/payroll?view=remittance&id=${id}&kind=paye`}>PAYE</a>
          <a className="btn btn-ghost px-2 py-1 text-xs" href={`/api/payroll?view=remittance&id=${id}&kind=pension`}>Pension</a>
          <a className="btn btn-ghost px-2 py-1 text-xs" href={`/api/payroll?view=remittance&id=${id}&kind=nhf`}>NHF</a>
          <a className="btn btn-ghost px-2 py-1 text-xs" href={`/api/payroll?view=remittance&id=${id}&kind=employer`}>Employer costs</a>
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <p className="rounded bg-slate-50 p-2">PAYE <b className="block tabular-nums">{money(sum("paye"), currency)}</b></p>
        <p className="rounded bg-slate-50 p-2">Pension (staff + school) <b className="block tabular-nums">{money(sum("pension_employee") + sum("pension_employer"), currency)}</b></p>
        <p className="rounded bg-slate-50 p-2">NHF <b className="block tabular-nums">{money(sum("nhf"), currency)}</b></p>
        <p className="rounded bg-slate-50 p-2">Employer contributions <b className="block tabular-nums">{money(sum("employer_total"), currency)}</b></p>
      </div>
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-1">Staff</th><th className="text-right">Gross</th><th className="text-right">PAYE</th><th className="text-right">Pension</th><th className="text-right">Other</th><th className="text-right">Net</th><th>Bank</th></tr></thead>
        <tbody>{data.payslips.map(p => {
          const other = Number(p.total_deductions) - Number(p.paye) - Number(p.pension_employee);
          return (
            <tr key={p.id} className="border-t border-slate-100"><td className="py-1.5">{p.staff?.full_name}<div className="text-xs text-slate-400">{p.staff?.staff_no}{Number(p.unpaid_leave_days) ? ` · ${p.unpaid_leave_days} unpaid leave days` : ""}{p.days_worked != null ? ` · ${p.days_worked} days worked` : ""}</div></td>
              <td className="text-right tabular-nums">{money(p.gross, currency)}</td><td className="text-right tabular-nums">{money(p.paye, currency)}</td><td className="text-right tabular-nums">{money(p.pension_employee, currency)}</td>
              <td className="text-right tabular-nums">{money(other, currency)}</td><td className="text-right font-semibold tabular-nums">{money(p.net, currency)}</td>
              <td className="text-xs">{p.bank_name ? `${p.bank_name} ${p.account_no}` : <span className="text-amber-600">no bank details</span>}</td></tr>
          );
        })}</tbody></table></div>
    </div>
  );
}

function AllowanceRows({ list, onChange }: { list: Allow[]; onChange: (l: Allow[]) => void }) {
  return (
    <div>
      {list.map((a, i) => <div key={i} className="mb-1 flex flex-wrap items-center gap-2">
        <input className="input flex-1" value={a.name} placeholder="e.g. Housing" onChange={e => onChange(list.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} aria-label="Allowance name" />
        <input className="input w-36" type="number" min={0} step="any" value={a.amount} onChange={e => onChange(list.map((x, j) => j === i ? { ...x, amount: Number(e.target.value) } : x))} aria-label="Allowance amount" />
        <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={a.pensionable ?? /housing|transport|rent|accommodation/i.test(a.name)} onChange={e => onChange(list.map((x, j) => j === i ? { ...x, pensionable: e.target.checked } : x))} />pension</label>
        <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={a.taxable !== false} onChange={e => onChange(list.map((x, j) => j === i ? { ...x, taxable: e.target.checked } : x))} />taxable</label>
        <button type="button" className="text-xs text-rose-600" aria-label="Remove" onClick={() => onChange(list.filter((_, j) => j !== i))}>✕</button></div>)}
      <button type="button" className="btn btn-ghost text-xs" onClick={() => onChange([...list, { name: "", amount: 0 }])}>+ Allowance</button>
    </div>
  );
}

function Profiles({ currency }: { currency: string }) {
  const { data, reload } = useApi<{ grades: Grade[]; staff: StaffRow[] }>("/api/payroll?view=profiles");
  const { data: st } = useApi<{ settings: Settings }>("/api/payroll?view=settings");
  const [edit, setEdit] = useState<{ staff: StaffRow; p: Profile } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const flat = st?.settings.tax_regime === "flat";
  const blank = (sid: string): Profile => ({ staff_id: sid, grade_id: null, basic: 0, allowances: [{ name: "Housing", amount: 0 }, { name: "Transport", amount: 0 }], deductions: [], tax_percent: 0, pension_percent: 8,
    annual_rent: 0, nhf: false, nhis: false, pension_exempt: false, bank_name: null, account_no: null, account_name: null });
  const grade = (id: string | null) => data?.grades.find(g => g.id === id);
  return (
    <div>
      {!data?.staff.length ? <Empty>No staff records. Add staff under HR first.</Empty> : (
        <div className="card overflow-x-auto"><table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-2">Staff</th><th className="p-2">Grade</th><th className="p-2 text-right">Basic</th><th className="p-2 text-right">Allowances</th><th className="p-2">For remittances</th><th className="p-2">Bank</th><th className="p-2" /></tr></thead>
          <tbody>{data.staff.map(s => {
            const g = grade(s.profile?.grade_id ?? null);
            const basic = g ? g.basic : s.profile?.basic;
            const allow = [...(g?.allowances ?? []), ...(s.profile?.allowances ?? [])].reduce((a, x) => a + Number(x.amount), 0);
            return (
              <tr key={s.id} className="border-t border-slate-100"><td className="p-2">{s.full_name}<div className="text-xs text-slate-400">{s.staff_no} · {s.position}</div></td>
                <td className="p-2">{g?.name ?? ""}</td>
                <td className="p-2 text-right tabular-nums">{s.profile ? money(basic, currency) : <span className="text-amber-600">not set</span>}</td>
                <td className="p-2 text-right tabular-nums">{s.profile ? money(allow, currency) : ""}</td>
                <td className="p-2 text-xs">{!s.ids.tin && <span className="mr-1 text-amber-600">no TIN</span>}{!s.profile?.pension_exempt && !s.ids.rsa_pin && <span className="mr-1 text-amber-600">no RSA PIN</span>}{s.profile?.nhf && !s.ids.nhf && <span className="text-amber-600">no NHF no.</span>}{s.ids.tin && (s.ids.rsa_pin || s.profile?.pension_exempt) ? <span className="text-emerald-700">complete</span> : null}</td>
                <td className="p-2 text-xs">{s.profile?.bank_name ? `${s.profile.bank_name} ${s.profile.account_no}` : ""}</td>
                <td className="p-2 text-right"><button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setEdit({ staff: s, p: s.profile ? { ...blank(s.id), ...s.profile } : blank(s.id) })}>{s.profile ? "Edit" : "Set salary"}</button></td></tr>
            );
          })}</tbody></table></div>
      )}
      <p className="mt-2 text-xs text-slate-500">TIN, RSA PIN, PFA and NHF numbers come from each person’s HR record (HR → Staff directory → Record, or My HR).</p>
      <Modal open={Boolean(edit)} onClose={() => setEdit(null)} title={`Salary: ${edit?.staff.full_name ?? ""}`} wide>
        {edit && (() => {
          const p = edit.p, set = (x: Partial<Profile>) => setEdit({ ...edit, p: { ...p, ...x } }), g = grade(p.grade_id);
          return (
            <form className="space-y-4" onSubmit={async e => {
              e.preventDefault();
              const r = await send("/api/payroll", { action: "save_profile", staff_id: edit.staff.id, grade_id: p.grade_id || null, basic: Number(g ? g.basic : p.basic),
                tax_percent: Number(p.tax_percent) || 0, pension_percent: Number(p.pension_percent) || 0, annual_rent: Number(p.annual_rent) || 0, nhf: p.nhf, nhis: p.nhis, pension_exempt: p.pension_exempt,
                allowances: p.allowances.filter(a => a.name && Number(a.amount) > 0).map(a => ({ name: a.name, amount: Number(a.amount), pensionable: a.pensionable ?? null, taxable: a.taxable ?? null })),
                deductions: p.deductions.filter(d => d.name).map(d => ({ name: d.name, amount: d.percent ? null : Number(d.amount ?? 0), percent: d.percent ? Number(d.percent) : null })),
                bank_name: p.bank_name, account_no: p.account_no, account_name: p.account_name });
              if (!r.ok) return setErr(r.error);
              setErr(null); setEdit(null); reload();
            }}>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Pay grade"><select className="input" value={p.grade_id ?? ""} onChange={e => set({ grade_id: e.target.value || null })}><option value="">No grade (enter pay below)</option>{data?.grades.map(x => <option key={x.id} value={x.id}>{x.name} · {money(x.basic, currency)}</option>)}</select></Field>
                <Field label="Monthly basic">{g ? <p className="py-2 tabular-nums">{money(g.basic, currency)} <span className="text-xs text-slate-500">from the grade</span></p> : <input className="input" type="number" min={0} step="any" value={p.basic} onChange={e => set({ basic: Number(e.target.value) })} />}</Field>
                <Field label="Annual rent paid (for rent relief)"><input className="input" type="number" min={0} step="any" value={p.annual_rent} onChange={e => set({ annual_rent: Number(e.target.value) })} /></Field>
              </div>
              {g && g.allowances.length > 0 && <p className="text-xs text-slate-500">From the grade: {g.allowances.map(a => `${a.name} ${money(a.amount, currency)}`).join(", ")}. Add any personal allowances below.</p>}
              <div><p className="label">{g ? "Personal allowances" : "Allowances"}</p><AllowanceRows list={p.allowances} onChange={l => set({ allowances: l })} /></div>
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-2"><input type="checkbox" checked={p.nhf} onChange={e => set({ nhf: e.target.checked })} />NHF</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={p.nhis} onChange={e => set({ nhis: e.target.checked })} />NHIS</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={p.pension_exempt} onChange={e => set({ pension_exempt: e.target.checked })} />Not in the pension scheme</label>
              </div>
              {flat && <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Pension % of basic"><input className="input" type="number" min={0} max={100} step="any" value={p.pension_percent} onChange={e => set({ pension_percent: Number(e.target.value) })} /></Field>
                <Field label="Tax % (flat)"><input className="input" type="number" min={0} max={100} step="any" value={p.tax_percent} onChange={e => set({ tax_percent: Number(e.target.value) })} /></Field>
              </div>}
              <div>
                <p className="label">Other deductions (fixed amount or % of basic; loans go under Loans & advances)</p>
                {p.deductions.map((d, i) => <div key={i} className="mb-1 flex gap-2"><input className="input" placeholder="e.g. Cooperative, union dues" value={d.name} onChange={e => set({ deductions: p.deductions.map((x, j) => j === i ? { ...x, name: e.target.value } : x) })} aria-label="Deduction name" />
                  <input className="input w-32" type="number" min={0} step="any" placeholder="Amount" value={d.amount ?? ""} onChange={e => set({ deductions: p.deductions.map((x, j) => j === i ? { ...x, amount: Number(e.target.value), percent: null } : x) })} aria-label="Deduction amount" />
                  <input className="input w-24" type="number" min={0} max={100} step="any" placeholder="%" value={d.percent ?? ""} onChange={e => set({ deductions: p.deductions.map((x, j) => j === i ? { ...x, percent: Number(e.target.value), amount: null } : x) })} aria-label="Deduction percent" /></div>)}
                <button type="button" className="btn btn-ghost text-xs" onClick={() => set({ deductions: [...p.deductions, { name: "", amount: 0 }] })}>+ Deduction</button>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Bank"><input className="input" value={p.bank_name ?? ""} onChange={e => set({ bank_name: e.target.value })} /></Field>
                <Field label="Account number"><input className="input" inputMode="numeric" value={p.account_no ?? ""} onChange={e => set({ account_no: e.target.value })} /></Field>
                <Field label="Account name"><input className="input" value={p.account_name ?? ""} onChange={e => set({ account_name: e.target.value })} /></Field>
              </div>
              {err && <Alert>{err}</Alert>}
              <div className="flex justify-end"><button className="btn btn-primary">Save salary</button></div>
            </form>
          );
        })()}
      </Modal>
    </div>
  );
}

function Loans({ currency }: { currency: string }) {
  const { data, reload } = useApi<{ loans: any[]; staff: { id: string; full_name: string; staff_no: string }[]; me: string; can_approve: boolean }>("/api/payroll?view=loans");
  const [add, setAdd] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const act = async (body: object, ok: string) => { const r = await send("/api/payroll", body); setMsg({ ok: r.ok, text: r.ok ? ok : r.error ?? "failed" }); reload(); return r.ok; };
  if (!data) return <Loading />;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2"><button className="btn btn-primary" onClick={() => setAdd(true)}>+ Loan or advance</button><p className="text-sm text-slate-500">Repaid from pay each month once approved; balances go down when the payroll is marked paid.</p></div>
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      {!data.loans.length ? <Empty>No loans or advances.</Empty> : (
        <div className="card overflow-x-auto"><table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-2">Staff</th><th className="p-2">Kind</th><th className="p-2 text-right">Amount</th><th className="p-2 text-right">Monthly</th><th className="p-2 text-right">Balance</th><th className="p-2">From</th><th className="p-2">Status</th><th className="p-2" /></tr></thead>
          <tbody>{data.loans.map(l => (
            <tr key={l.id} className="border-t border-slate-100"><td className="p-2">{l.staff?.full_name}{l.note && <div className="text-xs text-slate-500">{l.note}</div>}</td><td className="p-2 capitalize">{l.kind}</td>
              <td className="p-2 text-right tabular-nums">{money(l.principal, currency)}</td><td className="p-2 text-right tabular-nums">{money(l.monthly_deduction, currency)}</td><td className="p-2 text-right font-semibold tabular-nums">{money(l.balance, currency)}</td>
              <td className="p-2">{l.start_period}</td>
              <td className="p-2"><Badge tone={l.status === "settled" ? "green" : l.status === "cancelled" ? "slate" : l.approved_by ? "blue" : "amber"}>{l.status === "active" && !l.approved_by ? "awaiting approval" : l.status}</Badge></td>
              <td className="whitespace-nowrap p-2 text-right">
                {l.status === "active" && !l.approved_by && data.can_approve && l.created_by !== data.me && l.staff?.user_id !== data.me && <button className="btn btn-primary px-2 py-1 text-xs" onClick={() => act({ action: "approve_loan", id: l.id }, "Approved.")}>Approve</button>}
                {l.status === "active" && <button className="btn btn-ghost px-2 py-1 text-xs text-rose-600" onClick={() => confirm("Cancel this loan? Nothing more is deducted.") && act({ action: "cancel_loan", id: l.id }, "Cancelled.")}>Cancel</button>}
              </td></tr>))}</tbody></table></div>
      )}
      <Modal open={add} onClose={() => setAdd(false)} title="Loan or salary advance">
        <form className="space-y-3" onSubmit={async e => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          if (await act({ action: "add_loan", staff_id: String(fd.get("staff_id")), kind: String(fd.get("kind")), principal: Number(fd.get("principal")), monthly_deduction: Number(fd.get("monthly")),
            start_period: String(fd.get("start")), note: String(fd.get("note") || "") || null }, "Saved. The principal or another admin approves it before deductions start.")) setAdd(false);
        }}>
          <Field label="Staff"><select className="input" name="staff_id" required>{data.staff.map(s => <option key={s.id} value={s.id}>{s.full_name} ({s.staff_no})</option>)}</select></Field>
          <Field label="Kind"><select className="input" name="kind"><option value="loan">Loan</option><option value="advance">Salary advance</option></select></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Amount"><input className="input" type="number" name="principal" min={1} step="any" required /></Field>
            <Field label="Repay per month"><input className="input" type="number" name="monthly" min={1} step="any" required /></Field>
          </div>
          <Field label="First repayment month"><input className="input" type="month" name="start" required defaultValue={new Date().toISOString().slice(0, 7)} /></Field>
          <Field label="Note"><input className="input" name="note" maxLength={300} /></Field>
          <button className="btn btn-primary w-full">Save</button>
        </form>
      </Modal>
    </div>
  );
}

function SettingsTab({ currency }: { currency: string }) {
  const { data, reload } = useApi<{ settings: Settings; default_bands: { upto: number | null; rate: number }[]; grades: Grade[] }>("/api/payroll?view=settings");
  const [s, setS] = useState<Settings | null>(null);
  const [grade, setGrade] = useState<Partial<Grade> | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!data) return <Loading />;
  const cur = s ?? data.settings;
  const bands = cur.tax_bands ?? data.default_bands;
  const num = (k: keyof Settings, label: string, hint?: string) => <Field label={label} hint={hint}><input className="input" type="number" min={0} step="any" value={cur[k] as number} onChange={e => setS({ ...cur, [k]: Number(e.target.value) })} /></Field>;
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <form className="card space-y-3 p-4" onSubmit={async e => {
        e.preventDefault();
        const { saved: _s, ...body } = cur;
        const r = await send("/api/payroll", { action: "save_settings", ...body });
        setMsg({ ok: r.ok, text: r.ok ? "Saved. Recalculate any draft payroll to use the new rates." : r.error ?? "" });
        if (r.ok) { setS(null); reload(); }
      }}>
        <h2 className="font-semibold">Tax and statutory contributions</h2>
        {!data.settings.saved && <Alert tone="amber">These are the starting rates (Nigeria Tax Act 2025 and the Pension Reform Act 2014). Check them with your tax adviser, then save.</Alert>}
        <Field label="Tax"><select className="input" value={cur.tax_regime} onChange={e => setS({ ...cur, tax_regime: e.target.value as Settings["tax_regime"] })}>
          <option value="nta2025">PAYE by bands (Nigeria Tax Act 2025)</option><option value="flat">A flat percentage set for each person</option></select></Field>
        {cur.tax_regime === "nta2025" && <div>
          <p className="label">Annual bands</p>
          <table className="w-full text-sm"><tbody>{bands.map((b, i) => (
            <tr key={i}><td className="py-0.5 pr-2 text-slate-500">{i === 0 ? "First" : "Up to"}</td>
              <td className="py-0.5 pr-2">{b.upto === null ? <span className="text-slate-500">above that</span> : <input className="input" type="number" min={1} value={b.upto} onChange={e => setS({ ...cur, tax_bands: bands.map((x, j) => j === i ? { ...x, upto: Number(e.target.value) } : x) })} />}</td>
              <td className="w-28 py-0.5"><div className="flex items-center gap-1"><input className="input" type="number" min={0} max={100} step="any" value={b.rate} onChange={e => setS({ ...cur, tax_bands: bands.map((x, j) => j === i ? { ...x, rate: Number(e.target.value) } : x) })} />%</div></td></tr>))}</tbody></table>
          {cur.tax_bands && <button type="button" className="btn btn-ghost text-xs" onClick={() => setS({ ...cur, tax_bands: null })}>Use the Act’s bands</button>}
        </div>}
        <div className="grid gap-2 sm:grid-cols-2">
          {num("pension_employee_pct", "Pension, staff %", "of basic + housing + transport")}
          {num("pension_employer_pct", "Pension, school %")}
          {num("nhf_pct", "NHF %", "of basic, for staff in NHF")}
          {num("nhis_employee_pct", "NHIS, staff %")}
          {num("nhis_employer_pct", "NHIS, school %")}
          {num("nsitf_pct", "NSITF, school %", "of gross pay")}
          {num("itf_pct", "ITF, school %", "of gross pay, if the school must pay it")}
          {num("rent_relief_pct", "Rent relief %", "of annual rent paid")}
          {num("rent_relief_cap", `Rent relief cap (${currency})`)}
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={cur.prorate_joiners} onChange={e => setS({ ...cur, prorate_joiners: e.target.checked })} />Pay part of the month to people who join or leave during it</label>
        {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
        <button className="btn btn-primary w-full">Save</button>
      </form>
      <section className="card space-y-3 p-4">
        <div className="flex items-center"><h2 className="mr-auto font-semibold">Pay grades</h2><button className="btn btn-outline" onClick={() => setGrade({ name: "", basic: 0, allowances: [{ name: "Housing", amount: 0 }, { name: "Transport", amount: 0 }] })}>+ Grade</button></div>
        <p className="text-sm text-slate-500">Put staff on a grade under Salaries and their pay follows it; change the grade once and everyone on it moves.</p>
        {!data.grades.length ? <Empty>No grades yet.</Empty> : (
          <table className="w-full text-sm"><tbody>{data.grades.map(g => (
            <tr key={g.id} className="border-t border-slate-100"><td className="py-1.5 font-medium">{g.name}</td><td className="py-1.5 text-right tabular-nums">{money(g.basic, currency)}</td>
              <td className="py-1.5 text-xs text-slate-500">{g.allowances.map(a => a.name).join(", ")}</td>
              <td className="py-1.5 text-right"><button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setGrade(g)}>Edit</button>
                <button className="btn btn-ghost px-2 py-1 text-xs text-rose-600" onClick={async () => { if (confirm("Delete this grade?")) { const r = await send("/api/payroll", { action: "delete_grade", id: g.id }); if (!r.ok) alert(r.error); reload(); } }}>Delete</button></td></tr>))}</tbody></table>
        )}
      </section>
      <Modal open={Boolean(grade)} onClose={() => setGrade(null)} title={grade?.id ? "Edit grade" : "New grade"} wide>
        {grade && <form className="space-y-3" onSubmit={async e => {
          e.preventDefault();
          const r = await send("/api/payroll", { action: "save_grade", id: grade.id, name: grade.name, basic: Number(grade.basic),
            allowances: (grade.allowances ?? []).filter(a => a.name && Number(a.amount) > 0).map(a => ({ name: a.name, amount: Number(a.amount), pensionable: a.pensionable ?? null, taxable: a.taxable ?? null })) });
          if (!r.ok) return alert(r.error);
          setGrade(null); reload();
        }}>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Name"><input className="input" required placeholder="e.g. Grade 7 step 2" value={grade.name ?? ""} onChange={e => setGrade({ ...grade, name: e.target.value })} /></Field>
            <Field label="Monthly basic"><input className="input" type="number" min={0} step="any" value={grade.basic ?? 0} onChange={e => setGrade({ ...grade, basic: Number(e.target.value) })} /></Field>
          </div>
          <div><p className="label">Allowances</p><AllowanceRows list={grade.allowances ?? []} onChange={l => setGrade({ ...grade, allowances: l })} /></div>
          <button className="btn btn-primary w-full">Save grade</button>
        </form>}
      </Modal>
    </div>
  );
}

function Mine({ currency }: { currency: string }) {
  const { data, error } = useApi<{ payslips: any[]; loans: any[] }>("/api/payroll?view=mine");
  const [open, setOpen] = useState<any | null>(null);
  if (error) return <Alert tone="amber">{error}</Alert>;
  if (!data) return <Loading />;
  return (
    <div className="space-y-4">
      {data.loans.filter(l => l.status === "active" && l.approved_by).map(l => <Alert key={l.id} tone="blue">{l.kind === "advance" ? "Salary advance" : "Loan"}: {money(l.balance, currency)} left to repay at {money(l.monthly_deduction, currency)} a month.</Alert>)}
      {!data.payslips.length ? <Empty>No payslips yet. They appear here once a payroll is approved.</Empty> : data.payslips.map(p => (
        <button key={p.id} className="card flex w-full items-center justify-between p-4 text-left hover:border-brand-300" onClick={() => setOpen(p)}>
          <span className="font-semibold">{p.payroll_runs?.period}</span><span className="tabular-nums">Net {money(p.net, currency)}</span></button>))}
      <Modal open={Boolean(open)} onClose={() => setOpen(null)} title="Payslip">
        {open && <div className="text-sm">
          <p className="font-semibold">{open.staff?.full_name} · {open.staff?.staff_no}</p><p className="text-slate-500">{open.staff?.position} · {open.payroll_runs?.period}{open.payroll_runs?.paid_at ? ` · paid ${fmtDate(open.payroll_runs.paid_at)}` : ""}{open.days_worked != null ? ` · ${open.days_worked} days worked` : ""}</p>
          <div className="overflow-x-auto print:overflow-visible"><table className="mt-3 w-full"><tbody>
            <tr><td className="py-1">Basic</td><td className="text-right tabular-nums">{money(open.basic, currency)}</td></tr>
            {(open.allowances ?? []).map((a: any) => <tr key={a.name}><td className="py-1">{a.name}</td><td className="text-right tabular-nums">{money(a.amount, currency)}</td></tr>)}
            <tr className="border-t font-semibold"><td className="py-1">Gross</td><td className="text-right tabular-nums">{money(open.gross, currency)}</td></tr>
            {(open.deductions ?? []).map((d: any, i: number) => <tr key={i}><td className="py-1">{d.name}</td><td className="text-right tabular-nums">{d.amount > 0 ? `−${money(d.amount, currency)}` : ""}</td></tr>)}
            <tr className="border-t-2 text-base font-bold"><td className="py-1">Net pay</td><td className="text-right tabular-nums">{money(open.net, currency)}</td></tr>
          </tbody></table></div>
          {(open.employer_contributions ?? []).length > 0 && <div className="mt-3 rounded bg-slate-50 p-2 text-xs"><p className="font-semibold">Paid by the school on top of your pay</p>
            {open.employer_contributions.map((e: any) => <p key={e.name} className="flex justify-between"><span>{e.name}</span><span className="tabular-nums">{money(e.amount, currency)}</span></p>)}</div>}
          {Number(open.taxable_income) > 0 && <p className="mt-2 text-xs text-slate-500">Annual taxable income used for PAYE: {money(open.taxable_income, currency)}.</p>}
          <button className="btn btn-ghost mt-3 border border-slate-200" onClick={() => window.print()}>Print</button>
        </div>}
      </Modal>
    </div>
  );
}
