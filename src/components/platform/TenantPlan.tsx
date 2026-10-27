"use client";
import { useEffect, useState } from "react";
import { useApi, send, Alert, Badge, Field, Loading, Modal, fmtDate } from "@/components/ui";
import PlanPicker, { emptyChoice, type PlanChoice, type PlanOption } from "./PlanPicker";
import ModulesEditor, { draftFrom, type Draft, type ModuleRowView } from "./ModulesEditor";
import { moduleLabel, naira, type ModuleGroup } from "@/lib/saas";

type Invoice = { id: string; number: string; status: string; kind: string; amount_cents: number; lines: { label: string; amount: number }[]; period_start: string | null; period_end: string | null; due_at: string | null; paid_at: string | null; method: string | null; reference: string | null; created_at: string };
type Sub = { status: string; cycle: "annual" | "termly"; band: number | null; add_on_groups: string[]; custom_annual: number | null; discount_pct: number; grace_days: number; period_start: string | null; period_end: string | null; cancel_at_period_end: boolean; notes: string | null };
type SubData = { subscription: Sub | null; plan: { code: string; name: string } | null; price: { annual: number | null; perInvoice: number | null } | null; invoices: Invoice[]; students: number; suggested_band: number | null };

const INV_TONE: Record<string, "green" | "amber" | "slate" | "blue"> = { paid: "green", open: "amber", void: "slate", draft: "blue" };

/** Plan & billing tab for one school on the platform. */
export function PlanTab({ tenantId }: { tenantId: string }) {
  const { data, reload } = useApi<SubData>(`/api/platform/tenants/${tenantId}/subscription`);
  const { data: catalog } = useApi<{ plans: PlanOption[]; group_prices: Record<string, number[]> }>("/api/platform/plans");
  const [choice, setChoice] = useState<PlanChoice | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pay, setPay] = useState<Invoice | null>(null);
  useEffect(() => {
    if (!data) return;
    const s = data.subscription;
    setChoice(s ? { plan_code: data.plan?.code ?? "growth", band: s.band, cycle: s.cycle, add_on_groups: (s.add_on_groups ?? []) as ModuleGroup[], custom_annual: s.custom_annual, discount_pct: Number(s.discount_pct ?? 0), grace_days: s.grace_days, status: s.status === "trial" ? "trial" : "active", issue_invoice: false, notes: s.notes ?? "" } : emptyChoice(data.suggested_band));
  }, [data]);
  if (!data || !catalog || !choice) return <Loading />;
  const s = data.subscription;

  async function save() {
    const r = await send(`/api/platform/tenants/${tenantId}/subscription`, { ...choice, notes: choice!.notes || null, period_start: s?.period_start ?? null, period_end: s?.period_end ?? null }, "PUT");
    setMsg({ ok: r.ok, text: r.ok ? `Plan saved.${r.data?.invoice ? ` Invoice ${r.data.invoice.number} sent.` : ""} Modules updated.` : r.error ?? "failed" });
    if (r.ok) reload();
  }
  async function cancelAtEnd(on: boolean) {
    const r = await send(`/api/platform/tenants/${tenantId}/subscription`, { ...choice, issue_invoice: false, notes: choice!.notes || null, period_start: s?.period_start, period_end: s?.period_end, cancel_at_period_end: on }, "PUT");
    setMsg({ ok: r.ok, text: r.ok ? (on ? "The subscription will end at the end of this period." : "The subscription will renew.") : r.error ?? "failed" });
    if (r.ok) reload();
  }
  async function voidInvoice(inv: Invoice) {
    const reason = window.prompt(`Why cancel invoice ${inv.number}?`);
    if (!reason) return;
    const r = await send("/api/platform/invoices", { action: "void", id: inv.id, reason }, "PATCH");
    setMsg({ ok: r.ok, text: r.ok ? `${inv.number} cancelled.` : r.error ?? "failed" });
    if (r.ok) reload();
  }
  return (
    <div className="space-y-5">
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      {s && (
        <section className="card grid gap-3 p-5 text-sm sm:grid-cols-4">
          <div><p className="text-xs text-slate-500">Plan</p><p className="font-semibold">{data.plan?.name ?? "—"}</p></div>
          <div><p className="text-xs text-slate-500">Status</p><Badge tone={s.status === "active" ? "green" : s.status === "trial" ? "blue" : s.status === "cancelled" ? "slate" : "amber"}>{s.status.replace("_", " ")}</Badge>{s.cancel_at_period_end && <p className="text-xs text-amber-700">ends at period end</p>}</div>
          <div><p className="text-xs text-slate-500">Current period</p><p>{s.period_start ? fmtDate(s.period_start) : "—"} to {s.period_end ? fmtDate(s.period_end) : "—"}</p></div>
          <div><p className="text-xs text-slate-500">Price</p><p className="font-semibold tabular-nums">{data.price?.annual != null ? `${naira(data.price.annual)} a year` : "needs a price"}</p></div>
        </section>
      )}
      <section className="card space-y-4 p-5">
        <h2 className="font-semibold">{s ? "Change the plan" : "Put this school on a plan"}</h2>
        {!s && <p className="text-sm text-slate-600">Until then every module stays on and nothing is billed.</p>}
        <PlanPicker plans={catalog.plans} groupPrices={catalog.group_prices} value={choice} onChange={setChoice} students={data.students} />
        <div className="flex flex-wrap justify-end gap-2">
          {s && s.status !== "cancelled" && <button className="btn btn-ghost" onClick={() => cancelAtEnd(!s.cancel_at_period_end)}>{s.cancel_at_period_end ? "Keep renewing" : "End at the end of this period"}</button>}
          <button className="btn btn-primary" onClick={save}>Save plan</button>
        </div>
        <p className="text-xs text-slate-500">Saving switches modules to match the plan straight away (your module overrides still apply). Price changes reach the school on its next invoice unless you send one now.</p>
      </section>
      <section className="card p-5">
        <h2 className="mb-3 font-semibold">Invoices</h2>
        {data.invoices.length === 0 ? <p className="text-sm text-slate-500">No invoices yet.</p> : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500"><tr><th className="py-1">Number</th><th>For</th><th className="text-right">Amount</th><th>Due</th><th>Status</th><th /></tr></thead>
            <tbody>
              {data.invoices.map(i => (
                <tr key={i.id} className="border-t border-slate-100">
                  <td className="py-2 font-mono text-xs">{i.number ?? "—"}</td>
                  <td>{i.period_start ? `${fmtDate(i.period_start)} to ${fmtDate(i.period_end!)}` : i.kind}</td>
                  <td className="text-right tabular-nums">{naira(i.amount_cents / 100)}</td>
                  <td>{i.due_at ? fmtDate(i.due_at) : "—"}</td>
                  <td><Badge tone={INV_TONE[i.status] ?? "slate"}>{i.status === "open" ? "unpaid" : i.status}</Badge>{i.paid_at && <span className="ml-1 text-xs text-slate-500">{fmtDate(i.paid_at)} · {i.method}</span>}</td>
                  <td className="text-right">{i.status === "open" && <><button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setPay(i)}>Record payment</button><button className="btn btn-ghost px-2 py-1 text-xs text-rose-700" onClick={() => voidInvoice(i)}>Cancel</button></>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <PayInvoice inv={pay} onClose={() => setPay(null)} onDone={t => { setPay(null); setMsg({ ok: true, text: t }); reload(); }} />
    </div>
  );
}

export function PayInvoice({ inv, onClose, onDone }: { inv: Invoice | { id: string; number: string; amount_cents: number } | null; onClose: () => void; onDone: (text: string) => void }) {
  const [f, setF] = useState({ method: "transfer", reference: "", paid_at: new Date().toISOString().slice(0, 10) });
  const [err, setErr] = useState<string | null>(null);
  if (!inv) return null;
  return (
    <Modal open onClose={onClose} title={`Record payment for ${inv.number}`}>
      <div className="space-y-3">
        <p className="text-sm">Amount: <b className="tabular-nums">{naira(inv.amount_cents / 100)}</b></p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Paid by"><select className="input" value={f.method} onChange={e => setF({ ...f, method: e.target.value })}>{["transfer", "card", "paystack", "cheque", "cash", "other"].map(m => <option key={m}>{m}</option>)}</select></Field>
          <Field label="Reference"><input className="input" value={f.reference} onChange={e => setF({ ...f, reference: e.target.value })} /></Field>
          <Field label="Date paid"><input className="input" type="date" value={f.paid_at} onChange={e => setF({ ...f, paid_at: e.target.value })} /></Field>
        </div>
        <p className="text-xs text-slate-500">This moves the school into the paid period and reopens it if it was paused for this bill.</p>
        {err && <Alert>{err}</Alert>}
        <div className="flex justify-end gap-2"><button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={async () => {
            const r = await send("/api/platform/invoices", { action: "paid", id: inv.id, method: f.method, reference: f.reference || null, paid_at: new Date(`${f.paid_at}T12:00:00`).toISOString() }, "PATCH");
            if (!r.ok) return setErr(r.error);
            onDone(`Payment recorded for ${inv.number}.`);
          }}>Record payment</button></div>
      </div>
    </Modal>
  );
}

/** Modules tab: PLAN / ON / OFF per module with end dates, checked before saving. */
export function ModulesTab({ tenantId }: { tenantId: string }) {
  const { data, reload } = useApi<{ plan: { name: string } | null; rows: ModuleRowView[] }>(`/api/platform/tenants/${tenantId}/modules`);
  const [draft, setDraft] = useState<Draft>({});
  const [check, setCheck] = useState<{ turnedOn: string[]; turnedOff: string[] } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { if (data) { setDraft(draftFrom(data.rows)); setCheck(null); } }, [data]);
  if (!data) return <Loading />;
  const payload = () => ({ overrides: Object.entries(draft).map(([module, d]) => ({ module, mode: d.mode, expires_at: d.mode !== "inherit" && d.expires_at ? new Date(`${d.expires_at}T23:59:59`).toISOString() : null, note: d.note || null })) });
  const changed = data.rows.some(r => (draft[r.key]?.mode ?? "inherit") !== (r.expired ? "inherit" : r.mode) || (draft[r.key]?.expires_at ?? "") !== (!r.expired && r.expires_at ? r.expires_at.slice(0, 10) : ""));
  return (
    <section className="card space-y-4 p-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1">
          <h2 className="font-semibold">Modules</h2>
          <p className="text-sm text-slate-600">{data.plan ? `Following the ${data.plan.name} plan.` : "No plan yet: every module follows \"on\"."} PLAN follows the plan; ON or OFF overrides it, for good or until a date. Every API checks this, not just the menus.</p>
        </div>
      </div>
      {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
      <ModulesEditor rows={data.rows} draft={draft} setDraft={d => { setDraft(d); setCheck(null); }} />
      {check && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
          <p className="font-semibold">Saving will:</p>
          {!check.turnedOn.length && !check.turnedOff.length && <p>Change no module (only end dates or notes).</p>}
          {check.turnedOn.length > 0 && <p>Switch ON: {check.turnedOn.map(moduleLabel).join(", ")}</p>}
          {check.turnedOff.length > 0 && <p>Switch OFF: {check.turnedOff.map(moduleLabel).join(", ")}. Staff lose those pages at once; no data is deleted.</p>}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button className="btn btn-ghost" disabled={!changed} onClick={() => setDraft(draftFrom(data.rows))}>Undo changes</button>
        {!check
          ? <button className="btn btn-outline" disabled={!changed} onClick={async () => { const r = await send(`/api/platform/tenants/${tenantId}/modules`, { ...payload(), preview: true }, "PUT"); if (r.ok) setCheck(r.data); else setMsg({ ok: false, text: r.error ?? "failed" }); }}>Check changes</button>
          : <button className="btn btn-primary" onClick={async () => { const r = await send(`/api/platform/tenants/${tenantId}/modules`, payload(), "PUT"); setMsg({ ok: r.ok, text: r.ok ? "Modules saved and in force now." : r.error ?? "failed" }); if (r.ok) reload(); }}>Save</button>}
      </div>
    </section>
  );
}

const ROLE_LABELS: Record<string, string> = {
  school_admin: "School admin", principal: "Principal", teacher: "Teacher", it_admin: "IT admin", bursar: "Bursar", librarian: "Librarian",
  hr_manager: "HR manager", qa_officer: "QA officer", gate_officer: "Gate officer", transport_officer: "Transport officer",
  hostel_warden: "Hostel warden", nurse: "Nurse", admissions_officer: "Admissions officer", cashier: "Cashier", counsellor: "Counsellor", exam_officer: "Exam officer"
};
const ALWAYS = ["school_admin", "principal", "teacher"];

/** The staff roles this school may give its people (its admins build custom roles from these). */
export function RolesCeiling({ allowed, save }: { allowed: string[] | null; save: (v: string[] | null) => Promise<boolean> }) {
  const [v, setV] = useState<string[] | null>(allowed);
  return (
    <section className="card space-y-3 p-5">
      <h2 className="font-semibold">Roles this school may use</h2>
      <p className="text-sm text-slate-600">School admin, principal and teacher are always allowed. Roles left out disappear from the school&apos;s choices and stop working for anyone who has them.</p>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v === null} onChange={e => setV(e.target.checked ? null : [...ALWAYS])} /> Every role</label>
      {v !== null && (
        <div className="grid gap-2 sm:grid-cols-3">
          {Object.keys(ROLE_LABELS).map(r => <label key={r} className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={ALWAYS.includes(r)} checked={ALWAYS.includes(r) || v.includes(r)} onChange={e => setV(e.target.checked ? [...v, r] : v.filter(x => x !== r))} /> {ROLE_LABELS[r]}</label>)}
        </div>
      )}
      <div className="flex justify-end"><button className="btn btn-primary" onClick={() => save(v)}>Save roles</button></div>
    </section>
  );
}
