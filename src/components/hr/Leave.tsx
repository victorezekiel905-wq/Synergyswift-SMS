"use client";
import { useState } from "react";
import { useApi, send, Alert, Empty, Modal, Field, Badge, statusTone, fmtDate } from "@/components/ui";

type LeaveRow = { id: string; leave_type: string; starts_on: string; ends_on: string; days: number; half_day: boolean; reason: string | null; cover_note: string | null; status: string; decision_note: string | null;
  manager_status: string | null; manager_note: string | null; document_id: string | null; mine: boolean; i_manage: boolean; staff: { id: string; full_name: string; department: string | null } | null };
type Balance = { leave_type: string; paid: boolean; entitlement: number | null; carried: number; taken: number; pending: number; remaining: number | null };
type Policy = { leave_type: string; days_per_year: number | null; paid: boolean; carry_over_max: number; needs_document: boolean; min_notice_days: number };
type Data = { items: LeaveRow[]; me: { id: string; full_name: string; balances: Balance[] } | null; can_decide: boolean; today: string; month: string; policies: Policy[];
  away: { name: string; department: string | null; starts_on: string; ends_on: string; leave_type: string; half_day: boolean }[] };

const TYPES = ["annual", "sick", "maternity", "paternity", "compassionate", "study", "unpaid", "other"];

/** Leave: balances, requests (half days, supporting documents), the line manager's recommendation, HR's decision, who is away, and policies. */
export function Leave({ staff }: { staff: { id: string; full_name: string; status: string }[] }) {
  const [month, setMonth] = useState<string | null>(null);
  const { data, error, reload } = useApi<Data>(`/api/hr/leave${month ? `?month=${month}` : ""}`, [month]);
  const blank = { staff_id: "", leave_type: "annual", starts_on: "", ends_on: "", half_day: false, reason: "", cover_note: "", override: false };
  const [f, setF] = useState(blank);
  const [file, setFile] = useState<File | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [filter, setFilter] = useState<"action" | "all" | "mine">("action");
  const [policies, setPolicies] = useState(false);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return null;
  const pol = data.policies.find(p => p.leave_type === f.leave_type);
  const bal = data.me?.balances.find(b => b.leave_type === f.leave_type);
  const needsAction = (l: LeaveRow) => l.status === "pending" && ((l.i_manage && l.manager_status === "pending") || (data.can_decide && !l.mine));
  const rows = data.items.filter(l => filter === "all" ? true : filter === "mine" ? l.mine : needsAction(l) || (l.mine && l.status === "pending"));

  async function apply(e: React.FormEvent) {
    e.preventDefault();
    let document_id: string | null = null;
    if (file) {
      const fd = new FormData();
      fd.set("file", file); fd.set("kind", f.leave_type === "sick" || f.leave_type === "maternity" ? "medical" : "other"); fd.set("title", `${f.leave_type} leave ${f.starts_on}`);
      if (f.staff_id) fd.set("staff_id", f.staff_id);
      const up = await fetch("/api/hr/documents", { method: "POST", body: fd });
      const j = await up.json().catch(() => ({}));
      if (!up.ok) return setMsg({ ok: false, text: j.error ?? "Could not upload the document" });
      document_id = j.id;
    }
    const r = await send<{ days: number; warnings: string[] }>("/api/hr/leave", { ...f, staff_id: f.staff_id || undefined, reason: f.reason || null, cover_note: f.cover_note || null, document_id });
    setMsg({ ok: r.ok, text: r.ok ? `Request sent (${r.data.days} working day${r.data.days === 1 ? "" : "s"}).${r.data.warnings?.length ? ` Filed despite: ${r.data.warnings.join("; ")}.` : ""}` : r.error ?? "failed" });
    if (r.ok) { setF(blank); setFile(null); reload(); }
  }
  const act = async (body: object, ok: string) => { const r = await send("/api/hr/leave", body, "PATCH"); setMsg({ ok: r.ok, text: r.ok ? ok : r.error ?? "failed" }); reload(); };

  return (
    <div className="grid gap-5 xl:grid-cols-3">
      <div className="space-y-4">
        {data.me && (
          <section className="card p-4">
            <h2 className="mb-2 font-semibold">My leave</h2>
            <ul className="space-y-1 text-sm">{data.me.balances.filter(b => b.entitlement !== null && (b.taken || b.pending || ["annual", "sick"].includes(b.leave_type))).map(b => (
              <li key={b.leave_type} className="flex justify-between"><span className="capitalize">{b.leave_type}</span><span className="tabular-nums"><b>{b.remaining}</b> of {Number(b.entitlement) + b.carried} left{b.pending ? ` (${b.pending} waiting)` : ""}</span></li>))}</ul>
          </section>
        )}
        <form onSubmit={apply} className="card space-y-3 p-4">
          <h2 className="font-semibold">Request leave</h2>
          {!data.me && !data.can_decide && <Alert tone="amber">Your account has no staff record, so you cannot request leave here.</Alert>}
          {data.can_decide && <Field label="For"><select className="input" value={f.staff_id} onChange={e => setF({ ...f, staff_id: e.target.value })}><option value="">{data.me ? "Myself" : "Choose…"}</option>{staff.filter(s => s.status !== "exited" && s.id !== data.me?.id).map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select></Field>}
          <Field label="Type"><select className="input capitalize" value={f.leave_type} onChange={e => setF({ ...f, leave_type: e.target.value })}>{TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="From"><input className="input" type="date" required value={f.starts_on} onChange={e => setF({ ...f, starts_on: e.target.value, ends_on: f.ends_on && f.ends_on >= e.target.value ? f.ends_on : e.target.value })} /></Field>
            <Field label="To"><input className="input" type="date" required min={f.starts_on} value={f.ends_on} onChange={e => setF({ ...f, ends_on: e.target.value })} /></Field>
          </div>
          {f.starts_on && f.starts_on === f.ends_on && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.half_day} onChange={e => setF({ ...f, half_day: e.target.checked })} />Half day</label>}
          <Field label="Reason"><textarea className="input h-16" maxLength={1000} value={f.reason} onChange={e => setF({ ...f, reason: e.target.value })} /></Field>
          <Field label="Cover arranged (classes, duties)"><input className="input" maxLength={500} value={f.cover_note} onChange={e => setF({ ...f, cover_note: e.target.value })} /></Field>
          <Field label={`Supporting document${pol?.needs_document ? " (required)" : ""}`}><input className="input" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={e => setFile(e.target.files?.[0] ?? null)} /></Field>
          {pol && <p className="text-xs text-slate-500">{pol.paid ? "Paid" : "Unpaid (deducted from pay)"}{pol.min_notice_days ? ` · ${pol.min_notice_days} days' notice` : ""}{!f.staff_id && bal?.remaining != null ? ` · ${bal.remaining} days left` : ""}. Weekends and school holidays are not counted.</p>}
          {data.can_decide && f.staff_id && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.override} onChange={e => setF({ ...f, override: e.target.checked })} />File even if notice or balance rules are not met</label>}
          <button className="btn btn-primary w-full" disabled={!data.me && !f.staff_id}>Send request</button>
        </form>
        {data.can_decide && <button className="text-sm text-brand-700 underline" onClick={() => setPolicies(true)}>Leave policies</button>}
      </div>

      <div className="space-y-4 xl:col-span-2">
        {msg && <Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert>}
        <div className="flex gap-1 text-sm">{([["action", "Needs attention"], ["mine", "Mine"], ["all", "All I can see"]] as const).map(([k, l]) => <button key={k} className={"rounded px-3 py-1 " + (filter === k ? "bg-brand-600 text-white" : "bg-slate-100")} onClick={() => setFilter(k)}>{l}</button>)}</div>
        {!rows.length ? <Empty>{filter === "action" ? "Nothing waiting." : "No leave requests."}</Empty> : (
          <div className="card overflow-x-auto"><table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-[13px] text-slate-500"><tr><th className="p-3">Staff</th><th className="p-3">Leave</th><th className="p-3">Days</th><th className="p-3">Status</th><th className="p-3" /></tr></thead>
            <tbody>{rows.map(l => (
              <tr key={l.id} className="border-t border-slate-100 align-top">
                <td className="p-3">{l.staff?.full_name}<div className="text-xs text-slate-500">{l.staff?.department}</div></td>
                <td className="p-3"><span className="capitalize">{l.leave_type}</span>: {fmtDate(l.starts_on)}{l.ends_on !== l.starts_on ? ` – ${fmtDate(l.ends_on)}` : ""}{l.half_day ? " (half day)" : ""}
                  {l.reason && <div className="text-xs text-slate-500">{l.reason}</div>}{l.cover_note && <div className="text-xs text-slate-500">Cover: {l.cover_note}</div>}
                  {l.document_id && <a className="text-xs text-brand-700 underline" href={`/api/hr/documents?id=${l.document_id}`} target="_blank" rel="noreferrer">document</a>}</td>
                <td className="p-3 tabular-nums">{l.days}</td>
                <td className="p-3"><Badge tone={statusTone(l.status)}>{l.status}</Badge>
                  {l.manager_status && <div className="mt-1 text-xs">{l.manager_status === "pending" ? "Line manager: waiting" : l.manager_status === "recommended" ? <span className="text-emerald-700">Line manager recommends</span> : <span className="text-rose-700">Line manager does not recommend</span>}{l.manager_note ? `: ${l.manager_note}` : ""}</div>}
                  {l.decision_note && <div className="text-xs text-slate-500">{l.decision_note}</div>}</td>
                <td className="space-y-1 whitespace-nowrap p-3 text-right">
                  {l.i_manage && l.status === "pending" && l.manager_status === "pending" && <div className="flex justify-end gap-1">
                    <button className="btn btn-outline px-2 py-1 text-xs" onClick={() => act({ action: "recommend", id: l.id, recommend: true, note: null }, "Recommended; HR has been told.")}>Recommend</button>
                    <button className="btn btn-ghost px-2 py-1 text-xs text-rose-600" onClick={() => { const n = prompt("Why not?"); if (n !== null) act({ action: "recommend", id: l.id, recommend: false, note: n || null }, "Sent to HR as not recommended."); }}>Don’t recommend</button></div>}
                  {data.can_decide && !l.mine && l.status === "pending" && <div className="flex justify-end gap-1">
                    <button className="btn btn-primary px-2 py-1 text-xs" onClick={() => act({ id: l.id, status: "approved" }, "Approved.")}>Approve</button>
                    <button className="btn btn-ghost px-2 py-1 text-xs text-rose-600" onClick={() => { const n = prompt("Reason?"); if (n !== null) act({ id: l.id, status: "rejected", note: n || null }, "Rejected."); }}>Reject</button></div>}
                  {(l.mine || data.can_decide) && (l.status === "pending" || (l.status === "approved" && l.ends_on >= data.today)) && <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => { if (confirm("Cancel this leave?")) act({ id: l.id, status: "cancelled" }, "Cancelled."); }}>Cancel</button>}
                </td>
              </tr>))}</tbody></table></div>
        )}
        <section className="card p-4">
          <div className="mb-2 flex items-center gap-2"><h2 className="mr-auto font-semibold">Who is away</h2><input className="input w-40" type="month" value={data.month} onChange={e => setMonth(e.target.value)} /></div>
          {!data.away.length ? <p className="text-sm text-slate-500">Nobody on approved leave this month.</p> : (
            <ul className="space-y-1 text-sm">{data.away.map((a, i) => <li key={i} className="flex flex-wrap gap-2"><span className="font-medium">{a.name}</span><span className="text-slate-500">{a.department}</span>
              <span className="capitalize">{a.leave_type}</span><span className="ml-auto tabular-nums">{fmtDate(a.starts_on)}{a.ends_on !== a.starts_on ? ` – ${fmtDate(a.ends_on)}` : ""}{a.half_day ? " (½)" : ""}</span></li>)}</ul>
          )}
          <p className="mt-2 text-xs text-slate-500">Approved leave for teachers with a login also appears in Cover, so their lessons can be covered.</p>
        </section>
      </div>
      <Modal open={policies} onClose={() => setPolicies(false)} title="Leave policies" wide><Policies onSaved={reload} /></Modal>
    </div>
  );
}

function Policies({ onSaved }: { onSaved: () => void }) {
  const { data, reload } = useApi<{ policies: (Policy & { annual_uses_allowance: boolean })[] }>("/api/hr/people?view=policies");
  const [msg, setMsg] = useState<string | null>(null);
  if (!data) return null;
  return (
    <div className="space-y-2">
      <p className="text-sm text-slate-600">Days per year for annual leave can be left blank to use each person’s own allowance (set on their staff record). Unpaid leave is deducted in payroll.</p>
      <div className="overflow-x-auto"><table className="w-full text-sm">
        <thead className="text-left text-[13px] text-slate-500"><tr><th className="py-1">Type</th><th className="py-1">Days / year</th><th className="py-1">Paid</th><th className="py-1">Carry over</th><th className="py-1">Notice</th><th className="py-1">Document</th><th /></tr></thead>
        <tbody>{data.policies.map(p => <PolicyRow key={p.leave_type} p={p} onSaved={() => { setMsg(`Saved ${p.leave_type}.`); reload(); onSaved(); }} />)}</tbody></table></div>
      {msg && <Alert tone="green">{msg}</Alert>}
    </div>
  );
}

function PolicyRow({ p, onSaved }: { p: Policy & { annual_uses_allowance: boolean }; onSaved: () => void }) {
  const [r, setR] = useState({ days: p.leave_type === "annual" && p.annual_uses_allowance ? "" : p.days_per_year === null ? "" : String(p.days_per_year), paid: p.paid, carry: String(p.carry_over_max), notice: String(p.min_notice_days), doc: p.needs_document });
  const [err, setErr] = useState<string | null>(null);
  return (
    <tr className="border-t border-slate-100">
      <td className="py-1 capitalize">{p.leave_type}</td>
      <td className="py-1 pr-2"><input className="input w-20" type="number" min={0} max={366} step={0.5} placeholder={p.leave_type === "annual" ? "own" : "no limit"} value={r.days} onChange={e => setR({ ...r, days: e.target.value })} /></td>
      <td className="py-1"><input type="checkbox" checked={r.paid} onChange={e => setR({ ...r, paid: e.target.checked })} aria-label="Paid" /></td>
      <td className="py-1 pr-2"><input className="input w-16" type="number" min={0} max={366} value={r.carry} onChange={e => setR({ ...r, carry: e.target.value })} /></td>
      <td className="py-1 pr-2"><input className="input w-16" type="number" min={0} max={365} value={r.notice} onChange={e => setR({ ...r, notice: e.target.value })} /></td>
      <td className="py-1"><input type="checkbox" checked={r.doc} onChange={e => setR({ ...r, doc: e.target.checked })} aria-label="Needs a document" /></td>
      <td className="py-1 text-right"><button className="btn btn-ghost px-2 py-1 text-xs" onClick={async () => {
        const res = await send("/api/hr/people", { action: "save_policy", leave_type: p.leave_type, days_per_year: r.days === "" ? null : Number(r.days), paid: r.paid, carry_over_max: Number(r.carry) || 0, needs_document: r.doc, min_notice_days: Number(r.notice) || 0 });
        if (!res.ok) setErr(res.error); else { setErr(null); onSaved(); }
      }}>Save</button>{err && <div className="text-xs text-rose-600">{err}</div>}</td>
    </tr>
  );
}
