"use client";
import { useState } from "react";
import { useApi, send, Page, PageHeader, Tabs, Alert, Empty, Modal, Field, Badge, statusTone, fmtDate, rolesOf, type Me } from "@/components/ui";
import QrCode from "@/components/QrCode";

type Staff = {
  id: string; staff_no: string; full_name: string; email: string | null; phone: string | null; department: string | null; position: string | null;
  employment_type: string; hire_date: string | null; status: string; leave_allowance: number; leave_used: number; card_code: string; user_id: string | null;
  users: { id: string; role: string; extra_roles: string[]; active: boolean } | null;
};
type Leave = { id: string; leave_type: string; starts_on: string; ends_on: string; days: number; reason: string | null; status: string; decision_note: string | null; staff: { full_name: string; staff_no: string; user_id: string | null } | null };

const ROLE_OPTIONS = ["teacher", "school_admin", "principal", "it_admin", "bursar", "librarian", "hr_manager", "qa_officer", "gate_officer"];

export default function HrPage() {
  const { data: me } = useApi<Me>("/api/me");
  const roles = rolesOf(me);
  const isHr = ["hr_manager", "school_admin", "principal", "platform_admin"].some(r => roles.has(r));
  const isAdmin = ["school_admin", "principal", "platform_admin"].some(r => roles.has(r));
  const [tab, setTab] = useState<"staff" | "leave">("leave");
  return (
    <Page wide>
      <PageHeader eyebrow="People" title="HR & leave" subtitle="Staff records, access roles, ID cards and leave requests with approval. Staff sign-in times feed punctuality in Quality assurance." />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "leave", label: "Leave" }, { id: "staff", label: "Staff directory" }]} />
      {tab === "staff" ? <StaffTab isHr={isHr} isAdmin={isAdmin} myId={me?.profile?.id} /> : <LeaveTab />}
    </Page>
  );
}

function StaffTab({ isHr, isAdmin, myId }: { isHr: boolean; isAdmin: boolean; myId?: string }) {
  const { data, error, reload } = useApi<Staff[]>("/api/hr/staff");
  const [edit, setEdit] = useState<Partial<Staff> | null>(null);
  const [access, setAccess] = useState<Staff | null>(null);
  const [card, setCard] = useState<Staff | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div>
      {isHr && <button className="btn btn-primary mb-4" onClick={() => setEdit({ employment_type: "full_time", status: "active", leave_allowance: 20 })}>+ Add staff</button>}
      {error && <Alert>{error}</Alert>}
      {msg && <div className="mb-3"><Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert></div>}
      {!data?.length ? <Empty>No staff records yet.</Empty> : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-3">Staff</th><th className="p-3">Position</th><th className="p-3">Access</th><th className="p-3">Leave</th><th className="p-3">Status</th><th className="p-3" /></tr></thead>
            <tbody>
              {data.map(s => (
                <tr key={s.id} className="border-t border-slate-100">
                  <td className="p-3"><span className="font-medium">{s.full_name}</span><div className="text-xs text-slate-500">{s.staff_no} · {s.email ?? "no email"}</div></td>
                  <td className="p-3">{s.position}<div className="text-xs text-slate-500">{s.department}</div></td>
                  <td className="p-3">{s.users ? <div className="flex flex-wrap gap-1"><Badge tone={s.users.active ? "blue" : "red"}>{s.users.role.replace(/_/g, " ")}</Badge>{s.users.extra_roles.map(r => <Badge key={r}>{r.replace(/_/g, " ")}</Badge>)}</div> : <span className="text-xs text-slate-400">no login</span>}</td>
                  <td className="p-3 tabular-nums">{s.leave_used} / {s.leave_allowance} days</td>
                  <td className="p-3"><Badge tone={statusTone(s.status)}>{s.status}</Badge></td>
                  <td className="whitespace-nowrap p-3 text-right">
                    <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setCard(s)}>ID card</button>
                    {isHr && <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setEdit(s)}>Edit</button>}
                    {isAdmin && s.user_id !== myId && <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setAccess(s)}>{s.user_id ? "Roles" : "Give login"}</button>}
                    {isAdmin && s.users && s.user_id !== myId && <button className="btn btn-ghost px-2 py-1 text-xs" onClick={async () => { const r = await send("/api/hr/staff", { action: "set_active", staff_id: s.id, active: !s.users!.active }); setMsg({ ok: r.ok, text: r.ok ? "Updated." : r.error ?? "" }); reload(); }}>{s.users.active ? "Disable login" : "Enable login"}</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <StaffForm staff={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />
      <AccessForm staff={access} onClose={() => setAccess(null)} onDone={(t) => { setAccess(null); setMsg({ ok: true, text: t }); reload(); }} />
      <Modal open={Boolean(card)} onClose={() => setCard(null)} title="Staff ID card">
        {card && <div className="mx-auto w-72 rounded-xl border-2 border-slate-800 p-4 text-center">
          <p className="text-xs font-bold uppercase">Staff ID</p><p className="mt-1 text-lg font-bold">{card.full_name}</p>
          <p className="text-xs text-slate-600">{card.staff_no} · {card.position ?? ""}</p>
          <div className="mt-3 flex justify-center"><QrCode value={`EDU:${card.card_code}`} size={180} /></div>
        </div>}
        <div className="mt-4 flex justify-center"><button className="btn btn-primary" onClick={() => window.print()}>Print</button></div>
      </Modal>
    </div>
  );
}

function StaffForm({ staff, onClose, onSaved }: { staff: Partial<Staff> | null; onClose: () => void; onSaved: () => void }) {
  const [s, setS] = useState<Partial<Staff>>({});
  const [err, setErr] = useState<string | null>(null);
  const cur = { ...staff, ...s };
  const bind = (k: keyof Staff) => ({ value: (cur[k] as string | number) ?? "", onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setS({ ...s, [k]: e.target.value }) });
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const r = await send("/api/hr/staff", { action: "save", staff: {
      id: cur.id, staff_no: cur.staff_no, full_name: cur.full_name, email: cur.email || null, phone: cur.phone || null,
      department: cur.department || null, position: cur.position || null, employment_type: cur.employment_type, hire_date: cur.hire_date || null,
      status: cur.status, leave_allowance: Number(cur.leave_allowance ?? 20) } });
    if (!r.ok) return setErr(r.error);
    setS({}); setErr(null); onSaved();
  }
  return (
    <Modal open={Boolean(staff)} onClose={() => { setS({}); onClose(); }} title={cur.id ? "Edit staff" : "Add staff"} wide>
      <form onSubmit={save} className="grid gap-3 sm:grid-cols-3">
        <Field label="Staff number"><input className="input" required {...bind("staff_no")} /></Field>
        <Field label="Full name"><input className="input" required {...bind("full_name")} /></Field>
        <Field label="Email (needed for a login)"><input className="input" type="email" {...bind("email")} /></Field>
        <Field label="Phone"><input className="input" {...bind("phone")} /></Field>
        <Field label="Department"><input className="input" {...bind("department")} /></Field>
        <Field label="Position"><input className="input" {...bind("position")} /></Field>
        <Field label="Employment"><select className="input" {...bind("employment_type")}><option value="full_time">Full time</option><option value="part_time">Part time</option><option value="contract">Contract</option><option value="volunteer">Volunteer</option></select></Field>
        <Field label="Hire date"><input className="input" type="date" {...bind("hire_date")} /></Field>
        <Field label="Status"><select className="input" {...bind("status")}><option value="active">Active</option><option value="on_leave">On leave</option><option value="exited">Exited</option></select></Field>
        <Field label="Annual leave days"><input className="input" type="number" min={0} {...bind("leave_allowance")} /></Field>
        {err && <div className="sm:col-span-3"><Alert>{err}</Alert></div>}
        <div className="flex justify-end gap-2 sm:col-span-3"><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary">Save</button></div>
      </form>
    </Modal>
  );
}

function AccessForm({ staff, onClose, onDone }: { staff: Staff | null; onClose: () => void; onDone: (t: string) => void }) {
  const [role, setRole] = useState<string>("");
  const [extra, setExtra] = useState<string[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const r0 = role || staff?.users?.role || "teacher";
  const x0 = extra ?? staff?.users?.extra_roles ?? [];
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const r = await send("/api/hr/staff", { action: "grant_access", staff_id: staff!.id, role: r0, extra_roles: x0 });
    if (!r.ok) return setErr(r.error);
    setRole(""); setExtra(null); setErr(null);
    onDone(r.data.invited ? `Invitation sent to ${staff!.email}.` : "Roles updated.");
  }
  return (
    <Modal open={Boolean(staff)} onClose={() => { setRole(""); setExtra(null); onClose(); }} title={`Access: ${staff?.full_name ?? ""}`}>
      <form onSubmit={save} className="space-y-3">
        {!staff?.user_id && <p className="text-sm text-slate-600">An invitation email goes to <b>{staff?.email ?? "(no email: add one first)"}</b>.</p>}
        <Field label="Main role"><select className="input" value={r0} onChange={e => setRole(e.target.value)}>{ROLE_OPTIONS.map(r => <option key={r} value={r}>{r.replace(/_/g, " ")}</option>)}</select></Field>
        <fieldset>
          <legend className="label">Extra duties</legend>
          <div className="grid grid-cols-2 gap-1 text-sm">
            {ROLE_OPTIONS.filter(r => r !== r0).map(r => (
              <label key={r} className="flex items-center gap-2"><input type="checkbox" checked={x0.includes(r)} onChange={e => setExtra(e.target.checked ? [...x0, r] : x0.filter(y => y !== r))} />{r.replace(/_/g, " ")}</label>
            ))}
          </div>
        </fieldset>
        {err && <Alert>{err}</Alert>}
        <div className="flex justify-end gap-2"><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary">{staff?.user_id ? "Save roles" : "Send invitation"}</button></div>
      </form>
    </Modal>
  );
}

function LeaveTab() {
  const { data, error, reload } = useApi<{ items: Leave[]; me: { id: string; leave_allowance: number } | null; can_decide: boolean }>("/api/hr/leave");
  const [f, setF] = useState({ leave_type: "annual", starts_on: "", ends_on: "", reason: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function apply(e: React.FormEvent) {
    e.preventDefault();
    const r = await send("/api/hr/leave", { ...f, reason: f.reason || null });
    setMsg({ ok: r.ok, text: r.ok ? `Request submitted (${r.data.days} working days).` : r.error ?? "failed" });
    if (r.ok) { setF({ leave_type: "annual", starts_on: "", ends_on: "", reason: "" }); reload(); }
  }
  async function decide(id: string, status: string) {
    const note = status === "rejected" ? prompt("Reason?") ?? "" : "";
    const r = await send("/api/hr/leave", { id, status, note: note || null }, "PATCH");
    setMsg({ ok: r.ok, text: r.ok ? `Leave ${status}.` : r.error ?? "failed" });
    reload();
  }
  return (
    <div className="grid gap-5 xl:grid-cols-3">
      <form onSubmit={apply} className="card h-fit space-y-3 p-5">
        <h2 className="font-semibold">Request leave</h2>
        {!data?.me && data && <Alert tone="amber">Your account has no staff record, so you cannot request leave here.</Alert>}
        <Field label="Type"><select className="input" value={f.leave_type} onChange={e => setF({ ...f, leave_type: e.target.value })}>{["annual", "sick", "maternity", "paternity", "compassionate", "study", "unpaid", "other"].map(t => <option key={t}>{t}</option>)}</select></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="From"><input className="input" type="date" required value={f.starts_on} onChange={e => setF({ ...f, starts_on: e.target.value })} /></Field>
          <Field label="To"><input className="input" type="date" required value={f.ends_on} onChange={e => setF({ ...f, ends_on: e.target.value })} /></Field>
        </div>
        <Field label="Reason"><textarea className="input h-20" value={f.reason} onChange={e => setF({ ...f, reason: e.target.value })} /></Field>
        <button className="btn btn-primary w-full" disabled={!data?.me}>Submit</button>
      </form>
      <div className="xl:col-span-2">
        {error && <Alert>{error}</Alert>}
        {msg && <div className="mb-3"><Alert tone={msg.ok ? "green" : "red"}>{msg.text}</Alert></div>}
        {!data?.items.length ? <Empty>No leave requests.</Empty> : (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-3">Staff</th><th className="p-3">Type</th><th className="p-3">Dates</th><th className="p-3">Days</th><th className="p-3">Status</th><th className="p-3" /></tr></thead>
              <tbody>
                {data.items.map(l => (
                  <tr key={l.id} className="border-t border-slate-100">
                    <td className="p-3">{l.staff?.full_name}</td><td className="p-3">{l.leave_type}</td>
                    <td className="p-3">{fmtDate(l.starts_on)} – {fmtDate(l.ends_on)}{l.reason && <div className="text-xs text-slate-500">{l.reason}</div>}</td>
                    <td className="p-3 tabular-nums">{l.days}</td>
                    <td className="p-3"><Badge tone={statusTone(l.status)}>{l.status}</Badge>{l.decision_note && <div className="text-xs text-slate-500">{l.decision_note}</div>}</td>
                    <td className="whitespace-nowrap p-3 text-right">
                      {data.can_decide && l.status === "pending" && <>
                        <button className="btn btn-primary px-2 py-1 text-xs" onClick={() => decide(l.id, "approved")}>Approve</button>
                        <button className="btn btn-ghost px-2 py-1 text-xs text-rose-600" onClick={() => decide(l.id, "rejected")}>Reject</button>
                      </>}
                      {l.status === "pending" && <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => decide(l.id, "cancelled")}>Cancel</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
